import { PrismaClient } from "@prisma/client";

export async function seedAuthCatalog(prisma: PrismaClient) {
  const redirectUris = JSON.stringify([
    "http://localhost:3000/app/callback",
    "http://localhost:3000/callback",
    "https://auth.wega.ind.br/app/callback",
    "https://intranet.wega.ind.br/callback",
    "https://comex.wega.ind.br/callback",
    "https://financeiro.wega.ind.br/callback"
  ]);

  async function upsertApplication(data: {
    code: string;
    name: string;
    audience: string;
    description: string;
  }) {
    return prisma.application.upsert({
      where: { code: data.code },
      update: { name: data.name, audience: data.audience, description: data.description, redirectUris },
      create: { ...data, redirectUris }
    });
  }

  async function upsertRole(data: {
    code: string;
    name: string;
    description: string;
    applicationId: string;
  }) {
    return prisma.role.upsert({
      where: { code: data.code },
      update: { name: data.name, description: data.description, applicationId: data.applicationId },
      create: data
    });
  }

  async function upsertPermission(data: {
    code: string;
    name: string;
    description: string;
    applicationId: string;
  }) {
    return prisma.permission.upsert({
      where: {
        applicationId_code: { applicationId: data.applicationId, code: data.code }
      },
      update: { name: data.name, description: data.description },
      create: data
    });
  }

  async function linkRolePermissions(roleId: string, permissionIds: string[]) {
    for (const permissionId of permissionIds) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId }
      });
    }
  }

  async function upsertMapping(entraGroupName: string, roleId: string, entraGroupId?: string) {
    await prisma.entraGroupMapping.upsert({
      where: { entraGroupName_roleId: { entraGroupName, roleId } },
      update: { entraGroupId: entraGroupId ?? null },
      create: { entraGroupName, roleId, entraGroupId: entraGroupId ?? null }
    });
  }

  const intranet = await upsertApplication({
    code: "intranet",
    name: "Intranet Wega",
    audience: "intranet",
    description: "Portal interno da Wega"
  });
  const comex = await upsertApplication({
    code: "comex",
    name: "Sistema Comex (Connect)",
    audience: "comex",
    description: "Sistema de comércio exterior"
  });
  const financeiro = await upsertApplication({
    code: "financeiro",
    name: "Sistema Financeiro",
    audience: "financeiro",
    description: "Sistema financeiro interno"
  });
  const authApp = await upsertApplication({
    code: "auth",
    name: "Auth Service",
    audience: "auth",
    description: "Administração do serviço de autenticação"
  });

  const authAdmin = await upsertRole({
    code: "AUTH-ADMIN",
    name: "Administrador do Auth Service",
    description: "Gerencia roles, permissões, mapeamentos e auditoria",
    applicationId: authApp.id
  });
  const comexAdmin = await upsertRole({
    code: "COMEX-ADMIN",
    name: "Administrador Comex",
    description: "Administradores do futuro Sistema Comex",
    applicationId: comex.id
  });
  const comexFinance = await upsertRole({
    code: "COMEX-FINANCE",
    name: "Financeiro Comex",
    description: "Usuários financeiros do Sistema Comex",
    applicationId: comex.id
  });
  const finAdmin = await upsertRole({
    code: "FIN-ADMIN",
    name: "Administrador Financeiro",
    description: "Administradores do Sistema Financeiro",
    applicationId: financeiro.id
  });
  const intranetUser = await upsertRole({
    code: "INTRANET-USER",
    name: "Usuário da Intranet",
    description: "Acesso básico à Intranet Wega",
    applicationId: intranet.id
  });

  const authPermissions = await Promise.all([
    upsertPermission({
      code: "auth.users.read",
      name: "Consultar usuários",
      description: "Listar cadastros internos de usuários",
      applicationId: authApp.id
    }),
    upsertPermission({
      code: "auth.roles.manage",
      name: "Gerenciar roles",
      description: "Alterar roles e permissões",
      applicationId: authApp.id
    }),
    upsertPermission({
      code: "auth.audit.read",
      name: "Consultar auditoria",
      description: "Ler eventos de autenticação e autorização",
      applicationId: authApp.id
    }),
    upsertPermission({
      code: "auth.applications.manage",
      name: "Gerenciar aplicações",
      description: "Administrar clientes internos do Auth Service",
      applicationId: authApp.id
    })
  ]);

  const comexPermissions = await Promise.all([
    upsertPermission({
      code: "comex.records.create",
      name: "Criar registros",
      description: "Criar registros no Comex",
      applicationId: comex.id
    }),
    upsertPermission({
      code: "comex.records.edit",
      name: "Editar registros",
      description: "Editar registros no Comex",
      applicationId: comex.id
    }),
    upsertPermission({
      code: "comex.records.delete",
      name: "Excluir registros",
      description: "Excluir registros no Comex",
      applicationId: comex.id
    }),
    upsertPermission({
      code: "comex.reports.read",
      name: "Consultar relatórios",
      description: "Consultar relatórios do Comex",
      applicationId: comex.id
    }),
    upsertPermission({
      code: "comex.users.admin",
      name: "Administrar usuários",
      description: "Administrar usuários no contexto Comex",
      applicationId: comex.id
    })
  ]);

  const financePermissions = await Promise.all([
    upsertPermission({
      code: "fin.records.create",
      name: "Criar registros financeiros",
      description: "Criar registros no Financeiro",
      applicationId: financeiro.id
    }),
    upsertPermission({
      code: "fin.records.edit",
      name: "Editar registros financeiros",
      description: "Editar registros no Financeiro",
      applicationId: financeiro.id
    }),
    upsertPermission({
      code: "fin.records.delete",
      name: "Excluir registros financeiros",
      description: "Excluir registros no Financeiro",
      applicationId: financeiro.id
    }),
    upsertPermission({
      code: "fin.reports.read",
      name: "Consultar relatórios financeiros",
      description: "Consultar relatórios do Financeiro",
      applicationId: financeiro.id
    }),
    upsertPermission({
      code: "fin.users.admin",
      name: "Administrar usuários financeiros",
      description: "Administrar usuários no contexto Financeiro",
      applicationId: financeiro.id
    })
  ]);

  const intranetPermissions = await Promise.all([
    upsertPermission({
      code: "intranet.home.read",
      name: "Acessar intranet",
      description: "Acesso ao portal interno",
      applicationId: intranet.id
    }),
    upsertPermission({
      code: "intranet.profile.read",
      name: "Consultar perfil",
      description: "Visualizar o próprio perfil",
      applicationId: intranet.id
    })
  ]);

  await linkRolePermissions(
    authAdmin.id,
    authPermissions.map((item) => item.id)
  );
  await linkRolePermissions(
    comexAdmin.id,
    comexPermissions.map((item) => item.id)
  );
  await linkRolePermissions(comexFinance.id, [
    comexPermissions.find((item) => item.code === "comex.records.create")!.id,
    comexPermissions.find((item) => item.code === "comex.records.edit")!.id,
    comexPermissions.find((item) => item.code === "comex.reports.read")!.id
  ]);
  await linkRolePermissions(
    finAdmin.id,
    financePermissions.map((item) => item.id)
  );
  await linkRolePermissions(
    intranetUser.id,
    intranetPermissions.map((item) => item.id)
  );

  await upsertMapping("AUTH-ADM", authAdmin.id, "g-auth-adm");
  await upsertMapping("CONNECT-ADM", comexAdmin.id, "g-connect-adm");
  await upsertMapping("CONNECT-ADM", intranetUser.id, "g-connect-adm");
  await upsertMapping("CONNECT-FINANCEIRO", comexFinance.id, "g-connect-fin");
  await upsertMapping("CONNECT-FINANCEIRO", intranetUser.id, "g-connect-fin");
  await upsertMapping("FINANCEIRO-ADM", finAdmin.id, "g-fin-adm");
  await upsertMapping("FINANCEIRO-ADM", intranetUser.id, "g-fin-adm");
}

const isDirectRun = process.argv[1]?.includes("seed.ts") || process.argv[1]?.includes("seed.js");

if (isDirectRun) {
  const prisma = new PrismaClient();
  seedAuthCatalog(prisma)
    .then(() => console.log("Seed do Auth Service concluído."))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
