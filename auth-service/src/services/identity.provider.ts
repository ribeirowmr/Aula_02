import type { PrismaClient } from "@prisma/client";
import { pkceChallenge, randomToken } from "../lib/crypto.js";
import { badRequest } from "../lib/errors.js";
import type { AppEnv } from "../config/env.js";
import type {
  AuthStartParams,
  AuthorizationUrlResult,
  CallbackQuery,
  IdentityProfile,
  IdentityProvider
} from "../domain/types.js";

export const MOCK_USERS: Array<IdentityProfile & { password?: string }> = [
  {
    entraId: "11111111-1111-1111-1111-111111111111",
    email: "maria.admin@wega.com.br",
    name: "Maria Souza",
    displayName: "Maria Souza",
    groups: [
      { id: "g-connect-adm", name: "CONNECT-ADM" },
      { id: "g-auth-adm", name: "AUTH-ADM" }
    ],
    attributes: {
      department: "Comércio Exterior",
      company: "Wega Motors",
      country: "BR",
      officeLocation: "SC",
      preferredLanguage: "pt-BR"
    }
  },
  {
    entraId: "22222222-2222-2222-2222-222222222222",
    email: "joao.financeiro@wega.com.br",
    name: "João Pereira",
    displayName: "João Pereira",
    groups: [{ id: "g-connect-fin", name: "CONNECT-FINANCEIRO" }],
    attributes: {
      department: "Financeiro Comex",
      company: "Wega Motors",
      country: "BR",
      officeLocation: "SC",
      preferredLanguage: "pt-BR"
    }
  },
  {
    entraId: "33333333-3333-3333-3333-333333333333",
    email: "ana.financeiro@wega.com.br",
    name: "Ana Ribeiro",
    displayName: "Ana Ribeiro",
    groups: [{ id: "g-fin-adm", name: "FINANCEIRO-ADM" }],
    attributes: {
      department: "Financeiro",
      company: "Wega Motors",
      country: "BR",
      officeLocation: "PR",
      preferredLanguage: "pt-BR"
    }
  },
  {
    entraId: "44444444-4444-4444-4444-444444444444",
    email: "pedro.consulta@wega.com.br",
    name: "Pedro Lima",
    displayName: "Pedro Lima",
    groups: [],
    attributes: {
      department: "Operações",
      company: "Wega Motors",
      country: "BR",
      officeLocation: "SP",
      preferredLanguage: "en-US"
    }
  }
];

export class MockIdentityProvider implements IdentityProvider {
  readonly mode = "mock" as const;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv
  ) {}

  async getAuthorizationUrl(params: AuthStartParams): Promise<AuthorizationUrlResult> {
    const state = randomToken(24);
    const nonce = randomToken(16);
    const codeVerifier = randomToken(32);

    await this.prisma.oidcState.create({
      data: {
        state,
        nonce,
        codeVerifier,
        applicationId: params.applicationId,
        redirectUri: params.redirectUri,
        appState: params.appState ?? null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    const url = new URL("/mock/login", this.env.PUBLIC_BASE_URL);
    url.searchParams.set("state", state);
    return { url: `${url.pathname}${url.search}`, state };
  }

  async completeMockLogin(state: string, entraId: string): Promise<{ code: string; state: string }> {
    const oidc = await this.prisma.oidcState.findUnique({ where: { state } });
    if (!oidc || oidc.expiresAt.getTime() < Date.now()) {
      throw badRequest("State OIDC inválido ou expirado.");
    }
    const profile = MOCK_USERS.find((user) => user.entraId === entraId);
    if (!profile) {
      throw badRequest("Usuário de demonstração não encontrado.");
    }
    const code = Buffer.from(JSON.stringify({ entraId, state }), "utf8").toString("base64url");
    return { code, state };
  }

  async handleCallback(query: CallbackQuery): Promise<IdentityProfile> {
    if (query.error) {
      throw badRequest(query.error_description || query.error);
    }
    if (!query.code || !query.state) {
      throw badRequest("Retorno OIDC incompleto.");
    }

    const oidc = await this.prisma.oidcState.findUnique({ where: { state: query.state } });
    if (!oidc || oidc.expiresAt.getTime() < Date.now()) {
      throw badRequest("State OIDC inválido ou expirado.");
    }

    let payload: { entraId: string; state: string };
    try {
      payload = JSON.parse(Buffer.from(query.code, "base64url").toString("utf8"));
    } catch {
      throw badRequest("Código de autorização mock inválido.");
    }

    if (payload.state !== query.state) {
      throw badRequest("State do código não confere.");
    }

    const profile = MOCK_USERS.find((user) => user.entraId === payload.entraId);
    if (!profile) {
      throw badRequest("Perfil mock não encontrado.");
    }

    await this.prisma.oidcState.delete({ where: { id: oidc.id } });
    return profile;
  }
}

export function buildEntraAuthorizationUrl(
  env: AppEnv,
  params: { state: string; nonce: string; codeVerifier: string }
): string {
  const url = new URL(
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize`
  );
  url.searchParams.set("client_id", env.ENTRA_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.ENTRA_REDIRECT_URI);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", env.ENTRA_SCOPES);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", pkceChallenge(params.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export class EntraIdentityProvider implements IdentityProvider {
  readonly mode = "entra" as const;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv
  ) {}

  async getAuthorizationUrl(params: AuthStartParams): Promise<AuthorizationUrlResult> {
    const state = randomToken(24);
    const nonce = randomToken(16);
    const codeVerifier = randomToken(48);

    await this.prisma.oidcState.create({
      data: {
        state,
        nonce,
        codeVerifier,
        applicationId: params.applicationId,
        redirectUri: params.redirectUri,
        appState: params.appState ?? null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    return {
      url: buildEntraAuthorizationUrl(this.env, { state, nonce, codeVerifier }),
      state
    };
  }

  async handleCallback(query: CallbackQuery): Promise<IdentityProfile> {
    if (query.error) {
      throw badRequest(query.error_description || query.error);
    }
    if (!query.code || !query.state) {
      throw badRequest("Retorno do Entra ID incompleto.");
    }

    const oidc = await this.prisma.oidcState.findUnique({ where: { state: query.state } });
    if (!oidc || oidc.expiresAt.getTime() < Date.now()) {
      throw badRequest("State OIDC inválido ou expirado.");
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.env.ENTRA_TENANT_ID}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: this.env.ENTRA_CLIENT_ID,
      client_secret: this.env.ENTRA_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: query.code,
      redirect_uri: this.env.ENTRA_REDIRECT_URI,
      code_verifier: oidc.codeVerifier,
      scope: this.env.ENTRA_SCOPES
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const tokenJson = (await tokenResponse.json()) as {
      access_token?: string;
      id_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenResponse.ok || !tokenJson.access_token) {
      throw badRequest(tokenJson.error_description || "Falha ao trocar o código no Entra ID.");
    }

    const profile = await this.fetchGraphProfile(tokenJson.access_token);
    await this.prisma.oidcState.delete({ where: { id: oidc.id } });
    return profile;
  }

  private async fetchGraphProfile(accessToken: string): Promise<IdentityProfile> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const select =
      "id,displayName,mail,userPrincipalName,givenName,surname,department,companyName,country,officeLocation,preferredLanguage";

    const [meResponse, groupsResponse] = await Promise.all([
      fetch(`https://graph.microsoft.com/v1.0/me?$select=${select}`, { headers }),
      fetch("https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName", { headers })
    ]);

    if (!meResponse.ok) {
      throw badRequest("Falha ao consultar o Microsoft Graph (usuário).");
    }

    const me = (await meResponse.json()) as {
      id: string;
      displayName?: string;
      mail?: string;
      userPrincipalName?: string;
      givenName?: string;
      surname?: string;
      department?: string;
      companyName?: string;
      country?: string;
      officeLocation?: string;
      preferredLanguage?: string;
    };

    let groups: { id?: string; name: string }[] = [];
    if (groupsResponse.ok) {
      const payload = (await groupsResponse.json()) as {
        value?: Array<{ id?: string; displayName?: string; "@odata.type"?: string }>;
      };
      groups = (payload.value ?? [])
        .filter((item) => !item["@odata.type"] || item["@odata.type"].includes("group"))
        .map((item) => ({ id: item.id, name: item.displayName || "" }))
        .filter((item) => item.name);
    }

    const email = me.mail || me.userPrincipalName;
    if (!email) {
      throw badRequest("O Microsoft Graph não retornou e-mail para o usuário autenticado.");
    }

    return {
      entraId: me.id,
      email,
      name: me.displayName || [me.givenName, me.surname].filter(Boolean).join(" ") || email,
      displayName: me.displayName ?? null,
      groups,
      attributes: {
        department: me.department ?? null,
        company: me.companyName ?? null,
        country: me.country ?? null,
        officeLocation: me.officeLocation ?? null,
        preferredLanguage: me.preferredLanguage ?? null
      }
    };
  }
}

export function createIdentityProvider(
  prisma: PrismaClient,
  env: AppEnv
): IdentityProvider & { completeMockLogin?: MockIdentityProvider["completeMockLogin"] } {
  if (env.AUTH_MODE === "mock") {
    return new MockIdentityProvider(prisma, env);
  }
  return new EntraIdentityProvider(prisma, env);
}
