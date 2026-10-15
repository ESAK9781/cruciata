// Start npm start first. CPU-profiles a single large army order.
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(5);
    cruciata.scenario((s) => {
      const base = s.buildings.find((b) => b.team === 0 && b.kind === "towncenter");
      for (let i = 0; i < 120; i++) {
        const u = JSON.parse(JSON.stringify(s.units.find((u) => u.team === 0)));
        Object.assign(u, { id: 900000 + i, type: ["sword", "archer", "knight"][i % 3], x: base.x + 260 + (i % 12) * 30, y: base.y + 210 + Math.floor(i / 12) * 30, order: null, path: [], job: null, target: null });
        s.units.push(u);
      }
    });
  });
  await page.evaluate(() => {
    const snap = cruciata.snapshot();
    window.__ids = snap.units.filter((u) => u.id >= 900000).map((u) => u.id);
    const e = snap.buildings.find((b) => b.team === 1);
    window.__target = { x: e.x, y: e.y };
  });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  const ms = await page.evaluate(() => {
    const t = performance.now();
    cruciata.order(window.__ids, window.__target, false);
    return performance.now() - t;
  });
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map();
  const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ":" + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + dt[i]); });
  console.log("order ms", ms);
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + " " + (v / 1000).toFixed(1)).join("\n"));
  await browser.close();
})();
