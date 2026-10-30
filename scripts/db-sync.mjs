// Bring the local and test databases up to the current schema in one step:
//   npm run db:sync
// Uses `prisma db push` (schema → database) so it works whatever their migration history.
// Never point this at production: it only runs against localhost databases.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const fromEnvFile = () => {
  if (!existsSync(".env")) return undefined;
  return readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1];
};
const testUrl = () => readFileSync("tests/setup.ts", "utf8").match(/"(postgresql:\/\/[^"]+)"/)?.[1];

const targets = [
  ["local", process.env.DATABASE_URL ?? fromEnvFile()],
  ["test", process.env.TEST_DATABASE_URL ?? testUrl()],
].filter(([, url]) => url);

for (const [name, url] of targets) {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    console.error(`Skipping ${name}: ${host} is not a local database`);
    continue;
  }
  console.log(`Syncing the ${name} database…`);
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
}
