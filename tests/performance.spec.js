const { test, expect } = require("./helpers");
test("budgeted paths match synchronous routes and survive distant map changes", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const blocked = (x, y) => !(x > 240 && x < 272 && y < 420);
    const a = new CruciataNavigation(640, 480),
      b = new CruciataNavigation(640, 480);
    a.rebuild(blocked);
    b.rebuild(blocked);
    const start = { x: 100, y: 100 },
      goal = { x: 400, y: 100 };
    const expected = a.find(start, goal);
    const pending = b.query(start, goal) === null;
    b.process(0.01);
    b.rebuild(blocked, [], [{ x: 560, y: 400, w: 20, h: 20 }]);
    let actual = null,
      iterations = 0;
    while (actual === null && iterations++ < 5000) {
      b.process(0.2);
      actual = b.query(start, goal);
    }
    return { pending, actual, expected, iterations, jobs: b.jobs.length };
  });
  expect(result.pending).toBe(true);
  expect(result.actual).toEqual(result.expected);
  expect(result.actual.length).toBeGreaterThan(1);
  expect(result.jobs).toBe(0);
});
test("scanline connectivity agrees with a flood-fill reference across irregular obstacles", async ({
  page,
}) => {
  await page.goto("/?test");
  const failures = await page.evaluate(() => {
    let mismatches = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let random = seed;
      const next = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random / 4294967296;
      };
      const nav = new CruciataNavigation(320, 240);
      const obstacles = Array.from({ length: 300 }, () => next() < 0.35);
      nav.rebuild(
        (x, y) => !obstacles[Math.floor(y / 16) * 20 + Math.floor(x / 16)],
      );
      const labels = new Int32Array(300).fill(-1);
      let component = 0;
      for (let i = 0; i < 300; i++) {
        if (obstacles[i] || labels[i] >= 0) continue;
        const q = [i];
        labels[i] = component;
        for (let head = 0; head < q.length; head++) {
          const n = q[head],
            x = n % 20,
            y = Math.floor(n / 20);
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            if (x + dx < 0 || x + dx >= 20 || y + dy < 0 || y + dy >= 15)
              continue;
            const j = n + dx + dy * 20;
            if (!obstacles[j] && labels[j] < 0) {
              labels[j] = component;
              q.push(j);
            }
          }
        }
        component++;
      }
      for (let i = 0; i < 300; i++)
        if (labels[i] !== nav.components[i]) mismatches++;
    }
    return mismatches;
  });
  expect(failures).toBe(0);
});

test("vision scanlines match circular sight and retain explored cells after movement", async ({
  page,
}) => {
  await page.goto("/?test");
  const result = await page.evaluate(() => {
    const fog = new CruciataFog(2400, 1800),
      units = Array.from({ length: 40 }, (_, i) => ({
        team: 0,
        hp: 100,
        type: i % 3 === 0 ? "knight" : i % 3 === 1 ? "worker" : "archer",
        x: (i * 137.31) % 2400,
        y: (i * 173.12) % 1800,
      }));
    const reference = (actors) =>
      Array.from(fog.visible, (_, id) =>
        actors.some(
          (u) =>
            (((id % fog.cols) + 0.5) * fog.cell - u.x) ** 2 +
              ((Math.floor(id / fog.cols) + 0.5) * fog.cell - u.y) ** 2 <=
            (u.type === "knight" ? 520 : u.type === "worker" ? 310 : 440) ** 2,
        )
          ? 1
          : 0,
      );
    fog.update(units, []);
    const first = reference(units);
    let mismatches = first.filter((v, i) => v !== fog.visible[i]).length;
    units.forEach((u) => (u.x += 700));
    fog.update(units, []);
    const second = reference(units);
    mismatches += second.filter((v, i) => v !== fog.visible[i]).length;
    const memory = first.filter(
      (v, i) => (v || second[i]) !== fog.explored[i],
    ).length;
    return { mismatches, memory };
  });
  expect(result).toEqual({ mismatches: 0, memory: 0 });
});
