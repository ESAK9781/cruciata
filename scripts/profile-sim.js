// Start npm start first. CPU-profiles N simulated seconds of a campaign level (default: level 0, 120 s).
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 0),
    seconds = Number(process.argv[3] || 120);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate((level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
    cruciata.scenario((s) => {
      const scout = s.units.find((u) => u.team === 1 && u.type === "archer");
      if (scout) {
        scout.x = 1050;
        scout.y = 1700;
        scout.hold = true;
      }
    });
  }, level);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const ms = await page.evaluate((seconds) => {
    const t = performance.now();
    cruciata.step(seconds);
    return performance.now() - t;
  }, seconds);
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const k =
      n.callFrame.functionName +
      ":" +
      n.callFrame.url.split("/").pop() +
      ":" +
      n.callFrame.lineNumber;
    self.set(k, (self.get(k) || 0) + profile.timeDeltas[i]);
  });
  const parent = new Map();
  for (const n of profile.nodes)
    for (const c of n.children || []) parent.set(c, n.id);
  const callers = new Map();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    if (
      n.callFrame.functionName ===
      (process.argv[4] === "anon" ? "" : process.argv[4] || "groundFree")
    ) {
      const pn = byId.get(parent.get(id));
      const k = pn
        ? pn.callFrame.functionName + ":" + pn.callFrame.lineNumber
        : "?";
      callers.set(k, (callers.get(k) || 0) + profile.timeDeltas[i]);
    }
  });
  console.log(
    "callers of",
    process.argv[4] === "anon" ? "" : process.argv[4] || "groundFree",
    [...callers]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => k + " " + (v / 1000).toFixed(0))
      .join(" | "),
  );
  console.log(
    "total ms",
    ms.toFixed(0),
    "per step",
    (ms / (seconds * 30)).toFixed(2),
  );
  console.log(
    [...self]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(([k, v]) => k + " " + (v / 1000).toFixed(0))
      .join("\n"),
  );
  await browser.close();
})();
