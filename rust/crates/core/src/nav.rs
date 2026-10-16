//! Port of `src/navigation.js`: adaptive quadtree A* with chunk corridors, gap
//! routes around sub-cell obstacles and path smoothing. Only the quadtree
//! ("leaf") search is ported: the legacy per-cell search exists in JS solely for
//! tests and benchmarks.
//!
//! The JS version runs searches as generators under a frame budget. Rust
//! searches are fast enough to run to completion, so jobs are resolved whole
//! (`process`), keeping the same priority and ownership rules.

use crate::js::hypot;
use indexmap::{IndexMap, IndexSet};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

impl Pt {
    pub fn new(x: f64, y: f64) -> Pt {
        Pt { x, y }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Waypoint {
    pub x: f64,
    pub y: f64,
    pub wid: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Physical collision test used by every search (`groundFree(x, y, 6)` in JS).
pub type Physical<'a> = &'a dyn Fn(f64, f64) -> bool;

/// Binary min-heap with the exact sift behaviour of the JS `Heap`.
#[derive(Default)]
struct Heap {
    ids: Vec<i32>,
    scores: Vec<f64>,
}

impl Heap {
    fn new() -> Heap {
        Heap { ids: Vec::new(), scores: Vec::new() }
    }
    fn len(&self) -> usize {
        self.ids.len()
    }
    fn push_item(&mut self, id: i32, f: f64) {
        let mut i = self.ids.len();
        self.ids.push(id);
        self.scores.push(f);
        while i > 0 {
            let p = (i - 1) >> 1;
            if self.scores[p] <= f {
                break;
            }
            self.ids[i] = self.ids[p];
            self.scores[i] = self.scores[p];
            i = p;
        }
        self.ids[i] = id;
        self.scores[i] = f;
    }
    fn pop_id(&mut self) -> i32 {
        if self.ids.is_empty() {
            return -1;
        }
        let first_id = self.ids[0];
        let last_id = self.ids.pop().unwrap();
        let last_score = self.scores.pop().unwrap();
        let length = self.ids.len();
        if length > 0 {
            let mut i = 0usize;
            let half = length >> 1;
            while i < half {
                let mut c = (i << 1) + 1;
                if c + 1 < length && self.scores[c + 1] < self.scores[c] {
                    c += 1;
                }
                if self.scores[c] >= last_score {
                    break;
                }
                self.ids[i] = self.ids[c];
                self.scores[i] = self.scores[c];
                i = c;
            }
            self.ids[i] = last_id;
            self.scores[i] = last_score;
        }
        first_id
    }
}

#[derive(Clone, Copy)]
struct GapEdge {
    clear: bool,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

#[derive(Clone, Debug)]
pub struct Job {
    pub key: String,
    pub start: Pt,
    pub destination: Pt,
    pub revision: u32,
    pub last_used: f64,
    pub priority: i32,
    pub owners: IndexSet<u32>,
}

pub struct Nav {
    pub width: f64,
    pub height: f64,
    pub cell: f64,
    pub cols: i32,
    pub rows: i32,
    pub blocked: Vec<u8>,
    pub revision: u32,
    pub searches: u32,
    pub components: Vec<i32>,
    chunk_cells: i32,
    chunk_cols: i32,
    chunk_rows: i32,
    chunk_links: Vec<IndexSet<usize>>,
    edge_caches: Vec<Option<Vec<u8>>>,
    corridors: IndexMap<String, IndexSet<usize>>,
    path_cache: IndexMap<String, Vec<Pt>>,
    pub pending: IndexMap<String, Job>,
    pub jobs: Vec<String>,
    owner_keys: HashMap<u32, String>,
    leaf_of: Vec<i32>,
    lx: Vec<i16>,
    ly: Vec<i16>,
    ls: Vec<u8>,
    leaf_count: Vec<u16>,
    pub leaf_total: i64,
    sat: Vec<i32>,
    waypoints: Vec<Waypoint>,
    waypoint_chunks: HashMap<(i32, i32), Vec<usize>>,
    gap_edges: IndexMap<u64, GapEdge>,
    pub footprints: Option<IndexMap<String, (Area, String)>>,
    leaf_cost: Vec<f64>,
    leaf_parent: Vec<i32>,
    leaf_closed: Vec<u32>,
    leaf_stamp: Vec<u32>,
    leaf_epoch: u32,
    pub last_dirty_chunks: usize,
}

fn js_floor(v: f64) -> i32 {
    v.floor() as i32
}

impl Nav {
    pub fn new(width: f64, height: f64, cell: f64) -> Nav {
        let cols = (width / cell).ceil() as i32;
        let rows = (height / cell).ceil() as i32;
        let chunk_cells = 32;
        let chunk_cols = (cols as f64 / chunk_cells as f64).ceil() as i32;
        let chunk_rows = (rows as f64 / chunk_cells as f64).ceil() as i32;
        let chunks = (chunk_cols * chunk_rows) as usize;
        let n = (cols * rows) as usize;
        Nav {
            width,
            height,
            cell,
            cols,
            rows,
            blocked: vec![0; n],
            revision: 0,
            searches: 0,
            components: vec![-1; n],
            chunk_cells,
            chunk_cols,
            chunk_rows,
            chunk_links: (0..chunks).map(|_| IndexSet::new()).collect(),
            edge_caches: vec![None; chunks],
            corridors: IndexMap::new(),
            path_cache: IndexMap::new(),
            pending: IndexMap::new(),
            jobs: Vec::new(),
            owner_keys: HashMap::new(),
            leaf_of: vec![-1; n],
            lx: vec![0; chunks * 1024],
            ly: vec![0; chunks * 1024],
            ls: vec![0; chunks * 1024],
            leaf_count: vec![0; chunks],
            leaf_total: 0,
            sat: vec![0; 33 * 33],
            waypoints: Vec::new(),
            waypoint_chunks: HashMap::new(),
            gap_edges: IndexMap::new(),
            footprints: None,
            leaf_cost: vec![0.0; chunks * 1024],
            leaf_parent: vec![0; chunks * 1024],
            leaf_closed: vec![0; chunks * 1024],
            leaf_stamp: vec![0; chunks * 1024],
            leaf_epoch: 0,
            last_dirty_chunks: 0,
        }
    }

    pub fn key(start: Pt, destination: Pt) -> String {
        format!("{},{},{},{}", js_num(start.x), js_num(start.y), js_num(destination.x), js_num(destination.y))
    }

    fn build_chunk_leaves(&mut self, chunk: usize) {
        let cols = self.cols;
        let rows = self.rows;
        let cx = chunk as i32 % self.chunk_cols;
        let cy = chunk as i32 / self.chunk_cols;
        let x0 = cx * 32;
        let y0 = cy * 32;
        for y in y0..rows.min(y0 + 32) {
            let a = (y * cols + x0) as usize;
            let b = (y * cols + cols.min(x0 + 32)) as usize;
            for v in &mut self.leaf_of[a..b] {
                *v = -1;
            }
        }
        for v in self.sat.iter_mut() {
            *v = 0;
        }
        for j in 0..32 {
            let mut row = 0i32;
            for i in 0..32 {
                let gx = x0 + i;
                let gy = y0 + j;
                row += if gx < cols && gy < rows { self.blocked[(gy * cols + gx) as usize] as i32 } else { 1 };
                self.sat[((j + 1) * 33 + i + 1) as usize] = self.sat[(j * 33 + i + 1) as usize] + row;
            }
        }
        let sat = self.sat.clone();
        let count = |x: i32, y: i32, s: i32| -> i32 {
            sat[((y + s) * 33 + x + s) as usize] - sat[(y * 33 + x + s) as usize] - sat[((y + s) * 33 + x) as usize]
                + sat[(y * 33 + x) as usize]
        };
        let mut stack: Vec<i32> = vec![0, 0, 32];
        let mut n = 0i32;
        while !stack.is_empty() {
            let s = stack.pop().unwrap();
            let y = stack.pop().unwrap();
            let x = stack.pop().unwrap();
            let blocked_cells = count(x, y, s);
            if blocked_cells == s * s {
                continue;
            }
            if blocked_cells == 0 {
                let id = chunk as i32 * 1024 + n;
                n += 1;
                self.lx[id as usize] = (x0 + x) as i16;
                self.ly[id as usize] = (y0 + y) as i16;
                self.ls[id as usize] = s as u8;
                for yy in (y0 + y)..(y0 + y + s) {
                    let a = (yy * cols + x0 + x) as usize;
                    let b = (yy * cols + x0 + x + s) as usize;
                    for v in &mut self.leaf_of[a..b] {
                        *v = id;
                    }
                }
                continue;
            }
            let h = s >> 1;
            stack.extend_from_slice(&[x, y, h, x + h, y, h, x, y + h, h, x + h, y + h, h]);
        }
        self.leaf_total += (n - self.leaf_count[chunk] as i32) as i64;
        self.leaf_count[chunk] = n as u16;
    }

    /// `rebuild(test, waypoints, regions)`. `regions` is `None` for a full rebuild.
    pub fn rebuild(&mut self, test: Physical, waypoints: &[Pt], regions: Option<&[Area]>) -> bool {
        match regions {
            None => self.gap_edges.clear(),
            Some(regions) => {
                if self.gap_edges.is_empty() {
                    // `!this.gapEdges` is only true before the first build.
                }
                let keys: Vec<u64> = self
                    .gap_edges
                    .iter()
                    .filter(|(_, e)| {
                        regions.iter().any(|a| e.max_x >= a.x && e.min_x <= a.x + a.w && e.max_y >= a.y && e.min_y <= a.y + a.h)
                    })
                    .map(|(k, _)| *k)
                    .collect();
                for k in keys {
                    self.gap_edges.shift_remove(&k);
                }
            }
        }
        self.path_cache.clear();
        let mut unique: IndexMap<(u64, u64), Pt> = IndexMap::new();
        for p in waypoints {
            if test(p.x, p.y) {
                unique.insert((p.x.to_bits(), p.y.to_bits()), *p);
            }
        }
        self.waypoints = unique.values().enumerate().map(|(i, p)| Waypoint { x: p.x, y: p.y, wid: i }).collect();
        self.waypoint_chunks = HashMap::new();
        let size = (self.chunk_cells as f64) * self.cell;
        for (i, p) in self.waypoints.iter().enumerate() {
            let key = (js_floor(p.x / size), js_floor(p.y / size));
            self.waypoint_chunks.entry(key).or_default().push(i);
        }

        let full = [Area { x: 0.0, y: 0.0, w: self.width, h: self.height }];
        let areas: &[Area] = regions.unwrap_or(&full);
        let mut changed = self.revision == 0;
        for area in areas {
            let x0 = 0.max(js_floor(area.x / self.cell));
            let y0 = 0.max(js_floor(area.y / self.cell));
            let x1 = (self.cols - 1).min(((area.x + area.w) / self.cell).ceil() as i32);
            let y1 = (self.rows - 1).min(((area.y + area.h) / self.cell).ceil() as i32);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let id = (y * self.cols + x) as usize;
                    let value: u8 = if test((x as f64 + 0.5) * self.cell, (y as f64 + 0.5) * self.cell) { 0 } else { 1 };
                    if self.blocked[id] != value {
                        changed = true;
                    }
                    self.blocked[id] = value;
                }
            }
        }
        if changed {
            let size = self.chunk_cells as f64 * self.cell;
            let mut dirty: IndexSet<usize> = IndexSet::new();
            for area in areas {
                let cy0 = 0.max(js_floor(area.y / size));
                let cy1 = (self.chunk_rows - 1).min(js_floor((area.y + area.h) / size));
                for cy in cy0..=cy1 {
                    let cx0 = 0.max(js_floor(area.x / size));
                    let cx1 = (self.chunk_cols - 1).min(js_floor((area.x + area.w) / size));
                    for cx in cx0..=cx1 {
                        dirty.insert((cy * self.chunk_cols + cx) as usize);
                    }
                }
            }
            for chunk in dirty {
                self.build_chunk_leaves(chunk);
            }
        }
        if !changed {
            match regions {
                Some(r) if !r.is_empty() => {}
                _ => return false,
            }
            self.revision += 1;
            self.refresh_chunks(areas, test);
            return true;
        }
        self.revision += 1;
        for v in self.components.iter_mut() {
            *v = -1;
        }
        let total = self.blocked.len();
        let mut queue: Vec<i32> = vec![0; total];
        let mut region = 0i32;
        let cols = self.cols;
        for start in 0..total {
            if self.blocked[start] != 0 || self.components[start] >= 0 {
                continue;
            }
            let mut head = 0usize;
            let mut tail = 1usize;
            queue[0] = start as i32;
            self.components[start] = -2;
            while head < tail {
                let seed = queue[head] as usize;
                head += 1;
                if self.components[seed] >= 0 {
                    continue;
                }
                let row = (seed as i32 / cols * cols) as usize;
                let mut left = seed;
                let mut right = seed;
                while left > row && self.blocked[left - 1] == 0 && self.components[left - 1] < 0 {
                    left -= 1;
                }
                while right + 1 < row + cols as usize && self.blocked[right + 1] == 0 && self.components[right + 1] < 0 {
                    right += 1;
                }
                for v in &mut self.components[left..=right] {
                    *v = region;
                }
                for offset in [-(cols as i64), cols as i64] {
                    if (left as i64) + offset < 0 || (right as i64) + offset >= total as i64 {
                        continue;
                    }
                    let mut run = false;
                    let mut id = left as i64 + offset;
                    while id <= right as i64 + offset {
                        let u = id as usize;
                        if self.blocked[u] != 0 || self.components[u] >= 0 {
                            run = false;
                            id += 1;
                            continue;
                        }
                        if !run && self.components[u] == -1 {
                            self.components[u] = -2;
                            queue[tail] = u as i32;
                            tail += 1;
                        }
                        run = true;
                        id += 1;
                    }
                }
            }
            region += 1;
        }
        self.refresh_chunks(areas, test);
        true
    }

    fn chunk_id(&self, x: i32, y: i32) -> usize {
        ((y >> 5) * self.chunk_cols + (x >> 5)) as usize
    }

    fn edge_open(&mut self, a: i32, b: i32, phys: Physical) -> bool {
        let low = a.min(b);
        let delta = (a - b).abs();
        let cols = self.cols;
        let x = low % cols;
        let y = low / cols;
        let chunk = ((y >> 5) * self.chunk_cols + (x >> 5)) as usize;
        let edge_type = if delta == 1 {
            0
        } else if delta == cols {
            1
        } else if delta == cols + 1 {
            2
        } else {
            3
        };
        let key = ((((y & 31) << 5) | (x & 31)) * 4 + edge_type) as usize;
        let cache = self.edge_caches[chunk].get_or_insert_with(|| vec![0u8; 4096]);
        if cache[key] != 0 {
            return cache[key] == 2;
        }
        let clear = self.clear_line(
            Pt::new((x as f64 + 0.5) * self.cell, (y as f64 + 0.5) * self.cell),
            Pt::new(((b % cols) as f64 + 0.5) * self.cell, ((b / cols) as f64 + 0.5) * self.cell),
            phys,
        );
        self.edge_caches[chunk].as_mut().unwrap()[key] = if clear { 2 } else { 1 };
        clear
    }

    fn refresh_chunks(&mut self, areas: &[Area], phys: Physical) {
        let size = self.chunk_cells as f64 * self.cell;
        let mut dirty: IndexSet<usize> = IndexSet::new();
        for a in areas {
            let y0 = 0.max(js_floor(a.y / size) - 1);
            let y1 = (self.chunk_rows - 1).min(js_floor((a.y + a.h) / size) + 1);
            for y in y0..=y1 {
                let x0 = 0.max(js_floor(a.x / size) - 1);
                let x1 = (self.chunk_cols - 1).min(js_floor((a.x + a.w) / size) + 1);
                for x in x0..=x1 {
                    dirty.insert((y * self.chunk_cols + x) as usize);
                }
            }
        }
        for &id in &dirty {
            if let Some(c) = self.edge_caches[id].as_mut() {
                for v in c.iter_mut() {
                    *v = 0;
                }
            }
        }
        for &id in &dirty {
            let cx = id as i32 % self.chunk_cols;
            let cy = id as i32 / self.chunk_cols;
            let x0 = cx * self.chunk_cells;
            let y0 = cy * self.chunk_cells;
            let x1 = self.cols.min(x0 + self.chunk_cells);
            let y1 = self.rows.min(y0 + self.chunk_cells);
            let nexts: Vec<usize> = self.chunk_links[id].iter().copied().collect();
            for next in nexts {
                self.chunk_links[next].shift_remove(&id);
            }
            self.chunk_links[id].clear();
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let nx = cx + dx;
                let ny = cy + dy;
                if nx < 0 || ny < 0 || nx >= self.chunk_cols || ny >= self.chunk_rows {
                    continue;
                }
                let mut open = false;
                if dx != 0 {
                    let mut y = y0;
                    while y < y1 && !open {
                        let x = if dx > 0 { x1 - 1 } else { x0 };
                        if self.free(x, y) && self.free(x + dx, y) {
                            open = self.edge_open(y * self.cols + x, y * self.cols + x + dx, phys);
                        }
                        y += 1;
                    }
                } else {
                    let mut x = x0;
                    while x < x1 && !open {
                        let y = if dy > 0 { y1 - 1 } else { y0 };
                        if self.free(x, y) && self.free(x, y + dy) {
                            open = self.edge_open(y * self.cols + x, (y + dy) * self.cols + x, phys);
                        }
                        x += 1;
                    }
                }
                if open {
                    let other = (ny * self.chunk_cols + nx) as usize;
                    self.chunk_links[id].insert(other);
                    self.chunk_links[other].insert(id);
                }
            }
        }
        self.corridors.clear();
        self.last_dirty_chunks = dirty.len();
    }

    fn chunk_corridor(&mut self, a: (i32, i32), b: (i32, i32)) -> Option<IndexSet<usize>> {
        let start = self.chunk_id(a.0, a.1);
        let goal = self.chunk_id(b.0, b.1);
        let key = format!("{}:{}", start, goal);
        if let Some(c) = self.corridors.get(&key) {
            return Some(c.clone());
        }
        let chunk_cols = self.chunk_cols;
        let heuristic = |id: usize| -> f64 {
            ((id as i32 % chunk_cols) - (goal as i32 % chunk_cols)).abs() as f64
                + ((id as i32 / chunk_cols) - (goal as i32 / chunk_cols)).abs() as f64
        };
        let mut heap = Heap::new();
        let mut cost: HashMap<usize, f64> = HashMap::new();
        cost.insert(start, 0.0);
        let mut parent: HashMap<usize, usize> = HashMap::new();
        let mut seen: std::collections::HashSet<usize> = std::collections::HashSet::new();
        heap.push_item(start as i32, heuristic(start));
        let mut found = false;
        while heap.len() > 0 {
            let id = heap.pop_id() as usize;
            if seen.contains(&id) {
                continue;
            }
            seen.insert(id);
            if id == goal {
                found = true;
                break;
            }
            let cid = cost[&id];
            let links: Vec<usize> = self.chunk_links[id].iter().copied().collect();
            for next in links {
                let value = cid + 1.0;
                if value >= *cost.get(&next).unwrap_or(&f64::INFINITY) {
                    continue;
                }
                cost.insert(next, value);
                parent.insert(next, id);
                heap.push_item(next as i32, value + heuristic(next));
            }
        }
        if !found {
            return None;
        }
        let mut corridor: IndexSet<usize> = IndexSet::new();
        let mut cur = Some(goal);
        while let Some(id) = cur {
            let x = id as i32 % self.chunk_cols;
            let y = id as i32 / self.chunk_cols;
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if x + dx >= 0 && y + dy >= 0 && x + dx < self.chunk_cols && y + dy < self.chunk_rows {
                        corridor.insert(((y + dy) * self.chunk_cols + x + dx) as usize);
                    }
                }
            }
            cur = parent.get(&id).copied();
        }
        if self.corridors.len() >= 256 {
            self.corridors.shift_remove_index(0);
        }
        self.corridors.insert(key, corridor.clone());
        Some(corridor)
    }

    fn local_waypoints(&self, start: Pt, goal: Pt, pad: f64) -> Vec<usize> {
        let mut list = Vec::new();
        let size = self.chunk_cells as f64 * self.cell;
        let x0 = start.x.min(goal.x) - pad;
        let x1 = start.x.max(goal.x) + pad;
        let y0 = start.y.min(goal.y) - pad;
        let y1 = start.y.max(goal.y) + pad;
        for y in js_floor(y0 / size)..=js_floor(y1 / size) {
            for x in js_floor(x0 / size)..=js_floor(x1 / size) {
                if let Some(ids) = self.waypoint_chunks.get(&(x, y)) {
                    for &i in ids {
                        let p = &self.waypoints[i];
                        if p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 {
                            list.push(i);
                        }
                    }
                }
            }
        }
        list
    }

    pub fn free(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.cols && y < self.rows && self.blocked[(y * self.cols + x) as usize] == 0
    }

    pub fn point_free(&self, x: f64, y: f64) -> bool {
        self.free(js_floor(x / self.cell), js_floor(y / self.cell))
    }

    /// `nearest(x, y, region)`: the closest free cell, optionally in `region`.
    pub fn nearest(&self, x: f64, y: f64, region: Option<i32>) -> Option<(i32, i32)> {
        let cx = 0.max((self.cols - 1).min(js_floor(x / self.cell)));
        let cy = 0.max((self.rows - 1).min(js_floor(y / self.cell)));
        if self.free(cx, cy) && (region.is_none() || Some(self.components[(cy * self.cols + cx) as usize]) == region) {
            return Some((cx, cy));
        }
        for r in 1..14i32 {
            let mut best: Option<(i32, i32)> = None;
            let mut score = f64::INFINITY;
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx.abs().max(dy.abs()) != r || !self.free(cx + dx, cy + dy) {
                        continue;
                    }
                    if let Some(rg) = region {
                        if self.components[((cy + dy) * self.cols + cx + dx) as usize] != rg {
                            continue;
                        }
                    }
                    let s = hypot(((cx + dx) as f64 + 0.5) * self.cell - x, ((cy + dy) as f64 + 0.5) * self.cell - y);
                    if s < score {
                        score = s;
                        best = Some((cx + dx, cy + dy));
                    }
                }
            }
            if best.is_some() {
                return best;
            }
        }
        None
    }

    pub fn component_at(&self, cell: (i32, i32)) -> i32 {
        self.components[(cell.1 * self.cols + cell.0) as usize]
    }

    pub fn clear_line(&self, a: Pt, b: Pt, phys: Physical) -> bool {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let length = hypot(dx, dy);
        if length < 1e-6 {
            return phys(a.x, a.y);
        }
        let ux = dx / length;
        let uy = dy / length;
        let cell = self.cell;
        let leaves = length > 96.0;
        let mut t = 0.0f64;
        loop {
            let x = a.x + ux * t;
            let y = a.y + uy * t;
            if !phys(x, y) {
                return false;
            }
            if t >= length {
                return true;
            }
            let mut step = 3.0f64;
            if leaves {
                let cx = (x / cell) as i32;
                let cy = (y / cell) as i32;
                if cx >= 0 && cy >= 0 && cx < self.cols && cy < self.rows {
                    let id = self.leaf_of[(cy * self.cols + cx) as usize];
                    if id >= 0 && self.ls[id as usize] >= 4 {
                        let x0 = self.lx[id as usize] as f64 * cell;
                        let y0 = self.ly[id as usize] as f64 * cell;
                        let size = self.ls[id as usize] as f64 * cell;
                        let tx = if ux > 1e-9 {
                            (x0 + size - x) / ux
                        } else if ux < -1e-9 {
                            (x0 - x) / ux
                        } else {
                            f64::INFINITY
                        };
                        let ty = if uy > 1e-9 {
                            (y0 + size - y) / uy
                        } else if uy < -1e-9 {
                            (y0 - y) / uy
                        } else {
                            f64::INFINITY
                        };
                        step = 3.0f64.max(tx.min(ty));
                    }
                }
            }
            t = length.min(t + step);
        }
    }

    fn gap_route(&mut self, start: Pt, goal: Pt, limit: usize, phys: Physical) -> Vec<Pt> {
        let pad = 256.0;
        let mut near: Vec<(usize, f64)> = self
            .local_waypoints(start, goal, pad)
            .into_iter()
            .map(|i| {
                let p = &self.waypoints[i];
                (i, hypot(p.x - start.x, p.y - start.y) + hypot(p.x - goal.x, p.y - goal.y))
            })
            .collect();
        near.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        // points[0] = start, points[1] = goal, then waypoints (with wid >= 0).
        let mut points: Vec<(Pt, Option<usize>)> = vec![(start, None), (goal, None)];
        for (i, _) in near.into_iter().take(limit) {
            let w = &self.waypoints[i];
            points.push((Pt::new(w.x, w.y), Some(w.wid)));
        }
        let n = points.len();
        let mut cost = vec![f64::INFINITY; n];
        let mut parent = vec![-1i32; n];
        let mut closed = vec![false; n];
        let mut heap = Heap::new();
        cost[0] = 0.0;
        heap.push_item(0, 0.0);
        while heap.len() > 0 {
            let id = heap.pop_id() as usize;
            if closed[id] {
                continue;
            }
            closed[id] = true;
            if id == 1 {
                let mut path = Vec::new();
                let mut i = 1usize;
                while i != 0 {
                    path.push(points[i].0);
                    i = parent[i] as usize;
                }
                path.reverse();
                return path;
            }
            for i in 1..n {
                if closed[i] {
                    continue;
                }
                let next = cost[id] + hypot(points[i].0.x - points[id].0.x, points[i].0.y - points[id].0.y);
                if next >= cost[i] {
                    continue;
                }
                let a = points[id].0;
                let b = points[i].0;
                let clear;
                if id > 1 && i > 1 {
                    let aw = points[id].1.unwrap();
                    let bw = points[i].1.unwrap();
                    let key = if aw < bw { aw as u64 * 2097152 + bw as u64 } else { bw as u64 * 2097152 + aw as u64 };
                    if let Some(edge) = self.gap_edges.get(&key) {
                        clear = edge.clear;
                    } else {
                        clear = self.clear_line(a, b, phys);
                        if self.gap_edges.len() > 50000 {
                            self.gap_edges.shift_remove_index(0);
                        }
                        self.gap_edges.insert(
                            key,
                            GapEdge { clear, min_x: a.x.min(b.x), max_x: a.x.max(b.x), min_y: a.y.min(b.y), max_y: a.y.max(b.y) },
                        );
                    }
                } else {
                    clear = self.clear_line(a, b, phys);
                }
                if !clear {
                    continue;
                }
                cost[i] = next;
                parent[i] = id as i32;
                heap.push_item(i as i32, next + hypot(points[i].0.x - goal.x, points[i].0.y - goal.y));
            }
        }
        Vec::new()
    }

    /// Synchronous, cached route (`find`).
    pub fn find(&mut self, start: Pt, destination: Pt, phys: Physical) -> Vec<Pt> {
        let key = Nav::key(start, destination);
        if let Some(c) = self.path_cache.get(&key) {
            return c.clone();
        }
        let path = self.find_route(start, destination, false, phys);
        if self.path_cache.len() >= 512 {
            self.path_cache.shift_remove_index(0);
        }
        self.path_cache.insert(key, path.clone());
        path
    }

    fn leaf_route(&mut self, s: (i32, i32), end: (i32, i32), goal: Pt, corridor: Option<&IndexSet<usize>>, phys: Physical) -> Option<Vec<Pt>> {
        let cols = self.cols;
        let rows = self.rows;
        let chunk_cols = self.chunk_cols;
        self.leaf_epoch += 1;
        let epoch = self.leaf_epoch;
        let start_leaf = self.leaf_of[(s.1 * cols + s.0) as usize];
        let goal_leaf = self.leaf_of[(end.1 * cols + end.0) as usize];
        if start_leaf < 0 || goal_leaf < 0 {
            return None;
        }
        let gx = end.0 as f64 + 0.5;
        let gy = end.1 as f64 + 0.5;
        let cx_of = |lx: &Vec<i16>, ls: &Vec<u8>, id: usize| lx[id] as f64 + ls[id] as f64 / 2.0;
        let cy_of = |ly: &Vec<i16>, ls: &Vec<u8>, id: usize| ly[id] as f64 + ls[id] as f64 / 2.0;
        let mut heap = Heap::new();
        let sl = start_leaf as usize;
        self.leaf_cost[sl] = 0.0;
        self.leaf_stamp[sl] = epoch;
        self.leaf_parent[sl] = -1;
        heap.push_item(
            start_leaf,
            hypot(cx_of(&self.lx, &self.ls, sl) - gx, cy_of(&self.ly, &self.ls, sl) - gy),
        );
        let mut found = false;
        while heap.len() > 0 {
            let current = heap.pop_id() as usize;
            if self.leaf_closed[current] == epoch {
                continue;
            }
            if current as i32 == goal_leaf {
                found = true;
                break;
            }
            self.leaf_closed[current] = epoch;
            let x = self.lx[current] as i32;
            let y = self.ly[current] as i32;
            let size = self.ls[current] as i32;
            // Gather neighbour leaves in the same order as the JS loops.
            let mut neighbours: Vec<usize> = Vec::new();
            if x > 0 {
                let mut yy = y;
                while yy < y + size {
                    let id = self.leaf_of[(yy * cols + x - 1) as usize];
                    if id < 0 {
                        yy += 1;
                    } else {
                        neighbours.push(id as usize);
                        yy = self.ly[id as usize] as i32 + self.ls[id as usize] as i32;
                    }
                }
            }
            if x + size < cols {
                let mut yy = y;
                while yy < y + size {
                    let id = self.leaf_of[(yy * cols + x + size) as usize];
                    if id < 0 {
                        yy += 1;
                    } else {
                        neighbours.push(id as usize);
                        yy = self.ly[id as usize] as i32 + self.ls[id as usize] as i32;
                    }
                }
            }
            if y > 0 {
                let mut xx = x;
                while xx < x + size {
                    let id = self.leaf_of[((y - 1) * cols + xx) as usize];
                    if id < 0 {
                        xx += 1;
                    } else {
                        neighbours.push(id as usize);
                        xx = self.lx[id as usize] as i32 + self.ls[id as usize] as i32;
                    }
                }
            }
            if y + size < rows {
                let mut xx = x;
                while xx < x + size {
                    let id = self.leaf_of[((y + size) * cols + xx) as usize];
                    if id < 0 {
                        xx += 1;
                    } else {
                        neighbours.push(id as usize);
                        xx = self.lx[id as usize] as i32 + self.ls[id as usize] as i32;
                    }
                }
            }
            // The orthogonal neighbours must be relaxed one by one *before* the
            // diagonals, and each relax can see previous ones' updates, so we
            // relax inline instead of batching.
            for id in neighbours {
                self.relax_leaf(current, id, epoch, corridor, chunk_cols, cols, gx, gy, &mut heap, phys);
            }
            for (dx, dy) in [(-1i32, -1i32), (1, -1), (-1, 1), (1, 1)] {
                let ox = if dx < 0 { x - 1 } else { x + size };
                let oy = if dy < 0 { y - 1 } else { y + size };
                let ax = if dx < 0 { x } else { x + size - 1 };
                let ay = if dy < 0 { y } else { y + size - 1 };
                if ox < 0 || oy < 0 || ox >= cols || oy >= rows {
                    continue;
                }
                let id = self.leaf_of[(oy * cols + ox) as usize];
                if id < 0 {
                    continue;
                }
                if self.blocked[(ay * cols + ox) as usize] != 0 || self.blocked[(oy * cols + ax) as usize] != 0 {
                    continue;
                }
                self.relax_leaf(current, id as usize, epoch, corridor, chunk_cols, cols, gx, gy, &mut heap, phys);
            }
        }
        if !found {
            return None;
        }
        let mut chain: Vec<usize> = Vec::new();
        let mut id = goal_leaf;
        while id >= 0 && id != start_leaf {
            chain.push(id as usize);
            id = self.leaf_parent[id as usize];
        }
        chain.push(start_leaf as usize);
        chain.reverse();
        let cell = self.cell;
        let (lx, ly, ls) = (&self.lx, &self.ly, &self.ls);
        let mut route = Vec::new();
        for i in 0..chain.len().saturating_sub(1) {
            let a = chain[i];
            let b = chain[i + 1];
            let (lxa, lya, lsa) = (lx[a] as i32, ly[a] as i32, ls[a] as i32);
            let (lxb, lyb, lsb) = (lx[b] as i32, ly[b] as i32, ls[b] as i32);
            let abut_x = lxb + lsb == lxa || lxa + lsa == lxb;
            let abut_y = lyb + lsb == lya || lya + lsa == lyb;
            let edge_x = if lxb + lsb == lxa { lxa } else { lxb };
            let edge_y = if lyb + lsb == lya { lya } else { lyb };
            let mid_x = (lxa.max(lxb) + (lxa + lsa).min(lxb + lsb)) as f64 / 2.0;
            let mid_y = (lya.max(lyb) + (lya + lsa).min(lyb + lsb)) as f64 / 2.0;
            let px = if abut_x { edge_x as f64 } else { mid_x };
            let py = if abut_y { edge_y as f64 } else { mid_y };
            if lsa <= 2 && lsb <= 2 {
                route.push(Pt::new((lxb as f64 + lsb as f64 / 2.0) * cell, (lyb as f64 + lsb as f64 / 2.0) * cell));
            } else {
                route.push(Pt::new(px * cell, py * cell));
            }
        }
        route.push(goal);
        Some(route)
    }

    #[allow(clippy::too_many_arguments)]
    fn relax_leaf(
        &mut self,
        current: usize,
        id: usize,
        epoch: u32,
        corridor: Option<&IndexSet<usize>>,
        chunk_cols: i32,
        cols: i32,
        gx: f64,
        gy: f64,
        heap: &mut Heap,
        phys: Physical,
    ) {
        if self.leaf_closed[id] == epoch {
            return;
        }
        if let Some(c) = corridor {
            let key = ((self.ly[id] as i32 >> 5) * chunk_cols + (self.lx[id] as i32 >> 5)) as usize;
            if !c.contains(&key) {
                return;
            }
        }
        let cxo = |s: &Nav, i: usize| s.lx[i] as f64 + s.ls[i] as f64 / 2.0;
        let cyo = |s: &Nav, i: usize| s.ly[i] as f64 + s.ls[i] as f64 / 2.0;
        let next = self.leaf_cost[current] + hypot(cxo(self, id) - cxo(self, current), cyo(self, id) - cyo(self, current));
        if self.leaf_stamp[id] == epoch && next >= self.leaf_cost[id] {
            return;
        }
        if self.ls[current] <= 2 && self.ls[id] <= 2 {
            let open = if self.ls[current] == 1
                && self.ls[id] == 1
                && (self.lx[current] == self.lx[id] || self.ly[current] == self.ly[id])
            {
                let a = self.ly[current] as i32 * cols + self.lx[current] as i32;
                let b = self.ly[id] as i32 * cols + self.lx[id] as i32;
                self.edge_open(a, b, phys)
            } else {
                self.clear_line(
                    Pt::new(cxo(self, current) * self.cell, cyo(self, current) * self.cell),
                    Pt::new(cxo(self, id) * self.cell, cyo(self, id) * self.cell),
                    phys,
                )
            };
            if !open {
                return;
            }
        }
        self.leaf_cost[id] = next;
        self.leaf_stamp[id] = epoch;
        self.leaf_parent[id] = current as i32;
        heap.push_item(id as i32, next + hypot(cxo(self, id) - gx, cyo(self, id) - gy));
    }

    pub fn find_route(&mut self, start: Pt, destination: Pt, unrestricted: bool, phys: Physical) -> Vec<Pt> {
        self.searches += 1;
        let precise = phys(destination.x, destination.y);
        if precise && self.clear_line(start, destination, phys) {
            return vec![destination];
        }
        let s = self.nearest(start.x, start.y, None);
        let end = if s.is_some() { self.nearest(destination.x, destination.y, None) } else { None };
        let (s, end) = match (s, end) {
            (Some(s), Some(e)) => (s, e),
            _ => {
                return if precise { self.gap_route(start, destination, 160, phys) } else { Vec::new() };
            }
        };
        if self.component_at(s) != self.component_at(end) {
            return if precise { self.gap_route(start, destination, 160, phys) } else { Vec::new() };
        }
        let goal = Pt::new((end.0 as f64 + 0.5) * self.cell, (end.1 as f64 + 0.5) * self.cell);
        if self.clear_line(start, goal, phys) {
            return vec![goal];
        }
        let corridor = if unrestricted { None } else { self.chunk_corridor(s, end) };
        match self.leaf_route(s, end, goal, corridor.as_ref(), phys) {
            None => {
                if corridor.is_some() {
                    return self.find_route(start, destination, true, phys);
                }
                if precise {
                    self.gap_route(start, destination, 160, phys)
                } else {
                    Vec::new()
                }
            }
            Some(route) => {
                if std::env::var("CRUCIATA_DEBUG_ROUTE").is_ok() {
                    eprintln!("RAW {:?}", route.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>());
                    eprintln!("CORRIDOR {:?} s={:?} end={:?}", corridor, s, end);
                }
                self.finish_route(route, start, destination, precise, phys)
            }
        }
    }

    fn finish_route(&mut self, route: Vec<Pt>, start: Pt, destination: Pt, precise: bool, phys: Physical) -> Vec<Pt> {
        let mut smooth: Vec<Pt> = Vec::new();
        let mut anchor = start;
        let mut i = 0usize;
        while i < route.len() {
            let mut far = i;
            while far + 1 < route.len() && far - i < 48 && self.clear_line(anchor, route[far + 1], phys) {
                far += 1;
            }
            if far == i && !self.clear_line(anchor, route[i], phys) {
                let detour = self.gap_route(anchor, route[i], 96, phys);
                if !detour.is_empty() {
                    for q in &detour[..detour.len() - 1] {
                        smooth.push(*q);
                    }
                }
            }
            smooth.push(route[far]);
            anchor = route[far];
            i = far + 1;
        }
        if precise && self.clear_line(*smooth.last().unwrap_or(&start), destination, phys) {
            smooth.push(destination);
        }
        let direct = hypot(destination.x - start.x, destination.y - start.y);
        let length = path_length(&smooth, start);
        if precise && direct < 2000.0 && length > direct * 1.45 {
            let gap = self.gap_route(start, destination, 160, phys);
            if !gap.is_empty() && path_length(&gap, start) < length {
                return gap;
            }
        }
        smooth
    }

    // ---- query / job queue -------------------------------------------------

    pub fn cancel_owner(&mut self, owner: u32) {
        let key = match self.owner_keys.get(&owner) {
            Some(k) => k.clone(),
            None => return,
        };
        if let Some(job) = self.pending.get_mut(&key) {
            job.owners.shift_remove(&owner);
            if !job.owners.is_empty() {
                self.owner_keys.remove(&owner);
                return;
            }
        }
        self.pending.shift_remove(&key);
        self.jobs.retain(|k| *k != key);
        self.owner_keys.remove(&owner);
    }

    /// `query(start, destination, {priority, owner})`: `Some(route)` when cached or
    /// trivially clear, `None` while a job is pending.
    pub fn query(&mut self, start: Pt, destination: Pt, priority: i32, owner: Option<u32>, now: f64, phys: Physical) -> Option<Vec<Pt>> {
        let key = Nav::key(start, destination);
        if let Some(o) = owner {
            if self.owner_keys.get(&o) != Some(&key) {
                self.cancel_owner(o);
                self.owner_keys.insert(o, key.clone());
            }
        }
        if let Some(c) = self.path_cache.get(&key) {
            return Some(c.clone());
        }
        let existing = self.pending.contains_key(&key);
        let existing_priority = self.pending.get(&key).map(|j| j.priority).unwrap_or(0);
        let reprioritize = !existing || priority > existing_priority;
        if existing {
            let job = self.pending.get_mut(&key).unwrap();
            job.last_used = now;
            job.priority = job.priority.max(priority);
            if let Some(o) = owner {
                job.owners.insert(o);
            }
        }
        if !existing && priority > 0 && phys(destination.x, destination.y) && self.clear_line(start, destination, phys) {
            self.searches += 1;
            let path = vec![destination];
            self.path_cache.insert(key, path.clone());
            if self.path_cache.len() > 512 {
                self.path_cache.shift_remove_index(0);
            }
            return Some(path);
        }
        if !existing && self.pending.len() >= 128 && priority > 0 {
            let obsolete = self
                .pending
                .values()
                .filter(|j| j.priority < priority)
                .min_by(|a, b| a.last_used.partial_cmp(&b.last_used).unwrap_or(std::cmp::Ordering::Equal))
                .map(|j| j.key.clone());
            if let Some(k) = obsolete {
                if let Some(j) = self.pending.shift_remove(&k) {
                    self.jobs.retain(|x| *x != k);
                    for id in j.owners {
                        self.owner_keys.remove(&id);
                    }
                }
            }
        }
        if !existing && self.pending.len() < 128 {
            let mut owners = IndexSet::new();
            if let Some(o) = owner {
                owners.insert(o);
            }
            let job = Job { key: key.clone(), start, destination, revision: self.revision, last_used: now, priority, owners };
            self.pending.insert(key.clone(), job);
            self.jobs.push(key.clone());
        }
        if reprioritize {
            let pending = &self.pending;
            let prio = |k: &String| pending.get(k).map(|j| j.priority).unwrap_or(0);
            self.jobs.sort_by(|a, b| prio(b).cmp(&prio(a)));
        }
        None
    }

    pub fn urgent(&self) -> bool {
        self.jobs.iter().any(|k| self.pending.get(k).map(|j| j.priority > 0).unwrap_or(false))
    }

    /// Resolve up to `max_jobs` queued searches (highest priority first).
    /// Jobs idle for more than five seconds are dropped.
    pub fn process(&mut self, max_jobs: usize, now: f64, phys: Physical) {
        let mut done = 0;
        while done < max_jobs {
            if self.jobs.is_empty() {
                return;
            }
            let key = self.jobs.remove(0);
            let job = match self.pending.get(&key) {
                Some(j) => j.clone(),
                None => continue,
            };
            if now - job.last_used > 5.0 {
                for o in &job.owners {
                    if self.owner_keys.get(o) == Some(&job.key) {
                        self.owner_keys.remove(o);
                    }
                }
                self.pending.shift_remove(&job.key);
                continue;
            }
            let path = self.find_route(job.start, job.destination, false, phys);
            if job.revision == self.revision {
                if self.path_cache.len() >= 512 {
                    self.path_cache.shift_remove_index(0);
                }
                self.path_cache.insert(job.key.clone(), path);
            }
            self.pending.shift_remove(&job.key);
            for o in &job.owners {
                if self.owner_keys.get(o) == Some(&job.key) {
                    self.owner_keys.remove(o);
                }
            }
            done += 1;
        }
    }
}

fn path_length(path: &[Pt], start: Pt) -> f64 {
    let mut sum = 0.0;
    for (i, p) in path.iter().enumerate() {
        let prev = if i > 0 { path[i - 1] } else { start };
        sum += hypot(p.x - prev.x, p.y - prev.y);
    }
    sum
}

/// Format a number the way JS string concatenation does (shortest round trip,
/// no trailing `.0`), used for the path-cache keys.
pub fn js_num(v: f64) -> String {
    if v == v.trunc() && v.abs() < 1e21 {
        format!("{}", v as i64)
    } else {
        format!("{}", v)
    }
}
