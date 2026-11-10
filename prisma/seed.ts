// Seeds a realistic workspace by running real data through the real pipeline.
// `--if-empty` (used by the test copy's build) does nothing when companies already exist.
import { db } from "../src/lib/db";
import { seedDemo } from "../src/lib/seed";

async function main() {
  if (process.argv.includes("--if-empty") && (await db.account.count()) > 0) {
    console.log("Sample data already present; nothing to do.");
    return;
  }
  await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
