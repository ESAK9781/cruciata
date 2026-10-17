//! Entity construction and placement helpers (`makeUnit`, `makeBuilding`,
//! `validSite`, `wallLine`, `defensivePlots`, `queueConstruction`).

use crate::data::data;
use crate::js::{clamp, cos, hypot, round, sin};
use crate::model::*;
use crate::movement::dist;
use crate::nav::Pt;
use crate::sim::Sim;
use crate::world::*;
use std::collections::HashSet;

pub const COLOSSUS_MIN_RANGE: f64 = 700.0;

/// A planned fortification piece (`defensivePlots` entries).
#[derive(Clone, Debug, Default)]
pub struct Plot {
    pub b: Building,
    /// True when the JS plot carried an explicit `hp`/`maxHp`.
    pub has_hp: bool,
    pub has_wh: bool,
}

pub fn wall_kind_name(k: BKind) -> BKind {
    if k == BKind::Bastionwall {
        BKind::Wall
    } else {
        k
    }
}

impl Sim {
    pub fn next_uid(&mut self) -> u32 {
        self.uid += 1;
        self.uid
    }

    pub fn make_unit(&mut self, ty: UType, team: i32, x: f64, y: f64) -> Unit {
        let t = data().ty(ty);
        let id = self.next_uid();
        Unit {
            id,
            ty,
            team,
            x,
            y,
            hp: t.hp,
            max_hp: t.hp,
            angle: if team == 1 { 2.4 } else { -0.5 },
            order: None,
            target: None,
            manual_target: false,
            path: Vec::new(),
            path_goal: None,
            path_timer: 0.0,
            path_revision: 0,
            cooldown: (id % 9) as f64 * 0.11,
            anim: 0.0,
            strike: 0.0,
            moving: false,
            working: false,
            hold: false,
            stance: "fight".into(),
            blessed: 0.0,
            job: None,
            carry: 0.0,
            carry_type: None,
            flee_until: 0.0,
            formation: None,
            stuck: 0.0,
            deployment: "packed".into(),
            deploy_timer: 0.0,
            pending_order: None,
            ..Default::default()
        }
    }

    pub fn make_building(&mut self, kind: BKind, team: i32, x: f64, y: f64, progress: f64) -> Building {
        let base = data().bld(kind);
        let rotated_gate = false;
        let (w, h) = if rotated_gate { (base.h, base.w) } else { (base.w, base.h) };
        let id = self.next_uid();
        let real = wall_kind_name(kind);
        Building {
            id,
            kind: real,
            fortified: kind == BKind::Bastionwall,
            architecture: if team == 1 { Some("islamic".into()) } else { None },
            team,
            x,
            y,
            w,
            h,
            r: w.max(h) / 2.0,
            hp: base.hp * if progress == 1.0 { 1.0 } else { 0.2 },
            max_hp: base.hp,
            progress,
            queue: Vec::new(),
            remaining: if kind == BKind::Farm { Some(2400.0) } else { None },
            max: if kind == BKind::Farm { Some(2400.0) } else { None },
            rally: None,
            closed: if kind == BKind::Gate { Some(true) } else { None },
            guard_cooldown: 1.0,
            spent: Some(match &base.cost {
                Some(c) => cost_json(c),
                None => serde_json::json!({}),
            }),
            ..Default::default()
        }
    }

    /// `makeBuilding(kind, team, x, y, progress, { ...plot, ... })`.
    pub fn make_from_plot(&mut self, plot: &Plot, team: i32, progress: f64) -> Building {
        let mut b = self.make_building(plot.b.kind, team, plot.b.x, plot.b.y, progress);
        let p = &plot.b;
        if plot.has_hp {
            b.hp = p.hp;
            b.max_hp = p.max_hp;
        }
        if plot.has_wh {
            b.w = p.w;
            b.h = p.h;
        }
        b.wall_angle = p.wall_angle;
        b.wall_attachment = p.wall_attachment.clone();
        b.gate_segments = p.gate_segments.clone();
        b.gate_angle = p.gate_angle;
        b.bastion_gate = p.bastion_gate;
        if p.closed.is_some() {
            b.closed = p.closed;
        }
        b.defence_layer = p.defence_layer;
        b
    }

    pub fn placement_spec(&self, kind: BKind, rotation: f64) -> (f64, f64) {
        let spec = data().bld(kind);
        if kind == BKind::Gate && rotation == 90.0 {
            (spec.h, spec.w)
        } else {
            (spec.w, spec.h)
        }
    }

    pub fn colossus_of(&self, team: i32) -> Option<usize> {
        self.state.buildings.iter().position(|b| b.kind == BKind::Colossus && b.team == team && b.hp > 0.0)
    }

    pub fn valid_site(&self, kind: BKind, p: Pt, team: i32, rotation: f64, footprint: Option<(f64, f64)>) -> bool {
        let remembered = if team == 0 { self.cheat_reveal() || self.fog.remembers(p.x, p.y) } else { self.enemy_fog.remembers(p.x, p.y) };
        if !remembered {
            return false;
        }
        if kind == BKind::Colossus && self.colossus_of(team).is_some() {
            return false;
        }
        let (tw, th) = footprint.unwrap_or_else(|| self.placement_spec(kind, rotation));
        if self.state.units.iter().any(|u| u.hp > 0.0 && (u.x - p.x).abs() < tw / 2.0 + 10.0 && (u.y - p.y).abs() < th / 2.0 + 10.0) {
            return false;
        }
        let wallish = matches!(kind, BKind::Wall | BKind::Bastionwall);
        let min_border = if wallish { 0.0 } else { 32.0 };
        let (w, h) = (self.geo.w, self.geo.h);
        if p.x - tw / 2.0 < min_border || p.y - th / 2.0 < min_border || p.x + tw / 2.0 > w - min_border || p.y + th / 2.0 > h - min_border {
            return false;
        }
        if wallish {
            if !self.ground_free_adj(p.x, p.y, 0.0, None, Adj::All) {
                return false;
            }
        } else {
            for dx in [-tw / 2.0, 0.0, tw / 2.0] {
                for dy in [-th / 2.0, 0.0, th / 2.0] {
                    if !self.ground_free_adj(p.x + dx, p.y + dy, 13.0, None, Adj::All) {
                        return false;
                    }
                }
            }
        }
        if self.state.nodes.iter().any(|n| n.remaining > 0.0 && (n.x - p.x).abs() < tw / 2.0 + n.r + 12.0 && (n.y - p.y).abs() < th / 2.0 + n.r + 12.0) {
            return false;
        }
        if self.state.buildings.iter().any(|b| b.hp > 0.0 && (b.x - p.x).abs() < (b.w + tw) / 2.0 && (b.y - p.y).abs() < (b.h + th) / 2.0) {
            return false;
        }
        true
    }

    pub fn wall_line(&self, a: Pt, b: Pt) -> Vec<Pt> {
        let (w, h) = (self.geo.w, self.geo.h);
        let min_x: f64 = 32.0;
        let max_x = min_x.max(((w - 16.0) / 32.0).floor() * 32.0);
        let min_y: f64 = 32.0;
        let max_y = min_y.max(((h - 16.0) / 32.0).floor() * 32.0);
        let snap = |p: Pt| Pt::new(clamp(round(p.x / 32.0) * 32.0, min_x, max_x), clamp(round(p.y / 32.0) * 32.0, min_y, max_y));
        let a = snap(a);
        let b = snap(b);
        let mut points = vec![a];
        let mut p = a;
        let sgn = |v: f64| if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { 0.0 };
        while (p.x != b.x || p.y != b.y) && points.len() < 150 {
            p = Pt::new(p.x + sgn(b.x - p.x) * 32.0, p.y + sgn(b.y - p.y) * 32.0);
            points.push(p);
        }
        points
    }

    pub fn queue_construction(&mut self, builders: &[usize], ids: &[u32], append: bool) {
        for &ui in builders {
            let appendable = append && {
                let u = &self.state.units[ui];
                match &u.job {
                    Some(j) if j.kind == "build" => j.target.and_then(|t| self.get_object(t)).map(|o| matches!(o, crate::sim::Obj::Building(i) if self.state.buildings[i].progress < 1.0)).unwrap_or(false),
                    _ => false,
                }
            };
            let u = &mut self.state.units[ui];
            if appendable {
                let mut q = u.build_queue.clone().unwrap_or_default();
                q.extend_from_slice(ids);
                u.build_queue = Some(q);
            } else {
                let mut q: Vec<u32> = ids.to_vec();
                let first = q.remove(0);
                u.build_queue = Some(q);
                u.job = Some(Job { kind: "build".into(), target: Some(first), ..Default::default() });
                u.order = None;
                u.path_timer = 0.0;
                u.hold = false;
            }
        }
    }

    /// Nudge a building to the nearest clear ground when its footprint overlaps others.
    pub fn place_clear(&mut self, bi: usize, margin: f64) {
        let (bw, bh, bid) = (self.state.buildings[bi].w, self.state.buildings[bi].h, self.state.buildings[bi].id);
        let clear = |s: &Sim, x: f64, y: f64| -> bool {
            !s.state.buildings.iter().any(|o| o.id != bid && o.hp > 0.0 && (x - o.x).abs() < (bw + o.w) / 2.0 + margin && (y - o.y).abs() < (bh + o.h) / 2.0 + margin)
                && s.land_free(x, y, bw.max(bh) / 2.0, true)
        };
        let (bx, by) = (self.state.buildings[bi].x, self.state.buildings[bi].y);
        if clear(self, bx, by) {
            return;
        }
        let mut r = 24.0;
        while r <= 480.0 {
            for i in 0..16 {
                let angle = (i as f64 * std::f64::consts::PI) / 8.0 + r * 0.01;
                let x = bx + cos(angle) * r;
                let y = by + sin(angle) * r;
                if clear(self, x, y) {
                    self.state.buildings[bi].x = x;
                    self.state.buildings[bi].y = y;
                    return;
                }
            }
            r += 24.0;
        }
    }

    /// `defensivePlots(base, radius)`; `base_id`/position/shape describe the base.
    pub fn defensive_plots(&self, base_id: u32, bx: f64, by: f64, fortress: Option<&serde_json::Value>, radius: f64, adaptive: bool) -> Vec<Plot> {
        let (w, h) = (self.geo.w, self.geo.h);
        let mut plots: Vec<Plot> = Vec::new();
        let mut seen: HashSet<(i64, i64)> = HashSet::new();
        let snap = |n: f64| round(n / 32.0) * 32.0;
        let phase = (base_id % 7) as f64 * 0.035;
        let layers_flag = fortress.and_then(|f| f.get("layers")).and_then(|v| v.as_f64()) == Some(3.0);
        let scales: Vec<f64> = if layers_flag {
            vec![1.0, 0.72, 0.44]
        } else if radius >= 600.0 {
            vec![1.0, 0.64]
        } else {
            vec![1.0]
        };
        let fx = fortress.and_then(|f| f.get("x")).and_then(|v| v.as_f64()).filter(|v| *v != 0.0).unwrap_or(1.0);
        let fy = fortress.and_then(|f| f.get("y")).and_then(|v| v.as_f64()).filter(|v| *v != 0.0).unwrap_or(1.0);
        for (layer, scale) in scales.iter().enumerate() {
            let mut blocked: Vec<bool> = Vec::new();
            let ring: Vec<Pt> = (0..16)
                .map(|i| {
                    let angle = (i as f64 * std::f64::consts::PI) / 8.0 + phase;
                    let bulge = if i % 4 == 0 { 1.13 } else if i % 2 == 1 { 0.94 } else { 1.04 };
                    if adaptive {
                        // The ring follows the land: it swells to enclose seen resource
                        // patches, shrinks inland from water and rock, and is left out
                        // where the terrain already forms the barrier.
                        let r0 = radius * scale * bulge;
                        let mut r = r0;
                        for n in &self.state.nodes {
                            if !(n.remaining > 0.0) || !self.enemy_fog.remembers(n.x, n.y) {
                                continue;
                            }
                            let d = ((n.x - bx).powi(2) + (n.y - by).powi(2)).sqrt();
                            let turn = crate::js::atan2(n.y - by, n.x - bx) - angle;
                            if d > r0 * 0.7 && d < r0 * 1.45 && crate::js::atan2(sin(turn), cos(turn)).abs() < 0.35 {
                                r = r.max((d + 150.0).min(r0 * 1.5));
                            }
                        }
                        let reach = |q: f64| self.land_free(clamp(bx + cos(angle) * q, 128.0, w - 128.0), clamp(by + sin(angle) * q, 128.0, h - 128.0), 24.0, true);
                        while r > r0 * 0.55 && !reach(r) {
                            r -= 48.0;
                        }
                        blocked.push(!reach(r));
                        return Pt::new(snap(clamp(bx + cos(angle) * r, 128.0, w - 128.0)), snap(clamp(by + sin(angle) * r, 128.0, h - 128.0)));
                    }
                    Pt::new(
                        snap(clamp(bx + cos(angle) * radius * scale * bulge * fx, 128.0, w - 128.0)),
                        snap(clamp(by + sin(angle) * radius * scale * bulge * fy, 128.0, h - 128.0)),
                    )
                })
                .collect();
            for edge in 0..ring.len() {
                if adaptive && blocked[edge] && blocked[(edge + 1) % ring.len()] {
                    continue;
                }
                let a = ring[edge];
                let b = ring[(edge + 1) % ring.len()];
                let points = self.wall_line(a, b);
                let angle = crate::js::atan2(b.y - a.y, b.x - a.x);
                let middle = points.len() / 2;
                let mut i = 0usize;
                while i < points.len() {
                    let p = points[i];
                    let key = (p.x as i64, p.y as i64);
                    if seen.contains(&key) {
                        i += 1;
                        continue;
                    }
                    seen.insert(key);
                    if edge % 4 == 1 && i == middle && points.get(i + 1).is_some() {
                        i += 1;
                        let q = points[i];
                        seen.insert((q.x as i64, q.y as i64));
                        let mut gate = Building { kind: BKind::Gate, hp: 18000.0, max_hp: 18000.0, bastion_gate: Some(true), x: (p.x + q.x) / 2.0, y: (p.y + q.y) / 2.0, gate_angle: Some(angle), w: (q.x - p.x).abs() + 32.0, h: (q.y - p.y).abs() + 32.0, closed: Some(false), defence_layer: Some(layer as f64), ..Default::default() };
                        let seg = |part: Pt, to: Pt, from: Pt| -> GateSegment {
                            let mut links = std::collections::BTreeMap::new();
                            links.insert("forward".to_string(), Link { x: (to.x - from.x) / 2.0, y: (to.y - from.y) / 2.0, terrain: None });
                            links.insert("backward".to_string(), Link { x: (from.x - to.x) / 2.0, y: (from.y - to.y) / 2.0, terrain: None });
                            GateSegment { x: part.x, y: part.y, w: 32.0, h: 32.0, wall_angle: Some(angle), fortified: Some(true), links: Some(links), extra: Default::default() }
                        };
                        gate.gate_segments = Some(vec![seg(p, q, p), seg(q, q, p)]);
                        plots.push(Plot { b: gate, has_hp: true, has_wh: true });
                    } else if i == 0 || (i % 10 == 5 && !(edge % 4 == 1 && (i as i64 - middle as i64).abs() < 4)) {
                        let tower = Building {
                            kind: BKind::Tower,
                            x: p.x,
                            y: p.y,
                            hp: 11000.0,
                            max_hp: 11000.0,
                            w: 48.0,
                            h: 48.0,
                            wall_attachment: Some(WallAttachment { x: p.x, y: p.y, w: 32.0, h: 32.0, fortified: Some(true), wall_angle: Some(angle), links: Some(Default::default()), extra: Default::default() }),
                            defence_layer: Some(layer as f64),
                            ..Default::default()
                        };
                        plots.push(Plot { b: tower, has_hp: true, has_wh: true });
                    } else {
                        let wall = Building { kind: BKind::Bastionwall, x: p.x, y: p.y, wall_angle: Some(angle), defence_layer: Some(layer as f64), ..Default::default() };
                        plots.push(Plot { b: wall, has_hp: false, has_wh: false });
                    }
                    i += 1;
                }
            }
        }
        plots
    }

    // ---- Colossus helpers ---------------------------------------------------

    pub fn colossus_reveals(&self, team: i32) -> Vec<crate::fog::Source> {
        let mut out = Vec::new();
        for b in &self.state.buildings {
            if b.kind == BKind::Colossus && b.hp > 0.0 && b.team != team && (b.team == 0 || b.team == 1) && (team == 0 || team == 1) {
                out.push(crate::fog::Source { x: b.x, y: b.y, vision: 360.0, team, hit: false });
            }
        }
        out
    }

    /// Both sides hear the moment Colossal engineering is begun.
    pub fn announce_research(&mut self, team: i32, key: &str) {
        if key != "colossal" {
            return;
        }
        let other = 1 - team;
        self.toast_for(other, "WARNING: the enemy has begun researching Colossal engineering! Prepare to strike their siege workshop or to answer a Colossus.");
        self.sound("horn", None);
        self.toast_for(team, "Colossal engineering begun. The enemy has been told and will prepare.");
    }

    pub fn announce_colossus(&mut self, bi: usize) {
        self.state.buildings[bi].announced = Some(true);
        let (team, x, y) = (self.state.buildings[bi].team, self.state.buildings[bi].x, self.state.buildings[bi].y);
        if team == 1 {
            self.toast("WARNING: the enemy has begun a Colossal siege engine! Its site is marked on your map. Press Z to look.");
            self.sound("horn", None);
            let alerts = self.state.alerts.get_or_insert_with(Vec::new);
            alerts.push(serde_json::json!({"x": x, "y": y, "t": 0}));
        } else if team == 0 {
            self.toast("Colossus begun. The enemy has been told where it stands and will try to destroy it.");
        }
    }
}

pub fn cost_json(c: &Cost) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    for (r, v) in &c.0 {
        let name = match r {
            Res::Food => "food",
            Res::Wood => "wood",
            Res::Gold => "gold",
            Res::Stone => "stone",
        };
        m.insert(name.to_string(), serde_json::json!(v));
    }
    serde_json::Value::Object(m)
}

#[allow(dead_code)]
fn unused(a: Pt, b: Pt) -> f64 {
    dist(a, b) + hypot(0.0, 0.0)
}
