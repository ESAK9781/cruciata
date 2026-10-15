// Start npm start first. Profiles real animation frames with a huge army on screen: node scripts/profile-army-render.js [units] [zoom-wheel-steps]
const { chromium } = require("@playwright/test");
(async () => {
  const count = Number(process.argv[2] || 800),
    steps = Number(process.argv[3] || 6);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/");
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate((count) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(0);
    cruciata.scenario((s) => {
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
      const tpl = JSON.parse(
        JSON.stringify(s.units.find((u) => u.team === 0 && u.type === "sword")),
      );
      const types = ["sword", "sword", "archer", "knight"];
      for (let i = 0; i < count; i++) {
        const u = JSON.parse(JSON.stringify(tpl));
        Object.assign(u, {
          id: 900000 + i,
          type: types[i % 4],
          x: 1300 + (i % 40) * 30,
          y: 2300 + Math.floor(i / 40) * 30,
          order: null,
          path: [],
          target: null,
          stance: "stand-down",
        });
        s.units.push(u);
      }
    });
    cruciata.camera(1900, 2600);
  }, count);
  await page.mouse.move(700, 400);
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const ids = cruciata
      .snapshot()
      .units.filter((u) => u.id >= 900000)
      .map((u) => u.id);
    cruciata.order(ids, { x: 4200, y: 2800 });
  });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const tick = (t) => {
          times.push(t - last);
          last = t;
          if (times.length < 120) requestAnimationFrame(tick);
          else {
            times.sort((a, b) => a - b);
            resolve({ median: times[60], p95: times[114], worst: times[119] });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  const { profile } = await cdp.send("Profiler.stop");
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id),
      k =
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
  const total = new Map();
  profile.samples.forEach((id, i) => {
    const seen = new Set();
    for (let cur = id; cur; cur = parent.get(cur)) {
      const m = byId.get(cur),
        k =
          m.callFrame.functionName +
          ":" +
          m.callFrame.url.split("/").pop() +
          ":" +
          m.callFrame.lineNumber;
      if (!seen.has(k)) {
        seen.add(k);
        total.set(k, (total.get(k) || 0) + profile.timeDeltas[i]);
      }
    }
  });
  console.log("TOTAL");
  console.log(
    [...total]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([k, v]) => k + " " + Math.round(v / 1000))
      .join(String.fromCharCode(10)),
  );
  console.log("frame ms", JSON.stringify(fps));
  console.log(
    [...self]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(([k, v]) => k + " " + Math.round(v / 1000))
      .join("\n"),
  );
  await browser.close();
})();
