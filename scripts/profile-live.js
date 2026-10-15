// Start npm start first. CPU-profiles live frames of a campaign level: node scripts/profile-live.js <level> <seconds>.
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 3),
    seconds = Number(process.argv[3] || 190),
    warm = Number(process.argv[4] || 0);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
  }, level);
  if (warm)
    await page.evaluate((warm) => {
      for (let i = 0; i < warm * 30; i++) cruciata.liveFrame(1);
    }, warm);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  await cdp.send("Profiler.start");
  const worst = await page.evaluate((seconds) => {
    let w = 0,
      at = 0;
    for (let i = 0; i < seconds * 30; i++) {
      const [ms] = cruciata.liveFrame(1);
      if (ms > w) {
        w = ms;
        at = i / 30;
      }
    }
    return { w, at };
  }, seconds);
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes)
    for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map(),
    total = new Map();
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i];
    const n = byId.get(id),
      k =
        n.callFrame.functionName +
        ":" +
        n.callFrame.url.split("/").pop() +
        ":" +
        n.callFrame.lineNumber;
    self.set(k, (self.get(k) || 0) + dt);
    const seen = new Set();
    for (let cur = id; cur; cur = parent.get(cur)) {
      const m = byId.get(cur),
        kk =
          m.callFrame.functionName +
          ":" +
          m.callFrame.url.split("/").pop() +
          ":" +
          m.callFrame.lineNumber;
      if (!seen.has(kk)) {
        seen.add(kk);
        total.set(kk, (total.get(kk) || 0) + dt);
      }
    }
  });
  console.log("worst frame", worst);
  console.log(
    "SELF\n" +
      [...self]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => k + " " + (v / 1000).toFixed(0))
        .join("\n"),
  );
  console.log(
    "TOTAL\n" +
      [...total]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k, v]) => k + " " + (v / 1000).toFixed(0))
        .join("\n"),
  );
  await browser.close();
})();
