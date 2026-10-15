// Start npm start first. Lists which update phase dominates each slow frame: node scripts/phase-hunt.js <level> <seconds> <threshold>.
const { chromium } = require("@playwright/test");
(async () => {
  const level = Number(process.argv[2] || 5),
    seconds = Number(process.argv[3] || 130),
    threshold = Number(process.argv[4] || 80);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const out = await page.evaluate(
    ({ level, seconds, threshold }) => {
      document.getElementById("front-menu").hidden = true;
      cruciata.start(level);
      cruciata.phases();
      const nav = cruciata.internals().nav;
      const frameCallers = new Map();
      let pfCalls = 0,
        wrapped = null,
        clearCalls = 0;
      const origClear = nav.clearLine.bind(nav);
      nav.clearLine = (a, b) => {
        clearCalls++;
        const caller = (new Error().stack.split("\n")[2] || "")
          .trim()
          .replace(/^at /, "")
          .replace(/http:\/\/[^ ]*\//, "")
          .slice(0, 44);
        frameCallers.set(
          caller,
          (frameCallers.get(caller) || 0) +
            Math.hypot(b.x - a.x, b.y - a.y) / 3,
        );
        return origClear(a, b);
      };
      const rows = [],
        totals = {};
      for (let i = 0; i < seconds * 30; i++) {
        const t = performance.now();
        cruciata.liveFrame(1);
        const ms = performance.now() - t,
          ph = cruciata.phases();
        for (const [k, v] of Object.entries(ph))
          totals[k] = (totals[k] || 0) + v;
        if (ms > threshold)
          rows.push({
            at: +(i / 30).toFixed(1),
            ms: Math.round(ms),
            callers: [...frameCallers]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([k, v]) => k + "=" + Math.round(v))
              .join(" ; "),
            clears: clearCalls,
            top: Object.entries(ph)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([k, v]) => k + "=" + Math.round(v))
              .join(" "),
          });
      }
      return {
        rows: rows.slice(0, 40),
        totals: Object.entries(totals)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([k, v]) => k + "=" + (v / (seconds * 30)).toFixed(2))
          .join(" "),
      };
    },
    { level, seconds, threshold },
  );
  for (const r of out.rows) console.log(JSON.stringify(r));
  console.log("avg ms/frame:", out.totals);
  await browser.close();
})();
