import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../config/env.js";
import type { JwtKeys } from "../lib/jwt.js";
import type { AuthService } from "../services/auth.service.js";
import { MOCK_USERS } from "../services/identity.provider.js";
import { asyncHandler } from "../middleware/error.js";
import { bearerAuth } from "../middleware/auth.js";
import { unauthorized } from "../lib/errors.js";

export function createAuthRouter(params: {
  env: AppEnv;
  keys: JwtKeys;
  prisma: PrismaClient;
  auth: AuthService;
  identity: { mode: string };
}) {
  const router = Router();
  const { env, keys, auth, identity } = params;

  router.get(
    "/login",
    asyncHandler(async (req, res) => {
      const { url } = await auth.startLogin(req);
      res.redirect(url);
    })
  );

  router.get(
    "/redirect",
    asyncHandler(async (req, res) => {
      const result = await auth.handleRedirect(req);
      res.redirect(result.redirectUrl);
    })
  );

  router.post(
    "/token",
    asyncHandler(async (req, res) => {
      const tokens = await auth.exchangeCode(req);
      res.cookie(env.SESSION_COOKIE_NAME, tokens.refresh_token, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.COOKIE_SECURE || env.NODE_ENV === "production",
        maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
        path: "/"
      });
      res.json(tokens);
    })
  );

  router.post(
    "/refresh",
    asyncHandler(async (req, res) => {
      if (!req.body?.refresh_token && req.cookies?.[env.SESSION_COOKIE_NAME]) {
        req.body = { ...req.body, refresh_token: req.cookies[env.SESSION_COOKIE_NAME] };
      }
      const tokens = await auth.refresh(req);
      res.cookie(env.SESSION_COOKIE_NAME, tokens.refresh_token, {
        httpOnly: true,
        sameSite: "lax",
        secure: env.COOKIE_SECURE || env.NODE_ENV === "production",
        maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000,
        path: "/"
      });
      res.json(tokens);
    })
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      if (!req.body?.refresh_token && req.cookies?.[env.SESSION_COOKIE_NAME]) {
        req.body = { ...req.body, refresh_token: req.cookies[env.SESSION_COOKIE_NAME] };
      }
      await auth.logout(req);
      res.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
      res.json({ ok: true });
    })
  );

  router.get(
    "/me",
    bearerAuth(env, keys),
    asyncHandler(async (req, res) => {
      if (!req.auth) {
        throw unauthorized();
      }
      const user = await auth.requireUser(req.auth);
      res.json({
        user: {
          id: user.id,
          entraId: user.entraId,
          email: user.email,
          name: user.name,
          organizationalUnit: user.organizationalUnit,
          department: user.department,
          company: user.company,
          country: user.country,
          officeLocation: user.officeLocation,
          preferredLanguage: user.preferredLanguage,
          status: user.status,
          lastAccessAt: user.lastAccessAt
        },
        roles: req.auth.roles,
        permissions: req.auth.permissions
      });
    })
  );

  router.post(
    "/introspect",
    asyncHandler(async (req, res) => {
      const token = String(req.body?.token || "");
      const audience = req.body?.audience ? String(req.body.audience) : undefined;
      if (!token) {
        res.json({ active: false });
        return;
      }
      try {
        const claims = await auth.introspect(token, audience);
        res.json(claims);
      } catch {
        res.json({ active: false });
      }
    })
  );

  router.get("/jwks.json", (_req, res) => {
    res.json({ keys: [keys.publicJwk] });
  });

  router.post(
    "/mock/complete",
    asyncHandler(async (req, res) => {
      const state = String(req.body?.state || req.query.state || "");
      const entraId = String(req.body?.entraId || req.query.entraId || "");
      const redirect = await auth.completeMockLogin(state, entraId);
      res.redirect(redirect);
    })
  );

  router.get("/mock/users", (_req, res) => {
    if (identity.mode !== "mock") {
      res.status(404).json({ error: "NOT_FOUND", message: "Modo mock desativado." });
      return;
    }
    res.json(
      MOCK_USERS.map((user) => ({
        entraId: user.entraId,
        name: user.name,
        email: user.email,
        groups: user.groups.map((group) => group.name),
        uo: `${user.attributes.country}-${user.attributes.officeLocation}`,
        language: user.attributes.preferredLanguage
      }))
    );
  });

  return router;
}

export function createWellKnownRouter(env: AppEnv, keys: JwtKeys) {
  const router = Router();
  router.get("/openid-configuration", (_req, res) => {
    res.json({
      issuer: env.ISSUER,
      authorization_endpoint: `${env.PUBLIC_BASE_URL}/auth/login`,
      token_endpoint: `${env.PUBLIC_BASE_URL}/auth/token`,
      userinfo_endpoint: `${env.PUBLIC_BASE_URL}/auth/me`,
      jwks_uri: `${env.PUBLIC_BASE_URL}/auth/jwks.json`,
      introspection_endpoint: `${env.PUBLIC_BASE_URL}/auth/introspect`,
      end_session_endpoint: `${env.PUBLIC_BASE_URL}/auth/logout`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email"]
    });
  });
  router.get("/jwks.json", (_req, res) => {
    res.json({ keys: [keys.publicJwk] });
  });
  return router;
}
