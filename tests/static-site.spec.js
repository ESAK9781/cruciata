const { test, expect } = require("./helpers");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const assets = [
  ".nojekyll",
  "artwork.js",
  "audio.js",
  "fog.js",
  "CREDITS.md",
  "REALISM_ASSETS.md",
  "game.js",
  "menus.js",
  "index.html",
  "navigation.js",
  "style.css",
];
function walk(folder, prefix = "") {
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(folder, e.name), prefix + e.name + "/")
        : [prefix + e.name],
    );
}
assets.push(...walk(path.join(root, "assets"), "assets/"));
assets.sort();

test("deployment contains only the exact static browser assets", async () => {
  expect(walk(output).sort()).toEqual(assets);
  for (const file of assets) {
    expect(fs.readFileSync(path.join(output, file))).toEqual(
      fs.readFileSync(path.join(root, file)),
    );
  }
});

for (const prefix of ["/", "/cruciata/"]) {
  test(`published static files work at ${prefix} without a backend or web fonts`, async ({
    page,
  }) => {
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const file = pathname.startsWith(prefix)
        ? pathname.slice(prefix.length) || "index.html"
        : "";
      if (!assets.includes(file)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const type =
        {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".ogg": "audio/ogg",
          ".mp3": "audio/mpeg",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[path.extname(file)] || "text/plain";
      response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
      response.end(fs.readFileSync(path.join(output, file)));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    const localFailures = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(origin) && response.status() >= 400)
        localFailures.push(response.url());
    });
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.abort(),
    );
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
    try {
      await page.goto(origin + prefix);
      await expect(page.locator("#game")).toBeVisible();
      await expect(page.locator("#mission-title")).toHaveText(
        "A foothold on the coast",
      );
      expect(
        await page
          .locator("header")
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe("flex");
      await page.locator("#open-campaign").click();
      await page.locator("#chapter-0").click();
      await page.getByRole("button", { name: "Begin the march" }).click();
      await expect
        .poll(() => page.evaluate(() => window.cruciata.snapshot().time))
        .toBeGreaterThan(0.5);
      await page.keyboard.press("Space");
      expect(
        await page.evaluate(() => window.cruciata.snapshot().selected.length),
      ).toBe(8);
      const point = await page.evaluate(() => {
        const s = cruciata.snapshot(),
          b = s.buildings.find((b) => b.kind === "barracks" && b.team === 0);
        return cruciata.project(b.x, b.y);
      });
      await page.mouse.click(point.x, point.y);
      await page.locator("#recruit-sword").click();
      expect(
        await page.evaluate(() => window.cruciata.snapshot().population.queued),
      ).toBe(1);
      expect(errors).toEqual([]);
      expect(localFailures).toEqual([]);
    } finally {
      await page.goto("about:blank");
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
