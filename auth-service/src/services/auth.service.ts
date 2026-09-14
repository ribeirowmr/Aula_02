import type { PrismaClient } from "@prisma/client";
import type { Request } from "express";
import type { AppEnv } from "../config/env.js";
import { AUDIT_EVENTS, type AccessTokenClaims, type IdentityProvider } from "../domain/types.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";
import { signAccessToken, verifyAccessToken, type JwtKeys } from "../lib/jwt.js";
import { AuditService } from "./audit.service.js";
import { AuthorizationService } from "./authorization.service.js";
import { SessionService } from "./session.service.js";
import { UserService } from "./user.service.js";
import { MockIdentityProvider } from "./identity.provider.js";

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.get("user-agent") ?? null
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly keys: JwtKeys,
    private readonly identity: IdentityProvider,
    private readonly users: UserService,
    private readonly authorization: AuthorizationService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService
  ) {}

  async startLogin(req: Request) {
    const clientId = String(req.query.client_id || "intranet");
    const redirectUri = String(req.query.redirect_uri || `${this.env.PUBLIC_BASE_URL}/app/callback`);
    const appState = req.query.state ? String(req.query.state) : undefined;

    const application = await this.prisma.application.findUnique({ where: { code: clientId } });
    if (!application || !application.isActive) {
      throw badRequest("Aplicação cliente não registrada.");
    }

    const allowed = JSON.parse(application.redirectUris) as string[];
    const parsedRedirect = new URL(redirectUri);
    const sameServiceCallback =
      this.env.NODE_ENV !== "production" &&
      ["/app/callback", "/callback"].includes(parsedRedirect.pathname);
    if (!allowed.includes(redirectUri) && !sameServiceCallback) {
      throw badRequest("redirect_uri não autorizado para esta aplicação.");
    }

    const { url } = await this.identity.getAuthorizationUrl({
      applicationId: application.id,
      redirectUri,
      appState
    });

    return { url, application };
  }

  async completeMockLogin(state: string, entraId: string) {
    if (!(this.identity instanceof MockIdentityProvider)) {
      throw badRequest("Login mock disponível somente em AUTH_MODE=mock.");
    }
    const { code } = await this.identity.completeMockLogin(state, entraId);
    return `/auth/redirect?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  }

  async handleRedirect(req: Request) {
    const state = String(req.query.state || "");
    const oidc = await this.prisma.oidcState.findUnique({
      where: { state },
      include: { application: true }
    });

    try {
      const profile = await this.identity.handleCallback({
        code: req.query.code ? String(req.query.code) : undefined,
        state: req.query.state ? String(req.query.state) : undefined,
        error: req.query.error ? String(req.query.error) : undefined,
        error_description: req.query.error_description
          ? String(req.query.error_description)
          : undefined
      });

      const stored = oidc;
      if (!stored) {
        throw badRequest("Contexto OIDC não encontrado após o callback.");
      }

      const user = await this.users.upsertFromIdentity(profile);
      if (user.status === "BLOCKED") {
        throw forbidden("Usuário bloqueado no Auth Service.");
      }

      const previousRoles = await this.authorization.resolveAccess(user.id);
      const access = await this.authorization.syncRolesFromGroups(user, profile.groups);

      const roleChanged =
        previousRoles.roles.join(",") !== access.roles.join(",") ||
        previousRoles.permissions.join(",") !== access.permissions.join(",");

      await this.audit.record({
        eventType: AUDIT_EVENTS.AUTH_SUCCESS,
        userId: user.id,
        email: user.email,
        applicationId: stored.applicationId,
        success: true,
        details: {
          entraId: profile.entraId,
          groups: profile.groups.map((group) => group.name),
          roles: access.roles
        },
        ...requestMeta(req)
      });

      if (roleChanged) {
        await this.audit.record({
          eventType: AUDIT_EVENTS.ACCESS_CHANGE,
          userId: user.id,
          email: user.email,
          applicationId: stored.applicationId,
          details: {
            previousRoles: previousRoles.roles,
            currentRoles: access.roles
          },
          ...requestMeta(req)
        });
      }

      const code = await this.sessions.createAuthorizationCode({
        userId: user.id,
        applicationId: stored.applicationId,
        redirectUri: stored.redirectUri
      });

      const redirect = new URL(stored.redirectUri);
      redirect.searchParams.set("code", code);
      if (stored.appState) {
        redirect.searchParams.set("state", stored.appState);
      }

      return {
        redirectUrl: redirect.toString(),
        user,
        application: stored.application
      };
    } catch (error) {
      await this.audit.record({
        eventType: AUDIT_EVENTS.AUTH_FAILURE,
        email: null,
        applicationId: oidc?.applicationId ?? null,
        success: false,
        details: {
          error: error instanceof Error ? error.message : "Falha desconhecida",
          query: {
            error: req.query.error,
            error_description: req.query.error_description
          }
        },
        ...requestMeta(req)
      });
      throw error;
    }
  }

  async exchangeCode(req: Request) {
    const code = String(req.body?.code || "");
    const redirectUri = String(req.body?.redirect_uri || "");
    const clientId = String(req.body?.client_id || "");

    if (!code || !redirectUri || !clientId) {
      throw badRequest("code, client_id e redirect_uri são obrigatórios.");
    }

    const application = await this.prisma.application.findUnique({ where: { code: clientId } });
    if (!application) {
      throw badRequest("Aplicação cliente inválida.");
    }

    const authCode = await this.sessions.consumeAuthorizationCode(code, redirectUri);
    if (authCode.applicationId !== application.id) {
      throw unauthorized("Código não pertence à aplicação informada.");
    }

    const user = await this.users.getById(authCode.userId);
    if (!user || user.status !== "ACTIVE") {
      throw forbidden("Usuário inativo.");
    }

    const access = await this.authorization.resolveAccess(user.id);
    const { session, refreshToken } = await this.sessions.create({
      userId: user.id,
      applicationId: application.id,
      ...requestMeta(req)
    });

    const { token, claims } = await signAccessToken(this.keys, this.env, {
      sub: user.id,
      entra_id: user.entraId,
      name: user.name,
      email: user.email,
      roles: access.roles,
      permissions: access.permissions,
      uo: user.organizationalUnit,
      department: user.department,
      company: user.company,
      preferred_language: user.preferredLanguage,
      aud: application.audience
    });

    await this.audit.record({
      eventType: AUDIT_EVENTS.TOKEN_ISSUED,
      userId: user.id,
      email: user.email,
      applicationId: application.id,
      details: { sessionId: session.id, roles: access.roles },
      ...requestMeta(req)
    });

    return {
      token_type: "Bearer",
      access_token: token,
      refresh_token: refreshToken,
      expires_in: this.env.JWT_ACCESS_TTL_SECONDS,
      claims
    };
  }

  async refresh(req: Request) {
    const refreshToken = String(req.body?.refresh_token || "");
    if (!refreshToken) {
      throw badRequest("refresh_token é obrigatório.");
    }

    const { session, refreshToken: nextRefresh } = await this.sessions.rotate(refreshToken);
    const user = await this.users.getById(session.userId);
    const application = await this.prisma.application.findUnique({
      where: { id: session.applicationId }
    });
    if (!user || !application || user.status !== "ACTIVE") {
      throw unauthorized("Sessão inválida.");
    }

    const access = await this.authorization.resolveAccess(user.id);
    const { token, claims } = await signAccessToken(this.keys, this.env, {
      sub: user.id,
      entra_id: user.entraId,
      name: user.name,
      email: user.email,
      roles: access.roles,
      permissions: access.permissions,
      uo: user.organizationalUnit,
      department: user.department,
      company: user.company,
      preferred_language: user.preferredLanguage,
      aud: application.audience
    });

    await this.audit.record({
      eventType: AUDIT_EVENTS.TOKEN_REFRESH,
      userId: user.id,
      email: user.email,
      applicationId: application.id,
      details: { sessionId: session.id },
      ...requestMeta(req)
    });

    return {
      token_type: "Bearer",
      access_token: token,
      refresh_token: nextRefresh,
      expires_in: this.env.JWT_ACCESS_TTL_SECONDS,
      claims
    };
  }

  async logout(req: Request) {
    const refreshToken = String(req.body?.refresh_token || req.cookies?.[this.env.SESSION_COOKIE_NAME] || "");
    const session = refreshToken ? await this.sessions.revokeByRefreshToken(refreshToken) : null;

    if (session) {
      const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
      await this.audit.record({
        eventType: AUDIT_EVENTS.LOGOUT,
        userId: session.userId,
        email: user?.email ?? null,
        applicationId: session.applicationId,
        details: { sessionId: session.id },
        ...requestMeta(req)
      });
    }

    return { ok: true };
  }

  async introspect(token: string, audience?: string) {
    const claims = await verifyAccessToken(this.keys, this.env, token, audience);
    return { active: true, ...claims };
  }

  async requireUser(claims: AccessTokenClaims) {
    const user = await this.users.getById(claims.sub);
    if (!user || user.status !== "ACTIVE") {
      throw unauthorized("Usuário inválido.");
    }
    return user;
  }

  requirePermission(claims: AccessTokenClaims, permission: string) {
    if (!claims.permissions.includes(permission) && !claims.roles.includes("AUTH-ADMIN")) {
      throw forbidden("Permissão insuficiente.");
    }
  }
}
