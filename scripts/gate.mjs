// The deploy gate: runs first in every build (`npm run build`, which Vercel runs). If a rule check
// fails, the build fails and the live site stays on its last good version. Type errors already stop
// `next build`. The database tests and browser journeys run on every push in GitHub Actions.
//
// Emergency only: GATE_SKIP=true lets a build through without the gate (say why in the commit).
import { execFileSync } from "node:child_process";

if (process.env.GATE_SKIP === "true") {
  console.warn("Deploy gate SKIPPED (GATE_SKIP=true).");
  process.exit(0);
}

const run = (label, cmd, args) => {
  console.log(`Deploy gate: ${label}…`);
  try {
    execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, ADAPTER_MODE: "mock" } });
  } catch {
    console.error(`\nDeploy gate FAILED: ${label}. Nothing was deployed; the live site keeps its last good version.`);
    process.exit(1);
  }
};

run("design tokens", "node", ["scripts/check-tokens.mjs"]);
run("rule checks (no database)", "npx", ["vitest", "run", "-c", "vitest.unit.config.ts", "--reporter=dot"]);
console.log("Deploy gate passed.");
