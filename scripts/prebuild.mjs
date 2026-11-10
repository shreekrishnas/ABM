// Runs before every build. On the live site it does nothing.
// On the test copy (ABM_TEST_COPY=true) it brings the test database up to the current schema
// and loads the sample data when the database is empty.
import { execFileSync } from "node:child_process";

if (process.env.ABM_TEST_COPY !== "true") process.exit(0);

const url = process.env.DATABASE_URL ?? "";
let schema = "";
try {
  schema = new URL(url).searchParams.get("schema") ?? "";
} catch {}
// Safety: the test copy must use its own schema, never the live one.
if (!schema || schema === "abm" || schema === "public") {
  console.error(`Test copy: DATABASE_URL must end with ?schema=abm_test (found "${schema || "none"}"). Refusing to touch this database.`);
  process.exit(1);
}
const env = { ...process.env, ADAPTER_MODE: "mock" };
console.log(`Test copy: syncing schema "${schema}"…`);
execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { stdio: "inherit", env });
try {
  console.log("Test copy: loading sample data if the database is empty…");
  execFileSync("npx", ["tsx", "prisma/seed.ts", "--if-empty"], { stdio: "inherit", env, timeout: 240_000 });
} catch (e) {
  // The build still succeeds; sample data can be loaded from Settings instead.
  console.error("Test copy: sample data was not loaded during the build:", e?.message ?? e);
}
