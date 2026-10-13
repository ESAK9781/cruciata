/* Eight-way A* navigation with footprint clearance and no diagonal corner cutting. */
(() => {
  "use strict";
  class Heap {
    constructor() {
      this.items = [];
    }
    push(node) {
      const a = this.items;
      a.push(node);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= node.f) break;
        a[i] = a[p];
        i = p;
      }
      a[i] = node;
    }
    pop() {
      const a = this.items,
        first = a[0],
        last = a.pop();
      if (a.length) {
        let i = 0;
        while (i * 2 + 1 < a.length) {
          let c = i * 2 + 1;
          if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
          if (a[c].f >= last.f) break;
          a[i] = a[c];
          i = c;
        }
        a[i] = last;
      }
      return first;
    }
  }
  class Navigation {
    constructor(width, height, cell = 16) {
      this.width = width;
      this.height = height;
      this.cell = cell;
      this.cols = Math.ceil(width / cell);
      this.rows = Math.ceil(height / cell);
      this.blocked = new Uint8Array(this.cols * this.rows);
      this.revision = 0;
      this.searches = 0;
      this.components = new Int32Array(this.blocked.length).fill(-1);
    }
    rebuild(test, waypoints = []) {
      this.physicalFree = test;
      this.gapEdges = new Map();
      this.waypoints = waypoints.filter((p) => test(p.x, p.y));
      for (let y = 0; y < this.rows; y++)
        for (let x = 0; x < this.cols; x++)
          this.blocked[y * this.cols + x] = test(
            (x + 0.5) * this.cell,
            (y + 0.5) * this.cell,
          )
            ? 0
            : 1;
      this.revision++;
      this.components.fill(-1);
      const queue = new Int32Array(this.blocked.length);
      let region = 0;
      for (let start = 0; start < this.blocked.length; start++) {
        if (this.blocked[start] || this.components[start] >= 0) continue;
        let head = 0,
          tail = 1;
        queue[0] = start;
        this.components[start] = region;
        while (head < tail) {
          const id = queue[head++],
            x = id % this.cols,
            y = Math.floor(id / this.cols);
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = x + dx,
              ny = y + dy;
            if (!this.free(nx, ny)) continue;
            const next = ny * this.cols + nx;
            if (this.components[next] >= 0) continue;
            this.components[next] = region;
            queue[tail++] = next;
          }
        }
        region++;
      }
    }
    free(x, y) {
      return (
        x >= 0 &&
        y >= 0 &&
        x < this.cols &&
        y < this.rows &&
        !this.blocked[y * this.cols + x]
      );
    }
    pointFree(x, y) {
      return this.free(Math.floor(x / this.cell), Math.floor(y / this.cell));
    }
    nearest(x, y, region = null) {
      const cx = Math.max(
          0,
          Math.min(this.cols - 1, Math.floor(x / this.cell)),
        ),
        cy = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cell)));
      if (
        this.free(cx, cy) &&
        (region === null || this.components[cy * this.cols + cx] === region)
      )
        return { x: cx, y: cy };
      for (let r = 1; r < 14; r++) {
        let best,
          score = Infinity;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (
              Math.max(Math.abs(dx), Math.abs(dy)) !== r ||
              !this.free(cx + dx, cy + dy) ||
              (region !== null &&
                this.components[(cy + dy) * this.cols + cx + dx] !== region)
            )
              continue;
            const s = Math.hypot(
              (cx + dx + 0.5) * this.cell - x,
              (cy + dy + 0.5) * this.cell - y,
            );
            if (s < score) {
              score = s;
              best = { x: cx + dx, y: cy + dy };
            }
          }
        if (best) return best;
      }
      return null;
    }
    clearLine(a, b) {
      const length = Math.hypot(b.x - a.x, b.y - a.y),
        steps = Math.ceil(length / 3);
      for (let i = 0; i <= steps; i++) {
        const t = steps ? i / steps : 0;
        if (!this.physicalFree(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
          return false;
      }
      return true;
    }
    gapRoute(start, goal) {
      // Obstacle-edge vertices retain passages narrower than a navigation cell.
      const pad = 256;
      const points = [
        start,
        goal,
        ...this.waypoints
          .filter(
            (p) =>
              p.x >= Math.min(start.x, goal.x) - pad &&
              p.x <= Math.max(start.x, goal.x) + pad &&
              p.y >= Math.min(start.y, goal.y) - pad &&
              p.y <= Math.max(start.y, goal.y) + pad,
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - start.x, a.y - start.y) +
              Math.hypot(a.x - goal.x, a.y - goal.y) -
              Math.hypot(b.x - start.x, b.y - start.y) -
              Math.hypot(b.x - goal.x, b.y - goal.y),
          )
          .slice(0, 512),
      ];
      const cost = new Float64Array(points.length).fill(Infinity),
        parent = new Int32Array(points.length).fill(-1),
        closed = new Uint8Array(points.length),
        heap = new Heap();
      cost[0] = 0;
      heap.push({ id: 0, f: 0 });
      while (heap.items.length) {
        const id = heap.pop().id;
        if (closed[id]) continue;
        closed[id] = 1;
        if (id === 1) {
          const path = [];
          for (let i = 1; i !== 0; i = parent[i]) path.push(points[i]);
          return path.reverse();
        }
        for (let i = 1; i < points.length; i++) {
          if (closed[i]) continue;
          const next =
            cost[id] +
            Math.hypot(points[i].x - points[id].x, points[i].y - points[id].y);
          if (next >= cost[i]) continue;
          const a = points[id],
            b = points[i],
            ka = a.x + "," + a.y,
            kb = b.x + "," + b.y,
            key = ka < kb ? ka + ";" + kb : kb + ";" + ka;
          let clear = this.gapEdges.get(key);
          if (clear === undefined) {
            clear = this.clearLine(a, b);
            if (this.gapEdges.size > 50000) this.gapEdges.clear();
            this.gapEdges.set(key, clear);
          }
          if (!clear) continue;
          cost[i] = next;
          parent[i] = id;
          heap.push({
            id: i,
            f: next + Math.hypot(points[i].x - goal.x, points[i].y - goal.y),
          });
        }
      }
      return [];
    }
    find(start, destination) {
      this.searches++;
      const precise = this.physicalFree(destination.x, destination.y);
      if (precise && this.clearLine(start, destination))
        return [{ ...destination }];
      const s = this.nearest(start.x, start.y);
      const end = s ? this.nearest(destination.x, destination.y, null) : null;
      if (!s || !end) return precise ? this.gapRoute(start, destination) : [];
      if (
        this.components[s.y * this.cols + s.x] !==
        this.components[end.y * this.cols + end.x]
      )
        return precise ? this.gapRoute(start, destination) : [];
      const goal = {
        x: (end.x + 0.5) * this.cell,
        y: (end.y + 0.5) * this.cell,
      };
      if (this.clearLine(start, goal)) return [goal];
      const count = this.blocked.length;
      if (this.cost?.length !== count) {
        this.cost = new Float64Array(count);
        this.parent = new Int32Array(count);
        this.closed = new Uint32Array(count);
        this.costStamp = new Uint32Array(count);
        this.searchEpoch = 0;
      }
      const epoch = ++this.searchEpoch;
      const cost = this.cost,
        parent = this.parent,
        closed = this.closed,
        stamp = this.costStamp,
        heap = new Heap(),
        si = s.y * this.cols + s.x,
        ei = end.y * this.cols + end.x;
      const heuristic = (x, y) => {
        const dx = Math.abs(x - end.x),
          dy = Math.abs(y - end.y);
        return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy);
      };
      cost[si] = 0;
      stamp[si] = epoch;
      parent[si] = -1;
      heap.push({ id: si, f: heuristic(s.x, s.y) });
      let found = false;
      while (heap.items.length) {
        const current = heap.pop().id;
        if (closed[current] === epoch) continue;
        if (current === ei) {
          found = true;
          break;
        }
        closed[current] = epoch;
        const x = current % this.cols,
          y = Math.floor(current / this.cols);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (
              (!dx && !dy) ||
              !this.free(x + dx, y + dy) ||
              (dx && dy && (!this.free(x + dx, y) || !this.free(x, y + dy)))
            )
              continue;
            if (
              !this.clearLine(
                { x: (x + 0.5) * this.cell, y: (y + 0.5) * this.cell },
                {
                  x: (x + dx + 0.5) * this.cell,
                  y: (y + dy + 0.5) * this.cell,
                },
              )
            )
              continue;
            const id = (y + dy) * this.cols + x + dx,
              next = cost[current] + (dx && dy ? Math.SQRT2 : 1);
            if (
              closed[id] !== epoch &&
              (stamp[id] !== epoch || next < cost[id])
            ) {
              cost[id] = next;
              stamp[id] = epoch;
              parent[id] = current;
              heap.push({ id, f: next + heuristic(x + dx, y + dy) });
            }
          }
      }
      if (!found) return precise ? this.gapRoute(start, destination) : [];
      const route = [];
      for (let id = ei; id !== si && id >= 0; id = parent[id])
        route.push({
          x: ((id % this.cols) + 0.5) * this.cell,
          y: (Math.floor(id / this.cols) + 0.5) * this.cell,
        });
      route.reverse();
      const smooth = [];
      let anchor = start,
        i = 0;
      while (i < route.length) {
        let far = i;
        while (far + 1 < route.length && this.clearLine(anchor, route[far + 1]))
          far++;
        smooth.push(route[far]);
        anchor = route[far];
        i = far + 1;
      }
      if (
        precise &&
        this.clearLine(smooth[smooth.length - 1] || start, destination)
      )
        smooth.push({ ...destination });
      const direct = Math.hypot(
        destination.x - start.x,
        destination.y - start.y,
      );
      const length = smooth.reduce((sum, p, i) => {
        const prev = i ? smooth[i - 1] : start;
        return sum + Math.hypot(p.x - prev.x, p.y - prev.y);
      }, 0);
      if (precise && direct < 2000 && length > direct * 1.45) {
        const gap = this.gapRoute(start, destination);
        if (
          gap.length &&
          gap.reduce((sum, p, i) => {
            const prev = i ? gap[i - 1] : start;
            return sum + Math.hypot(p.x - prev.x, p.y - prev.y);
          }, 0) < length
        )
          return gap;
      }
      return smooth;
    }
  }
  window.CruciataNavigation = Navigation;
})();
