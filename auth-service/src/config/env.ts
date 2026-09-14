import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_MODE: z.enum(["mock", "entra"]).default("mock"),
  DATABASE_URL: z.string().min(1),
  ISSUER: z.string().url().default("http://localhost:3000"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(3600),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
  SESSION_COOKIE_NAME: z.string().default("wega_auth_session"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  ENTRA_TENANT_ID: z.string().optional().default(""),
  ENTRA_CLIENT_ID: z.string().optional().default(""),
  ENTRA_CLIENT_SECRET: z.string().optional().default(""),
  ENTRA_REDIRECT_URI: z.string().optional().default("http://localhost:3000/auth/redirect"),
  ENTRA_SCOPES: z.string().optional().default("openid profile email offline_access User.Read GroupMember.Read.All"),
  JWT_PRIVATE_KEY_PATH: z.string().default("./keys/private.pem"),
  JWT_PUBLIC_KEY_PATH: z.string().default("./keys/public.pem")
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(overrides: Record<string, string | undefined> = {}): AppEnv {
  const source = { ...process.env, ...overrides };
  const parsed = envSchema.parse(source);

  if (parsed.AUTH_MODE === "entra") {
    if (!parsed.ENTRA_TENANT_ID || !parsed.ENTRA_CLIENT_ID || !parsed.ENTRA_CLIENT_SECRET) {
      throw new Error(
        "AUTH_MODE=entra exige ENTRA_TENANT_ID, ENTRA_CLIENT_ID e ENTRA_CLIENT_SECRET."
      );
    }
  }

  return parsed;
}
