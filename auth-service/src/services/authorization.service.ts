import type { PrismaClient, User } from "@prisma/client";
import type { IdentityGroup } from "../domain/types.js";

export type ResolvedAccess = {
  roles: string[];
  permissions: string[];
  roleIds: string[];
};

function normalizeGroupName(name: string): string {
  return name.trim().toUpperCase();
}

export class AuthorizationService {
  constructor(private readonly prisma: PrismaClient) {}

  async syncRolesFromGroups(user: User, groups: IdentityGroup[]): Promise<ResolvedAccess> {
    const names = groups.map((group) => normalizeGroupName(group.name));
    const mappings = names.length
      ? await this.prisma.entraGroupMapping.findMany({
          where: {
            entraGroupName: { in: names }
          },
          include: { role: true }
        })
      : [];

    const activeMappings = mappings.filter((mapping) => mapping.role.isActive);
    const mappedRoleIds = new Set(activeMappings.map((mapping) => mapping.roleId));

    const existing = await this.prisma.userRole.findMany({
      where: { userId: user.id }
    });

    const toRemove = existing.filter(
      (item) => item.source === "ENTRA_GROUP" && !mappedRoleIds.has(item.roleId)
    );
    const existingEntraRoleIds = new Set(
      existing.filter((item) => item.source === "ENTRA_GROUP").map((item) => item.roleId)
    );
    const toAdd = [...mappedRoleIds].filter((roleId) => !existingEntraRoleIds.has(roleId));

    await this.prisma.$transaction([
      ...toRemove.map((item) =>
        this.prisma.userRole.delete({
          where: { userId_roleId: { userId: user.id, roleId: item.roleId } }
        })
      ),
      ...toAdd.map((roleId) =>
        this.prisma.userRole.create({
          data: { userId: user.id, roleId, source: "ENTRA_GROUP" }
        })
      )
    ]);

    return this.resolveAccess(user.id);
  }

  async resolveAccess(userId: string): Promise<ResolvedAccess> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } }
          }
        }
      }
    });

    const active = userRoles.filter((item) => item.role.isActive);
    const roles = [...new Set(active.map((item) => item.role.code))].sort();
    const permissions = [
      ...new Set(active.flatMap((item) => item.role.permissions.map((rp) => rp.permission.code)))
    ].sort();

    return {
      roles,
      permissions,
      roleIds: active.map((item) => item.role.id)
    };
  }

  async listRoles() {
    return this.prisma.role.findMany({
      orderBy: { code: "asc" },
      include: {
        application: true,
        permissions: { include: { permission: true } },
        groupMappings: true
      }
    });
  }

  async listMappings() {
    return this.prisma.entraGroupMapping.findMany({
      orderBy: { entraGroupName: "asc" },
      include: { role: { include: { application: true } } }
    });
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: { code: "asc" },
      include: { application: true }
    });
  }

  async assignPermissionToRole(roleId: string, permissionId: string) {
    return this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId }
    });
  }

  async removePermissionFromRole(roleId: string, permissionId: string) {
    return this.prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId, permissionId } }
    });
  }
}
