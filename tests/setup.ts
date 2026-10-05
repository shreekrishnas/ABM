// Integration tests run against a separate database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://abm:abm@localhost:5432/abm_test?schema=public";
process.env.ADAPTER_MODE = "mock";
