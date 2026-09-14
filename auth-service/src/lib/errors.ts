export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "HTTP_ERROR",
    public details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, message, "BAD_REQUEST", details);
}

export function unauthorized(message = "Não autenticado."): HttpError {
  return new HttpError(401, message, "UNAUTHORIZED");
}

export function forbidden(message = "Acesso negado."): HttpError {
  return new HttpError(403, message, "FORBIDDEN");
}

export function notFound(message = "Recurso não encontrado."): HttpError {
  return new HttpError(404, message, "NOT_FOUND");
}
