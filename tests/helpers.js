const { test, expect } = require("@playwright/test");
const os = require("os");
try {
  os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {}
const cooldown = process.env.CI
  ? 0
  : Number(process.env.CRUCIATA_TEST_COOLDOWN_MS ?? 8000);
test.afterEach(async ({ context }) => {
  await context.close();
  if (cooldown > 0)
    await new Promise((resolve) => setTimeout(resolve, cooldown));
});
module.exports = { test, expect };
