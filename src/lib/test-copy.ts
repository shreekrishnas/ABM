// The test copy: a separate deployment with its own database and sample data, where changes
// are checked before they go live. ABM_TEST_COPY=true marks it. Anything that can wipe or
// fake data is allowed only there.
export const isTestCopy = () => process.env.ABM_TEST_COPY === "true";
