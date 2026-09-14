import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "./config/env.js";
import type { JwtKeys } from "./lib/jwt.js";
import { AuthService } from "./services/auth.service.js";
import { AuditService } from "./services/audit.service.js";
import { AuthorizationService } from "./services/authorization.service.js";
import { SessionService } from "./services/session.service.js";
import { UserService } from "./services/user.service.js";
import { createIdentityProvider } from "./services/identity.provider.js";
import { createAuthRouter, createWellKnownRouter } from "./routes/auth.routes.js";
import { createAdminRouter } from "./routes/admin.routes.js";
import { errorHandler } from "./middleware/error.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(params: { env: AppEnv; prisma: PrismaClient; keys: JwtKeys }) {
  const { env, prisma, keys } = params;
  const identity = createIdentityProvider(prisma, env);
  const users = new UserService(prisma);
  const authorization = new AuthorizationService(prisma);
  const sessions = new SessionService(prisma, env);
  const audit = new AuditService(prisma);
  const auth = new AuthService(prisma, env, keys, identity, users, authorization, sessions, audit);
  const publicDir = resolve(__dirname, "../public");

  const app = express();
  app.set("trust proxy", 1);
  app.use(
    helmet({
      hsts: env.NODE_ENV === "production",
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null
        }
      }
    })
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(express.static(publicDir));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "wega-auth-service",
      mode: env.AUTH_MODE,
      issuer: env.ISSUER
    });
  });

  app.use("/auth", createAuthRouter({ env, keys, prisma, auth, identity }));
  app.use("/.well-known", createWellKnownRouter(env, keys));
  app.use("/api", createAdminRouter({ env, keys, prisma, users, authorization, audit }));

  app.get("/mock/login", (_req, res) => {
    res.sendFile(resolve(publicDir, "mock-login.html"));
  });
  app.get("/app/callback", (_req, res) => {
    res.sendFile(resolve(publicDir, "callback.html"));
  });
  app.get("/admin", (_req, res) => {
    res.sendFile(resolve(publicDir, "admin.html"));
  });

  app.use(errorHandler);

  return { app, auth, users, authorization, audit, identity };
}
