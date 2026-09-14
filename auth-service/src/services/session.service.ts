import type { PrismaClient } from "@prisma/client";
import { randomToken, sha256 } from "../lib/crypto.js";
import { unauthorized } from "../lib/errors.js";
import type { AppEnv } from "../config/env.js";

export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv
  ) {}

  async create(params: {
    userId: string;
    applicationId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    const refreshToken = randomToken(48);
    const session = await this.prisma.session.create({
      data: {
        userId: params.userId,
        applicationId: params.applicationId,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL_SECONDS * 1000),
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null
      }
    });
    return { session, refreshToken };
  }

  async rotate(refreshToken: string) {
    const current = await this.prisma.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) }
    });

    if (!current || current.revokedAt || current.expiresAt.getTime() < Date.now()) {
      throw unauthorized("Refresh token inválido ou expirado.");
    }

    await this.prisma.session.update({
      where: { id: current.id },
      data: { revokedAt: new Date() }
    });

    return this.create({
      userId: current.userId,
      applicationId: current.applicationId,
      ipAddress: current.ipAddress,
      userAgent: current.userAgent
    });
  }

  async revokeByRefreshToken(refreshToken: string) {
    const hash = sha256(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash }
    });
    if (!session || session.revokedAt) {
      return null;
    }
    return this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async createAuthorizationCode(params: {
    userId: string;
    applicationId: string;
    redirectUri: string;
  }) {
    const code = randomToken(32);
    await this.prisma.authorizationCode.create({
      data: {
        codeHash: sha256(code),
        userId: params.userId,
        applicationId: params.applicationId,
        redirectUri: params.redirectUri,
        expiresAt: new Date(Date.now() + 60 * 1000)
      }
    });
    return code;
  }

  async consumeAuthorizationCode(code: string, redirectUri: string) {
    const record = await this.prisma.authorizationCode.findUnique({
      where: { codeHash: sha256(code) }
    });
    if (
      !record ||
      record.consumedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.redirectUri !== redirectUri
    ) {
      throw unauthorized("Código de autorização inválido ou expirado.");
    }

    await this.prisma.authorizationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() }
    });

    return record;
  }
}
