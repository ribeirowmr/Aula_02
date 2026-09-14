import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../config/env.js";
import type { JwtKeys } from "../lib/jwt.js";
import { AuthorizationService } from "../services/authorization.service.js";
import { AuditService } from "../services/audit.service.js";
import { UserService } from "../services/user.service.js";
import { asyncHandler } from "../middleware/error.js";
import { bearerAuth } from "../middleware/auth.js";
import { unauthorized, forbidden, badRequest } from "../lib/errors.js";
import { AUDIT_EVENTS } from "../domain/types.js";

function isAdmin(roles: string[] = []) {
  return roles.includes("AUTH-ADMIN");
}

export function createAdminRouter(params: {
  env: AppEnv;
  keys: JwtKeys;
  prisma: PrismaClient;
  users: UserService;
  authorization: AuthorizationService;
  audit: AuditService;
}) {
  const router = Router();
  const { env, keys, prisma, users, authorization, audit } = params;

  router.use(bearerAuth(env, keys));
  router.use((req, _res, next) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    next();
  });

  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      res.json(req.auth);
    })
  );

  router.get(
    "/users",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden("Somente AUTH-ADMIN pode listar usuários.");
      }
      const list = await users.list();
      res.json(
        list.map((user) => ({
          id: user.id,
          entraId: user.entraId,
          name: user.name,
          email: user.email,
          organizationalUnit: user.organizationalUnit,
          department: user.department,
          company: user.company,
          country: user.country,
          status: user.status,
          lastAccessAt: user.lastAccessAt,
          roles: user.userRoles.map((item) => ({
            code: item.role.code,
            application: item.role.application.code,
            source: item.source
          }))
        }))
      );
    })
  );

  router.get(
    "/roles",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden("Somente AUTH-ADMIN pode gerenciar roles.");
      }
      const roles = await authorization.listRoles();
      res.json(
        roles.map((role) => ({
          id: role.id,
          code: role.code,
          name: role.name,
          description: role.description,
          application: role.application.code,
          isActive: role.isActive,
          permissions: role.permissions.map((item) => item.permission.code),
          entraGroups: role.groupMappings.map((item) => item.entraGroupName)
        }))
      );
    })
  );

  router.get(
    "/permissions",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden();
      }
      res.json(await authorization.listPermissions());
    })
  );

  router.get(
    "/mappings",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden();
      }
      const mappings = await authorization.listMappings();
      res.json(
        mappings.map((mapping) => ({
          id: mapping.id,
          entraGroupId: mapping.entraGroupId,
          entraGroupName: mapping.entraGroupName,
          role: mapping.role.code,
          application: mapping.role.application.code
        }))
      );
    })
  );

  router.get(
    "/applications",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden();
      }
      const apps = await prisma.application.findMany({ orderBy: { code: "asc" } });
      res.json(
        apps.map((app) => ({
          ...app,
          redirectUris: JSON.parse(app.redirectUris)
        }))
      );
    })
  );

  router.get(
    "/audit",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden("Somente AUTH-ADMIN pode consultar auditoria.");
      }
      const logs = await audit.list({
        eventType: req.query.eventType ? String(req.query.eventType) : undefined,
        email: req.query.email ? String(req.query.email) : undefined,
        take: req.query.take ? Number(req.query.take) : 50
      });
      res.json(
        logs.map((log) => ({
          id: log.id,
          eventType: log.eventType,
          email: log.email,
          success: log.success,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt,
          application: log.application?.code ?? null,
          user: log.user?.name ?? null,
          details: log.details ? JSON.parse(log.details) : null
        }))
      );
    })
  );

  router.post(
    "/roles/:roleId/permissions",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden();
      }
      const permissionCode = String(req.body?.permissionCode || "");
      if (!permissionCode) {
        throw badRequest("permissionCode é obrigatório.");
      }
      const role = await prisma.role.findUnique({ where: { id: String(req.params.roleId) } });
      if (!role) {
        throw badRequest("Role não encontrada.");
      }
      const permission = await prisma.permission.findFirst({
        where: { code: permissionCode, applicationId: role.applicationId }
      });
      if (!permission) {
        throw badRequest("Permissão não encontrada para a aplicação da role.");
      }
      await authorization.assignPermissionToRole(role.id, permission.id);
      await audit.record({
        eventType: AUDIT_EVENTS.ACCESS_CHANGE,
        userId: req.auth?.sub,
        email: req.auth?.email,
        details: { action: "GRANT_PERMISSION", role: role.code, permission: permission.code }
      });
      res.json({ ok: true });
    })
  );

  router.delete(
    "/roles/:roleId/permissions/:permissionCode",
    asyncHandler(async (req, res) => {
      if (!isAdmin(req.auth?.roles)) {
        throw forbidden();
      }
      const roleId = String(req.params.roleId);
      const permissionCode = String(req.params.permissionCode);
      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        throw badRequest("Role não encontrada.");
      }
      const permission = await prisma.permission.findFirst({
        where: { code: permissionCode, applicationId: role.applicationId }
      });
      if (!permission) {
        throw badRequest("Permissão não encontrada.");
      }
      await authorization.removePermissionFromRole(role.id, permission.id);
      await audit.record({
        eventType: AUDIT_EVENTS.ACCESS_CHANGE,
        userId: req.auth?.sub,
        email: req.auth?.email,
        details: { action: "REVOKE_PERMISSION", role: role.code, permission: permission.code }
      });
      res.json({ ok: true });
    })
  );

  return router;
}
