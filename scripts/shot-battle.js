// Start npm start first. Screenshots a staged battle with cavalry charge, archers and siege.
const { chromium } = require("@playwright/test");
(async () => {
  const out = process.argv[2] || "artifacts/shots/battle";
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  await page.addStyleTag({
    content:
      ".shot #objective-panel,.shot .map-controls,.shot #control-groups,.shot .minimap-frame,.shot .map-caption{visibility:hidden}",
  });
  const ids = await page.evaluate(() => {
    document.getElementById("front-menu").hidden = true;
    document.body.classList.add("shot");
    cruciata.start(0);
    const cx = 2600,
      cy = 2600;
    const ids = [];
    cruciata.scenario((s) => {
      s.units = [];
      s.buildings = s.buildings.filter((b) => b.kind === "towncenter");
      s.buildings.forEach((b, i) => {
        b.x = 300 + i * 1400;
        b.y = 300;
      });
      s.nodes = [];
      s.decorations = [];
      s.cheats = { reveal: true };
      s.enemy.think = 1e9;
      s.regionalThink = 1e9;
      s.campaignRules = null;
      s.mode = "quickmatch";
      const base = {};
      const mk = (type, team, x, y, i) => ({
        id: 70000 + i,
        type,
        team,
        x,
        y,
        hp: 200,
        maxHp: 200,
        angle: team ? Math.PI : 0,
        visualAngle: team ? Math.PI : 0,
        order: null,
        path: [],
        target: null,
        manualTarget: false,
        stance: "fight",
        cooldown: 0,
        strike: 0,
        anim: 0,
        moving: false,
        carry: 0,
        rank: 1,
        deployment: "deployed",
        deployTimer: 0,
        formation: null,
        hold: false,
        working: false,
        job: null,
        blessed: 0,
      });
      let i = 0;
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 8; c++) {
          s.units.push(
            mk("sword", 0, cx - 260 + r * 28, cy - 140 + c * 36, i++),
          );
          s.units.push(
            mk(
              r % 2 ? "sword" : "archer",
              1,
              cx + 120 - r * 28,
              cy - 140 + c * 36,
              i++,
            ),
          );
        }
      for (let c = 0; c < 5; c++)
        s.units.push(mk("knight", 0, cx - 420, cy - 100 + c * 60, i++));
      s.units.push(mk("trebuchet", 0, cx - 330, cy + 180, i++));
      s.units.push(mk("trebuchet", 1, cx + 340, cy - 180, i++));
      for (const u of s.units)
        if (u.type === "trebuchet") {
          u.deployment = "deployed";
        }
    });
    const snap = cruciata.snapshot();
    cruciata.camera(cx - 60, cy);
    return snap.units.filter((u) => u.type === "knight").map((u) => u.id);
  });
  // Charge: order knights into the enemy line, others advance.
  await page.evaluate((ids) => {
    const all = cruciata
      .snapshot()
      .units.filter((u) => u.team === 0 && u.type !== "trebuchet")
      .map((u) => u.id);
    cruciata.order(all, { x: 2760, y: 2600 }, true);
  }, ids);
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => cruciata.liveFrame(24));
    await page.waitForTimeout(120);
    await page.locator("#game").screenshot({ path: `${out}-${k}.png` });
  }
  await browser.close();
})();
