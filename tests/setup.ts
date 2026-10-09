// Integration tests run against a separate database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://abm:abm@localhost:5432/abm_test?schema=public";
process.env.ADAPTER_MODE = "mock";

// The general suites exercise pipeline mechanics with small, mixed-country sample companies.
// Manch's real targeting rule (India, more than 5,000 employees) is covered in tests/targeting.test.ts.
// (dynamic import: a static one would be hoisted above the DATABASE_URL line)
const { MANCH } = await import("@/lib/seller/manch");
MANCH.icp.mustHave = undefined;
MANCH.icp.industryMode = "targeted";
MANCH.icp.employees = { sweetSpot: 1000, mid: 500, min: 200 };

export {};
