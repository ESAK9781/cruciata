const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain",
  ".json": "application/json",
};
http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (
      !file.startsWith(root + path.sep) ||
      !(
        relative.startsWith("assets/") ||
        relative.startsWith("src/") ||
        relative.startsWith("docs/") ||
        ["index.html", "README.md"].includes(relative)
      )
    ) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const headers = {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "Accept-Ranges": "bytes",
      };
      const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (range) {
        const start = range[1]
          ? Number(range[1])
          : Math.max(0, data.length - Number(range[2]));
        const end =
          range[1] && range[2]
            ? Math.min(data.length - 1, Number(range[2]))
            : data.length - 1;
        if (start > end || start >= data.length) {
          res.writeHead(416, { "Content-Range": `bytes */${data.length}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          "Content-Length": end - start + 1,
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.writeHead(200, { ...headers, "Content-Length": data.length });
        res.end(data);
      }
    });
  })
  .listen(process.env.PORT || 3000, "127.0.0.1", () =>
    console.log(
      "cruciāta is ready at http://localhost:" + (process.env.PORT || 3000),
    ),
  );
