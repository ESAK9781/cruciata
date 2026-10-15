// Start npm start first. Times simulation steps and order issuing in a crowded late-campaign map.
const { chromium } = require("@playwright/test");
async function main() {
  const level = Number(process.argv[2] || 5);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  const result = await page.evaluate(async (level) => {
    document.getElementById("front-menu").hidden = true;
    cruciata.start(level);
    cruciata.supply({ gold: 9000, food: 9000, wood: 9000, stone: 9000 });
    cruciata.scenario((s) => {
      const base = s.buildings.find(
        (b) => b.team === 0 && b.kind === "towncenter",
      );
      const types = ["sword", "archer", "knight", "sword"];
      for (let i = 0; i < 120; i++) {
        const t = types[i % 4];
        const u = JSON.parse(
          JSON.stringify(
            s.units.find((u) => u.team === 0 && u.type === "sword") ||
              s.units[0],
          ),
        );
        u.id = 900000 + i;
        u.type = t;
        u.team = 0;
        u.hp = u.maxHp || 100;
        u.x = base.x + 260 + (i % 12) * 30;
        u.y = base.y + 210 + Math.floor(i / 12) * 30;
        u.order = null;
        u.path = [];
        u.job = null;
        u.target = null;
        s.units.push(u);
      }
    });
    const snap = cruciata.snapshot();
    const base = snap.buildings.find(
      (b) => b.team === 0 && b.kind === "towncenter",
    );
    const ids = snap.units
      .filter((u) => u.team === 0 && u.id >= 900000)
      .map((u) => u.id);
    const enemy = snap.buildings.find((b) => b.team === 1);
    const times = [];
    const timeStep = () => {
      const d = cruciata.liveFrame(1)[0];
      times.push(d);
      return d;
    };
    for (let i = 0; i < 30; i++) timeStep();
    const idle = [...times].sort((a, b) => a - b);
    times.length = 0;
    const out = { ids: ids.length, orders: [] };
    const targets = [
      { x: base.x - 900, y: base.y - 700 },
      { x: base.x + 1500, y: base.y + 300 },
      enemy ? { x: enemy.x, y: enemy.y } : { x: base.x + 3000, y: base.y },
    ];
    for (const target of targets) {
      const t0 = performance.now();
      cruciata.order(ids, target, false);
      const orderMs = performance.now() - t0;
      times.length = 0;
      let firstMove = -1;
      for (let i = 0; i < 90; i++) {
        timeStep();
        if (
          firstMove < 0 &&
          cruciata.snapshot().units.some((u) => ids.includes(u.id) && u.moving)
        )
          firstMove = i + 1;
      }
      const s = [...times].sort((a, b) => a - b);
      const moved = cruciata
        .snapshot()
        .units.filter((u) => ids.includes(u.id) && u.moving).length;
      out.orders.push({
        firstMoveFrame: firstMove,
        orderMs: +orderMs.toFixed(1),
        stepMax: +s[s.length - 1].toFixed(1),
        stepP95: +s[Math.floor(s.length * 0.95)].toFixed(1),
        stepMed: +s[Math.floor(s.length / 2)].toFixed(1),
        moving: moved,
      });
    }
    // Progress: after 30 more sim seconds how many have arrived / are idle with an order left
    times.length = 0;
    for (let i = 0; i < 900; i++) timeStep();
    const fin = cruciata.snapshot().units.filter((u) => ids.includes(u.id));
    out.after30s = {
      withOrder: fin.filter((u) => u.order).length,
      stuckGt1: fin.filter((u) => u.order && (u.stuck || 0) > 1).length,
      noPathWithOrder: fin.filter((u) => u.order && !u.moving).length,
    };
    const s = [...times].sort((a, b) => a - b);
    out.long = {
      max: +s[s.length - 1].toFixed(1),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
      med: +s[Math.floor(s.length / 2)].toFixed(1),
    };
    out.idleMed = +idle[15].toFixed(1);
    return out;
  }, level);
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
