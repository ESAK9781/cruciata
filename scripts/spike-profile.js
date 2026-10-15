// Start npm start first. Profiles live frames and prints the dominant call paths inside frames slower than a threshold.
// node scripts/spike-profile.js <level> <seconds> <thresholdMs>
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 5),
    seconds = Number(process.argv[3] || 130),
    threshold = Number(process.argv[4] || 80);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
  }, level);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  const clock = await page.evaluate(() => performance.now());
  const windows = await page.evaluate(
    ({ seconds, threshold }) => {
      const rows = [];
      for (let i = 0; i < seconds * 30; i++) {
        const t = performance.now();
        cruciata.liveFrame(1);
        const ms = performance.now() - t;
        if (ms > threshold)
          rows.push({ start: t, end: t + ms, ms, at: i / 30 });
      }
      return rows;
    },
    { seconds, threshold },
  );
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes)
    for (const c of n.children || []) parent.set(c, n.id);
  const label = (n) => n.callFrame.functionName + ":" + n.callFrame.lineNumber;
  let cum = 0;
  const stamps = profile.timeDeltas.map((d) => (cum += d) / 1000);
  for (const w of windows.slice(0, 8)) {
    const self = new Map(),
      total = new Map();
    profile.samples.forEach((id, i) => {
      const t = stamps[i] + clock - stamps[0] * 0;
      // The profiler clock starts at the first sample; align by the recorded start of the run.
      const rel = stamps[i];
      if (rel + clock < w.start - 0 || rel + clock > w.end + 0) return;
      const dt = profile.timeDeltas[i] / 1000,
        n = byId.get(id);
      self.set(label(n), (self.get(label(n)) || 0) + dt);
      const seen = new Set();
      for (let cur = id; cur; cur = parent.get(cur)) {
        const k = label(byId.get(cur));
        if (!seen.has(k)) {
          seen.add(k);
          total.set(k, (total.get(k) || 0) + dt);
        }
      }
    });
    console.log("== frame at", w.at.toFixed(1), "s", w.ms.toFixed(0), "ms");
    console.log(
      " self:",
      [...self]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => k + "=" + v.toFixed(0))
        .join(" | "),
    );
    console.log(
      " total:",
      [...total]
        .filter(([k]) => !/^(:0|evaluate|liveFrame|\(root\)|update:)/.test(k))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => k + "=" + v.toFixed(0))
        .join(" | "),
    );
  }
  await browser.close();
})();
