/* Local, build-time painted sprite pages. Models remain editable source masters. */
(() => {
  "use strict";
  const data = window.CruciataAtlasManifest;
  if (!data || new URLSearchParams(location.search).has("bake")) return;
  const pages = new Map(),
    pending = new Set();
  function load(index) {
    const now = performance.now();
    if (pages.has(index)) {
      const value = pages.get(index);
      value.used = now;
      pages.delete(index);
      pages.set(index, value);
      return value;
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
  const previous = new Map();
  window.CruciataAtlas = {
    draw(g, key, w, h, ox, oy) {
      const e = data.frames[key];
      if (!e) {
        misses++;
        return false;
      }
      const group = (e.group ||= key
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
        .join(":"));
      const image = load(e[0]);
      if (image.failed) {
        misses++;
        return false;
      }
      if (!image.complete || !image.naturalWidth) {
        pendingFrames++;
        // Keep the last ready pose while another local page decodes. A known
        // atlas animation never falls back to rebuilding geometry mid-frame.
        const old = previous.get(group);
        if (old && pages.get(old.e[0])?.naturalWidth) {
          const [p, x, y, sw, sh, dx, dy] = old.e;
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
      previous.set(group, { e });
      while (previous.size > 128) previous.delete(previous.keys().next().value);
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
