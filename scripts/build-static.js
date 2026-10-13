const fs = require("node:fs");
const path = require("node:path");

// Publish only browser assets, never development tools or test artifacts.
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
fs.mkdirSync(output, { recursive: true });
for (const file of [
  "index.html",
  "style.css",
  "game.js",
  "menus.js",
  "artwork.js",
  "navigation.js",
  "fog.js",
  "audio.js",
  "CREDITS.md",
  "REALISM_ASSETS.md",
  ".nojekyll",
]) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
fs.cpSync(path.join(root, "assets"), path.join(output, "assets"), {
  recursive: true,
});
console.log("Static site ready in dist/ — no server or runtime dependencies.");
