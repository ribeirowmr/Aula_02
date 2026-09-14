import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  SignJWT,
  jwtVerify,
  type JWK
} from "jose";
import type { AppEnv } from "../config/env.js";
import type { AccessTokenClaims } from "../domain/types.js";

export type JwtKeys = {
  privateKey: Awaited<ReturnType<typeof importPKCS8>>;
  publicKey: Awaited<ReturnType<typeof importSPKI>>;
  publicJwk: JWK;
  kid: string;
};

const ALG = "RS256";

export async function loadOrCreateKeys(env: AppEnv): Promise<JwtKeys> {
  const privatePath = resolve(env.JWT_PRIVATE_KEY_PATH);
  const publicPath = resolve(env.JWT_PUBLIC_KEY_PATH);

  if (existsSync(privatePath) && existsSync(publicPath)) {
    const privatePem = readFileSync(privatePath, "utf8");
    const publicPem = readFileSync(publicPath, "utf8");
    return keysFromPem(privatePem, publicPem);
  }

  const { privateKey, publicKey } = await generateKeyPair(ALG, { modulusLength: 2048, extractable: true });
  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);

  mkdirSync(dirname(privatePath), { recursive: true });
  mkdirSync(dirname(publicPath), { recursive: true });
  writeFileSync(privatePath, privatePem, { mode: 0o600 });
  writeFileSync(publicPath, publicPem);

  return keysFromPem(privatePem, publicPem);
}

export async function createEphemeralKeys(): Promise<JwtKeys> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { modulusLength: 2048, extractable: true });
  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);
  return keysFromPem(privatePem, publicPem);
}

async function keysFromPem(privatePem: string, publicPem: string): Promise<JwtKeys> {
  const privateKey = await importPKCS8(privatePem, ALG);
  const publicKey = await importSPKI(publicPem, ALG);
  const publicJwk = await exportJWK(publicKey);
  const kid = "wega-auth-rs256";
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  publicJwk.alg = ALG;
  return { privateKey, publicKey, publicJwk, kid };
}

export async function signAccessToken(
  keys: JwtKeys,
  env: AppEnv,
  claims: Omit<AccessTokenClaims, "iss" | "iat" | "exp" | "jti"> & { jti?: string },
  ttlSeconds = env.JWT_ACCESS_TTL_SECONDS
): Promise<{ token: string; claims: AccessTokenClaims }> {
  const now = Math.floor(Date.now() / 1000);
  const jti = claims.jti ?? crypto.randomUUID();
  const payload: AccessTokenClaims = {
    ...claims,
    jti,
    iss: env.ISSUER,
    iat: now,
    exp: now + ttlSeconds
  };

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: ALG, kid: keys.kid, typ: "JWT" })
    .setIssuer(env.ISSUER)
    .setAudience(claims.aud)
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(payload.exp)
    .setJti(jti)
    .sign(keys.privateKey);

  return { token, claims: payload };
}

export async function verifyAccessToken(
  keys: JwtKeys,
  env: AppEnv,
  token: string,
  audience?: string
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, keys.publicKey, {
    issuer: env.ISSUER,
    audience
  });
  return payload as AccessTokenClaims;
}
