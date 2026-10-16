//! The simulation: owns the state and every derived structure (collision
//! geometry, navigation, vision, spatial indices) and runs the fixed step.

use crate::data::data;
use crate::fog::{Fog, Source};
use crate::js::{clamp, hypot, Seeded};
use crate::model::*;
use crate::nav::{Area, Nav, Pt};
use crate::quadtree::Quadtree;
use crate::world::*;
use indexmap::IndexMap;
use std::collections::HashMap;

pub const STEP: f64 = 1.0 / 30.0;

/// Something the front end should present (sound, message, effect).
#[derive(Clone, Debug)]
pub enum Event {
    Toast(String),
    Sound { kind: String, x: Option<f64>, y: Option<f64>, team: Option<i32> },
    /// A player unit or structure was attacked (front ends decide whether to ping).
    Alert { x: f64, y: f64, kind: Option<BKind>, team: i32 },
    /// The game ended (`true` when the player won).
    Finished(bool),
    /// Time to write an autosave.
    Autosave,
    /// A boulder landed (front ends add smoke, sparks, camera shake).
    Impact { x: f64, y: f64, heavy: bool },
    /// Structures `old` were replaced by structure `new` (gate upgrade).
    Replaced { old: Vec<u32>, new: u32 },
}

#[derive(Clone, Debug)]
pub struct Settings {
    pub gore: bool,
    /// Both sides are human players: the enemy AI never runs.
    pub pvp: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Obj {
    Unit(usize),
    Building(usize),
    Node(usize),
}

pub struct Sim {
    pub state: State,
    pub geo: Geo,
    pub nav: Nav,
    pub uid: u32,
    pub fog: Fog,
    pub enemy_fog: Fog,
    pub militia_fog: Fog,
    pub unit_tree: Quadtree,
    pub combat_structures: Vec<(i32, Quadtree)>,
    pub combat_structure_radius: f64,
    pub object_index: HashMap<u32, Obj>,
    pub events: Vec<Event>,
    pub rng: Seeded,
    pub vision_timer: f64,
    nav_decor_gen: u64,
    pub decor_gen: u64,
    pub clear_memos: crate::movement::ClearMemos,
    pub settings: Settings,
    pub combat_ready: bool,
    /// Route searches resolved per fixed step.
    pub nav_jobs_per_step: usize,
    /// Planned fortifications per enemy base (regenerated deterministically).
    pub fortifications: HashMap<u32, Vec<crate::build::Plot>>,
    /// Advance walk-cycle clocks (set by a front end that draws the units).
    pub visual: bool,
    /// Cumulative wall-clock per update phase (profiling aid).
    pub phases: HashMap<&'static str, f64>,
    pub lap_at: Option<std::time::Instant>,
}

/// A curtain piece as seen by `wallConnections` (walls, gate parts and tower
/// attachments flattened into one list).
#[derive(Clone, Debug)]
struct Segment {
    id: Option<u32>,
    gate_part: Option<(u32, usize)>,
    team: i32,
    hp: f64,
    kind: BKind,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    fortified: bool,
    wall_angle: Option<f64>,
    has_gate_segments: bool,
}

impl Sim {
    pub fn new(state: State, decorations: Vec<Deco>, uid: u32) -> Sim {
        let w = world_width(&state);
        let h = world_height(&state);
        let mut geo = Geo::new(w, h);
        geo.decorations = decorations;
        geo.warm(&state.terrain_features);
        let nav = Nav::new(w, h, 16.0);
        Sim {
            fog: Fog::new(w, h, 0),
            enemy_fog: Fog::new(w, h, 1),
            militia_fog: Fog::new(w, h, 3),
            unit_tree: Quadtree::new(w, h),
            combat_structures: Vec::new(),
            combat_structure_radius: 0.0,
            object_index: HashMap::new(),
            events: Vec::new(),
            rng: Seeded::new(777.0),
            vision_timer: 0.0,
            nav_decor_gen: u64::MAX,
            decor_gen: 0,
            clear_memos: HashMap::new(),
            settings: Settings { gore: true, pvp: false },
            combat_ready: false,
            nav_jobs_per_step: 4,
            fortifications: HashMap::new(),
            visual: true,
            phases: HashMap::new(),
            lap_at: None,
            state,
            geo,
            nav,
            uid,
        }
    }

    // ---- small helpers -----------------------------------------------------

    /// Attribute the time since the previous lap to `name`.
    pub fn lap(&mut self, name: &'static str) {
        let now = std::time::Instant::now();
        if let Some(prev) = self.lap_at {
            *self.phases.entry(name).or_insert(0.0) += now.duration_since(prev).as_secs_f64();
        }
        self.lap_at = Some(now);
    }

    pub fn toast(&mut self, text: impl Into<String>) {
        self.events.push(Event::Toast(text.into()));
    }

    pub fn sound(&mut self, kind: &str, at: Option<(f64, f64, i32)>) {
        self.events.push(Event::Sound {
            kind: kind.to_string(),
            x: at.map(|a| a.0),
            y: at.map(|a| a.1),
            team: at.map(|a| a.2),
        });
    }

    pub fn ground_free(&self, x: f64, y: f64, margin: f64) -> bool {
        ground_free(&self.state, &self.geo, x, y, margin, None, Adj::No)
    }

    pub fn ground_free_adj(&self, x: f64, y: f64, margin: f64, ignore: Option<u32>, adj: Adj) -> bool {
        ground_free(&self.state, &self.geo, x, y, margin, ignore, adj)
    }

    pub fn land_free(&self, x: f64, y: f64, margin: f64, allow_bridge: bool) -> bool {
        land_free(&self.state, self.geo.w, self.geo.h, x, y, margin, allow_bridge)
    }

    pub fn cheat_invulnerable(&self) -> bool {
        self.state.cheats.as_ref().and_then(|c| c.get("invulnerable")).map(|v| v.as_bool().unwrap_or(false) || v.as_f64().map(|n| n != 0.0).unwrap_or(false)).unwrap_or(false)
    }

    pub fn cheat_reveal(&self) -> bool {
        self.state.cheats.as_ref().and_then(|c| c.get("reveal")).map(|v| v.as_bool().unwrap_or(false)).unwrap_or(false)
    }

    pub fn w(&self) -> f64 {
        self.geo.w
    }
    pub fn h(&self) -> f64 {
        self.geo.h
    }

    /// `getObject(id)`: a live unit/building or any node.
    pub fn get_object(&self, id: u32) -> Option<Obj> {
        if let Some(&o) = self.object_index.get(&id) {
            let ok = match o {
                Obj::Unit(i) => self.state.units.get(i).map(|u| u.id == id && u.hp > 0.0).unwrap_or(false),
                Obj::Building(i) => self.state.buildings.get(i).map(|b| b.id == id && b.hp > 0.0).unwrap_or(false),
                Obj::Node(i) => self.state.nodes.get(i).map(|n| n.id == id).unwrap_or(false),
            };
            if ok {
                return Some(o);
            }
        }
        if let Some(i) = self.state.units.iter().position(|u| u.id == id && u.hp > 0.0) {
            return Some(Obj::Unit(i));
        }
        if let Some(i) = self.state.buildings.iter().position(|b| b.id == id && b.hp > 0.0) {
            return Some(Obj::Building(i));
        }
        self.state.nodes.iter().position(|n| n.id == id).map(Obj::Node)
    }

    pub fn obj_pos(&self, o: Obj) -> Pt {
        match o {
            Obj::Unit(i) => Pt::new(self.state.units[i].x, self.state.units[i].y),
            Obj::Building(i) => Pt::new(self.state.buildings[i].x, self.state.buildings[i].y),
            Obj::Node(i) => Pt::new(self.state.nodes[i].x, self.state.nodes[i].y),
        }
    }

    // ---- navigation rebuild (`rebuildNavigation`) --------------------------

    /// Bucket every blocking obstacle. With `exact_when_dirty` the index is
    /// trusted even while `nav_dirty` is set (it was just rebuilt from the
    /// current state), which keeps physical queries fast for route searches.
    pub fn build_obstacle_index(&mut self, exact_when_dirty: bool) {
        let mut index = ObstacleIndex::default();
        index.exact_when_dirty = exact_when_dirty;
        for (i, b) in self.state.buildings.iter().enumerate() {
            if b.hp > 0.0 {
                insert_index(&mut index.buildings, i, b.x, b.y, 32f64.max(b.w / 2.0).max(b.r), 32f64.max(b.h / 2.0).max(b.r));
            }
        }
        for (i, dd) in self.geo.decorations.iter().enumerate() {
            if dd.block {
                insert_index(&mut index.decorations, i, dd.x, dd.y, dd.r, dd.r);
            }
        }
        for (i, m) in self.state.terrain_features.iter().enumerate() {
            if m.block {
                insert_index(&mut index.masses, i, m.x, m.y, m.rx, m.ry);
            }
        }
        for (i, n) in self.state.nodes.iter().enumerate() {
            if n.remaining > 0.0 {
                let r = if n.kind == Res::Wood { 14.0 } else { 23.0 };
                insert_index(&mut index.nodes, i, n.x, n.y, r, r);
            }
        }
        self.geo.index = Some(index);
    }

    pub fn rebuild_navigation(&mut self) {
        self.state.nav_dirty = false;
        self.state.nav_combat = false;
        self.state.nav_at = self.state.time;
        self.object_index.clear();
        let d = data();
        let (w, h) = (self.geo.w, self.geo.h);
        // Combat structure trees (one per hostile side).
        self.combat_structures.clear();
        self.combat_structure_radius = 0.0;
        self.combat_ready = true;
        for (i, b) in self.state.buildings.iter().enumerate() {
            if b.hp > 0.0 && b.team != 2 {
                let pos = match self.combat_structures.iter().position(|(t, _)| *t == b.team) {
                    Some(p) => p,
                    None => {
                        self.combat_structures.push((b.team, Quadtree::new(w, h)));
                        self.combat_structures.len() - 1
                    }
                };
                self.combat_structures[pos].1.insert(i as u32, b.x, b.y);
                self.combat_structure_radius = self.combat_structure_radius.max(b.r);
            }
        }
        self.build_obstacle_index(false);

        // Curtain segments (walls, gate parts, tower attachments).
        let mut curtain: Vec<Segment> = Vec::new();
        for other in &self.state.buildings {
            if let (Some(parts), true) = (&other.gate_segments, other.hp > 0.0) {
                for (i, part) in parts.iter().enumerate() {
                    curtain.push(Segment {
                        id: None,
                        gate_part: Some((other.id, i)),
                        team: other.team,
                        hp: other.hp,
                        kind: BKind::Wall,
                        x: part.x,
                        y: part.y,
                        w: part.w,
                        h: part.h,
                        fortified: part.fortified.unwrap_or(other.fortified),
                        wall_angle: part.wall_angle.or(other.wall_angle),
                        has_gate_segments: true,
                    });
                }
            } else if let Some(att) = &other.wall_attachment {
                curtain.push(Segment {
                    id: Some(other.id),
                    gate_part: None,
                    team: other.team,
                    hp: other.hp,
                    kind: BKind::Wall,
                    x: att.x,
                    y: att.y,
                    w: att.w,
                    h: att.h,
                    fortified: att.fortified.unwrap_or(other.fortified),
                    wall_angle: att.wall_angle.or(other.wall_angle),
                    has_gate_segments: other.gate_segments.is_some(),
                });
            } else {
                curtain.push(Segment {
                    id: Some(other.id),
                    gate_part: None,
                    team: other.team,
                    hp: other.hp,
                    kind: other.kind,
                    x: other.x,
                    y: other.y,
                    w: other.w,
                    h: other.h,
                    fortified: other.fortified,
                    wall_angle: other.wall_angle,
                    has_gate_segments: other.gate_segments.is_some(),
                });
            }
        }
        let mut buckets: HashMap<i32, Vec<usize>> = HashMap::new();
        for (i, s) in curtain.iter().enumerate() {
            if s.hp > 0.0 && matches!(s.kind, BKind::Wall | BKind::Gate) {
                insert_index(&mut buckets, i, s.x, s.y, s.w / 2.0, s.h / 2.0);
            }
        }
        for bi in 0..self.state.buildings.len() {
            {
                let b = &mut self.state.buildings[bi];
                if let Some(att) = &b.wall_attachment {
                    if b.hp > 0.0 && ((att.x - b.x).abs() > 0.5 || (att.y - b.y).abs() > 0.5) {
                        b.x = att.x;
                        b.y = att.y;
                    }
                }
            }
            let (bx, by) = (self.state.buildings[bi].x, self.state.buildings[bi].y);
            let neighbors: Vec<usize> = buckets.get(&cell_key((bx / 128.0).floor() as i32, (by / 128.0).floor() as i32)).cloned().unwrap_or_default();
            let b = &self.state.buildings[bi];
            if b.kind == BKind::Wall && b.hp > 0.0 {
                let me = Segment {
                    id: Some(b.id),
                    gate_part: None,
                    team: b.team,
                    hp: b.hp,
                    kind: b.kind,
                    x: b.x,
                    y: b.y,
                    w: b.w,
                    h: b.h,
                    fortified: b.fortified,
                    wall_angle: b.wall_angle,
                    has_gate_segments: b.gate_segments.is_some(),
                };
                let links = self.wall_connections(&me, &neighbors, &curtain);
                self.state.buildings[bi].links = Some(links);
            }
            let b = &self.state.buildings[bi];
            if let (Some(att), true) = (&b.wall_attachment, b.hp > 0.0) {
                let me = Segment {
                    id: Some(b.id),
                    gate_part: None,
                    team: b.team,
                    hp: b.hp,
                    kind: BKind::Wall,
                    x: att.x,
                    y: att.y,
                    w: att.w,
                    h: att.h,
                    fortified: att.fortified.unwrap_or(b.fortified),
                    wall_angle: att.wall_angle.or(b.wall_angle),
                    has_gate_segments: b.gate_segments.is_some(),
                };
                let links = self.wall_connections(&me, &neighbors, &curtain);
                if let Some(att) = self.state.buildings[bi].wall_attachment.as_mut() {
                    att.links = Some(links);
                }
            }
        }

        // Waypoints around every obstacle edge.
        let mut waypoints: Vec<Pt> = Vec::new();
        for b in &self.state.buildings {
            if b.hp > 0.0 && !(d.bld(b.kind).passable && !b.closed.unwrap_or(false)) {
                for dx in [-b.w / 2.0 - 6.25, b.w / 2.0 + 6.25] {
                    for dy in [-b.h / 2.0 - 6.25, b.h / 2.0 + 6.25] {
                        waypoints.push(Pt::new(b.x + dx, b.y + dy));
                    }
                }
            }
        }
        let ring = |wp: &mut Vec<Pt>, x: f64, y: f64, radius: f64| {
            for i in 0..16 {
                let a = (i as f64 * std::f64::consts::PI) / 8.0;
                wp.push(Pt::new(x + crate::js::cos(a) * radius, y + crate::js::sin(a) * radius));
            }
        };
        for n in &self.state.nodes {
            if n.remaining > 0.0 && n.kind != Res::Food {
                let radius = (match n.kind {
                    Res::Wood => 14.0,
                    Res::Gold | Res::Stone => 23.0,
                    _ => n.r,
                }) + 7.0;
                ring(&mut waypoints, n.x, n.y, radius);
            }
        }
        for dd in &self.geo.decorations {
            if dd.block {
                ring(&mut waypoints, dd.x, dd.y, dd.r + 7.0);
            }
        }
        for m in &self.state.terrain_features {
            for contour in &m.contours {
                for p in contour {
                    for dx in [-21.0, 21.0] {
                        for dy in [-21.0, 21.0] {
                            waypoints.push(Pt::new(p.x + dx, p.y + dy));
                        }
                    }
                }
            }
        }

        // Footprints: only changed obstacles are resampled.
        let mut footprints: IndexMap<String, (Area, String)> = IndexMap::new();
        for b in &self.state.buildings {
            if b.hp > 0.0 && !(d.bld(b.kind).passable && !b.closed.unwrap_or(false)) {
                let pad = if b.kind == BKind::Wall || b.gate_segments.is_some() { 96.0 } else { 24.0 };
                let (fw, fh) = (b.w + pad * 2.0, b.h + pad * 2.0);
                let key = format!(
                    "{};{};{};{};{:?};{:?};{};{}",
                    b.x,
                    b.y,
                    b.w,
                    b.h,
                    b.closed,
                    b.wall_angle,
                    serde_json::to_string(&b.links).unwrap_or_default(),
                    serde_json::to_string(&b.gate_segments).unwrap_or_default()
                );
                footprints.insert(format!("b{}", b.id), (Area { x: b.x - fw / 2.0, y: b.y - fh / 2.0, w: fw, h: fh }, key));
            }
        }
        for n in &self.state.nodes {
            if n.remaining > 0.0 && n.kind != Res::Food {
                footprints.insert(
                    format!("n{}", n.id),
                    (Area { x: n.x - 40.0, y: n.y - 40.0, w: 80.0, h: 80.0 }, format!("{};{};{:?}", n.x, n.y, n.kind)),
                );
            }
        }
        let previous = self.nav.footprints.take();
        let mut regions: Vec<Area> = Vec::new();
        if let Some(prev) = &previous {
            let mut keys: Vec<&String> = prev.keys().collect();
            for k in footprints.keys() {
                if !prev.contains_key(k) {
                    keys.push(k);
                }
            }
            for key in keys {
                let old = prev.get(key);
                let current = footprints.get(key);
                if old.map(|o| &o.1) == current.map(|c| &c.1) {
                    continue;
                }
                if let Some(o) = old {
                    regions.push(o.0);
                }
                if let Some(c) = current {
                    regions.push(c.0);
                }
            }
        }
        let incremental = previous.is_some() && self.nav_decor_gen == self.decor_gen;
        let state = &self.state;
        let geo = &self.geo;
        let changed = self.nav.rebuild(
            &|x, y| ground_free(state, geo, x, y, 6.0, None, Adj::No),
            &waypoints,
            if incremental { Some(&regions[..]) } else { None },
        );
        self.nav.footprints = Some(footprints);
        self.nav_decor_gen = self.decor_gen;
        if !changed {
            let _ = (w, h);
            return;
        }
        let revision = self.nav.revision as i64;
        for u in self.state.units.iter_mut() {
            let mut points: Vec<Pt> = vec![Pt::new(u.x, u.y)];
            points.extend(u.path.iter().copied());
            points.push(u.path_goal.unwrap_or(Pt::new(u.x, u.y)));
            let affected = !incremental
                || regions.iter().any(|area| {
                    points.iter().enumerate().any(|(i, p)| {
                        let a = points[i.saturating_sub(1)];
                        a.x.max(p.x) >= area.x && a.x.min(p.x) <= area.x + area.w && a.y.max(p.y) >= area.y && a.y.min(p.y) <= area.y + area.h
                    })
                });
            if affected {
                u.path.clear();
                u.path_timer = 0.0;
            } else {
                u.path_revision = revision;
            }
        }
    }

    fn wall_connections(&self, b: &Segment, neighbor_ids: &[usize], curtain: &[Segment]) -> std::collections::BTreeMap<String, Link> {
        let mut links: std::collections::BTreeMap<String, Link> = std::collections::BTreeMap::new();
        for &oi in neighbor_ids {
            let other = &curtain[oi];
            let same = match (b.id, other.id) {
                (Some(a), Some(c)) => a == c,
                _ => false,
            };
            if same || other.team != b.team || other.hp <= 0.0 || !matches!(other.kind, BKind::Wall | BKind::Gate) {
                continue;
            }
            let dx = other.x - b.x;
            let dy = other.y - b.y;
            if dx.abs() > 32f64.max((b.w + other.w) / 2.0) + 8.0 || dy.abs() > 32f64.max((b.h + other.h) / 2.0) + 8.0 {
                continue;
            }
            if dx.abs() > 12.0
                && dy.abs() > 12.0
                && neighbor_ids.iter().map(|&i| &curtain[i]).any(|c| {
                    c.hp > 0.0
                        && c.team == b.team
                        && c.kind == BKind::Wall
                        && (((c.x - other.x).abs() < 12.0 && (c.y - b.y).abs() < 12.0) || ((c.x - b.x).abs() < 12.0 && (c.y - other.y).abs() < 12.0))
                })
            {
                continue;
            }
            let key = format!(
                "{}{}",
                if dy < -12.0 { "n" } else if dy > 12.0 { "s" } else { "" },
                if dx < -12.0 { "w" } else if dx > 12.0 { "e" } else { "" }
            );
            if !key.is_empty() {
                let zero = b.fortified && other.has_gate_segments;
                links.insert(key, Link { x: if zero { 0.0 } else { dx / 2.0 }, y: if zero { 0.0 } else { dy / 2.0 }, terrain: None });
            }
        }
        let values: Vec<Link> = links.values().cloned().collect();
        let directions: Vec<f64> = if values.len() == 1 {
            vec![crate::js::atan2(-values[0].y, -values[0].x)]
        } else if values.is_empty() && b.wall_angle.map(|a| a.is_finite()).unwrap_or(false) {
            let a = b.wall_angle.unwrap();
            vec![a, a + std::f64::consts::PI]
        } else {
            Vec::new()
        };
        for angle in directions {
            let mut length = 16.0;
            while length <= 40.0 {
                let x = b.x + crate::js::cos(angle) * length;
                let y = b.y + crate::js::sin(angle) * length;
                let blocked = !self.land_free(x, y, 0.0, true) || self.decoration_blocks(x, y);
                if blocked {
                    let dx = crate::js::cos(angle) * length;
                    let dy = crate::js::sin(angle) * length;
                    let key = format!(
                        "{}{}",
                        if dy < -12.0 { "n" } else if dy > 12.0 { "s" } else { "" },
                        if dx < -12.0 { "w" } else if dx > 12.0 { "e" } else { "" }
                    );
                    if !key.is_empty() {
                        links.insert(key, Link { x: dx, y: dy, terrain: Some(serde_json::Value::Bool(true)) });
                    }
                    break;
                }
                length += 2.0;
            }
        }
        links
    }

    /// Terrain decorations (rocks, rock masses) blocking a point (margin 0), as
    /// `wallConnections` tests them.
    fn decoration_blocks(&self, x: f64, y: f64) -> bool {
        let bucket = cell_key((x / 128.0).floor() as i32, (y / 128.0).floor() as i32);
        let idx = self.geo.index.as_ref();
        let rocks: Vec<usize> = match idx {
            Some(i) => i.decorations.get(&bucket).cloned().unwrap_or_default(),
            None => (0..self.geo.decorations.len()).collect(),
        };
        for i in rocks {
            let d = &self.geo.decorations[i];
            if d.block && hypot(x - d.x, y - d.y) < d.r {
                return true;
            }
        }
        let masses: Vec<usize> = match idx {
            Some(i) => i.masses.get(&bucket).cloned().unwrap_or_default(),
            None => (0..self.state.terrain_features.len()).collect(),
        };
        for i in masses {
            let m = &self.state.terrain_features[i];
            if m.block && rock_blocks_cached(&self.geo, i, m, x, y, 0.0) {
                return true;
            }
        }
        false
    }

    // ---- vision ------------------------------------------------------------

    pub fn siege_shots(&self) -> Vec<Source> {
        let mut shots = Vec::new();
        for b in &self.state.boulders {
            shots.push(Source { x: b.x, y: b.y, vision: 440.0, team: b.team, hit: b.hit.unwrap_or(false) });
        }
        for a in &self.state.arrows {
            if a.siege {
                shots.push(Source { x: a.x, y: a.y, vision: 440.0, team: a.team, hit: false });
            }
        }
        for w in self.state.shot_sights.iter().flatten() {
            let t = w.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let team = w.get("team").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let x = w.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = w.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            shots.push(Source { x, y, vision: 440.0 * clamp(1.0 - (t - 3.0) / 5.0, 0.0, 1.0), team, hit: false });
        }
        shots
    }
}

pub fn world_width(state: &State) -> f64 {
    state.config.as_ref().and_then(|c| c.get("width")).and_then(|v| v.as_f64()).unwrap_or(12800.0)
}

pub fn world_height(state: &State) -> f64 {
    state.config.as_ref().and_then(|c| c.get("height")).and_then(|v| v.as_f64()).unwrap_or(8800.0)
}
