import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../lib/errors.js";
import type { AccessTokenClaims } from "../domain/types.js";
import type { JwtKeys } from "../lib/jwt.js";
import { verifyAccessToken } from "../lib/jwt.js";
import type { AppEnv } from "../config/env.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export function bearerAuth(env: AppEnv, keys: JwtKeys) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.get("authorization") || "";
      const [, token] = header.split(" ");
      if (!token) {
        throw unauthorized("Token Bearer ausente.");
      }
      req.auth = await verifyAccessToken(keys, env, token);
      next();
    } catch (error) {
      next(error instanceof Error && error.name === "JWTExpired" ? unauthorized("Token expirado.") : error);
    }
  };
}

export function optionalBearerAuth(env: AppEnv, keys: JwtKeys) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.get("authorization") || "";
      const [, token] = header.split(" ");
      if (token) {
        req.auth = await verifyAccessToken(keys, env, token);
      }
      next();
    } catch {
      next();
    }
  };
}
