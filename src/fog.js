/* Persistent exploration and current allied vision. */
(() => {
  "use strict";
  window.CruciataFog = class {
    constructor(width, height, saved, team = 0) {
      this.team = team;
      this.cell = 48;
      this.cols = Math.ceil(width / this.cell);
      this.rows = Math.ceil(height / this.cell);
      this.explored =
        saved?.explored?.length === this.cols * this.rows
          ? [...saved.explored]
          : Array(this.cols * this.rows).fill(0);
      this.visible = new Uint8Array(this.explored.length);
      this.known = saved?.known || {};
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.cols;
      this.canvas.height = this.rows;
      this.context = this.canvas.getContext("2d");
    }
    index(p) {
      const x = Math.floor(p.x / this.cell),
        y = Math.floor(p.y / this.cell);
      return x < 0 || y < 0 || x >= this.cols || y >= this.rows
        ? -1
        : y * this.cols + x;
    }
    sees(p) {
      return !!this.visible[this.index(p)];
    }
    remembers(p) {
      return !!this.explored[this.index(p)];
    }
    update(units, buildings) {
      this.visible.fill(0);
      const sources = units
        .filter((u) => u.team === this.team && u.hp > 0)
        .map((u) => ({
          x: u.x,
          y: u.y,
          vision:
            u.type === "worker"
              ? 310
              : u.type === "knight"
                ? 520
                : u.type === "trebuchet"
                  ? 760
                  : 440,
        }));
      for (const b of buildings)
        if (b.team === this.team && b.hp > 0 && b.progress >= 1)
          sources.push({
            x: b.x,
            y: b.y,
            vision:
              b.kind === "watchtower"
                ? 1100
                : b.kind === "tower"
                  ? 600
                  : b.kind === "towncenter"
                    ? 520
                    : b.kind === "farm"
                      ? 180
                      : 300,
          });
      for (const p of sources) {
        const minY = Math.max(0, Math.ceil((p.y - p.vision) / this.cell - 0.5));
        const maxY = Math.min(
          this.rows - 1,
          Math.floor((p.y + p.vision) / this.cell - 0.5),
        );
        for (let y = minY; y <= maxY; y++) {
          const dy = (y + 0.5) * this.cell - p.y;
          const reach = Math.sqrt(Math.max(0, p.vision * p.vision - dy * dy));
          const x0 = Math.max(0, Math.ceil((p.x - reach) / this.cell - 0.5));
          const x1 = Math.min(
            this.cols - 1,
            Math.floor((p.x + reach) / this.cell - 0.5),
          );
          if (x0 > x1) continue;
          const first = y * this.cols + x0,
            last = y * this.cols + x1 + 1;
          this.visible.fill(1, first, last);
          this.explored.fill(1, first, last);
        }
      }
      for (const b of buildings)
        if (this.sees(b)) this.known[b.id] = { ...b, queue: [], rally: null };
      if (!this.pixels) {
        this.pixels = this.context.createImageData(this.cols, this.rows);
        for (let i = 0; i < this.explored.length; i++) {
          this.pixels.data[i * 4] = 8;
          this.pixels.data[i * 4 + 1] = 16;
          this.pixels.data[i * 4 + 2] = 23;
        }
      }
      const pixels = this.pixels;
      for (let i = 0; i < this.explored.length; i++) {
        pixels.data[i * 4 + 3] = this.visible[i]
          ? 0
          : this.explored[i]
            ? 155
            : 255;
      }
      this.context.putImageData(pixels, 0, 0);
    }
    paint(g, width, height) {
      g.save();
      g.imageSmoothingEnabled = true;
      g.drawImage(this.canvas, 0, 0, width, height);
      g.restore();
    }
    save() {
      return { explored: this.explored, known: this.known };
    }
  };
})();
