/* Eight-way A* navigation with footprint clearance and no diagonal corner cutting. */
(() => {
  "use strict";
  class Heap {
    constructor(cap = 1024) {
      this.ids = new Int32Array(cap);
      this.scores = new Float64Array(cap);
      this.length = 0;
      this._popped = { id: 0, f: 0 };
    }
    grow() {
      const nextCap = this.ids.length << 1;
      const nextIds = new Int32Array(nextCap);
      const nextScores = new Float64Array(nextCap);
      nextIds.set(this.ids);
      nextScores.set(this.scores);
      this.ids = nextIds;
      this.scores = nextScores;
    }
    push(node) {
      this.pushItem(node.id, node.f);
    }
    pushItem(id, f) {
      if (this.length >= this.ids.length) this.grow();
      const ids = this.ids,
        scores = this.scores;
      let i = this.length++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (scores[p] <= f) break;
        ids[i] = ids[p];
        scores[i] = scores[p];
        i = p;
      }
      ids[i] = id;
      scores[i] = f;
    }
    pop() {
      if (!this.length) return undefined;
      const ids = this.ids,
        scores = this.scores,
        firstId = ids[0],
        firstScore = scores[0],
        lastIndex = --this.length,
        lastId = ids[lastIndex],
        lastScore = scores[lastIndex];
      if (this.length > 0) {
        let i = 0;
        const half = this.length >> 1;
        while (i < half) {
          let c = (i << 1) + 1;
          if (c + 1 < this.length && scores[c + 1] < scores[c]) c++;
          if (scores[c] >= lastScore) break;
          ids[i] = ids[c];
          scores[i] = scores[c];
          i = c;
        }
        ids[i] = lastId;
        scores[i] = lastScore;
      }
      this._popped.id = firstId;
      this._popped.f = firstScore;
      return this._popped;
    }
    popId() {
      if (!this.length) return -1;
      const ids = this.ids,
        scores = this.scores,
        firstId = ids[0],
        lastIndex = --this.length,
        lastId = ids[lastIndex],
        lastScore = scores[lastIndex];
      if (this.length > 0) {
        let i = 0;
        const half = this.length >> 1;
        while (i < half) {
          let c = (i << 1) + 1;
          if (c + 1 < this.length && scores[c + 1] < scores[c]) c++;
          if (scores[c] >= lastScore) break;
          ids[i] = ids[c];
          scores[i] = scores[c];
          i = c;
        }
        ids[i] = lastId;
        scores[i] = lastScore;
      }
      return firstId;
    }
    get items() {
      return this;
    }
    clear() {
      this.length = 0;
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
      this.chunkCells = 32;
      this.chunkCols = Math.ceil(this.cols / this.chunkCells);
      this.chunkRows = Math.ceil(this.rows / this.chunkCells);
      this.chunkLinks = Array.from(
        { length: this.chunkCols * this.chunkRows },
        () => new Set(),
      );
      this.edgeCaches = Array(this.chunkLinks.length).fill(null);
      this.corridors = new Map();
      this.pathCache = new Map();
      this.pending = new Map();
      this.jobs = [];
      this.activeJob = null;
      this.ownerKeys = new Map();
      // Adaptive resolution: every chunk is a quadtree of free squares, so open
      // ground costs a handful of nodes while cluttered ground keeps 16-unit cells.
      const chunks = this.chunkCols * this.chunkRows;
      this.useLeaves = true;
      this.leafOf = new Int32Array(this.cols * this.rows).fill(-1);
      this.lx = new Int16Array(chunks * 1024);
      this.ly = new Int16Array(chunks * 1024);
      this.ls = new Uint8Array(chunks * 1024);
      this.leafCount = new Uint16Array(chunks);
      this.leafTotal = 0;
      this.satScratch = new Int32Array(33 * 33);
      this.leafStack = [];
    }
    // Rebuild the free-square quadtree of one chunk from the blocked grid.
    buildChunkLeaves(chunk) {
      const cols = this.cols,
        rows = this.rows,
        cx = chunk % this.chunkCols,
        cy = (chunk / this.chunkCols) | 0,
        x0 = cx * 32,
        y0 = cy * 32,
        sat = this.satScratch,
        leafOf = this.leafOf,
        blocked = this.blocked;
      for (let y = y0; y < Math.min(rows, y0 + 32); y++)
        leafOf.fill(-1, y * cols + x0, y * cols + Math.min(cols, x0 + 32));
      sat.fill(0);
      for (let j = 0; j < 32; j++) {
        let row = 0;
        for (let i = 0; i < 32; i++) {
          const gx = x0 + i,
            gy = y0 + j;
          row += gx < cols && gy < rows ? blocked[gy * cols + gx] : 1;
          sat[(j + 1) * 33 + i + 1] = sat[j * 33 + i + 1] + row;
        }
      }
      const count = (x, y, s) =>
        sat[(y + s) * 33 + x + s] -
        sat[y * 33 + x + s] -
        sat[(y + s) * 33 + x] +
        sat[y * 33 + x];
      const stack = this.leafStack;
      stack.length = 0;
      stack.push(0, 0, 32);
      let n = 0;
      while (stack.length) {
        const s = stack.pop(),
          y = stack.pop(),
          x = stack.pop(),
          blockedCells = count(x, y, s);
        if (blockedCells === s * s) continue;
        if (blockedCells === 0) {
          const id = chunk * 1024 + n++;
          this.lx[id] = x0 + x;
          this.ly[id] = y0 + y;
          this.ls[id] = s;
          for (let yy = y0 + y; yy < y0 + y + s; yy++)
            leafOf.fill(id, yy * cols + x0 + x, yy * cols + x0 + x + s);
          continue;
        }
        const h = s >> 1;
        stack.push(x, y, h, x + h, y, h, x, y + h, h, x + h, y + h, h);
      }
      this.leafTotal += n - this.leafCount[chunk];
      this.leafCount[chunk] = n;
    }
    rebuild(test, waypoints = [], regions = null) {
      this.physicalFree = test;
      if (!regions || !this.gapEdges) this.gapEdges = new Map();
      else
        for (const [key, edge] of this.gapEdges)
          if (
            regions.some(
              (a) =>
                edge.maxX >= a.x &&
                edge.minX <= a.x + a.w &&
                edge.maxY >= a.y &&
                edge.minY <= a.y + a.h,
            )
          )
            this.gapEdges.delete(key);
      this.pathCache.clear();
      const unique = new Map();
      for (const p of waypoints)
        if (test(p.x, p.y)) unique.set(p.x + "," + p.y, p);
      this.waypoints = [...unique.values()];
      this.waypoints.forEach((p, i) => (p.wid = i));
      this.waypointChunks = new Map();
      for (const p of this.waypoints) {
        const key =
          Math.floor(p.x / (this.chunkCells * this.cell)) +
          "," +
          Math.floor(p.y / (this.chunkCells * this.cell));
        if (!this.waypointChunks.has(key)) this.waypointChunks.set(key, []);
        this.waypointChunks.get(key).push(p);
      }

      const areas = regions || [{ x: 0, y: 0, w: this.width, h: this.height }];
      let changed = this.revision === 0;
      for (const area of areas) {
        const x0 = Math.max(0, Math.floor(area.x / this.cell)),
          y0 = Math.max(0, Math.floor(area.y / this.cell)),
          x1 = Math.min(
            this.cols - 1,
            Math.ceil((area.x + area.w) / this.cell),
          ),
          y1 = Math.min(
            this.rows - 1,
            Math.ceil((area.y + area.h) / this.cell),
          );
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const id = y * this.cols + x,
              value = test((x + 0.5) * this.cell, (y + 0.5) * this.cell)
                ? 0
                : 1;
            if (this.blocked[id] !== value) changed = true;
            this.blocked[id] = value;
          }
      }
      if (changed) {
        const size = this.chunkCells * this.cell,
          dirtyChunks = new Set();
        for (const area of areas)
          for (
            let cy = Math.max(0, Math.floor(area.y / size));
            cy <=
            Math.min(this.chunkRows - 1, Math.floor((area.y + area.h) / size));
            cy++
          )
            for (
              let cx = Math.max(0, Math.floor(area.x / size));
              cx <=
              Math.min(
                this.chunkCols - 1,
                Math.floor((area.x + area.w) / size),
              );
              cx++
            )
              dirtyChunks.add(cy * this.chunkCols + cx);
        for (const chunk of dirtyChunks) this.buildChunkLeaves(chunk);
      }
      if (!changed) {
        if (!regions?.length) return false;
        // Sub-cell changes can affect a physically narrow passage without changing grid cells.
        this.revision++;
        this.refreshChunks(areas);
        return true;
      }
      this.revision++;
      this.components.fill(-1);
      const queue = (this.regionQueue ||= new Int32Array(this.blocked.length));
      let region = 0;
      for (let start = 0; start < this.blocked.length; start++) {
        if (this.blocked[start] || this.components[start] >= 0) continue;
        let head = 0,
          tail = 1;
        queue[0] = start;
        this.components[start] = -2;
        while (head < tail) {
          const seed = queue[head++];
          if (this.components[seed] >= 0) continue;
          const row = Math.floor(seed / this.cols) * this.cols;
          let left = seed,
            right = seed;
          while (
            left > row &&
            !this.blocked[left - 1] &&
            this.components[left - 1] < 0
          )
            left--;
          while (
            right + 1 < row + this.cols &&
            !this.blocked[right + 1] &&
            this.components[right + 1] < 0
          )
            right++;
          this.components.fill(region, left, right + 1);
          for (const offset of [-this.cols, this.cols]) {
            if (left + offset < 0 || right + offset >= this.blocked.length)
              continue;
            let run = false;
            for (let id = left + offset; id <= right + offset; id++) {
              if (this.blocked[id] || this.components[id] >= 0) {
                run = false;
                continue;
              }
              if (!run && this.components[id] === -1) {
                this.components[id] = -2;
                queue[tail++] = id;
              }
              run = true;
            }
          }
        }
        region++;
      }
      this.refreshChunks(areas);
      return true;
    }
    chunkId(x, y) {
      return ((y >> 5) * this.chunkCols + (x >> 5)) | 0;
    }
    edgeOpen(a, b) {
      const low = a < b ? a : b,
        delta = a > b ? a - b : b - a,
        cols = this.cols,
        x = low % cols,
        y = (low / cols) | 0,
        chunk = (y >> 5) * this.chunkCols + (x >> 5),
        edgeType =
          delta === 1 ? 0 : delta === cols ? 1 : delta === cols + 1 ? 2 : 3,
        key = (((y & 31) << 5) | (x & 31)) * 4 + edgeType,
        cache = (this.edgeCaches[chunk] ||= new Uint8Array(4096));
      if (cache[key]) return cache[key] === 2;
      const clear = this.clearLine(
        {
          x: (x + 0.5) * this.cell,
          y: (y + 0.5) * this.cell,
        },
        {
          x: ((b % cols) + 0.5) * this.cell,
          y: (((b / cols) | 0) + 0.5) * this.cell,
        },
      );
      cache[key] = clear ? 2 : 1;
      return clear;
    }
    refreshChunks(areas) {
      const dirty = new Set(),
        size = this.chunkCells * this.cell;
      for (const a of areas)
        for (
          let y = Math.max(0, Math.floor(a.y / size) - 1);
          y <= Math.min(this.chunkRows - 1, Math.floor((a.y + a.h) / size) + 1);
          y++
        )
          for (
            let x = Math.max(0, Math.floor(a.x / size) - 1);
            x <=
            Math.min(this.chunkCols - 1, Math.floor((a.x + a.w) / size) + 1);
            x++
          )
            dirty.add(y * this.chunkCols + x);
      for (const id of dirty) this.edgeCaches[id]?.fill(0);
      for (const id of dirty) {
        const cx = id % this.chunkCols,
          cy = Math.floor(id / this.chunkCols),
          x0 = cx * this.chunkCells,
          y0 = cy * this.chunkCells,
          x1 = Math.min(this.cols, x0 + this.chunkCells),
          y1 = Math.min(this.rows, y0 + this.chunkCells);
        for (const next of this.chunkLinks[id])
          this.chunkLinks[next].delete(id);
        this.chunkLinks[id].clear();
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= this.chunkCols || ny >= this.chunkRows)
            continue;
          let open = false;
          if (dx)
            for (let y = y0; y < y1 && !open; y++) {
              const x = dx > 0 ? x1 - 1 : x0;
              if (this.free(x, y) && this.free(x + dx, y))
                open = this.edgeOpen(y * this.cols + x, y * this.cols + x + dx);
            }
          else
            for (let x = x0; x < x1 && !open; x++) {
              const y = dy > 0 ? y1 - 1 : y0;
              if (this.free(x, y) && this.free(x, y + dy))
                open = this.edgeOpen(
                  y * this.cols + x,
                  (y + dy) * this.cols + x,
                );
            }
          if (open) {
            const other = ny * this.chunkCols + nx;
            this.chunkLinks[id].add(other);
            this.chunkLinks[other].add(id);
          }
        }
      }
      this.corridors.clear();
      this.lastDirtyChunks = dirty.size;
    }
    chunkCorridor(a, b) {
      const start = this.chunkId(a.x, a.y),
        goal = this.chunkId(b.x, b.y),
        key = start + ":" + goal;
      if (this.corridors.has(key)) return this.corridors.get(key);
      const heap = new Heap(),
        cost = new Map([[start, 0]]),
        parent = new Map(),
        seen = new Set();
      const heuristic = (id) =>
        Math.abs((id % this.chunkCols) - (goal % this.chunkCols)) +
        Math.abs(
          Math.floor(id / this.chunkCols) - Math.floor(goal / this.chunkCols),
        );
      heap.push({ id: start, f: heuristic(start) });
      let found = false,
        expansions = 0;
      while (heap.items.length) {
        const id = heap.pop().id;
        if (seen.has(id)) continue;
        seen.add(id);
        if (id === goal) {
          found = true;
          break;
        }
        for (const next of this.chunkLinks[id]) {
          const value = cost.get(id) + 1;
          if (value >= (cost.get(next) ?? Infinity)) continue;
          cost.set(next, value);
          parent.set(next, id);
          heap.push({ id: next, f: value + heuristic(next) });
        }
      }
      if (!found) return null;
      const corridor = new Set();
      for (let id = goal; id !== undefined; id = parent.get(id)) {
        const x = id % this.chunkCols,
          y = Math.floor(id / this.chunkCols);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (
              x + dx >= 0 &&
              y + dy >= 0 &&
              x + dx < this.chunkCols &&
              y + dy < this.chunkRows
            )
              corridor.add((y + dy) * this.chunkCols + x + dx);
      }
      if (this.corridors.size >= 256)
        this.corridors.delete(this.corridors.keys().next().value);
      this.corridors.set(key, corridor);
      return corridor;
    }
    localWaypoints(start, goal, pad) {
      const list = [],
        size = this.chunkCells * this.cell,
        x0 = Math.min(start.x, goal.x) - pad,
        x1 = Math.max(start.x, goal.x) + pad,
        y0 = Math.min(start.y, goal.y) - pad,
        y1 = Math.max(start.y, goal.y) + pad;
      for (let y = Math.floor(y0 / size); y <= Math.floor(y1 / size); y++)
        for (let x = Math.floor(x0 / size); x <= Math.floor(x1 / size); x++)
          for (const p of this.waypointChunks.get(x + "," + y) || [])
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) list.push(p);
      return list;
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
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      if (length < 1e-6) return this.physicalFree(a.x, a.y);
      const ux = dx / length,
        uy = dy / length,
        cell = this.cell,
        leaves = this.useLeaves && length > 96;
      let t = 0;
      for (;;) {
        const x = a.x + ux * t,
          y = a.y + uy * t;
        if (!this.physicalFree(x, y)) return false;
        if (t >= length) return true;
        let step = 3;
        if (leaves) {
          // Inside a wide free square nothing can intervene: hop to its far edge.
          const cx = (x / cell) | 0,
            cy = (y / cell) | 0;
          if (cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows) {
            const id = this.leafOf[cy * this.cols + cx];
            if (id >= 0 && this.ls[id] >= 4) {
              const x0 = this.lx[id] * cell,
                y0 = this.ly[id] * cell,
                size = this.ls[id] * cell,
                tx =
                  ux > 1e-9
                    ? (x0 + size - x) / ux
                    : ux < -1e-9
                      ? (x0 - x) / ux
                      : Infinity,
                ty =
                  uy > 1e-9
                    ? (y0 + size - y) / uy
                    : uy < -1e-9
                      ? (y0 - y) / uy
                      : Infinity;
              step = Math.max(3, Math.min(tx, ty));
            }
          }
        }
        t = Math.min(length, t + step);
      }
    }
    gapRoute(start, goal) {
      return this.complete(this.gapRouteSteps(start, goal));
    }
    *gapRouteSteps(start, goal, limit = 512) {
      // Obstacle-edge vertices retain passages narrower than a navigation cell.
      const pad = 256;
      const near = this.localWaypoints(start, goal, pad).map((p) => ({
        p,
        d:
          Math.hypot(p.x - start.x, p.y - start.y) +
          Math.hypot(p.x - goal.x, p.y - goal.y),
      }));
      near.sort((a, b) => a.d - b.d);
      const points = [start, goal, ...near.slice(0, limit).map((o) => o.p)];
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
            b = points[i];
          let clear;
          if (id > 1 && i > 1) {
            // Waypoint-to-waypoint edges are cached by integer pair key.
            const key =
              a.wid < b.wid ? a.wid * 2097152 + b.wid : b.wid * 2097152 + a.wid;
            yield;
            let edge = this.gapEdges.get(key);
            clear = edge?.clear;
            if (clear === undefined) {
              clear = this.clearLine(a, b);
              if (this.gapEdges.size > 50000)
                this.gapEdges.delete(this.gapEdges.keys().next().value);
              this.gapEdges.set(key, {
                clear,
                minX: Math.min(a.x, b.x),
                maxX: Math.max(a.x, b.x),
                minY: Math.min(a.y, b.y),
                maxY: Math.max(a.y, b.y),
              });
            }
          } else {
            yield;
            clear = this.clearLine(a, b);
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
      const key =
        start.x + "," + start.y + "," + destination.x + "," + destination.y;
      const cached = this.pathCache.get(key);
      if (cached) return cached.map((p) => ({ ...p }));
      const path = this.findRoute(start, destination, false);
      if (this.pathCache.size >= 512)
        this.pathCache.delete(this.pathCache.keys().next().value);
      this.pathCache.set(
        key,
        path.map((p) => ({ ...p })),
      );
      return path;
    }
    complete(steps) {
      let result;
      do {
        result = steps.next();
      } while (!result.done);
      return result.value;
    }
    // Live simulation searches resume under one shared frame budget. Synchronous
    // find remains available for deterministic tools and navigation tests.
    cancelOwner(owner) {
      const key = this.ownerKeys.get(owner);
      if (key === undefined) return;
      const job = this.pending.get(key);
      if (job?.owners) {
        job.owners.delete(owner);
        if (job.owners.size) {
          this.ownerKeys.delete(owner);
          return;
        }
      }
      this.pending.delete(key);
      this.jobs = this.jobs.filter((j) => j.key !== key);
      if (this.activeJob?.key === key) this.activeJob = null;
      this.ownerKeys.delete(owner);
    }
    query(start, destination, options = {}) {
      const key =
        start.x + "," + start.y + "," + destination.x + "," + destination.y;
      const priority = options.priority || 0,
        owner = options.owner;
      if (owner !== undefined && this.ownerKeys.get(owner) !== key) {
        this.cancelOwner(owner);
        this.ownerKeys.set(owner, key);
      }
      const cached = this.pathCache.get(key);
      if (cached) return cached.map((p) => ({ ...p }));
      const existing = this.pending.get(key);
      const reprioritize = !existing || priority > (existing.priority || 0);
      if (existing) {
        existing.lastUsed = performance.now();
        existing.priority = Math.max(existing.priority || 0, priority);
        if (owner !== undefined) existing.owners.add(owner);
      }
      // A clear player order starts immediately, even behind a long background search.
      if (
        !existing &&
        priority > 0 &&
        this.physicalFree(destination.x, destination.y) &&
        this.clearLine(start, destination)
      ) {
        this.searches++;
        const path = [{ ...destination }];
        this.pathCache.set(key, path);
        if (this.pathCache.size > 512)
          this.pathCache.delete(this.pathCache.keys().next().value);
        return path.map((p) => ({ ...p }));
      }
      if (!existing && this.pending.size >= 128 && priority > 0) {
        const obsolete = [...this.pending.values()]
          .filter((j) => (j.priority || 0) < priority && j !== this.activeJob)
          .sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (obsolete) {
          this.pending.delete(obsolete.key);
          this.jobs = this.jobs.filter((j) => j !== obsolete);
          for (const id of obsolete.owners) this.ownerKeys.delete(id);
        }
      }
      if (!existing && this.pending.size < 128) {
        const job = {
          key,
          start: { x: start.x, y: start.y },
          destination: { ...destination },
          revision: this.revision,
          lastUsed: performance.now(),
          priority,
          owners: new Set(owner === undefined ? [] : [owner]),
        };
        this.pending.set(key, job);
        this.jobs.push(job);
      }
      if (priority > (this.activeJob?.priority || 0)) {
        const interrupted = this.activeJob;
        if (interrupted) {
          interrupted.steps = null;
          this.jobs.push(interrupted);
          this.activeJob = null;
        }
      }
      if (reprioritize)
        this.jobs.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      return null;
    }
    // True while a player-priority route is waiting, so frames may spend more time.
    urgent() {
      if (this.activeJob && (this.activeJob.priority || 0) > 0) return true;
      for (const job of this.jobs) if ((job.priority || 0) > 0) return true;
      return false;
    }
    process(budget = 3, workLimit = Infinity) {
      const deadline = performance.now() + budget;
      let work = 0;
      while (work++ < workLimit && performance.now() < deadline) {
        const job = this.activeJob || this.jobs.shift();
        if (!job) return;
        if (performance.now() - job.lastUsed > 5000) {
          for (const owner of job.owners || [])
            if (this.ownerKeys.get(owner) === job.key)
              this.ownerKeys.delete(owner);
          this.pending.delete(job.key);
          this.activeJob = null;
          continue;
        }
        this.activeJob = job;
        job.steps ||= this.resolveJob(job);
        const result = job.steps.next();
        if (!result.done) continue;
        if (job.revision === this.revision) {
          if (this.pathCache.size >= 512)
            this.pathCache.delete(this.pathCache.keys().next().value);
          this.pathCache.set(
            job.key,
            result.value.map((p) => ({ ...p })),
          );
        }
        this.pending.delete(job.key);
        for (const owner of job.owners || [])
          if (this.ownerKeys.get(owner) === job.key)
            this.ownerKeys.delete(owner);
        this.activeJob = null;
      }
    }
    *resolveJob(job) {
      while (true) {
        job.revision = this.revision;
        const path = yield* this.findRouteSteps(job.start, job.destination);
        if (job.revision === this.revision) return path;
        // Distant construction must not continually restart a long search.
        // Revalidate every returned segment against the current physical map.
        let valid = path.length > 0,
          anchor = job.start;
        for (const point of path) {
          yield;
          if (!this.clearLine(anchor, point)) {
            valid = false;
            break;
          }
          anchor = point;
        }
        if (valid) {
          job.revision = this.revision;
          return path;
        }
        yield;
      }
    }
    findRoute(start, destination, unrestricted = false) {
      return this.complete(
        this.findRouteSteps(start, destination, unrestricted),
      );
    }
    // A* over free quadtree squares; returns portal points ending at `goal`.
    *leafRouteSteps(s, end, goal, corridor) {
      const cols = this.cols,
        rows = this.rows,
        leafOf = this.leafOf,
        lx = this.lx,
        ly = this.ly,
        ls = this.ls,
        blocked = this.blocked,
        chunkCols = this.chunkCols,
        cap = this.lx.length;
      if (this.leafCost?.length !== cap) {
        this.leafCost = new Float64Array(cap);
        this.leafParent = new Int32Array(cap);
        this.leafClosed = new Uint32Array(cap);
        this.leafStamp = new Uint32Array(cap);
        this.leafEpoch = 0;
      }
      const cost = this.leafCost,
        parent = this.leafParent,
        closed = this.leafClosed,
        stamp = this.leafStamp,
        epoch = ++this.leafEpoch,
        startLeaf = leafOf[s.y * cols + s.x],
        goalLeaf = leafOf[end.y * cols + end.x];
      if (startLeaf < 0 || goalLeaf < 0) return null;
      const gx = end.x + 0.5,
        gy = end.y + 0.5,
        cxOf = (id) => lx[id] + ls[id] / 2,
        cyOf = (id) => ly[id] + ls[id] / 2,
        heap = new Heap();
      cost[startLeaf] = 0;
      stamp[startLeaf] = epoch;
      parent[startLeaf] = -1;
      heap.pushItem(
        startLeaf,
        Math.hypot(cxOf(startLeaf) - gx, cyOf(startLeaf) - gy),
      );
      let found = false,
        expansions = 0;
      const relax = (current, id) => {
        if (closed[id] === epoch) return;
        if (
          corridor &&
          !corridor.has(((ly[id] >> 5) * chunkCols + (lx[id] >> 5)) | 0)
        )
          return;
        const next =
          cost[current] +
          Math.hypot(cxOf(id) - cxOf(current), cyOf(id) - cyOf(current));
        if (stamp[id] === epoch && next >= cost[id]) return;
        // Cluttered ground keeps the physical edge test; open squares are
        // convex and entirely free.
        if (ls[current] <= 2 && ls[id] <= 2) {
          const open =
            ls[current] === 1 &&
            ls[id] === 1 &&
            (lx[current] === lx[id] || ly[current] === ly[id])
              ? this.edgeOpen(
                  ly[current] * cols + lx[current],
                  ly[id] * cols + lx[id],
                )
              : this.clearLine(
                  {
                    x: cxOf(current) * this.cell,
                    y: cyOf(current) * this.cell,
                  },
                  { x: cxOf(id) * this.cell, y: cyOf(id) * this.cell },
                );
          if (!open) return;
        }
        cost[id] = next;
        stamp[id] = epoch;
        parent[id] = current;
        heap.pushItem(id, next + Math.hypot(cxOf(id) - gx, cyOf(id) - gy));
      };
      while (heap.length) {
        const current = heap.popId();
        if (closed[current] === epoch) continue;
        if (current === goalLeaf) {
          found = true;
          break;
        }
        if ((++expansions & 63) === 0) yield;
        closed[current] = epoch;
        const x = lx[current],
          y = ly[current],
          size = ls[current];
        if (x > 0)
          for (let yy = y; yy < y + size;) {
            const id = leafOf[yy * cols + x - 1];
            if (id < 0) yy++;
            else {
              relax(current, id);
              yy = ly[id] + ls[id];
            }
          }
        if (x + size < cols)
          for (let yy = y; yy < y + size;) {
            const id = leafOf[yy * cols + x + size];
            if (id < 0) yy++;
            else {
              relax(current, id);
              yy = ly[id] + ls[id];
            }
          }
        if (y > 0)
          for (let xx = x; xx < x + size;) {
            const id = leafOf[(y - 1) * cols + xx];
            if (id < 0) xx++;
            else {
              relax(current, id);
              xx = lx[id] + ls[id];
            }
          }
        if (y + size < rows)
          for (let xx = x; xx < x + size;) {
            const id = leafOf[(y + size) * cols + xx];
            if (id < 0) xx++;
            else {
              relax(current, id);
              xx = lx[id] + ls[id];
            }
          }
        // Diagonal hops across a free corner, never cutting a blocked cell.
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          const ox = dx < 0 ? x - 1 : x + size,
            oy = dy < 0 ? y - 1 : y + size,
            ax = dx < 0 ? x : x + size - 1,
            ay = dy < 0 ? y : y + size - 1;
          if (ox < 0 || oy < 0 || ox >= cols || oy >= rows) continue;
          const id = leafOf[oy * cols + ox];
          if (id < 0) continue;
          if (blocked[ay * cols + ox] || blocked[oy * cols + ax]) continue;
          relax(current, id);
        }
      }
      if (!found) return null;
      const chain = [];
      for (let id = goalLeaf; id >= 0 && id !== startLeaf; id = parent[id])
        chain.push(id);
      chain.push(startLeaf);
      chain.reverse();
      const cell = this.cell,
        route = [];
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = chain[i],
          b = chain[i + 1];
        const abutX = lx[b] + ls[b] === lx[a] || lx[a] + ls[a] === lx[b],
          abutY = ly[b] + ls[b] === ly[a] || ly[a] + ls[a] === ly[b],
          edgeX = lx[b] + ls[b] === lx[a] ? lx[a] : lx[b],
          edgeY = ly[b] + ls[b] === ly[a] ? ly[a] : ly[b],
          midX =
            (Math.max(lx[a], lx[b]) + Math.min(lx[a] + ls[a], lx[b] + ls[b])) /
            2,
          midY =
            (Math.max(ly[a], ly[b]) + Math.min(ly[a] + ls[a], ly[b] + ls[b])) /
            2;
        // The shared boundary's midpoint, or the shared corner for diagonals.
        const px = abutX ? edgeX : midX,
          py = abutY ? edgeY : midY;
        // Cluttered ground follows verified cell centres; open ground crosses
        // the shared boundary.
        if (ls[a] <= 2 && ls[b] <= 2)
          route.push({
            x: (lx[b] + ls[b] / 2) * cell,
            y: (ly[b] + ls[b] / 2) * cell,
          });
        else route.push({ x: px * cell, y: py * cell });
      }
      route.push(goal);
      return route;
    }
    *findRouteSteps(start, destination, unrestricted = false) {
      this.searches++;
      const precise = this.physicalFree(destination.x, destination.y);
      if (precise && this.clearLine(start, destination))
        return [{ ...destination }];
      const s = this.nearest(start.x, start.y);
      const end = s ? this.nearest(destination.x, destination.y, null) : null;
      if (!s || !end)
        return precise
          ? yield* this.gapRouteSteps(start, destination, 160)
          : [];
      if (
        this.components[s.y * this.cols + s.x] !==
        this.components[end.y * this.cols + end.x]
      )
        return precise
          ? yield* this.gapRouteSteps(start, destination, 160)
          : [];
      const goal = {
        x: (end.x + 0.5) * this.cell,
        y: (end.y + 0.5) * this.cell,
      };
      if (this.clearLine(start, goal)) return [goal];
      const corridor = unrestricted ? null : this.chunkCorridor(s, end);
      if (this.useLeaves) {
        const route = yield* this.leafRouteSteps(s, end, goal, corridor);
        if (!route) {
          if (corridor)
            return yield* this.findRouteSteps(start, destination, true);
          return precise
            ? yield* this.gapRouteSteps(start, destination, 160)
            : [];
        }
        return yield* this.finishRoute(route, start, destination, precise);
      }
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
        blocked = this.blocked,
        cols = this.cols,
        rows = this.rows,
        chunkCols = this.chunkCols,
        heap = new Heap(),
        si = s.y * cols + s.x,
        ei = end.y * cols + end.x;
      const heuristic = (x, y) => {
        const dx = Math.abs(x - end.x),
          dy = Math.abs(y - end.y);
        return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy);
      };
      cost[si] = 0;
      stamp[si] = epoch;
      parent[si] = -1;
      heap.pushItem(si, heuristic(s.x, s.y));
      let found = false,
        expansions = 0;
      const DIRS = [
        [-1, -1, 1, 1.4142135623730951],
        [0, -1, 0, 1],
        [1, -1, 1, 1.4142135623730951],
        [-1, 0, 0, 1],
        [1, 0, 0, 1],
        [-1, 1, 1, 1.4142135623730951],
        [0, 1, 0, 1],
        [1, 1, 1, 1.4142135623730951],
      ];
      while (heap.length) {
        const current = heap.popId();
        if (closed[current] === epoch) continue;
        if (current === ei) {
          found = true;
          break;
        }
        if ((++expansions & 31) === 0) yield;
        closed[current] = epoch;
        const x = current % cols,
          y = (current / cols) | 0;
        for (let di = 0; di < 8; di++) {
          const d = DIRS[di],
            nx = x + d[0],
            ny = y + d[1];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const id = ny * cols + nx;
          if (blocked[id]) continue;
          if (d[2] && (blocked[y * cols + nx] || blocked[ny * cols + x]))
            continue;
          const next = cost[current] + d[3];
          if (corridor && !corridor.has((ny >> 5) * chunkCols + (nx >> 5)))
            continue;
          if (closed[id] === epoch || (stamp[id] === epoch && next >= cost[id]))
            continue;
          if (!this.edgeOpen(current, id)) continue;
          cost[id] = next;
          stamp[id] = epoch;
          parent[id] = current;
          heap.pushItem(id, next + heuristic(nx, ny));
        }
      }
      if (!found) {
        if (corridor)
          return yield* this.findRouteSteps(start, destination, true);
        return precise
          ? yield* this.gapRouteSteps(start, destination, 160)
          : [];
      }
      const route = [];
      for (let id = ei; id !== si && id >= 0; id = parent[id])
        route.push({
          x: ((id % this.cols) + 0.5) * this.cell,
          y: (Math.floor(id / this.cols) + 0.5) * this.cell,
        });
      route.reverse();
      return yield* this.finishRoute(route, start, destination, precise);
    }
    // Smooth a coarse route with bounded, yielding look-ahead.
    *finishRoute(route, start, destination, precise) {
      const smooth = [];
      let anchor = start,
        i = 0,
        checks = 0;
      while (i < route.length) {
        let far = i;
        // Bounded lookahead that yields keeps long routes from freezing the frame.
        while (
          far + 1 < route.length &&
          far - i < 48 &&
          this.clearLine(anchor, route[far + 1])
        ) {
          far++;
          if ((++checks & 3) === 0) yield;
        }
        yield;
        // A coarse square can hide a sub-cell obstacle; detour around it locally.
        if (far === i && !this.clearLine(anchor, route[i])) {
          const detour = yield* this.gapRouteSteps(anchor, route[i], 96);
          for (const q of detour.slice(0, -1)) smooth.push(q);
        }
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
        const gap = yield* this.gapRouteSteps(start, destination, 160);
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
