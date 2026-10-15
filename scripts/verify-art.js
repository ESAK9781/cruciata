/* Verify generated sprite pages before shipping the static package. */
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(__dirname, "../assets/atlas"),
  scope = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "manifest.js"), "utf8"),
  scope,
);
const atlas = scope.window.CruciataAtlasManifest;
if (atlas.scale < 3)
  throw Error(
    "Rebuild artwork at the current texture resolution with npm run art:bake",
  );
const sizes = atlas.pages.map((name) => {
  if (!/^page-\d+\.png$/.test(name)) throw Error("Invalid atlas page name");
  const header = Buffer.alloc(24),
    fd = fs.openSync(path.join(root, name), "r");
  try {
    fs.readSync(fd, header, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header.toString("hex", 0, 8) !== "89504e470d0a1a0a")
    throw Error("Invalid atlas PNG: " + name);
  const w = header.readUInt32BE(16),
    h = header.readUInt32BE(20);
  if (w > 1024 || h > 1024)
    throw Error("Atlas page exceeds the resident memory budget: " + name);
  return [w, h];
});
for (const [key, f] of Object.entries(atlas.frames)) {
  const [p, x, y, w, h] = f,
    size = sizes[p];
  if (
    f.length !== 7 ||
    !f.every(Number.isFinite) ||
    !size ||
    x < 0 ||
    y < 0 ||
    w <= 0 ||
    h <= 0 ||
    x + w > size[0] ||
    y + h > size[1]
  )
    throw Error("Invalid atlas frame: " + key);
}
console.log(
  `Artwork verified: ${atlas.pages.length} local PNG pages, ${Object.keys(atlas.frames).length} frame entries.`,
);
