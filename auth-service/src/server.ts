import { loadEnv } from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { loadOrCreateKeys } from "./lib/jwt.js";
import { createApp } from "./createApp.js";

async function main() {
  const env = loadEnv();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const keys = await loadOrCreateKeys(env);
  const { app } = createApp({ env, prisma, keys });

  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`Auth Service Wega em ${env.PUBLIC_BASE_URL} (modo ${env.AUTH_MODE})`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
