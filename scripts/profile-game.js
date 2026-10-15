// Start npm start first; this uses test-only hooks to profile a reproducible map.
const { chromium } = require("@playwright/test");
async function main() {
  const url = process.argv[2] || "http://127.0.0.1:3000/?test";
  const level = Number(process.argv[3] || 5),
    seconds = Number(process.argv[4] || 10);
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > 5 ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 60
  )
    throw new Error(
      "Usage: node scripts/profile-game.js [test URL] [level 0-5] [simulation seconds 1-60]",
    );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 },
    });
    await page.goto(url);
    await page.locator("#open-campaign").click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    const result = await page.evaluate(
      async ({ level, seconds }) => {
        document.getElementById("front-menu").hidden = true;
        const start = performance.now();
        cruciata.start(level);
        const initialized = performance.now();
        cruciata.camera(10300, 3700);
        cruciata.step(seconds);
        const simulated = performance.now();
        const snapshot = cruciata.snapshot(),
          frames = [];
        let previous = performance.now();
        for (let i = 0; i < 90; i++)
          await new Promise((resolve) =>
            requestAnimationFrame((now) => {
              frames.push(now - previous);
              previous = now;
              resolve();
            }),
          );
        frames.shift();
        frames.sort((a, b) => a - b);
        return {
          level,
          seconds,
          units: snapshot.units.length,
          buildings: snapshot.buildings.length,
          initializeMs: initialized - start,
          simulationMs: simulated - initialized,
          frameMedianMs: frames[Math.floor(frames.length * 0.5)],
          frameP95Ms: frames[Math.floor(frames.length * 0.95)],
        };
      },
      { level, seconds },
    );
    const { profile } = await cdp.send("Profiler.stop"),
      counts = new Map();
    for (const id of profile.samples || [])
      counts.set(id, (counts.get(id) || 0) + 1);
    const hot = profile.nodes
      .map((node) => ({
        function: node.callFrame.functionName,
        file: node.callFrame.url.split("/").at(-1),
        samples: counts.get(node.id) || 0,
      }))
      .sort((a, b) => b.samples - a.samples)
      .slice(0, 15);
    console.log(JSON.stringify({ result, hot }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
