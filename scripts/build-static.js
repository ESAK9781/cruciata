const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.resolve(root, "dist");
if (path.dirname(output) !== root || path.basename(output) !== "dist")
  throw new Error("Invalid build target");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of ["index.html", "README.md", ".nojekyll"])
  fs.copyFileSync(path.join(root, file), path.join(output, file));
for (const directory of ["src", "assets", "docs"])
  fs.cpSync(path.join(root, directory), path.join(output, directory), {
    recursive: true,
  });
console.log("Static site ready in dist/ - no runtime dependencies.");
