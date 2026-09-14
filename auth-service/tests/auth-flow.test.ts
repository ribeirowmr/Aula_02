import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";
import { createApp } from "../src/createApp.js";
import { createEphemeralKeys } from "../src/lib/jwt.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import { seedAuthCatalog } from "../prisma/seed.js";

const dbDir = mkdtempSync(join(tmpdir(), "wega-auth-"));
const databaseUrl = `file:${join(dbDir, "test.db")}`;

describe("fluxo de autenticação e autorização", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    AUTH_MODE: "mock",
    DATABASE_URL: databaseUrl,
    ISSUER: "http://localhost:3000",
    PUBLIC_BASE_URL: "http://localhost:3000"
  });
  const prisma = createPrismaClient(databaseUrl);
  let app: ReturnType<typeof createApp>["app"];

  beforeAll(async () => {
    execSync("npx prisma db push --skip-generate", {
      cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe"
    });
    await seedAuthCatalog(prisma);
    const keys = await createEphemeralKeys();
    ({ app } = createApp({ env, prisma, keys }));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function loginAs(entraId: string, clientId = "intranet") {
    const redirectUri = "http://localhost:3000/app/callback";
    const start = await request(app).get(
      `/auth/login?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`
    );
    expect(start.status).toBe(302);
    const mockUrl = new URL(start.headers.location, "http://localhost:3000");
    const state = mockUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    const mockComplete = await request(app)
      .post("/auth/mock/complete")
      .type("form")
      .send({ state, entraId });
    expect(mockComplete.status).toBe(302);

    const redirect = await request(app).get(mockComplete.headers.location);
    expect(redirect.status).toBe(302);
    const appCallback = new URL(redirect.headers.location);
    const code = appCallback.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await request(app).post("/auth/token").send({
      code,
      client_id: clientId,
      redirect_uri: redirectUri
    });
    expect(tokenRes.status).toBe(200);
    return tokenRes.body as {
      access_token: string;
      refresh_token: string;
      claims: {
        email: string;
        roles: string[];
        permissions: string[];
        uo: string | null;
        aud: string;
      };
    };
  }

  it("emite JWT com roles e permissões do COMEX-ADMIN para CONNECT-ADM", async () => {
    const tokens = await loginAs("11111111-1111-1111-1111-111111111111");
    expect(tokens.claims.email).toBe("maria.admin@wega.com.br");
    expect(tokens.claims.roles).toEqual(expect.arrayContaining(["AUTH-ADMIN", "COMEX-ADMIN", "INTRANET-USER"]));
    expect(tokens.claims.permissions).toEqual(
      expect.arrayContaining([
        "comex.records.create",
        "comex.records.delete",
        "comex.users.admin",
        "auth.audit.read"
      ])
    );
    expect(tokens.claims.uo).toBe("BR-SC");
    expect(tokens.claims.aud).toBe("intranet");
  });

  it("mapeia CONNECT-FINANCEIRO para COMEX-FINANCE sem permissão de exclusão", async () => {
    const tokens = await loginAs("22222222-2222-2222-2222-222222222222");
    expect(tokens.claims.roles).toEqual(expect.arrayContaining(["COMEX-FINANCE"]));
    expect(tokens.claims.roles).not.toContain("COMEX-ADMIN");
    expect(tokens.claims.permissions).toContain("comex.records.create");
    expect(tokens.claims.permissions).not.toContain("comex.records.delete");
  });

  it("não concede permissões a usuário sem grupo no Entra ID", async () => {
    const tokens = await loginAs("44444444-4444-4444-4444-444444444444");
    expect(tokens.claims.roles).toEqual([]);
    expect(tokens.claims.permissions).toEqual([]);
  });

  it("rejeita acesso administrativo sem AUTH-ADMIN", async () => {
    const tokens = await loginAs("22222222-2222-2222-2222-222222222222");
    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${tokens.access_token}`);
    expect(res.status).toBe(403);
  });

  it("permite consultar auditoria e usuários com AUTH-ADMIN", async () => {
    const tokens = await loginAs("11111111-1111-1111-1111-111111111111");
    const audit = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${tokens.access_token}`);
    expect(audit.status).toBe(200);
    expect(audit.body.some((item: { eventType: string }) => item.eventType === "AUTH_SUCCESS")).toBe(true);

    const users = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${tokens.access_token}`);
    expect(users.status).toBe(200);
    expect(users.body.some((item: { email: string }) => item.email === "maria.admin@wega.com.br")).toBe(true);
  });

  it("renova o access token e registra logout", async () => {
    const tokens = await loginAs("33333333-3333-3333-3333-333333333333");
    expect(tokens.claims.roles).toContain("FIN-ADMIN");

    const refreshed = await request(app).post("/auth/refresh").send({
      refresh_token: tokens.refresh_token
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).toBeTruthy();
    expect(refreshed.body.refresh_token).not.toBe(tokens.refresh_token);

    const reused = await request(app).post("/auth/refresh").send({
      refresh_token: tokens.refresh_token
    });
    expect(reused.status).toBe(401);

    const logout = await request(app).post("/auth/logout").send({
      refresh_token: refreshed.body.refresh_token
    });
    expect(logout.status).toBe(200);
  });

  it("expõe JWKS e configuração OIDC", async () => {
    const jwks = await request(app).get("/auth/jwks.json");
    expect(jwks.status).toBe(200);
    expect(jwks.body.keys[0].kty).toBe("RSA");

    const wellKnown = await request(app).get("/.well-known/openid-configuration");
    expect(wellKnown.body.issuer).toBe("http://localhost:3000");
    expect(wellKnown.body.token_endpoint).toContain("/auth/token");
  });

  it("não armazena senha no cadastro interno", async () => {
    await loginAs("11111111-1111-1111-1111-111111111111");
    const user = await prisma.user.findUnique({
      where: { email: "maria.admin@wega.com.br" }
    });
    expect(user).toBeTruthy();
    expect(JSON.stringify(user)).not.toMatch(/password|senha/i);
  });
});
