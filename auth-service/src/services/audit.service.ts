import type { PrismaClient } from "@prisma/client";
import type { AuditEventType } from "../domain/types.js";

type AuditInput = {
  eventType: AuditEventType;
  userId?: string | null;
  email?: string | null;
  applicationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
  details?: Record<string, unknown>;
};

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        eventType: input.eventType,
        userId: input.userId ?? null,
        email: input.email ?? null,
        applicationId: input.applicationId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: input.success ?? true,
        details: input.details ? JSON.stringify(input.details) : null
      }
    });
  }

  async list(filters: { eventType?: string; email?: string; take?: number } = {}) {
    const take = Math.min(filters.take ?? 50, 200);
    return this.prisma.auditLog.findMany({
      where: {
        eventType: filters.eventType,
        email: filters.email
      },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        user: { select: { name: true, email: true } },
        application: { select: { code: true, name: true } }
      }
    });
  }
}
