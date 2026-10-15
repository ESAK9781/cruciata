const { test, expect } = require("@playwright/test");

test("mounted riders stay seated while their horses walk", async ({ page }) => {
  await page.goto("/?test&bake");
  const frames = await page.evaluate(() => {
    const draw = (phase, action) => {
      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 120;
      const context = canvas.getContext("2d");
      context.translate(50, 95);
      window.CruciataPeopleArt.draw(
        context,
        { type: "knight", team: 0, rank: 1 },
        phase,
        0,
        action,
      );
      return canvas.getContext("2d").getImageData(0, 0, 100, 120).data;
    };
    const still = draw(0, "walk"),
      oppositeStep = draw(Math.PI, "walk"),
      movingHorse = draw(Math.PI / 2, "walk"),
      idle = draw(0, "idle");
    let riderDiff = 0,
      horseDiff = 0,
      walkVsIdle = 0;
    for (let y = 26; y < 74; y++)
      for (let x = 20; x < 80; x++)
        for (let c = 0; c < 4; c++) {
          const i = (y * 100 + x) * 4 + c;
          riderDiff += Math.abs(still[i] - oppositeStep[i]);
          walkVsIdle += Math.abs(still[i] - idle[i]);
        }
    for (let y = 70; y < 115; y++)
      for (let x = 15; x < 85; x++)
        for (let c = 0; c < 4; c++) {
          const i = (y * 100 + x) * 4 + c;
          horseDiff += Math.abs(still[i] - movingHorse[i]);
        }
    return { riderDiff, horseDiff, walkVsIdle };
  });
  expect(frames.riderDiff).toBe(0);
  expect(frames.walkVsIdle).toBe(0);
  expect(frames.horseDiff).toBeGreaterThan(5000);
});

test("the pre-rendered cavalry atlas contains walking horse poses", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(async () => {
    const render = (anim) => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 180;
      const g = canvas.getContext("2d");
      g.translate(80, 145);
      CruciataArt.unit(
        g,
        {
          type: "knight",
          team: 0,
          rank: 1,
          moving: true,
          working: false,
          anim,
          angle: 0,
        },
        0,
        0,
      );
      return g.getImageData(0, 0, 160, 180).data;
    };
    render(0);
    await CruciataAtlas.ready;
    const first = render(0),
      stride = render(Math.PI / 2);
    let difference = 0,
      opaque = 0;
    for (let i = 0; i < first.length; i += 4) {
      difference += Math.abs(first[i] - stride[i]);
      difference += Math.abs(first[i + 1] - stride[i + 1]);
      difference += Math.abs(first[i + 2] - stride[i + 2]);
      opaque += first[i + 3] > 0 ? 1 : 0;
    }
    return { difference, opaque };
  });
  expect(result.opaque).toBeGreaterThan(300);
  expect(result.difference).toBeGreaterThan(1000);
});
