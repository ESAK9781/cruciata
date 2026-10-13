const { test, expect } = require("./helpers");
test("siege explosion recordings decode and battle voices are reused under their limit", async ({
  page,
}) => {
  await page.goto("/?test");
  await page.mouse.click(20, 20);
  const result = await page.evaluate(async () => {
    const context = new AudioContext(),
      durations = [];
    for (const name of [
      "explosionCrunch_000",
      "explosionCrunch_001",
      "lowFrequency_explosion_000",
    ]) {
      const data = await fetch("assets/audio/" + name + ".ogg");
      durations.push(
        (await context.decodeAudioData(await data.arrayBuffer())).duration,
      );
    }
    await context.close();
    for (let i = 0; i < 12; i++) {
      CruciataAudio.play("hit");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const before = CruciataAudio.status();
    for (let i = 0; i < 12; i++) {
      CruciataAudio.play("hit");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const after = CruciataAudio.status();
    return { durations, before, after };
  });
  expect(result.durations.every((d) => d > 0)).toBe(true);
  expect(result.after.played).toBeGreaterThan(result.before.played);
  expect(result.after.voices).toBeLessThanOrEqual(result.after.recordings * 2);
  expect(result.after.active).toBeLessThanOrEqual(10);
});
