/* Pooled point quadtree for flocking and target acquisition queries. */
(() => {
  "use strict";
  class Quadtree {
    constructor(width, height, capacity = 10, maxDepth = 10) {
      this.width = width;
      this.height = height;
      this.capacity = capacity;
      this.maxDepth = maxDepth;
      this.pool = [];
      this.used = 0;
      this.root = this.node(0, 0, Math.max(width, height) / 2, 0);
      this.size = 0;
    }
    node(cx, cy, half, depth) {
      let n = this.pool[this.used];
      if (!n) {
        n = { cx: 0, cy: 0, half: 0, depth: 0, items: [], kids: null };
        this.pool[this.used] = n;
      }
      this.used++;
      n.cx = cx;
      n.cy = cy;
      n.half = half;
      n.depth = depth;
      n.items.length = 0;
      n.kids = null;
      return n;
    }
    clear() {
      this.used = 0;
      this.size = 0;
      this.root = this.node(
        this.width / 2,
        this.height / 2,
        Math.max(this.width, this.height) / 2,
        0,
      );
    }
    insert(o) {
      this.size++;
      let n = this.root;
      for (;;) {
        if (!n.kids) {
          n.items.push(o);
          if (n.items.length > this.capacity && n.depth < this.maxDepth)
            this.split(n);
          return;
        }
        n = n.kids[(o.x >= n.cx ? 1 : 0) + (o.y >= n.cy ? 2 : 0)];
      }
    }
    split(n) {
      const h = n.half / 2,
        d = n.depth + 1;
      n.kids = [
        this.node(n.cx - h, n.cy - h, h, d),
        this.node(n.cx + h, n.cy - h, h, d),
        this.node(n.cx - h, n.cy + h, h, d),
        this.node(n.cx + h, n.cy + h, h, d),
      ];
      const items = n.items;
      n.items = [];
      for (const o of items)
        n.kids[(o.x >= n.cx ? 1 : 0) + (o.y >= n.cy ? 2 : 0)].items.push(o);
      // A heap of coincident points cannot be separated; stop at the depth cap.
      for (const k of n.kids)
        if (k.items.length > this.capacity && k.depth < this.maxDepth)
          this.split(k);
    }
    // Every inserted object whose position lies within r of (x, y).
    query(x, y, r, out = []) {
      const r2 = r * r,
        stack = this.stack || (this.stack = []);
      stack.length = 0;
      stack.push(this.root);
      while (stack.length) {
        const n = stack.pop();
        const dx = Math.max(Math.abs(x - n.cx) - n.half, 0),
          dy = Math.max(Math.abs(y - n.cy) - n.half, 0);
        if (dx * dx + dy * dy > r2) continue;
        if (n.kids) {
          for (const k of n.kids) stack.push(k);
          continue;
        }
        for (const o of n.items) {
          const ox = o.x - x,
            oy = o.y - y;
          if (ox * ox + oy * oy < r2) out.push(o);
        }
      }
      return out;
    }
  }
  window.CruciataQuadtree = Quadtree;
})();
