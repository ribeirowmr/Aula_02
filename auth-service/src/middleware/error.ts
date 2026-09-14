import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const error = err instanceof HttpError ? err : null;
  const status = error?.status ?? 500;
  const message = error?.message ?? (err instanceof Error ? err.message : "Erro interno.");

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: error?.code ?? "INTERNAL_ERROR",
    message,
    details: error?.details
  });
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
