// Converts the browser atlas manifest into plain JSON for the native client.
const fs = require("fs");
global.window = {};
require("../../assets/atlas/manifest.js");
const m = window.CruciataAtlasManifest;
fs.writeFileSync(
  __dirname + "/../../assets/atlas/manifest.json",
  JSON.stringify({ scale: m.scale, pages: m.pages, frames: m.frames }),
);
console.log("frames", Object.keys(m.frames).length);
