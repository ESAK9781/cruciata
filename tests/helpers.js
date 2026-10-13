const { test: base, expect } = require("@playwright/test");
const os = require("os");
try {
  os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {}
const cooldown = process.env.CI
  ? 0
  : Number(process.env.CRUCIATA_TEST_COOLDOWN_MS ?? 8000);
// An automatic fixture works across files even when this module is cached.
const test = base.extend({
  _cooldown: [
    async ({ context }, use) => {
      await use();
      await context.close();
      if (cooldown > 0)
        await new Promise((resolve) => setTimeout(resolve, cooldown));
    },
    { auto: true },
  ],
});
module.exports = { test, expect };
