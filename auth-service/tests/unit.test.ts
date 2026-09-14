import { describe, expect, it } from "vitest";
import { deriveOrganizationalUnit } from "../src/services/user.service.js";
import { buildEntraAuthorizationUrl } from "../src/services/identity.provider.js";
import { loadEnv } from "../src/config/env.js";
import { pkceChallenge } from "../src/lib/crypto.js";
import { createEphemeralKeys, signAccessToken, verifyAccessToken } from "../src/lib/jwt.js";

describe("unidade organizacional e JWT", () => {
  it("deriva UO a partir de país e localização do Entra ID", () => {
    expect(
      deriveOrganizationalUnit({
        entraId: "1",
        email: "a@wega.com.br",
        name: "A",
        groups: [],
        attributes: { country: "BR", officeLocation: "SC", preferredLanguage: "pt-BR" }
      })
    ).toBe("BR-SC");
  });

  it("usa o idioma quando não há país", () => {
    expect(
      deriveOrganizationalUnit({
        entraId: "1",
        email: "a@wega.com.br",
        name: "A",
        groups: [],
        attributes: { preferredLanguage: "en-US" }
      })
    ).toBe("EN-US");
  });

  it("assina e valida JWT RS256 com iss, aud e exp", async () => {
    const env = loadEnv({
      DATABASE_URL: "file:./dev.db",
      ISSUER: "https://auth.wega.ind.br",
      PUBLIC_BASE_URL: "https://auth.wega.ind.br"
    });
    const keys = await createEphemeralKeys();
    const { token, claims } = await signAccessToken(keys, env, {
      sub: "user-1",
      entra_id: "entra-1",
      name: "Nome do Usuário",
      email: "usuario@wega.com.br",
      roles: ["COMEX-ADMIN"],
      permissions: ["comex.records.create"],
      uo: "BR-SC",
      department: "Comex",
      company: "Wega Motors",
      preferred_language: "pt-BR",
      aud: "comex"
    });

    const verified = await verifyAccessToken(keys, env, token, "comex");
    expect(verified.sub).toBe("user-1");
    expect(verified.roles).toContain("COMEX-ADMIN");
    expect(verified.iss).toBe("https://auth.wega.ind.br");
    expect(verified.aud).toBe("comex");
    expect(verified.exp).toBeGreaterThan(claims.iat);

    await expect(verifyAccessToken(keys, env, token, "financeiro")).rejects.toThrow();
  });

  it("monta Authorization Code Flow com PKCE para o Entra ID", () => {
    const env = loadEnv({
      DATABASE_URL: "file:./dev.db",
      AUTH_MODE: "entra",
      ENTRA_TENANT_ID: "tenant-id",
      ENTRA_CLIENT_ID: "client-id",
      ENTRA_CLIENT_SECRET: "secret",
      ENTRA_REDIRECT_URI: "http://localhost:3000/auth/redirect"
    });
    const verifier = "test-verifier-value-which-is-long-enough";
    const url = new URL(
      buildEntraAuthorizationUrl(env, {
        state: "abc",
        nonce: "def",
        codeVerifier: verifier
      })
    );
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toContain("/tenant-id/oauth2/v2.0/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier));
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});
