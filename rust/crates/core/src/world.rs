//! Terrain and collision geometry (`landFree`, `groundFree`, rock/forest masses,
//! curtain walls) ported from `src/game.js`.

use crate::data::data;
use crate::js::{clamp, cos, hypot, sin};
use crate::model::{BKind, Building, Link, Node, Res, State, TerrainFeature};
use crate::nav::Pt;
use std::collections::{BTreeMap, HashMap, HashSet};

/// A blocking or decorative object produced during world generation
/// (`kind: "rock"` boulders and `"shrub"`s; masses live in `State`).
#[derive(Clone, Debug, PartialEq)]
pub struct Deco {
    pub x: f64,
    pub y: f64,
    pub kind: DecoKind,
    pub r: f64,
    pub block: bool,
    pub scale: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecoKind {
    Rock,
    Shrub,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Adj {
    No,
    Walls,
    All,
}

pub fn cell_key(gx: i32, gy: i32) -> i32 {
    (gx + 1024) * 4096 + (gy + 1024)
}

/// Multiplicative hasher for the integer bucket keys: SipHash dominated the
/// cost of `ground_free`, which navigation calls about 100k times per long route.
#[derive(Default, Clone, Copy)]
pub struct BucketHasher(u64);

impl std::hash::Hasher for BucketHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0 ^ b as u64).wrapping_mul(0x100000001b3);
        }
    }
    fn write_i32(&mut self, v: i32) {
        self.0 = (v as u32 as u64).wrapping_mul(0x9E3779B97F4A7C15);
    }
}

/// Tile rows of a rock mass or forest: row -> set of columns, with the cheap integer hasher.
pub type RockRows = HashMap<i32, HashSet<i32, std::hash::BuildHasherDefault<BucketHasher>>, std::hash::BuildHasherDefault<BucketHasher>>;

pub type BucketMap = HashMap<i32, Vec<usize>, std::hash::BuildHasherDefault<BucketHasher>>;

#[derive(Default)]
pub struct ObstacleIndex {
    pub buildings: BucketMap,
    pub decorations: BucketMap,
    pub masses: BucketMap,
    pub nodes: BucketMap,
    pub exact_when_dirty: bool,
}

pub fn insert_index(map: &mut BucketMap, idx: usize, ox: f64, oy: f64, rx: f64, ry: f64) {
    let y0 = ((oy - ry - 64.0) / 128.0).floor() as i32;
    let y1 = ((oy + ry + 64.0) / 128.0).floor() as i32;
    let x0 = ((ox - rx - 64.0) / 128.0).floor() as i32;
    let x1 = ((ox + rx + 64.0) / 128.0).floor() as i32;
    for y in y0..=y1 {
        for x in x0..=x1 {
            map.entry(cell_key(x, y)).or_default().push(idx);
        }
    }
}

/// Everything collision tests need besides the entity lists in `State`.
pub struct Geo {
    pub w: f64,
    pub h: f64,
    pub decorations: Vec<Deco>,
    pub index: Option<ObstacleIndex>,
    rock_rows: Vec<Option<RockRows>>,
}

impl Geo {
    pub fn new(w: f64, h: f64) -> Geo {
        Geo { w, h, decorations: Vec::new(), index: None, rock_rows: Vec::new() }
    }
    /// Forget cached tile rows (after terrain features change).
    pub fn reset_rock_cache(&mut self, count: usize) {
        self.rock_rows = (0..count).map(|_| None).collect();
    }
    fn rows(&mut self, i: usize, d: &TerrainFeature) -> &RockRows {
        if self.rock_rows.len() <= i {
            self.rock_rows.resize_with(i + 1, || None);
        }
        if self.rock_rows[i].is_none() {
            let mut rows = RockRows::default();
            for p in &d.tiles {
                rows.entry(p.y).or_default().insert(p.x);
            }
            self.rock_rows[i] = Some(rows);
        }
        self.rock_rows[i].as_ref().unwrap()
    }
}

pub fn coast_x(y: f64) -> f64 {
    175.0 + sin(y / 170.0) * 34.0 + cos(y / 67.0) * 12.0
}

pub fn config_biome(state: &State) -> Option<f64> {
    state.config.as_ref().and_then(|c| c.get("biome")).and_then(|b| b.as_f64())
}

pub fn bridge_y(state: &State, h: f64) -> f64 {
    if config_biome(state) == Some(1.0) {
        h * 0.5
    } else {
        1150.0
    }
}

pub fn river_x(state: &State, w: f64, y: f64) -> f64 {
    (if config_biome(state) == Some(1.0) { w * 0.5 } else { 1610.0 }) + sin(y / 330.0) * 165.0
}

pub fn level_terrain(state: &State) -> i32 {
    data().levels[state.level.min(data().levels.len() - 1)].terrain
}

pub fn is_river_map(state: &State) -> bool {
    if state.config.is_some() {
        config_biome(state) == Some(1.0)
    } else {
        level_terrain(state) == 1
    }
}

pub fn land_free(state: &State, w: f64, h: f64, x: f64, y: f64, margin: f64, allow_bridge: bool) -> bool {
    if x < 24.0 + margin || y < 24.0 + margin || x > w - 24.0 - margin || y > h - 24.0 - margin {
        return false;
    }
    let terrain = level_terrain(state);
    if state.mode != "quickmatch" && terrain == 0 && x < coast_x(y) + 25.0 + margin {
        return false;
    }
    if is_river_map(state)
        && (x - river_x(state, w, y)).abs() < 60.0 + margin
        && (!allow_bridge || (y - bridge_y(state, h)).abs() > 56.0 - margin)
    {
        return false;
    }
    true
}

pub fn inside_contour(x: f64, y: f64, contour: &[Pt]) -> bool {
    let mut inside = false;
    let n = contour.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let a = contour[i];
        let b = contour[j];
        if (a.y > y) != (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x {
            inside = !inside;
        }
        j = i;
    }
    inside
}

pub fn segment_distance(p: Pt, a: Pt, b: Pt) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let denom = dx * dx + dy * dy;
    let t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (if denom == 0.0 { 1.0 } else { denom }), 0.0, 1.0);
    hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}

/// `rockBlocks(d, x, y, margin)` for a mass (rock escarpment or forest).
pub fn rock_blocks(geo: &mut Geo, i: usize, d: &TerrainFeature, x: f64, y: f64, margin: f64) -> bool {
    if d.tiles.is_empty() {
        let mut interior = false;
        for contour in &d.contours {
            if inside_contour(x, y, contour) {
                interior = !interior;
            }
            for k in 0..contour.len() {
                if segment_distance(Pt::new(x, y), contour[k], contour[(k + 1) % contour.len()]) < 14.0 + margin {
                    return true;
                }
            }
        }
        return interior;
    }
    let radius = 14.0 + margin;
    let cell = d.cell;
    let min_x = ((x - radius) / cell).floor() as i32;
    let max_x = ((x + radius) / cell).floor() as i32;
    let min_y = ((y - radius) / cell).floor() as i32;
    let max_y = ((y + radius) / cell).floor() as i32;
    let rows = geo.rows(i, d);
    for ty in min_y..=max_y {
        let row = match rows.get(&ty) {
            Some(r) => r,
            None => continue,
        };
        for tx in min_x..=max_x {
            if !row.contains(&tx) {
                continue;
            }
            let dx = (tx as f64 * cell - x).max(0.0).max(x - (tx + 1) as f64 * cell);
            let dy = (ty as f64 * cell - y).max(0.0).max(y - (ty + 1) as f64 * cell);
            if dx * dx + dy * dy < radius * radius {
                return true;
            }
        }
    }
    false
}

/// Read-only variant used from closures (no cache writes): builds rows on the fly
/// only when the cache is already populated by `Geo::warm`.
pub fn rock_blocks_cached(geo: &Geo, i: usize, d: &TerrainFeature, x: f64, y: f64, margin: f64) -> bool {
    let rows = match geo.rock_rows.get(i).and_then(|r| r.as_ref()) {
        Some(r) => r,
        None => return rock_blocks_slow(d, x, y, margin),
    };
    let radius = 14.0 + margin;
    let cell = d.cell;
    let min_x = ((x - radius) / cell).floor() as i32;
    let max_x = ((x + radius) / cell).floor() as i32;
    let min_y = ((y - radius) / cell).floor() as i32;
    let max_y = ((y + radius) / cell).floor() as i32;
    for ty in min_y..=max_y {
        let row = match rows.get(&ty) {
            Some(r) => r,
            None => continue,
        };
        for tx in min_x..=max_x {
            if !row.contains(&tx) {
                continue;
            }
            let dx = (tx as f64 * cell - x).max(0.0).max(x - (tx + 1) as f64 * cell);
            let dy = (ty as f64 * cell - y).max(0.0).max(y - (ty + 1) as f64 * cell);
            if dx * dx + dy * dy < radius * radius {
                return true;
            }
        }
    }
    false
}

fn rock_blocks_slow(d: &TerrainFeature, x: f64, y: f64, margin: f64) -> bool {
    let radius = 14.0 + margin;
    let cell = d.cell;
    for p in &d.tiles {
        let dx = (p.x as f64 * cell - x).max(0.0).max(x - (p.x + 1) as f64 * cell);
        let dy = (p.y as f64 * cell - y).max(0.0).max(y - (p.y + 1) as f64 * cell);
        if dx * dx + dy * dy < radius * radius {
            return true;
        }
    }
    false
}

impl Geo {
    /// Populate the tile-row cache for every mass so collision queries are O(1).
    pub fn warm(&mut self, masses: &[TerrainFeature]) {
        self.rock_rows = (0..masses.len()).map(|_| None).collect();
        for (i, d) in masses.iter().enumerate() {
            if d.tiles.is_empty() {
                continue;
            }
            let mut rows = RockRows::default();
            for p in &d.tiles {
                rows.entry(p.y).or_default().insert(p.x);
            }
            self.rock_rows[i] = Some(rows);
        }
    }
}

/// Offsets from a curtain seam to its neighbours (`wallArms`).
pub fn wall_arms(links: Option<&BTreeMap<String, Link>>, wall_angle: Option<f64>, fallback: f64) -> Vec<Pt> {
    let angle = wall_angle.unwrap_or(fallback);
    let mut arms: Vec<Pt> = links.map(|l| l.values().map(|p| Pt::new(p.x, p.y)).collect()).unwrap_or_default();
    if arms.len() == 1 {
        arms.push(Pt::new(-arms[0].x, -arms[0].y));
    }
    if arms.is_empty() {
        let length = if (sin(angle) * cos(angle)).abs() > 0.1 { std::f64::consts::SQRT_2 * 16.0 } else { 16.0 };
        arms.push(Pt::new(cos(angle) * length, sin(angle) * length));
        arms.push(Pt::new(-cos(angle) * length, -sin(angle) * length));
    }
    arms
}

pub struct Curtain<'a> {
    pub x: f64,
    pub y: f64,
    pub fortified: bool,
    pub wall_angle: Option<f64>,
    pub links: Option<&'a BTreeMap<String, Link>>,
}

pub fn curtain_blocks(b: &Curtain, x: f64, y: f64, margin: f64, fallback_angle: f64) -> bool {
    let dx = x - b.x;
    let dy = y - b.y;
    let r = (if b.fortified { 24.0 } else { 15.0 }) + margin;
    let r2 = r * r;
    if dx > 42.0 + r || dx < -42.0 - r || dy > 42.0 + r || dy < -42.0 - r {
        return false;
    }
    for arm in wall_arms(b.links, b.wall_angle, fallback_angle) {
        let denom = arm.x * arm.x + arm.y * arm.y;
        let t = clamp((dx * arm.x + dy * arm.y) / (if denom == 0.0 { 1.0 } else { denom }), 0.0, 1.0);
        let rx = dx - arm.x * t;
        let ry = dy - arm.y * t;
        if rx * rx + ry * ry < r2 {
            return true;
        }
    }
    false
}

/// `groundFree(x, y, margin, ignore, adjacentWalls)`.
pub fn ground_free(state: &State, geo: &Geo, x: f64, y: f64, margin: f64, ignore: Option<u32>, adjacent: Adj) -> bool {
    if !land_free(state, geo.w, geo.h, x, y, margin, true) {
        return false;
    }
    let bucket = cell_key((x / 128.0).floor() as i32, (y / 128.0).floor() as i32);
    let index = match &geo.index {
        Some(i) if (!state.nav_dirty || i.exact_when_dirty) && margin <= 64.0 => Some(i),
        _ => None,
    };
    let d = data();
    let mut check_building = |b: &Building| -> Option<bool> {
        if Some(b.id) == ignore
            || adjacent == Adj::All
            || (adjacent == Adj::Walls && matches!(b.kind, BKind::Wall | BKind::Gate))
            || b.hp <= 0.0
            || (d.bld(b.kind).passable && !b.closed.unwrap_or(false))
        {
            return None;
        }
        if let Some(parts) = &b.gate_segments {
            for part in parts {
                let c = Curtain { x: part.x, y: part.y, fortified: part.fortified.unwrap_or(false), wall_angle: part.wall_angle, links: part.links.as_ref() };
                if curtain_blocks(&c, x, y, margin, b.gate_angle.unwrap_or(0.0)) {
                    return Some(false);
                }
            }
            return None;
        }
        if b.kind == BKind::Wall && b.wall_angle.map(|a| a.is_finite()).unwrap_or(false) {
            let c = Curtain { x: b.x, y: b.y, fortified: b.fortified, wall_angle: b.wall_angle, links: b.links.as_ref() };
            if curtain_blocks(&c, x, y, margin, 0.0) {
                return Some(false);
            }
            return None;
        }
        if (x - b.x).abs() < b.w / 2.0 + margin && (y - b.y).abs() < b.h / 2.0 + margin {
            return Some(false);
        }
        None
    };
    match index {
        Some(idx) => {
            if let Some(list) = idx.buildings.get(&bucket) {
                for &i in list {
                    if let Some(false) = check_building(&state.buildings[i]) {
                        return false;
                    }
                }
            }
        }
        None => {
            for b in &state.buildings {
                if let Some(false) = check_building(b) {
                    return false;
                }
            }
        }
    }
    // Rocks and shrubs.
    let rock_blocks_here = |dd: &Deco| dd.block && hypot(x - dd.x, y - dd.y) < dd.r + margin;
    let mass_blocks = |i: usize, m: &TerrainFeature| m.block && rock_blocks_cached(geo, i, m, x, y, margin);
    match index {
        Some(idx) => {
            if let Some(list) = idx.decorations.get(&bucket) {
                for &i in list {
                    if rock_blocks_here(&geo.decorations[i]) {
                        return false;
                    }
                }
            }
            if let Some(list) = idx.masses.get(&bucket) {
                for &i in list {
                    if mass_blocks(i, &state.terrain_features[i]) {
                        return false;
                    }
                }
            }
        }
        None => {
            for dd in &geo.decorations {
                if rock_blocks_here(dd) {
                    return false;
                }
            }
            for (i, m) in state.terrain_features.iter().enumerate() {
                if mass_blocks(i, m) {
                    return false;
                }
            }
        }
    }
    let node_blocks = |n: &Node| {
        n.remaining > 0.0 && n.kind != Res::Food && hypot(x - n.x, y - n.y) < (if n.kind == Res::Wood { 14.0 } else { 23.0 }) + margin
    };
    match index {
        Some(idx) => {
            if let Some(list) = idx.nodes.get(&bucket) {
                for &i in list {
                    if node_blocks(&state.nodes[i]) {
                        return false;
                    }
                }
            }
        }
        None => {
            for n in &state.nodes {
                if node_blocks(n) {
                    return false;
                }
            }
        }
    }
    true
}

/// `surfaceDistance(u, target)` for a point `u` and a building-like target.
pub fn surface_distance_building(p: Pt, t: &Building) -> f64 {
    if t.kind == BKind::Wall && t.wall_angle.map(|a| a.is_finite()).unwrap_or(false) {
        let mut best = f64::INFINITY;
        for arm in wall_arms(t.links.as_ref(), t.wall_angle, 0.0) {
            let d = segment_distance(p, Pt::new(t.x, t.y), Pt::new(t.x + arm.x, t.y + arm.y));
            if d < best {
                best = d;
            }
        }
        return (best - if t.fortified { 24.0 } else { 15.0 }).max(0.0);
    }
    if t.w != 0.0 {
        return hypot(((p.x - t.x).abs() - t.w / 2.0).max(0.0), ((p.y - t.y).abs() - t.h / 2.0).max(0.0));
    }
    (hypot(p.x - t.x, p.y - t.y) - t.r).max(0.0)
}
