// Start npm start first. Plays each level with random commands and reports page errors and invalid state.
// node scripts/chaos-player.js [levels] [iterations] [seed]
const { chromium } = require("@playwright/test");
(async () => {
  const levels = (process.argv[2] || "0,1,2,3,4,5").split(",").map(Number),
    iterations = Number(process.argv[3] || 100),
    seed = Number(process.argv[4] || 7);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });
  await page.goto("http://127.0.0.1:3000/?test");
  await page.locator("#open-campaign").click();
  for (const level of levels) {
    const report = await page.evaluate(
      ({ level, iterations, seed }) => {
        document.getElementById("front-menu").hidden = true;
        cruciata.start(level);
        cruciata.supply({ food: 6000, wood: 6000, gold: 6000, stone: 6000 });
        let rng = seed + level * 101;
        const rnd = () =>
          (rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296;
        const pick = (list) => list[Math.floor(rnd() * list.length)];
        const click = (id) => {
          const b = document.getElementById(id);
          if (b && !b.disabled) b.click();
        };
        const problems = [];
        const check = (tag) => {
          const s = cruciata.snapshot();
          for (const u of s.units) {
            if (!Number.isFinite(u.x) || !Number.isFinite(u.y))
              problems.push(`${tag}: NaN position unit ${u.id} ${u.type}`);
            else if (
              u.x < 0 ||
              u.y < 0 ||
              u.x > s.world.width ||
              u.y > s.world.height
            )
              problems.push(`${tag}: unit ${u.id} outside world`);
            if (!Number.isFinite(u.hp)) problems.push(`${tag}: NaN hp ${u.id}`);
          }
          for (const b of s.buildings)
            if (!Number.isFinite(b.x) || !Number.isFinite(b.hp))
              problems.push(`${tag}: bad building ${b.id}`);
          for (const k of ["food", "wood", "gold", "stone"])
            if (!Number.isFinite(s[k]) || s[k] < -1)
              problems.push(`${tag}: resource ${k}=${s[k]}`);
          return s;
        };
        const log = [];
        for (let i = 0; i < iterations && !cruciata.snapshot().result; i++) {
          const s = cruciata.snapshot();
          const base =
            s.buildings.find((b) => b.team === 0 && b.kind === "towncenter") ||
            s.buildings[0];
          const mine = s.units.filter((u) => u.team === 0);
          const action = Math.floor(rnd() * 10);
          try {
            if (action <= 2) {
              click("select-all");
              const army = mine.filter(
                (u) =>
                  !["worker", "civilian", "pilgrim", "merchant"].includes(
                    u.type,
                  ),
              );
              const group = army.filter(() => rnd() < 0.7).map((u) => u.id);
              if (group.length) {
                const foes = s.buildings.filter(
                  (b) => b.team === 1 && b.hp > 0,
                );
                const target =
                  rnd() < 0.35 && foes.length
                    ? pick(foes)
                    : {
                        x: Math.max(
                          60,
                          Math.min(
                            s.world.width - 60,
                            base.x + (rnd() - 0.3) * 3000,
                          ),
                        ),
                        y: Math.max(
                          60,
                          Math.min(
                            s.world.height - 60,
                            base.y + (rnd() - 0.5) * 2400,
                          ),
                        ),
                      };
                cruciata.order(
                  group,
                  { x: target.x, y: target.y },
                  rnd() < 0.4,
                );
              }
            } else if (action === 3) {
              for (const id of [
                "recruit-sword",
                "recruit-archer",
                "recruit-knight",
                "recruit-worker",
                "recruit-chaplain",
                "recruit-trebuchet",
                "recruit-standard",
              ])
                if (rnd() < 0.5) click(id);
            } else if (action === 4) {
              click(pick(["stance-fight", "stance-hold", "stance-stand-down"]));
            } else if (action === 5) {
              click("deploy-button");
              click("scout-button");
              click("bless-button");
            } else if (action === 6) {
              click("workers-button");
              const workers = mine
                .filter((u) => u.type === "worker")
                .map((u) => u.id);
              const nodes = s.nodes.filter((n) => n.remaining > 0);
              if (workers.length && nodes.length) {
                const n = pick(nodes);
                cruciata.order(workers, { x: n.x, y: n.y });
              }
            } else if (action === 7) {
              click("gate-button");
              click("cancel-targeting-button");
            } else if (action === 8 && rnd() < 0.3) {
              cruciata.save();
              cruciata.resume();
              cruciata.supply({
                food: 2000,
                wood: 2000,
                gold: 2000,
                stone: 2000,
              });
            } else if (action === 9) {
              document.dispatchEvent(
                new KeyboardEvent("keydown", {
                  code: pick(["KeyH", "KeyG", "KeyT", "Space", "KeyF", "KeyZ"]),
                  bubbles: true,
                }),
              );
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  code: pick([
                    "KeyH",
                    "KeyG",
                    "KeyT",
                    "Space",
                    "KeyF",
                    "KeyZ",
                    "KeyV",
                  ]),
                  bubbles: true,
                }),
              );
            }
            cruciata.liveFrame(90);
          } catch (e) {
            problems.push(`iteration ${i} action ${action}: ${e.message}`);
          }
          if (i % 10 === 9) check("i" + i);
        }
        const end = check("end");
        return {
          level,
          time: Math.round(end.time),
          result: end.result,
          units: end.units.length,
          mine: end.units.filter((u) => u.team === 0).length,
          problems: [...new Set(problems)].slice(0, 12),
        };
      },
      { level, iterations, seed },
    );
    console.log(JSON.stringify(report));
  }
  console.log(
    "page errors:",
    errors.length ? [...new Set(errors)].slice(0, 10) : "none",
  );
  await browser.close();
})();
