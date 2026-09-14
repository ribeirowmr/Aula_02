import type { Prisma, PrismaClient } from "@prisma/client";
import type { IdentityProfile } from "../domain/types.js";

export function deriveOrganizationalUnit(profile: IdentityProfile): string | null {
  const { country, officeLocation, preferredLanguage } = profile.attributes;
  if (country && officeLocation) {
    return `${country}-${officeLocation}`.toUpperCase();
  }
  if (country) {
    return country.toUpperCase();
  }
  if (preferredLanguage) {
    return preferredLanguage.toUpperCase();
  }
  return null;
}

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertFromIdentity(profile: IdentityProfile) {
    const organizationalUnit = deriveOrganizationalUnit(profile);
    const data: Prisma.UserUncheckedCreateInput = {
      entraId: profile.entraId,
      email: profile.email.toLowerCase(),
      name: profile.name,
      displayName: profile.displayName ?? profile.name,
      department: profile.attributes.department ?? null,
      company: profile.attributes.company ?? null,
      country: profile.attributes.country ?? null,
      officeLocation: profile.attributes.officeLocation ?? null,
      preferredLanguage: profile.attributes.preferredLanguage ?? null,
      organizationalUnit,
      status: "ACTIVE",
      lastAccessAt: new Date()
    };

    return this.prisma.user.upsert({
      where: { entraId: profile.entraId },
      create: data,
      update: {
        email: data.email,
        name: data.name,
        displayName: data.displayName,
        department: data.department,
        company: data.company,
        country: data.country,
        officeLocation: data.officeLocation,
        preferredLanguage: data.preferredLanguage,
        organizationalUnit: data.organizationalUnit,
        lastAccessAt: data.lastAccessAt,
        status: "ACTIVE"
      }
    });
  }

  async getById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                application: true,
                permissions: { include: { permission: true } }
              }
            }
          }
        }
      }
    });
  }

  async list() {
    return this.prisma.user.findMany({
      orderBy: { name: "asc" },
      include: {
        userRoles: {
          include: { role: { include: { application: true } } }
        }
      }
    });
  }
}
