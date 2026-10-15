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
        length = Math.hypot(dx, dy),
        steps = Math.ceil(length / 3);
      if (!steps) return this.physicalFree(a.x, a.y);
      const stepX = dx / steps,
        stepY = dy / steps;
      let cx = a.x,
        cy = a.y;
      for (let i = 0; i <= steps; i++) {
        if (!this.physicalFree(cx, cy)) return false;
        cx += stepX;
        cy += stepY;
      }
      return true;
    }
    gapRoute(start, goal) {
      return this.complete(this.gapRouteSteps(start, goal));
    }
    *gapRouteSteps(start, goal, limit = 512) {
      // Obstacle-edge vertices retain passages narrower than a navigation cell.
      const pad = 256;
      const points = [
        start,
        goal,
        ...this.localWaypoints(start, goal, pad)
          .sort(
            (a, b) =>
              Math.hypot(a.x - start.x, a.y - start.y) +
              Math.hypot(a.x - goal.x, a.y - goal.y) -
              Math.hypot(b.x - start.x, b.y - start.y) -
              Math.hypot(b.x - goal.x, b.y - goal.y),
          )
          .slice(0, limit),
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
          yield;
          let edge = this.gapEdges.get(key);
          let clear = edge?.clear;
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
    *findRouteSteps(start, destination, unrestricted = false) {
      this.searches++;
      const precise = this.physicalFree(destination.x, destination.y);
      if (precise && this.clearLine(start, destination))
        return [{ ...destination }];
      const s = this.nearest(start.x, start.y);
      const end = s ? this.nearest(destination.x, destination.y, null) : null;
      if (!s || !end)
        return precise ? yield* this.gapRouteSteps(start, destination) : [];
      if (
        this.components[s.y * this.cols + s.x] !==
        this.components[end.y * this.cols + end.x]
      )
        return precise ? yield* this.gapRouteSteps(start, destination) : [];
      const goal = {
        x: (end.x + 0.5) * this.cell,
        y: (end.y + 0.5) * this.cell,
      };
      if (this.clearLine(start, goal)) return [goal];
      const corridor = unrestricted ? null : this.chunkCorridor(s, end);
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
        return precise ? yield* this.gapRouteSteps(start, destination) : [];
      }
      const route = [];
      for (let id = ei; id !== si && id >= 0; id = parent[id])
        route.push({
          x: ((id % this.cols) + 0.5) * this.cell,
          y: (Math.floor(id / this.cols) + 0.5) * this.cell,
        });
      route.reverse();
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
