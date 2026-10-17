//! Unit movement, formations and slots (`moveUnit`, `marchUnit`,
//! `updateFormations`, `reserveSlot`, ...), ported from `src/game.js`.

use crate::data::data;
use crate::js::{atan2, clamp, cos, hypot, sin};
use crate::model::*;
use crate::nav::Pt;
use crate::sim::{Obj, Sim};
use crate::world::*;
use std::collections::HashMap;

pub fn dist(a: Pt, b: Pt) -> f64 {
    hypot(a.x - b.x, a.y - b.y)
}

pub fn is_heavy(t: UType) -> bool {
    matches!(t, UType::Knight | UType::Trebuchet | UType::Ram | UType::Ballista)
}

/// A thing with a position and footprint that units can walk to or work on.
#[derive(Clone, Debug)]
pub struct Target {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    /// Zero for round things (nodes, units).
    pub w: f64,
    pub h: f64,
    pub r: f64,
    pub is_wall_line: bool,
    pub fortified: bool,
    pub wall_angle: Option<f64>,
    pub links: Option<std::collections::BTreeMap<String, Link>>,
}

impl Target {
    pub fn from_building(b: &Building) -> Target {
        Target {
            id: b.id,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            r: b.r,
            is_wall_line: b.kind == BKind::Wall && b.wall_angle.map(|a| a.is_finite()).unwrap_or(false),
            fortified: b.fortified,
            wall_angle: b.wall_angle,
            links: b.links.clone(),
        }
    }
    pub fn from_node(n: &Node) -> Target {
        Target { id: n.id, x: n.x, y: n.y, w: 0.0, h: 0.0, r: n.r, is_wall_line: false, fortified: false, wall_angle: None, links: None }
    }
    pub fn from_unit(u: &Unit) -> Target {
        Target { id: u.id, x: u.x, y: u.y, w: 0.0, h: 0.0, r: 0.0, is_wall_line: false, fortified: false, wall_angle: None, links: None }
    }
    pub fn point(p: Pt) -> Target {
        Target { id: 0, x: p.x, y: p.y, w: 0.0, h: 0.0, r: 0.0, is_wall_line: false, fortified: false, wall_angle: None, links: None }
    }
    pub fn pos(&self) -> Pt {
        Pt::new(self.x, self.y)
    }
}

/// `surfaceDistance(u, target)`.
pub fn surface_distance(p: Pt, t: &Target) -> f64 {
    if t.is_wall_line {
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

/// Memoised line-of-sight (`clearCached`).
#[derive(Clone, Copy)]
pub struct ClearMemo {
    pub revision: u32,
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub value: bool,
}

pub type ClearMemos = HashMap<(u32, &'static str), ClearMemo>;

impl Sim {
    pub fn unit_pt(&self, ui: usize) -> Pt {
        Pt::new(self.state.units[ui].x, self.state.units[ui].y)
    }

    /// `nearby(u, r)`: indices of live units within `r` of unit `ui`.
    pub fn nearby(&mut self, ui: usize, r: f64) -> Vec<usize> {
        let (x, y) = (self.state.units[ui].x, self.state.units[ui].y);
        self.nearby_at(x, y, r)
    }

    pub fn nearby_at(&mut self, x: f64, y: f64, r: f64) -> Vec<usize> {
        let mut out: Vec<u32> = Vec::new();
        let units = &self.state.units;
        self.unit_tree.query(x, y, r, &|i| (units[i as usize].x, units[i as usize].y), &mut out);
        out.into_iter().map(|i| i as usize).filter(|&i| self.state.units[i].hp > 0.0).collect()
    }

    pub fn phys_free(&self, x: f64, y: f64) -> bool {
        ground_free(&self.state, &self.geo, x, y, 6.0, None, Adj::No)
    }

    pub fn clear_line(&self, a: Pt, b: Pt) -> bool {
        let (state, geo) = (&self.state, &self.geo);
        self.nav.clear_line(a, b, &|x, y| ground_free(state, geo, x, y, 6.0, None, Adj::No))
    }

    pub fn nav_query(&mut self, start: Pt, dest: Pt, priority: i32, owner: Option<u32>) -> Option<Vec<Pt>> {
        let now = self.state.time;
        let (state, geo) = (&self.state, &self.geo);
        self.nav.query(start, dest, priority, owner, now, &|x, y| ground_free(state, geo, x, y, 6.0, None, Adj::No))
    }

    pub fn nav_find(&mut self, start: Pt, dest: Pt) -> Vec<Pt> {
        let (state, geo) = (&self.state, &self.geo);
        self.nav.find(start, dest, &|x, y| ground_free(state, geo, x, y, 6.0, None, Adj::No))
    }

    // ---- locating free ground ------------------------------------------------

    pub fn find_free(&self, p: Pt) -> Pt {
        if self.ground_free(p.x, p.y, 6.0) {
            return p;
        }
        match self.nav.nearest(p.x, p.y, None) {
            Some(n) => Pt::new((n.0 as f64 + 0.5) * self.nav.cell, (n.1 as f64 + 0.5) * self.nav.cell),
            None => Pt::new(self.state.buildings[0].x + 120.0, self.state.buildings[0].y + 120.0),
        }
    }

    pub fn spawn_point(&self, bi: usize) -> Pt {
        let b = &self.state.buildings[bi];
        let origin = self.find_free(Pt::new(b.x + b.w / 2.0 + 36.0, b.y + b.h / 2.0 + 34.0));
        let start = self.nav.nearest(origin.x, origin.y, None);
        let mut radius = 0.0;
        while radius <= 320.0 {
            for i in 0..16 {
                let candidate = self.find_free(Pt::new(
                    origin.x + cos((i as f64 * std::f64::consts::PI) / 8.0) * radius,
                    origin.y + sin((i as f64 * std::f64::consts::PI) / 8.0) * radius,
                ));
                let cell = self.nav.nearest(candidate.x, candidate.y, None);
                if let (Some(s), Some(c)) = (start, cell) {
                    if self.nav.components[(s.1 * self.nav.cols + s.0) as usize] != self.nav.components[(c.1 * self.nav.cols + c.0) as usize] {
                        continue;
                    }
                }
                if self.state.units.iter().all(|u| u.hp <= 0.0 || dist(Pt::new(u.x, u.y), candidate) >= 28.0) {
                    return candidate;
                }
            }
            radius += 32.0;
        }
        origin
    }

    pub fn route_possible(&mut self, ui: usize, p: Pt) -> bool {
        let start = self.unit_pt(ui);
        let route = self.nav_query(start, p, 0, None);
        route.is_none() || !route.unwrap().is_empty()
    }

    /// `edgePoint(u, target, extra)`: (point, unreachable).
    pub fn edge_point(&mut self, ui: usize, target: &Target, extra: f64) -> (Pt, bool) {
        {
            let u = &self.state.units[ui];
            if let Some(a) = &u.approach {
                if a.id == target.id && a.extra == extra && a.revision == self.nav.revision as i64 && a.expires > self.state.time {
                    return (a.point, a.unreachable.unwrap_or(false));
                }
            }
        }
        let (ux, uy) = (self.state.units[ui].x, self.state.units[ui].y);
        let start = self.nav.nearest(ux, uy, None);
        let region = start.map(|s| self.nav.components[(s.1 * self.nav.cols + s.0) as usize]);
        let heading = atan2(uy - target.y, ux - target.x);
        let mut best: Option<Pt> = None;
        let mut score = f64::INFINITY;
        for i in 0..16 {
            let angle = heading + ((if i % 2 == 1 { 1.0 } else { -1.0 }) * ((i as f64) / 2.0).ceil() * std::f64::consts::PI) / 8.0;
            let cx = cos(angle);
            let cy = sin(angle);
            let radius = if target.w != 0.0 {
                (target.w / 2.0 / 0.01f64.max(cx.abs())).min(target.h / 2.0 / 0.01f64.max(cy.abs())) + extra
            } else {
                (if target.r != 0.0 { target.r } else { 18.0 }) + extra
            };
            let n = match self.nav.nearest(target.x + cx * radius, target.y + cy * radius, None) {
                Some(n) => n,
                None => continue,
            };
            let point = Pt::new((n.0 as f64 + 0.5) * self.nav.cell, (n.1 as f64 + 0.5) * self.nav.cell);
            if surface_distance(point, target) > 65f64.max(extra + 32.0) {
                continue;
            }
            if let Some(rg) = region {
                if self.nav.components[(n.1 * self.nav.cols + n.0) as usize] != rg && !self.route_possible(ui, point) {
                    continue;
                }
            }
            let value = dist(Pt::new(ux, uy), point) + i as f64 * 2.0;
            if value < score {
                best = Some(point);
                score = value;
            }
        }
        let (point, unreachable) = match best {
            Some(p) => (p, false),
            None => (self.find_free(Pt::new(ux, uy)), true),
        };
        self.state.units[ui].approach = Some(Approach {
            id: target.id,
            extra,
            revision: self.nav.revision as i64,
            expires: self.state.time + 1.2,
            point,
            unreachable: if unreachable { Some(true) } else { None },
        });
        (point, unreachable)
    }

    pub fn clear_cached(&mut self, ui: usize, slot: &'static str, a: Pt, b: Pt) -> bool {
        let id = self.state.units[ui].id;
        if let Some(hit) = self.clear_memos.get(&(id, slot)) {
            if hit.revision == self.nav.revision
                && self.state.time - hit.t < 0.2 + (id % 5) as f64 * 0.02
                && (hit.x - b.x).abs() < 2.0
                && (hit.y - b.y).abs() < 2.0
            {
                return hit.value;
            }
        }
        let value = self.clear_line(a, b);
        self.clear_memos.insert((id, slot), ClearMemo { revision: self.nav.revision, t: self.state.time, x: b.x, y: b.y, value });
        value
    }

    /// Head straight for the goal while a budgeted route is computing.
    pub fn provisional_path(&mut self, ui: usize, p: Pt) -> bool {
        let u = self.unit_pt(ui);
        let d = dist(u, p);
        if d < 1.0 {
            return false;
        }
        let reach = d.min(90.0);
        let probe = Pt::new(u.x + ((p.x - u.x) / d) * reach, u.y + ((p.y - u.y) / d) * reach);
        if !self.clear_line(u, probe) {
            return false;
        }
        let un = &mut self.state.units[ui];
        un.path = vec![if reach >= d { Pt::new(p.x, p.y) } else { probe }];
        un.path_goal = Some(p);
        un.path_revision = -1;
        true
    }

    /// Nearest point with comfortable clearance, to free wedged units.
    pub fn roomy_ground(&self, ui: usize) -> Option<Pt> {
        let u = &self.state.units[ui];
        let up = Pt::new(u.x, u.y);
        for margin in [14.0, 10.0, 8.0] {
            let mut radius = 10.0;
            while radius <= 160.0 {
                for i in 0..16 {
                    let angle = (i as f64 * std::f64::consts::PI) / 8.0 + (u.id % 8) as f64 * 0.1;
                    let q = Pt::new(u.x + cos(angle) * radius, u.y + sin(angle) * radius);
                    if self.ground_free(q.x, q.y, margin) && self.clear_line(up, q) {
                        return Some(q);
                    }
                }
                radius += 10.0;
            }
        }
        None
    }

    pub fn march_point(&self, p: Pt) -> Pt {
        if self.ground_free(p.x, p.y, 6.0) {
            p
        } else {
            self.find_free(p)
        }
    }

    // ---- slot reservation -----------------------------------------------------

    pub fn reserve_slot(&mut self, p: Pt, slots: &mut SlotBook, anchor: Option<Pt>) -> Pt {
        let mut p = p;
        let taken = |slots: &SlotBook, q: Pt| -> bool {
            let cx = (q.x / 24.0).floor() as i64;
            let cy = (q.y / 24.0).floor() as i64;
            for y in (cy - 1)..=(cy + 1) {
                for x in (cx - 1)..=(cx + 1) {
                    if let Some(cell) = slots.grid.get(&(x, y)) {
                        if cell.iter().any(|s| dist(*s, q) < 24.0) {
                            return true;
                        }
                    }
                }
            }
            false
        };
        let available = |sim: &Sim, slots: &SlotBook, q: Pt| -> bool { !taken(slots, q) && anchor.map(|a| sim.clear_line(a, q)).unwrap_or(true) };
        if !available(self, slots, p) {
            let mut found: Option<Pt> = None;
            let mut radius = 32.0;
            'outer: while radius <= 192.0 && found.is_none() {
                for i in 0..16 {
                    let q = Pt::new(p.x + cos((i as f64 * std::f64::consts::PI) / 8.0) * radius, p.y + sin((i as f64 * std::f64::consts::PI) / 8.0) * radius);
                    if self.ground_free(q.x, q.y, 6.0) && available(self, slots, q) {
                        found = Some(q);
                        break 'outer;
                    }
                }
                radius += 32.0;
            }
            if found.is_none() {
                if let Some(a) = anchor {
                    let mut radius = 0.0;
                    'outer2: while radius <= 960.0 && found.is_none() {
                        for i in 0..32 {
                            let q = Pt::new(a.x + cos((i as f64 * std::f64::consts::PI) / 16.0) * radius, a.y + sin((i as f64 * std::f64::consts::PI) / 16.0) * radius);
                            if self.ground_free(q.x, q.y, 6.0) && available(self, slots, q) {
                                found = Some(q);
                                break 'outer2;
                            }
                        }
                        radius += 32.0;
                    }
                }
            }
            if let Some(f) = found {
                p = f;
            }
        }
        slots.list.push(p);
        slots.grid.entry(((p.x / 24.0).floor() as i64, (p.y / 24.0).floor() as i64)).or_default().push(p);
        p
    }

}

/// A formation slot reservations (`slots` array plus its 24-unit hash).
#[derive(Default)]
pub struct SlotBook {
    pub list: Vec<Pt>,
    pub grid: HashMap<(i64, i64), Vec<Pt>>,
}
