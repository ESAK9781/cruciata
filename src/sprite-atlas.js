/* Local, build-time painted sprite pages. Models remain editable source masters. */
(() => {
  "use strict";
  const data = window.CruciataAtlasManifest;
  if (!data || new URLSearchParams(location.search).has("bake")) return;
  const pages = new Map(),
    pending = new Set();
  function load(index) {
    const now = performance.now();
    const known = pages.get(index);
    if (known) {
      // Recency only needs to be roughly right; skip the reordering when the
      // page was touched moments ago (thousands of draws share a few pages).
      if (now - known.used > 150) {
        known.used = now;
        pages.delete(index);
        pages.set(index, known);
      }
      return known;
    }
    const image = new Image();
    image.used = now;
    image.onerror = () => {
      image.failed = true;
    };
    image.src = "assets/atlas/" + data.pages[index];
    pages.set(index, image);
    const ready = image
      .decode()
      .catch(() => {})
      .finally(() => pending.delete(ready));
    pending.add(ready);
    while (pages.size > 32) {
      const first = pages.keys().next().value;
      // A dense view may use more than 32 pages in the same frame. Retain its
      // recent working set instead of repeatedly cancelling every image load.
      if (pages.size <= 64 && now - pages.get(first).used < 500) break;
      pages.get(first).src = "";
      pages.delete(first);
    }
    return image;
  }
  let hits = 0,
    misses = 0,
    pendingFrames = 0;
  const groups = new Map();
  window.CruciataAtlas = {
    draw(g, key, w, h, ox, oy) {
      const e = data.frames[key];
      if (!e) {
        misses++;
        return false;
      }
      if (!e.go) {
        const name = key
          .split(":")
          .slice(
            0,
            key.startsWith("buildingMotion:")
              ? 8
              : key.startsWith("building:")
                ? 6
                : key.startsWith("person:") || key.startsWith("siege:machine:")
                  ? 5
                  : 3,
          )
          .join(":");
        e.go = groups.get(name) || groups.set(name, { last: null }).get(name);
      }
      const go = e.go;
      const image = load(e[0]);
      if (image.failed) {
        misses++;
        return false;
      }
      if (!image.complete || !image.naturalWidth) {
        pendingFrames++;
        // Keep the last ready pose while another local page decodes. A known
        // atlas animation never falls back to rebuilding geometry mid-frame.
        const old = go.last;
        if (old && pages.get(old[0])?.naturalWidth) {
          const [p, x, y, sw, sh, dx, dy] = old;
          g.drawImage(
            pages.get(p),
            x,
            y,
            sw,
            sh,
            dx - ox,
            dy - oy,
            sw / data.scale,
            sh / data.scale,
          );
        }
        return true;
      }
      const [page, x, y, sw, sh, dx, dy] = e;
      g.drawImage(
        image,
        x,
        y,
        sw,
        sh,
        dx - ox,
        dy - oy,
        sw / data.scale,
        sh / data.scale,
      );
      hits++;
      go.last = e;
      return true;
    },
    // Draws a baked frame at world position (x, y) uniformly scaled, under the
    // canvas's current transform, so callers need no per-sprite matrix change.
    drawAt(g, key, ox, oy, x, y, scale) {
      const e = data.frames[key];
      if (!e || !e.go) return false; // first use goes through draw()
      const image = load(e[0]);
      if (image.failed) return false;
      let frame = e;
      if (!image.complete || !image.naturalWidth) {
        pendingFrames++;
        frame = e.go.last;
        if (!frame || !pages.get(frame[0])?.naturalWidth) return true;
      } else {
        e.go.last = e;
        hits++;
      }
      const [page, sx, sy, sw, sh, dx, dy] = frame,
        k = scale / data.scale;
      g.drawImage(
        frame === e ? image : pages.get(page),
        sx,
        sy,
        sw,
        sh,
        x + (dx - ox) * scale,
        y + (dy - oy) * scale,
        sw * k,
        sh * k,
      );
      return true;
    },
    get ready() {
      return Promise.all([...pending]);
    },
    stats: () => ({
      hits,
      misses,
      pendingFrames,
      frames: Object.keys(data.frames).length,
      pages: data.pages.length,
      residentPages: pages.size,
      decodedPixelLimit: 64 * 1024 * 1024,
    }),
  };
})();
