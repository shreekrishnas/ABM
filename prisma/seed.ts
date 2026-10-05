// Seeds a realistic workspace by running real data through the real pipeline.
import { db } from "../src/lib/db";
import { seedDemo } from "../src/lib/seed";

seedDemo()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
