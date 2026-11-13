// Prepares the database for the browser tests: sample data through the real pipeline (stand-in
// services) and a signed-in Super Admin. Only ever runs on a local database named *e2e*.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const url = process.env.E2E_DATABASE_URL ?? "postgresql://abm:abm@localhost:5432/abm_e2e?schema=public";
const u = new URL(url);
if (!/^(localhost|127\.0\.0\.1|postgres)$/.test(u.hostname) || !/e2e/.test(u.pathname)) {
  console.error(`Refusing: the browser tests only run on a local database named *e2e* (got ${u.hostname}${u.pathname}).`);
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.ADAPTER_MODE = "mock";
process.env.AUTH_SECRET ??= "e2e-secret";

// Create the database if needed, then bring it to the current schema.
try {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  execFileSync("psql", [admin.toString(), "-c", `CREATE DATABASE "${u.pathname.slice(1)}"`], { stdio: "ignore" });
} catch {
  /* already exists */
}
execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { stdio: "inherit", env: process.env });

const { baseDb } = await import("@/lib/db-base");
const tables = await baseDb.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
await baseDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
const { seedDemo } = await import("@/lib/seed");
await seedDemo(() => undefined);
const { DEFAULT_SELLER_ID } = await import("@/lib/seller");
const user = await baseDb.user.upsert({ where: { email: "e2e@trilliantdigital.com" }, create: { name: "E2E Admin", email: "e2e@trilliantdigital.com", role: "admin", superAdmin: true }, update: { superAdmin: true } });
await baseDb.userClient.upsert({ where: { userId_clientId: { userId: user.id, clientId: DEFAULT_SELLER_ID } }, create: { userId: user.id, clientId: DEFAULT_SELLER_ID }, update: {} });
const { sessionToken } = await import("@/lib/auth");
const token = await sessionToken(user.email, process.env.AUTH_SECRET!);
writeFileSync(new URL("./.session.json", import.meta.url), JSON.stringify({ token, client: DEFAULT_SELLER_ID }));
console.log(`E2E database ready: ${await baseDb.account.count()} companies, signed in as ${user.email}`);
await baseDb.$disconnect();
