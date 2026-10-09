// Run the pipeline from the command line.
//
//   npm run pipeline:run                     one scheduler tick (queue, sends, watchlist, …)
//   npm run pipeline:run -- <accountId> ...   run these accounts from their next stage
//   npm run pipeline:run -- --from 5 <id>     re-run an account from a given stage
//
// Uses the same DATABASE_URL and adapters as the app (ADAPTER_MODE=mock for mocks).

import { db } from "../src/lib/db";
import { newContext } from "../src/lib/pipeline/context";
import { processIntent, runAccount, tick } from "../src/lib/pipeline/orchestrator";

async function main() {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const fromStage = fromIdx >= 0 ? Number(args[fromIdx + 1]) : undefined;
  if (fromIdx >= 0 && (!Number.isInteger(fromStage) || fromStage! < 2 || fromStage! > 11)) throw new Error("--from must be a stage between 2 and 11");
  const ids = fromIdx >= 0 ? args.filter((_, i) => i !== fromIdx && i !== fromIdx + 1) : args;
  const ctx = newContext();

  if (ids.length === 0) {
    const result = await tick(ctx);
    const intent = await processIntent(ctx);
    console.log(JSON.stringify({ ...result, intentReruns: intent.length }, null, 2));
    return;
  }
  for (const id of ids) {
    const r = await runAccount(id, { fromStage, ctx });
    console.log(`${id}: ${r.status} at stage ${r.reachedStage} — ${r.reason}`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
