//! The opposing commander: economy, fortification, research, siege and
//! assaults (`enemyEconomy` and friends), plus regional militias.

use crate::build::{cost_json, Plot, COLOSSUS_MIN_RANGE};
use crate::data::data;
use crate::js::{atan2, clamp, cos, sin};
use crate::model::*;
use crate::movement::dist;
use crate::nav::Pt;
use crate::sim::{Obj, Sim};
use crate::workers::Gt;
use std::cmp::Ordering;

fn cmp(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

pub struct Plan {
    pub think: f64,
    pub workers: f64,
    pub attack: f64,
    pub retreat: f64,
    pub reserve: usize,
    pub grace: f64,
}

pub fn plan_for(difficulty: &str) -> Plan {
    match difficulty {
        "easy" => Plan { think: 10.0, workers: 10.0, attack: 16.0, retreat: 0.65, reserve: 5, grace: 300.0 },
        "hard" => Plan { think: 4.0, workers: 24.0, attack: 20.0, retreat: 0.45, reserve: 4, grace: 180.0 },
        _ => Plan { think: 6.0, workers: 16.0, attack: 18.0, retreat: 0.55, reserve: 4, grace: 240.0 },
    }
}

struct Ctx {
    ws: Vec<usize>,
    army: Vec<usize>,
    used: f64,
    queued: f64,
    cap: f64,
    known: Vec<Building>,
    base: usize,
}

fn engine_value(kind: BKind) -> f64 {
    match kind {
        BKind::Colossus => 100.0,
        BKind::Greatengine => 90.0,
        BKind::Siegeworkshop => 60.0,
        BKind::Barracks | BKind::Stable => 55.0,
        BKind::Towncenter => 50.0,
        BKind::Fort => 45.0,
        BKind::Tower => 35.0,
        BKind::Watchtower => 30.0,
        BKind::Chapel => 25.0,
        BKind::House => 20.0,
        _ => 0.0,
    }
}

fn colossus_value(kind: BKind) -> f64 {
    match kind {
        BKind::Colossus => 100.0,
        BKind::Greatengine => 70.0,
        BKind::Towncenter => 60.0,
        BKind::Barracks | BKind::Stable | BKind::Siegeworkshop => 45.0,
        BKind::Fort => 40.0,
        BKind::House => 15.0,
        BKind::Tower | BKind::Watchtower => 8.0,
        BKind::Wall | BKind::Gate => 0.0,
        _ => 20.0,
    }
}

impl Sim {
    /// Fog-known player structures, in id order (JS iterates object keys numerically).
    pub fn known_buildings(&self, fog_team: i32) -> Vec<Building> {
        let fog = if fog_team == 3 { &self.militia_fog } else { &self.enemy_fog };
        let mut v: Vec<Building> = fog.known.values().filter(|b| b.team == 0 && b.hp > 0.0).cloned().collect();
        v.sort_by_key(|b| b.id);
        v
    }

    fn bpt(b: &Building) -> Pt {
        Pt::new(b.x, b.y)
    }

    fn avg_pos(&self, members: &[usize]) -> Pt {
        let n = members.len() as f64;
        let mut p = Pt::new(0.0, 0.0);
        for &i in members {
            p.x += self.state.units[i].x / n;
            p.y += self.state.units[i].y / n;
        }
        p
    }

    pub fn has_tech(&self, key: &str, team: i32) -> bool {
        if team == 0 {
            self.state.techs.get(key).copied().unwrap_or(false)
        } else {
            self.state.enemy.techs.as_ref().and_then(|t| t.get(key)).copied().unwrap_or(false)
        }
    }

    pub fn rank_for(&self, ty: UType, team: i32) -> f64 {
        let key = match ty {
            UType::Sword => "sword",
            UType::Archer => "archer",
            UType::Knight => "knight",
            UType::Chaplain => "chaplain",
            UType::Standard => "standard",
            UType::Trebuchet => "trebuchet",
            _ => "",
        };
        let map = if team == 0 { &self.state.upgrades } else { &self.state.enemy.upgrades };
        map.get(key).copied().unwrap_or(0.0)
    }

    pub fn is_unlocked(&self, kind: BKind, team: i32) -> bool {
        let key = match kind {
            BKind::Greatengine => Some("engineworks"),
            BKind::Colossus => Some("colossal"),
            _ => None,
        };
        match key {
            None => true,
            Some(k) => self.has_tech(k, team) || self.state.buildings.iter().any(|b| b.team == team && b.kind == kind),
        }
    }

    pub fn tech_available(&self, key: &str, team: i32) -> bool {
        let Some(t) = data().tech(key) else { return false };
        if t.unlock.is_some() {
            return !self.has_tech(key, team) && t.requires.map(|r| self.has_tech(r, team)).unwrap_or(true);
        }
        self.rank_for(t.ty.unwrap(), team) == t.rank as f64 - 1.0
    }

    pub fn apply_rank(&mut self, ui: usize, rank: f64) {
        let u = &mut self.state.units[ui];
        let ratio = u.hp / u.max_hp;
        u.rank = Some(rank);
        u.max_hp = data().ty(u.ty).hp * (1.0 + rank * 0.25);
        u.hp = u.max_hp * ratio;
    }

    fn train(&mut self, ctx: &mut Ctx, ty: UType) -> bool {
        let d = data();
        let producer = d.ty(ty).producer.unwrap();
        let mut c = self.complete_buildings(Some(producer), 1);
        c.sort_by(|&a, &b| self.state.buildings[a].queue.len().cmp(&self.state.buildings[b].queue.len()));
        let Some(&bi) = c.first() else { return false };
        let cost = d.ty(ty).cost.clone().unwrap_or_default();
        if self.state.buildings[bi].queue.len() >= 3 || ctx.used + ctx.queued >= ctx.cap || !self.afford(&cost, 1) {
            return false;
        }
        self.pay(&cost, 1.0, 1);
        self.state.enemy.spent += cost.0.iter().map(|(_, v)| *v).sum::<f64>();
        self.state.buildings[bi].queue.push(QueueItem { kind: "unit".into(), ty: Some(ty), tech: None, time: 0.0, duration: d.ty(ty).train, cost: Some(cost_json(&cost)), extra: Default::default() });
        ctx.queued += 1.0;
        true
    }

    fn busy_foundation(&self, kind: BKind) -> bool {
        self.state.buildings.iter().any(|b| b.team == 1 && b.kind == kind && b.progress < 1.0 && b.hp > 0.0)
    }

    fn idle_builders(&self, ctx: &Ctx, limit: usize) -> Vec<usize> {
        ctx.ws.iter().copied().filter(|&u| self.state.units[u].job.as_ref().map(|j| j.kind != "build").unwrap_or(true)).take(limit).collect()
    }

    fn assign_build(&mut self, builders: &[usize], id: u32) {
        for &u in builders {
            let un = &mut self.state.units[u];
            un.job = Some(Job { kind: "build".into(), target: Some(id), ..Default::default() });
            un.order = None;
            un.target = None;
        }
    }

    fn ai_build(&mut self, ctx: &Ctx, kind: BKind, settlement: Pt) -> bool {
        let d = data();
        let cost = d.bld(kind).cost.clone().unwrap_or_default();
        if !self.afford(&cost, 1) || self.busy_foundation(kind) {
            return false;
        }
        let builders = self.idle_builders(ctx, 2);
        if builders.is_empty() {
            return false;
        }
        for i in 0..100 {
            let a = i as f64 * 2.399;
            let r = 310.0 + (i as f64 / 12.0).floor() * 65.0;
            let p = Pt::new(settlement.x + cos(a) * r, settlement.y + sin(a) * r);
            if !self.valid_site(kind, p, 1, 0.0, None) {
                continue;
            }
            self.pay(&cost, 1.0, 1);
            let b = self.make_building(kind, 1, p.x, p.y, 0.0);
            let id = b.id;
            self.state.buildings.push(b);
            self.state.nav_dirty = true;
            self.assign_build(&builders, id);
            return true;
        }
        false
    }

    fn ai_build_at(&mut self, ctx: &Ctx, kind: BKind, point: Pt) -> bool {
        let d = data();
        let cost = d.bld(kind).cost.clone().unwrap_or_default();
        if !self.afford(&cost, 1) || self.busy_foundation(kind) {
            return false;
        }
        let builders = self.idle_builders(ctx, 2);
        if builders.is_empty() {
            return false;
        }
        for i in 0..40 {
            let a = i as f64 * 2.399;
            let r = 70.0 + (i as f64 / 8.0).floor() * 26.0;
            let p = Pt::new(point.x + cos(a) * r, point.y + sin(a) * r);
            if !self.valid_site(kind, p, 1, 0.0, None) {
                continue;
            }
            self.pay(&cost, 1.0, 1);
            let b = self.make_building(kind, 1, p.x, p.y, 0.0);
            let id = b.id;
            self.state.buildings.push(b);
            self.state.nav_dirty = true;
            self.assign_build(&builders, id);
            return true;
        }
        false
    }

    fn expand_depots(&mut self, ctx: &Ctx, centres: &[usize]) {
        let d = data();
        let base = Self::bpt(&self.state.buildings[ctx.base]);
        for (kind, types) in [(BKind::Lumbercamp, vec![Res::Wood]), (BKind::Miningcamp, vec![Res::Gold, Res::Stone]), (BKind::Mill, vec![Res::Food])] {
            let count = self.state.buildings.iter().filter(|b| b.team == 1 && b.kind == kind && b.hp > 0.0).count();
            if count as f64 >= 3.0 + centres.len() as f64 * 2.0 {
                continue;
            }
            let drop_offs: Vec<Pt> = self
                .state
                .buildings
                .iter()
                .filter(|b| b.team == 1 && b.hp > 0.0 && d.bld(b.kind).drop.as_ref().map(|dr| dr.iter().any(|t| types.contains(t))).unwrap_or(false))
                .map(Self::bpt)
                .collect();
            let mut nodes: Vec<usize> = self
                .state
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| {
                    let np = Pt::new(n.x, n.y);
                    types.contains(&n.kind)
                        && n.remaining > 0.0
                        && self.enemy_fog.remembers(n.x, n.y)
                        && drop_offs.iter().all(|dd| dist(*dd, np) > 380.0)
                        && centres.iter().any(|&c| dist(Self::bpt(&self.state.buildings[c]), np) < 1500.0)
                        && ctx.known.iter().all(|b| dist(Self::bpt(b), np) > 800.0)
                })
                .map(|(i, _)| i)
                .collect();
            nodes.sort_by(|&a, &b| cmp(dist(Pt::new(self.state.nodes[a].x, self.state.nodes[a].y), base), dist(Pt::new(self.state.nodes[b].x, self.state.nodes[b].y), base)));
            if let Some(&n) = nodes.first() {
                let np = Pt::new(self.state.nodes[n].x, self.state.nodes[n].y);
                if self.ai_build_at(ctx, kind, np) {
                    return;
                }
            }
        }
    }

    fn enemy_fortifications(&mut self, ctx: &Ctx, base_idx: usize) {
        let (bid, bpos, fortress) = {
            let b = &self.state.buildings[base_idx];
            (b.id, Pt::new(b.x, b.y), b.fortress_shape.clone())
        };
        if !self.fortifications.contains_key(&bid) {
            let radius = if self.state.mode != "quickmatch" && Some(bid) == self.state.capitals.enemy { 896.0 } else { 640.0 };
            let plots = self.defensive_plots(bid, bpos.x, bpos.y, fortress.as_ref(), radius);
            self.fortifications.insert(bid, plots);
        }
        let plots = self.fortifications.get(&bid).unwrap().clone();
        let active = self.state.buildings.iter().filter(|b| b.team == 1 && b.defence == Some(true) && b.hp > 0.0 && b.progress < 1.0).count();
        let now = self.state.time;
        let mut builders: Vec<usize> = ctx
            .ws
            .iter()
            .copied()
            .filter(|&u| {
                let un = &self.state.units[u];
                !matches!(un.job.as_ref().map(|j| j.kind.as_str()), Some("build") | Some("repair")) && un.flee_until <= now
            })
            .collect();
        builders.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), bpos), dist(self.unit_pt(b), bpos)));
        builders.truncate(1.max((ctx.ws.len() as f64 / 4.0).floor() as usize));
        if builders.is_empty() || active >= 8 {
            return;
        }
        let mut ids: Vec<u32> = Vec::new();
        for p in &plots {
            if ids.len() >= 3 || ids.len() + active >= 8 {
                break;
            }
            let pp = Pt::new(p.b.x, p.b.y);
            if self.state.buildings.iter().any(|b| b.team == 1 && b.hp > 0.0 && dist(Pt::new(b.x, b.y), pp) < 4.0) {
                continue;
            }
            let spec = data().bld(p.b.kind);
            let cost = spec.cost.clone().unwrap_or_default();
            if !self.afford(&cost, 1) {
                continue;
            }
            let (vk, fp) = (if p.b.wall_attachment.is_some() { BKind::Wall } else { p.b.kind }, if p.b.w != 0.0 { Some((p.b.w, p.b.h)) } else { None });
            if !self.valid_site(vk, pp, 1, 0.0, fp) {
                continue;
            }
            self.pay(&cost, 1.0, 1);
            let mut b = self.make_from_plot(p, 1, 0.0);
            b.defence = Some(true);
            if p.has_hp {
                b.max_hp = p.b.max_hp;
                b.hp = p.b.max_hp * 0.2;
            }
            ids.push(b.id);
            self.state.buildings.push(b);
            self.state.nav_dirty = true;
        }
        if !ids.is_empty() {
            self.queue_construction(&builders, &ids, false);
        } else {
            let survey = plots.iter().find(|p| !self.enemy_fog.remembers(p.b.x, p.b.y));
            let worker = builders.iter().copied().find(|&u| self.state.units[u].order.is_none());
            if let (Some(sv), Some(w)) = (survey, worker) {
                let angle = atan2(bpos.y - sv.b.y, bpos.x - sv.b.x);
                let p = self.find_free(Pt::new(sv.b.x + cos(angle) * 80.0, sv.b.y + sin(angle) * 80.0));
                let u = &mut self.state.units[w];
                u.job = None;
                u.order = Some(Order { x: p.x, y: p.y, attack: Some(false), ..Default::default() });
                u.path_timer = 0.0;
            }
        }
    }

    fn colossus_ai(&mut self, ctx: &Ctx) {
        let d = data();
        let base = Self::bpt(&self.state.buildings[ctx.base]);
        let mine = self.colossus_of(1);
        let idle = |s: &Sim| -> Vec<usize> {
            ctx.ws
                .iter()
                .copied()
                .filter(|&u| {
                    let un = &s.state.units[u];
                    un.job.as_ref().map(|j| j.kind != "build").unwrap_or(true) && un.order.is_none() && un.stance != "stand-down"
                })
                .collect()
        };
        let Some(mi) = mine else {
            let cost = d.bld(BKind::Colossus).cost.clone().unwrap();
            if self.state.time < 840.0 || !self.has_tech("colossal", 1) || ctx.ws.len() < 12 || !self.afford(&cost, 1) {
                return;
            }
            for i in 0..80 {
                let a = i as f64 * 2.399;
                let r = 380.0 + (i as f64 / 10.0).floor() * 70.0;
                let p = Pt::new(base.x + cos(a) * r, base.y + sin(a) * r);
                if !self.valid_site(BKind::Colossus, p, 1, 0.0, None) {
                    continue;
                }
                self.pay(&cost, 1.0, 1);
                let b = self.make_building(BKind::Colossus, 1, p.x, p.y, 0.0);
                self.state.buildings.push(b);
                let bi = self.state.buildings.len() - 1;
                self.state.nav_dirty = true;
                let ids = [self.state.buildings[bi].id];
                let builders: Vec<usize> = idle(self).into_iter().take(8).collect();
                self.queue_construction(&builders, &ids, false);
                self.announce_colossus(bi);
                return;
            }
            return;
        };
        let mid = self.state.buildings[mi].id;
        if self.state.buildings[mi].progress < 1.0 {
            let crew = ctx.ws.iter().filter(|&&u| self.state.units[u].job.as_ref().map(|j| j.kind == "build" && j.target == Some(mid)).unwrap_or(false)).count();
            if crew < 6 {
                let builders: Vec<usize> = idle(self).into_iter().take(8 - crew).collect();
                self.queue_construction(&builders, &[mid], false);
            }
            return;
        }
        if let Some(t) = self.state.buildings[mi].attack_target {
            if self.get_object(t).is_some() {
                return;
            }
        }
        let mpos = Pt::new(self.state.buildings[mi].x, self.state.buildings[mi].y);
        let mut picks: Vec<usize> = Vec::new();
        for k in &ctx.known {
            if let Some(Obj::Building(bi)) = self.get_object(k.id) {
                let b = &self.state.buildings[bi];
                if b.hp > 0.0 && b.team == 0 && dist(Pt::new(b.x, b.y), mpos) >= COLOSSUS_MIN_RANGE {
                    picks.push(bi);
                }
            }
        }
        picks.sort_by(|&a, &c| {
            let (ba, bc) = (&self.state.buildings[a], &self.state.buildings[c]);
            cmp(colossus_value(bc.kind), colossus_value(ba.kind)).then(cmp(dist(Pt::new(ba.x, ba.y), mpos), dist(Pt::new(bc.x, bc.y), mpos)))
        });
        if let Some(&p) = picks.first() {
            let id = self.state.buildings[p].id;
            self.state.buildings[mi].attack_target = Some(id);
            self.state.buildings[mi].fire_target = None;
        }
    }

    fn tech_ai(&mut self) {
        let d = data();
        let works = self.complete_buildings(Some(BKind::Siegeworkshop), 1).into_iter().find(|&b| self.state.buildings[b].queue.len() < 2);
        let Some(wi) = works else { return };
        let hard = self.state.difficulty == "hard";
        let easy = self.state.difficulty == "easy";
        for key in ["engineworks", "colossal"] {
            let t = d.tech(key).unwrap();
            if self.has_tech(key, 1) || !self.tech_available(key, 1) || self.state.buildings.iter().any(|b| b.team == 1 && b.queue.iter().any(|q| q.tech.as_deref() == Some(key))) {
                continue;
            }
            let at = (if key == "engineworks" { 360.0 } else { 720.0 }) * if hard { 0.8 } else { 1.0 };
            if self.state.time < at || (key == "colossal" && easy) {
                return;
            }
            if !self.afford(&t.cost, 1) {
                return;
            }
            self.pay(&t.cost, 1.0, 1);
            self.state.buildings[wi].queue.push(QueueItem { kind: "research".into(), ty: None, tech: Some(key.into()), time: 0.0, duration: t.time, cost: Some(cost_json(&t.cost)), extra: Default::default() });
            return;
        }
    }

    fn battery_ai(&mut self, ctx: &Ctx) {
        let d = data();
        if !self.is_unlocked(BKind::Greatengine, 1) {
            return;
        }
        let base = Self::bpt(&self.state.buildings[ctx.base]);
        let spec = d.bld(BKind::Greatengine);
        let (min_range, range) = (spec.min_range.unwrap(), spec.range.unwrap());
        let engines: Vec<usize> = (0..self.state.buildings.len()).filter(|&i| {
            let b = &self.state.buildings[i];
            b.team == 1 && b.kind == BKind::Greatengine && b.hp > 0.0
        }).collect();
        let limit = match self.state.difficulty.as_str() {
            "hard" => 3,
            "easy" => 1,
            _ => 2,
        };
        let mut targets: Vec<usize> = Vec::new();
        for k in &ctx.known {
            if let Some(Obj::Building(bi)) = self.get_object(k.id) {
                let b = &self.state.buildings[bi];
                if b.hp > 0.0 && b.team == 0 && engine_value(b.kind) > 0.0 {
                    targets.push(bi);
                }
            }
        }
        for &e in &engines {
            if self.state.buildings[e].progress < 1.0 {
                continue;
            }
            let ep = Self::bpt(&self.state.buildings[e]);
            if let Some(t) = self.state.buildings[e].attack_target {
                if let Some(Obj::Building(ci)) = self.get_object(t) {
                    let dd = dist(ep, Pt::new(self.state.buildings[ci].x, self.state.buildings[ci].y));
                    if dd >= min_range && dd <= range {
                        continue;
                    }
                } else if let Some(o) = self.get_object(t) {
                    let tp = self.obj_pos(o);
                    let dd = dist(ep, tp);
                    if dd >= min_range && dd <= range {
                        continue;
                    }
                }
            }
            let mut picks: Vec<usize> = targets
                .iter()
                .copied()
                .filter(|&t| {
                    let dd = dist(ep, Self::bpt(&self.state.buildings[t]));
                    dd >= min_range + 20.0 && dd <= range - 30.0
                })
                .collect();
            picks.sort_by(|&a, &c| {
                let (ba, bc) = (&self.state.buildings[a], &self.state.buildings[c]);
                cmp(engine_value(bc.kind), engine_value(ba.kind)).then(cmp(dist(Self::bpt(ba), ep), dist(Self::bpt(bc), ep)))
            });
            self.state.buildings[e].attack_target = picks.first().map(|&p| self.state.buildings[p].id);
            self.state.buildings[e].fire_target = None;
        }
        for &e in &engines {
            let eid = self.state.buildings[e].id;
            let ep = Self::bpt(&self.state.buildings[e]);
            let stationed = ctx.army.iter().filter(|&&u| self.state.units[u].garrison_base == Some(eid)).count();
            let recruits: Vec<usize> = ctx
                .army
                .iter()
                .copied()
                .filter(|&u| {
                    let un = &self.state.units[u];
                    un.scout != Some(true) && un.garrison_base.is_none() && un.order.is_none() && un.target.is_none()
                })
                .take(5usize.saturating_sub(stationed))
                .collect();
            for u in recruits {
                let uid = self.state.units[u].id;
                let home = self.find_free(Pt::new(ep.x + ((uid % 3) as f64 - 1.0) * 80.0, ep.y + 170.0));
                let un = &mut self.state.units[u];
                un.garrison_base = Some(eid);
                un.home = Some(home);
                un.order = Some(Order { x: home.x, y: home.y, attack: Some(true), ..Default::default() });
                un.path_timer = 0.0;
            }
        }
        let cost = spec.cost.clone().unwrap();
        if engines.len() >= limit
            || engines.iter().any(|&e| self.state.buildings[e].progress < 1.0)
            || self.state.time < 480.0
            || ctx.ws.len() < 10
            || targets.is_empty()
            || !self.afford(&cost, 1)
        {
            return;
        }
        targets.sort_by(|&a, &c| cmp(dist(Self::bpt(&self.state.buildings[a]), base), dist(Self::bpt(&self.state.buildings[c]), base)));
        let target = Self::bpt(&self.state.buildings[targets[0]]);
        let away = atan2(base.y - target.y, base.x - target.x);
        for distance in [1900.0, 1700.0, 1500.0, 1300.0, 1100.0] {
            for lateral in [0.0, 260.0, -260.0, 520.0, -520.0] {
                let p = Pt::new(
                    target.x + cos(away) * distance + cos(away + std::f64::consts::PI / 2.0) * lateral,
                    target.y + sin(away) * distance + sin(away + std::f64::consts::PI / 2.0) * lateral,
                );
                if !self.valid_site(BKind::Greatengine, p, 1, 0.0, None)
                    || targets.iter().any(|&t| {
                        let b = &self.state.buildings[t];
                        dist(Self::bpt(b), p) < if matches!(b.kind, BKind::Tower | BKind::Watchtower | BKind::Fort) { 800.0 } else { 500.0 }
                    })
                {
                    continue;
                }
                self.pay(&cost, 1.0, 1);
                let b = self.make_building(BKind::Greatengine, 1, p.x, p.y, 0.0);
                let id = b.id;
                self.state.buildings.push(b);
                self.state.nav_dirty = true;
                let builders = self.idle_builders(ctx, 6);
                self.queue_construction(&builders, &[id], false);
                return;
            }
        }
    }

    fn target_weight(&self, b: &Building, from: Pt, base: Pt) -> f64 {
        let _ = base;
        let wallish = b.kind == BKind::Wall || b.kind == BKind::Gate || b.wall_attachment.is_some();
        dist(Self::bpt(b), from)
            + if b.kind == BKind::Tower { 500.0 } else { 0.0 }
            + if wallish { 1800.0 } else { 0.0 }
            + if matches!(b.kind, BKind::Barracks | BKind::Stable | BKind::Siegeworkshop) { -150.0 } else { 0.0 }
            + if b.kind == BKind::Towncenter { -100.0 } else { 0.0 }
            + if b.kind == BKind::Colossus { -6000.0 } else { 0.0 }
    }

    fn launch_assault(&mut self, group: &[usize], target: &Building, center: Pt) -> u32 {
        let d = data();
        let a = atan2(target.y - center.y, target.x - center.x);
        let formation_id = self.next_uid();
        let destination = self.find_free(Pt::new(target.x - cos(a) * (target.r + 80.0), target.y - sin(a) * (target.r + 80.0)));
        for (i, &u) in group.iter().enumerate() {
            let ty = self.state.units[u].ty;
            let rear = if ty == UType::Chaplain { 150.0 } else if ty == UType::Trebuchet { 450.0 } else { (i as f64 / 6.0).floor() * 24.0 };
            let side = ((i % 6) as f64 - 2.5) * 25.0;
            let goal = self.find_free(Pt::new(target.x - cos(a) * (target.r + 80.0 + rear) - sin(a) * side, target.y - sin(a) * (target.r + 80.0 + rear) + cos(a) * side));
            let un = &mut self.state.units[u];
            un.squad = None;
            un.home = None;
            let order = Order { x: goal.x, y: goal.y, attack: Some(true), formation: Some(formation_id), ..Default::default() };
            un.order = Some(order.clone());
            un.formation = Some(serde_json::json!({"id": formation_id, "x": goal.x, "y": goal.y}));
            un.march_offset = Some(Pt::new(goal.x - destination.x, goal.y - destination.y));
            un.path.clear();
            un.path_goal = None;
            un.path_request = None;
            un.stuck = 0.0;
            if ty == UType::Trebuchet && un.deployment == "deployed" {
                un.deployment = "packing".into();
                un.deploy_timer = 4.0;
                un.pending_order = un.order.take();
            }
        }
        let speed = group.iter().map(|&u| d.ty(self.state.units[u].ty).speed).fold(f64::INFINITY, f64::min);
        let rs = self.find_free(center);
        self.state.formations.push(Formation {
            id: formation_id,
            members: group.iter().map(|&u| self.state.units[u].id).collect(),
            anchor: center,
            route_start: Some(rs),
            shared_route: Some(true),
            route_ready: Some(false),
            destination,
            path: Vec::new(),
            revision: self.nav.revision as i64,
            speed,
            arrived: false,
            wait: 0.0,
            ..Default::default()
        });
        formation_id
    }

    pub fn enemy_economy(&mut self, dt: f64) {
        let d = data();
        let plan = plan_for(&self.state.difficulty);
        self.state.enemy.think -= dt;
        if self.state.enemy.think > 0.0 {
            return;
        }
        self.state.enemy.think = plan.think;
        let Some(&base) = self.complete_buildings(Some(BKind::Towncenter), 1).first() else { return };
        let ws = self.workers(1);
        let army = self.fighters(1);
        let pop = self.population(1);
        let mut ctx = Ctx { ws, army, used: pop.used, queued: pop.queued, cap: pop.cap, known: Vec::new(), base };
        for &u in &ctx.army {
            if let Some(g) = self.state.units[u].garrison_base {
                if self.get_object(g).is_none() {
                    self.state.units[u].garrison_base = None;
                    self.state.units[u].home = None;
                }
            }
        }
        ctx.known = self.known_buildings(1);
        self.state.enemy.discovered = !ctx.known.is_empty();
        let base_pt = Self::bpt(&self.state.buildings[base]);
        let now = self.state.time;

        let centres = self.complete_buildings(Some(BKind::Towncenter), 1);
        let exhausted = ctx.ws.iter().filter(|&&u| self.state.units[u].job.is_none() && self.state.units[u].order.is_none()).count();
        let mut front_sorted: Vec<&Building> = ctx.known.iter().filter(|k| !matches!(k.kind, BKind::Wall | BKind::Gate)).collect();
        front_sorted.sort_by(|a, b| cmp(dist(Self::bpt(a), base_pt), dist(Self::bpt(b), base_pt)));
        let front: Option<Pt> = front_sorted.first().map(|b| Self::bpt(b));
        if (now > 180.0 || (now > 100.0 && exhausted >= 3))
            && self.complete_buildings(Some(BKind::Towncenter), 1).len() < 4
            && !self.state.buildings.iter().any(|b| b.team == 1 && b.kind == BKind::Towncenter && b.progress < 1.0)
            && ctx.ws.len() >= 8
        {
            let tcs = self.complete_buildings(Some(BKind::Towncenter), 1);
            let mut res: Vec<usize> = self
                .state
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| n.remaining > 0.0 && self.enemy_fog.remembers(n.x, n.y) && tcs.iter().all(|&b| dist(Self::bpt(&self.state.buildings[b]), Pt::new(n.x, n.y)) > 1500.0))
                .map(|(i, _)| i)
                .collect();
            let score = |s: &Sim, n: usize| -> f64 {
                let np = Pt::new(s.state.nodes[n].x, s.state.nodes[n].y);
                dist(np, base_pt) + if front.is_some() && now > 420.0 { dist(np, front.unwrap()) * 0.7 } else { 0.0 }
            };
            res.sort_by(|&a, &b| cmp(score(self, a), score(self, b)));
            if let Some(&r) = res.first() {
                let tc_cost = d.bld(BKind::Towncenter).cost.clone().unwrap();
                if self.afford(&tc_cost, 1) {
                    let rp = Pt::new(self.state.nodes[r].x, self.state.nodes[r].y);
                    for i in 0..32 {
                        let p = Pt::new(rp.x + cos(i as f64 * 2.399) * 300.0, rp.y + sin(i as f64 * 2.399) * 300.0);
                        if !self.valid_site(BKind::Towncenter, p, 1, 0.0, None) {
                            continue;
                        }
                        self.pay(&tc_cost, 1.0, 1);
                        let outpost = self.make_building(BKind::Towncenter, 1, p.x, p.y, 0.0);
                        let oid = outpost.id;
                        self.state.buildings.push(outpost);
                        self.state.nav_dirty = true;
                        let builders = self.idle_builders(&ctx, 3);
                        self.queue_construction(&builders, &[oid], false);
                        break;
                    }
                }
            }
        }
        // (expandDepots runs after labour planning below, matching the JS order.)
        self.tech_ai();
        self.battery_ai(&ctx);
        self.colossus_ai(&ctx);
        let e = &self.state.enemy.resources;
        let surplus = e.food > 400.0 && e.wood > 500.0 && e.stone > 200.0 && e.gold > 300.0;
        if ctx.cap - ctx.used - ctx.queued < if surplus { 10.0 } else { 5.0 } {
            self.ai_build(&ctx, BKind::House, base_pt);
        }
        let worker_goal = 60f64.min(plan.workers + 8.0 * (self.complete_buildings(Some(BKind::Towncenter), 1).len() as f64 - 1.0));
        if (ctx.ws.len() as f64) < worker_goal {
            self.train(&mut ctx, UType::Worker);
            if (ctx.ws.len() as f64) < worker_goal - 4.0 {
                self.train(&mut ctx, UType::Worker);
            }
        }
        for kind in [BKind::Lumbercamp, BKind::Miningcamp, BKind::Mill] {
            if self.complete_buildings(Some(kind), 1).is_empty() {
                self.ai_build(&ctx, kind, base_pt);
            }
        }
        if now > 60.0 {
            self.expand_depots(&ctx, &centres);
        }
        let farms = self.complete_buildings(Some(BKind::Farm), 1).into_iter().filter(|&b| self.state.buildings[b].remaining.unwrap_or(0.0) > 0.0).count();
        if (farms as f64) < (ctx.ws.len() as f64 / if self.state.enemy.resources.food < 300.0 { 4.5 } else { 7.0 }).ceil() {
            self.ai_build(&ctx, BKind::Farm, base_pt);
        }
        if now > 45.0 && ctx.ws.len() >= 6 {
            for s in self.complete_buildings(Some(BKind::Towncenter), 1) {
                self.enemy_fortifications(&ctx, s);
            }
        }
        for kind in [BKind::Barracks, BKind::Stable, BKind::Chapel, BKind::Siegeworkshop] {
            if self.complete_buildings(Some(kind), 1).is_empty() && (kind != BKind::Siegeworkshop || now > 150.0) {
                self.ai_build(&ctx, kind, base_pt);
            }
        }
        if surplus && now > 240.0 && ctx.ws.len() as f64 >= worker_goal * 0.7 {
            for kind in [BKind::Barracks, BKind::Stable, BKind::Siegeworkshop] {
                if (self.complete_buildings(Some(kind), 1).len() as f64) < if kind == BKind::Siegeworkshop { 2.0 } else { 3.0 } && self.ai_build(&ctx, kind, base_pt) {
                    break;
                }
            }
        }
        let tcs: Vec<usize> = self.complete_buildings(Some(BKind::Towncenter), 1);
        for &s in tcs.iter().skip(1) {
            let sp = Self::bpt(&self.state.buildings[s]);
            let sid = self.state.buildings[s].id;
            if !self.complete_buildings(Some(BKind::Barracks), 1).iter().any(|&b| dist(Self::bpt(&self.state.buildings[b]), sp) < 900.0) {
                self.ai_build(&ctx, BKind::Barracks, sp);
            }
            let stationed = ctx.army.iter().filter(|&&u| self.state.units[u].garrison_base == Some(sid)).count();
            let recruits: Vec<usize> = ctx
                .army
                .iter()
                .copied()
                .filter(|&u| {
                    let un = &self.state.units[u];
                    un.scout != Some(true) && un.garrison_base.is_none() && un.order.is_none() && un.target.is_none()
                })
                .take(6usize.saturating_sub(stationed))
                .collect();
            for u in recruits {
                let uid = self.state.units[u].id;
                let home = self.find_free(Pt::new(sp.x + ((uid % 3) as f64 - 1.0) * 90.0, sp.y + 190.0));
                let un = &mut self.state.units[u];
                un.garrison_base = Some(sid);
                un.home = Some(home);
                un.order = Some(Order { x: home.x, y: home.y, attack: Some(true), ..Default::default() });
                un.path_timer = 0.0;
            }
        }
        // Repairs.
        let damaged: Vec<usize> = self
            .complete_buildings(None, 1)
            .into_iter()
            .filter(|&b| {
                let bb = &self.state.buildings[b];
                bb.hp < bb.max_hp * if bb.defence == Some(true) { 0.9 } else { 0.7 }
                    && !ctx.ws.iter().any(|&u| self.state.units[u].job.as_ref().map(|j| j.kind == "repair" && j.target == Some(bb.id)).unwrap_or(false))
            })
            .collect();
        if !damaged.is_empty() && self.state.enemy.resources.wood > 25.0 {
            let mut dm = damaged.clone();
            dm.sort_by(|&a, &b| cmp(self.state.buildings[a].hp / self.state.buildings[a].max_hp, self.state.buildings[b].hp / self.state.buildings[b].max_hp));
            let b = dm[0];
            let bp = Self::bpt(&self.state.buildings[b]);
            let bid = self.state.buildings[b].id;
            let mut cands: Vec<usize> = ctx.ws.iter().copied().filter(|&u| self.state.units[u].job.as_ref().map(|j| j.kind != "build").unwrap_or(true)).collect();
            cands.sort_by(|&a, &c| cmp(dist(self.unit_pt(a), bp), dist(self.unit_pt(c), bp)));
            if let Some(&w) = cands.first() {
                self.state.units[w].job = Some(Job { kind: "repair".into(), target: Some(bid), ..Default::default() });
                self.state.units[w].order = None;
            }
        }
        // Labour follows scarcity.
        let res_order = [Res::Food, Res::Wood, Res::Gold, Res::Stone];
        let stockpile = self.state.enemy.resources;
        let mut need: Vec<(Res, f64)> = res_order.iter().map(|&r| (r, clamp(1.0 - stockpile.get(r) / 900.0, 0.05, 1.0))).collect();
        let need_total: f64 = need.iter().map(|(_, v)| *v).sum();
        let mut desired: Vec<(Res, f64)> = need.iter().map(|&(r, n)| (r, 0.06 + (0.76 * n) / need_total)).collect();
        let mut assignments: Vec<(Res, f64)> = res_order.iter().map(|&r| (r, 0.0)).collect();
        let get = |v: &Vec<(Res, f64)>, r: Res| v.iter().find(|(k, _)| *k == r).unwrap().1;
        for &u in &ctx.ws {
            if let Some(r) = self.state.units[u].job.as_ref().and_then(|j| j.resource) {
                assignments.iter_mut().find(|(k, _)| *k == r).unwrap().1 += 1.0;
            }
        }
        let mut by_need_desc = need.clone();
        by_need_desc.sort_by(|a, b| cmp(b.1, a.1));
        let scarce = by_need_desc[0].0;
        let mut by_need_asc = need.clone();
        by_need_asc.sort_by(|a, b| cmp(a.1, b.1));
        let glut = by_need_asc[0].0;
        if get(&need, scarce) > 0.7 && get(&need, glut) < 0.3 {
            let mover = ctx.ws.iter().copied().find(|&u| {
                let un = &self.state.units[u];
                un.job.as_ref().map(|j| j.kind == "gather" && j.resource == Some(glut)).unwrap_or(false) && !(un.carry > 0.0) && un.flee_until <= now
            });
            if let Some(m) = mover {
                if self.assign_gather(m, scarce, None, None, None) {
                    assignments.iter_mut().find(|(k, _)| *k == glut).unwrap().1 -= 1.0;
                    assignments.iter_mut().find(|(k, _)| *k == scarce).unwrap().1 += 1.0;
                }
            }
        }
        for &u in &ctx.ws {
            {
                let un = &self.state.units[u];
                if let Some(j) = &un.job {
                    if j.kind == "build" {
                        if let Some(t) = j.target.and_then(|t| self.get_object(t)) {
                            if let Obj::Building(bi) = t {
                                if self.state.buildings[bi].progress >= 1.0 {
                                    self.state.units[u].job = None;
                                }
                            }
                        }
                    }
                }
            }
            let un = &self.state.units[u];
            if un.job.is_some() || un.order.is_some() || un.flee_until > now {
                continue;
            }
            let wl = ctx.ws.len().max(1) as f64;
            let mut order: Vec<Res> = res_order.to_vec();
            order.sort_by(|&a, &b| {
                let va = get(&assignments, a) / wl - get(&desired, a);
                let vb = get(&assignments, b) / wl - get(&desired, b);
                cmp(va, vb)
            });
            let resource = order[0];
            let mut tries: Vec<Res> = vec![resource];
            tries.extend(res_order.iter().copied().filter(|&r| r != resource));
            for r in tries {
                if self.assign_gather(u, r, None, None, None) {
                    assignments.iter_mut().find(|(k, _)| *k == r).unwrap().1 += 1.0;
                    break;
                }
            }
        }
        let _ = (&mut need, &mut desired);
        let cycle = [UType::Sword, UType::Archer, UType::Sword, UType::Knight, UType::Archer, UType::Chaplain, UType::Standard, UType::Trebuchet, UType::Ram, UType::Ballista];
        let intel = self.state.enemy.intel.get_or_insert_with(|| {
            let mut m = std::collections::BTreeMap::new();
            m.insert("sword".to_string(), 0.0);
            m.insert("archer".to_string(), 0.0);
            m.insert("knight".to_string(), 0.0);
            m
        });
        for v in intel.values_mut() {
            *v *= 0.85;
        }
        let mut sighted = [0.0f64; 3];
        for e in &self.state.units {
            if e.team == 0 && e.hp > 0.0 && self.enemy_fog.sees(e.x, e.y) {
                match e.ty {
                    UType::Sword => sighted[0] += 1.0,
                    UType::Archer => sighted[1] += 1.0,
                    UType::Knight => sighted[2] += 1.0,
                    _ => {}
                }
            }
        }
        let intel = self.state.enemy.intel.as_mut().unwrap();
        for (i, k) in ["sword", "archer", "knight"].iter().enumerate() {
            let v = intel.get_mut(*k).unwrap();
            *v = v.max(sighted[i]);
        }
        let (i_sword, i_archer, i_knight) = (intel["sword"], intel["archer"], intel["knight"]);
        let seen = i_sword + i_archer + i_knight;
        let counter = |ty: UType, i: usize| -> UType {
            if seen < 6.0 || i % 2 == 1 {
                return ty;
            }
            if ty == UType::Sword && i_archer > seen * 0.4 {
                return UType::Knight;
            }
            if ty == UType::Archer && i_knight > seen * 0.35 {
                return UType::Sword;
            }
            if ty == UType::Knight && i_knight > seen * 0.4 {
                return UType::Sword;
            }
            if ty == UType::Sword && i_sword > seen * 0.55 {
                return UType::Archer;
            }
            ty
        };
        let reps = if self.state.difficulty == "hard" { 4 } else { 2 };
        for i in 0..reps {
            let ty = counter(cycle[(ctx.army.len() + i) % cycle.len()], i);
            self.train(&mut ctx, ty);
        }
        let fort_count = ctx.known.iter().filter(|k| matches!(k.kind, BKind::Wall | BKind::Gate | BKind::Tower | BKind::Watchtower | BKind::Fort)).count();
        // Walls the army cannot walk through call for engines in proportion,
        // more after every failed assault.
        let walled = fort_count > 5;
        let failures0 = self.state.enemy.failures.unwrap_or(0.0);
        if walled && ctx.army.len() >= 6 {
            let limit = 8f64.min(3.0 + (fort_count as f64 / 8.0).floor() + 2f64.min(failures0));
            for (ty, cap) in [(UType::Ram, limit), (UType::Trebuchet, limit.min(4.0)), (UType::Ballista, limit.min(3.0))] {
                let have = ctx.army.iter().filter(|&&u| self.state.units[u].ty == ty).count() as f64;
                if have < cap && self.train(&mut ctx, ty) {
                    break;
                }
            }
        }
        // A failed push against walls earns a temporary forward post: two
        // defense towers just beyond the enemy's reach where engines gather.
        let posts = self.state.buildings.iter().filter(|b| b.team == 1 && b.hp > 0.0 && b.extra.get("forwardPost").and_then(|v| v.as_bool()) == Some(true)).count();
        let post_cost = Cost::of(&[(Res::Wood, 280.0), (Res::Stone, 240.0)]);
        let post_at = self.state.enemy.extra.get("postAt").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if walled && failures0 >= 1.0 && posts < 4 && now >= post_at && ctx.ws.len() >= 8 && self.afford(&post_cost, 1) {
            self.state.enemy.extra.insert("postAt".into(), serde_json::json!(now + 90.0));
            let fort = ctx.known.iter().filter(|k| matches!(k.kind, BKind::Wall | BKind::Gate | BKind::Tower | BKind::Watchtower)).min_by(|a, c| cmp(dist(Self::bpt(a), base_pt), dist(Self::bpt(c), base_pt))).cloned();
            if let Some(fort) = fort {
                let fp = Self::bpt(&fort);
                let back = atan2(base_pt.y - fp.y, base_pt.x - fp.x);
                'post: for distance in [1100.0, 1250.0, 1400.0, 1550.0] {
                    for lateral in [0.0, 240.0, -240.0, 480.0, -480.0] {
                        let p = Pt::new(fp.x + cos(back) * distance + cos(back + std::f64::consts::PI / 2.0) * lateral, fp.y + sin(back) * distance + sin(back + std::f64::consts::PI / 2.0) * lateral);
                        let q = Pt::new(p.x + cos(back + std::f64::consts::PI / 2.0) * 90.0, p.y + sin(back + std::f64::consts::PI / 2.0) * 90.0);
                        if !self.valid_site(BKind::Tower, p, 1, 0.0, None) || !self.valid_site(BKind::Tower, q, 1, 0.0, None) || ctx.known.iter().any(|k| dist(Self::bpt(k), p) < 700.0) {
                            continue;
                        }
                        self.pay(&post_cost, 1.0, 1);
                        let mut ids = Vec::new();
                        for at in [p, q] {
                            let mut b = self.make_building(BKind::Tower, 1, at.x, at.y, 0.0);
                            b.extra.insert("forwardPost".into(), serde_json::json!(true));
                            ids.push(b.id);
                            self.state.buildings.push(b);
                        }
                        self.state.nav_dirty = true;
                        let builders = self.idle_builders(&ctx, 4);
                        self.queue_construction(&builders, &ids, false);
                        break 'post;
                    }
                }
            }
        }
        if self.state.difficulty != "easy" && now > 300.0 {
            for (ty, name) in [(UType::Sword, "sword"), (UType::Archer, "archer"), (UType::Knight, "knight")] {
                let key = format!("{}{}", name, self.rank_for(ty, 1) as i64 + 1);
                let Some(t) = d.tech(&key) else { continue };
                let Some(&b) = self.complete_buildings(Some(t.producer), 1).first() else { continue };
                if self.state.buildings[b].queue.len() < 2
                    && !self.state.buildings.iter().any(|bb| bb.team == 1 && bb.queue.iter().any(|q| q.tech.as_deref() == Some(&format!("{}{}", name, t.rank))))
                    && self.afford(&t.cost, 1)
                {
                    self.pay(&t.cost, 1.0, 1);
                    self.state.buildings[b].queue.push(QueueItem { kind: "research".into(), ty: None, tech: Some(format!("{}{}", name, t.rank)), time: 0.0, duration: t.time, cost: Some(cost_json(&t.cost)), extra: Default::default() });
                    break;
                }
            }
        }
        // Scouts choose unexplored grid sectors.
        let mut scouts: Vec<usize> = ctx.army.iter().copied().filter(|&u| self.state.units[u].scout == Some(true)).collect();
        let scout_limit = match self.state.difficulty.as_str() {
            "hard" => 3usize,
            "easy" => 1,
            _ => 2,
        };
        let recruits: Vec<usize> = ctx
            .army
            .iter()
            .copied()
            .filter(|&u| {
                let un = &self.state.units[u];
                un.scout != Some(true) && un.garrison_base.is_none() && matches!(un.ty, UType::Knight | UType::Archer)
            })
            .take(scout_limit.saturating_sub(scouts.len()))
            .collect();
        for u in recruits {
            let un = &mut self.state.units[u];
            un.scout = Some(true);
            un.squad = None;
            scouts.push(u);
        }
        let (world_w, world_h) = (self.geo.w, self.geo.h);
        let mut reserved: Vec<Pt> = Vec::new();
        for &scout in &scouts {
            let (has_target, order, upt) = {
                let un = &self.state.units[scout];
                (un.target.is_some(), un.order.clone(), Pt::new(un.x, un.y))
            };
            if !has_target && order.as_ref().map(|o| dist(upt, Pt::new(o.x, o.y)) < 90.0).unwrap_or(true) {
                let mut best: Option<Pt> = None;
                let mut score = f64::INFINITY;
                let mut y = 450.0;
                while y < world_h - 200.0 {
                    let mut x = 450.0;
                    while x < world_w - 200.0 {
                        let p = Pt::new(x, y);
                        if !(self.enemy_fog.remembers(p.x, p.y) || reserved.iter().any(|q| dist(*q, p) < 550.0)) {
                            let value = dist(upt, p);
                            if value < score {
                                score = value;
                                best = Some(p);
                            }
                        }
                        x += 650.0;
                    }
                    y += 650.0;
                }
                if let Some(b) = best {
                    reserved.push(b);
                    self.state.enemy.scout += 1.0;
                    let f = self.find_free(b);
                    let un = &mut self.state.units[scout];
                    un.order = Some(Order { x: f.x, y: f.y, attack: Some(false), ..Default::default() });
                    un.path_timer = 0.0;
                }
            }
        }
        // Siege engines at the walls are hunted down first.
        {
            let wall_sides: Vec<Pt> = self.state.buildings.iter().filter(|b| b.team == 1 && b.hp > 0.0 && (matches!(b.kind, BKind::Wall | BKind::Gate | BKind::Bastiongate) || b.wall_attachment.is_some())).map(Self::bpt).collect();
            let mut raiding: Vec<usize> = (0..self.state.units.len())
                .filter(|&i| {
                    let u = &self.state.units[i];
                    u.team == 0 && u.hp > 0.0 && matches!(u.ty, UType::Ram | UType::Ballista | UType::Trebuchet) && self.enemy_fog.sees(u.x, u.y) && wall_sides.iter().any(|b| dist(*b, Pt::new(u.x, u.y)) < 700.0)
                })
                .collect();
            let sortie_at = self.state.enemy.extra.get("sortieAt").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if !raiding.is_empty() && now >= sortie_at {
                self.state.enemy.extra.insert("sortieAt".into(), serde_json::json!(now + 4.0));
                raiding.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), base_pt), dist(self.unit_pt(b), base_pt)));
                let engine = raiding[0];
                let (eid, ep) = (self.state.units[engine].id, self.unit_pt(engine));
                let mut hunters: Vec<usize> = ctx
                    .army
                    .iter()
                    .copied()
                    .filter(|&u| {
                        let un = &self.state.units[u];
                        un.scout != Some(true) && un.garrison_base.is_none() && un.fixed_defense != Some(true) && un.order.as_ref().and_then(|o| o.formation).is_none() && un.hp / un.max_hp > plan.retreat && dist(self.unit_pt(u), ep) < 1800.0
                    })
                    .collect();
                hunters.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), ep), dist(self.unit_pt(b), ep)));
                hunters.truncate(16);
                for u in hunters {
                    let un = &mut self.state.units[u];
                    un.target = Some(eid);
                    un.order = Some(Order { x: ep.x, y: ep.y, attack: Some(true), ..Default::default() });
                    un.path.clear();
                    un.path_goal = None;
                    un.path_request = None;
                    un.home = None;
                }
            }
        }
        let active: Vec<usize> = ctx.army.iter().copied().filter(|&u| self.state.units[u].scout != Some(true)).collect();
        let tcs2 = self.complete_buildings(Some(BKind::Towncenter), 1);
        let mut visible: Vec<usize> = self
            .state
            .units
            .iter()
            .enumerate()
            .filter(|(_, u)| u.team == 0 && self.enemy_fog.sees(u.x, u.y) && tcs2.iter().any(|&b| dist(Pt::new(u.x, u.y), Self::bpt(&self.state.buildings[b])) < 950.0))
            .map(|(i, _)| i)
            .collect();
        if !visible.is_empty() {
            visible.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), base_pt), dist(self.unit_pt(b), base_pt)));
            let target = self.unit_pt(visible[0]);
            let defenders: Vec<usize> = active.iter().copied().filter(|&u| self.state.units[u].order.as_ref().and_then(|o| o.formation).is_none() && dist(self.unit_pt(u), target) < 1200.0).collect();
            if defenders.len() > 2 {
                let id = self.next_uid();
                let center = self.avg_pos(&defenders);
                let destination = self.find_free(target);
                for (i, &u) in defenders.iter().enumerate() {
                    let ty = self.state.units[u].ty;
                    let goal = self.find_free(Pt::new(destination.x + ((i % 5) as f64 - 2.0) * 26.0, destination.y + (i as f64 / 5.0).floor() * 26.0 + if ty == UType::Chaplain { 150.0 } else { 0.0 }));
                    let un = &mut self.state.units[u];
                    un.order = Some(Order { x: goal.x, y: goal.y, attack: Some(true), formation: Some(id), ..Default::default() });
                    un.march_offset = Some(Pt::new(goal.x - destination.x, goal.y - destination.y));
                    un.path.clear();
                    un.path_goal = None;
                    un.path_request = None;
                    un.stuck = 0.0;
                }
                let speed = defenders.iter().map(|&u| d.ty(self.state.units[u].ty).speed).fold(f64::INFINITY, f64::min);
                let rs = self.find_free(center);
                self.state.formations.push(Formation {
                    id,
                    members: defenders.iter().map(|&u| self.state.units[u].id).collect(),
                    anchor: center,
                    route_start: Some(rs),
                    shared_route: Some(true),
                    route_ready: Some(false),
                    destination,
                    path: Vec::new(),
                    revision: self.nav.revision as i64,
                    speed,
                    arrived: false,
                    wait: 0.0,
                    ..Default::default()
                });
            }
            return;
        }
        // An assault presses on while strong and falls back when bled white.
        if let Some(assault) = self.state.enemy.assault.clone() {
            let raiders: Vec<usize> = active.iter().copied().filter(|&u| self.state.units[u].assault == Some(assault.id)).collect();
            let recall = |s: &mut Sim, failed: bool, raiders: &[usize]| {
                for &u in raiders {
                    s.state.units[u].assault = None;
                    if s.state.units[u].ty == UType::Trebuchet {
                        continue;
                    }
                    let uid = s.state.units[u].id;
                    let p = s.find_free(Pt::new(base_pt.x - 100.0 + (uid % 5) as f64 * 30.0, base_pt.y + 150.0));
                    let un = &mut s.state.units[u];
                    un.target = None;
                    un.order = Some(Order { x: p.x, y: p.y, attack: Some(false), ..Default::default() });
                    un.path.clear();
                }
                if failed {
                    s.state.enemy.failures = Some(s.state.enemy.failures.unwrap_or(0.0) + 1.0);
                } else {
                    s.state.enemy.failures = Some(0.0);
                }
                s.state.enemy.assault = None;
            };
            if raiders.is_empty() {
                recall(self, true, &raiders);
            } else if now - assault.at > 300.0 {
                recall(self, false, &raiders);
            } else if now - assault.at > 30.0 && (raiders.len() as f64) < assault.size * 0.35 {
                recall(self, true, &raiders);
            } else if now >= assault.continue_at {
                if let Some(a) = self.state.enemy.assault.as_mut() {
                    a.continue_at = now + 8.0;
                }
                let idle: Vec<usize> = raiders
                    .iter()
                    .copied()
                    .filter(|&u| {
                        let un = &self.state.units[u];
                        un.order.is_none() && un.target.is_none() && un.pending_order.is_none() && un.deployment != "setting-up" && un.deployment != "packing"
                    })
                    .collect();
                if idle.len() as f64 >= 3f64.max(raiders.len() as f64 * 0.5) {
                    let middle = self.avg_pos(&idle);
                    let mut next: Vec<&Building> = ctx.known.iter().filter(|b| b.hp > 0.0).collect();
                    next.sort_by(|a, b| cmp(self.target_weight(a, middle, base_pt), self.target_weight(b, middle, base_pt)));
                    if let Some(n) = next.first() {
                        let n = (*n).clone();
                        self.launch_assault(&idle, &n, middle);
                    } else {
                        recall(self, false, &raiders);
                    }
                }
            }
        }
        let healthy: Vec<usize> = active
            .iter()
            .copied()
            .filter(|&u| {
                let un = &self.state.units[u];
                un.garrison_base.is_none()
                    && un.campaign_post.is_none()
                    && un.fixed_defense != Some(true)
                    && un.curtain_guard != Some(true)
                    && un.regional_mission.is_none()
                    && un.order.as_ref().and_then(|o| o.formation).is_none()
                    && un.hp / un.max_hp > plan.retreat
                    && dist(Pt::new(un.x, un.y), base_pt) < 1200.0
            })
            .collect();
        for &u in &active {
            let un = &self.state.units[u];
            if un.order.is_none() && un.target.is_none() && !un.hold && un.assault.is_none() && un.home.is_none() {
                let uid = un.id;
                let h = self.find_free(Pt::new(base_pt.x - 180.0 + (uid % 6) as f64 * 26.0, base_pt.y + 180.0 + ((uid % 24) as f64 / 6.0).floor() * 26.0));
                self.state.units[u].home = Some(h);
            }
        }
        for &u in &active {
            if self.state.units[u].hp / self.state.units[u].max_hp < plan.retreat {
                let p = self.find_free(Pt::new(base_pt.x - 100.0, base_pt.y + 120.0));
                let un = &mut self.state.units[u];
                un.assault = None;
                un.target = None;
                un.order = Some(Order { x: p.x, y: p.y, attack: Some(false), ..Default::default() });
                un.squad = None;
            }
        }
        let failures = self.state.enemy.failures.unwrap_or(0.0);
        let need_size = crate::js::round(plan.attack * (1.0 + 0.5f64.min(0.15 * failures)));
        if !ctx.known.is_empty()
            && self.state.enemy.assault.is_none()
            && healthy.len() as f64 >= need_size
            && now >= plan.grace
            && now - self.state.enemy.attack > 40.0
        {
            self.state.enemy.attack = now;
            if self.state.enemy.faith >= 30.0 && self.state.difficulty != "easy" {
                self.state.enemy.faith -= 30.0;
                for &u in &healthy {
                    let un = &mut self.state.units[u];
                    un.blessed = 15.0;
                    un.hp = un.max_hp.min(un.hp + 30.0);
                }
            }
            let mut known_sorted: Vec<&Building> = ctx.known.iter().collect();
            known_sorted.sort_by(|a, b| cmp(self.target_weight(a, base_pt, base_pt), self.target_weight(b, base_pt, base_pt)));
            let target = known_sorted[0].clone();
            let center = self.avg_pos(&healthy);
            let mut sorted = healthy.clone();
            sorted.sort_by(|&a, &b| data().ty(self.state.units[a].ty).rank.cmp(&data().ty(self.state.units[b].ty).rank));
            let take = sorted.len().saturating_sub(plan.reserve);
            let group: Vec<usize> = sorted.into_iter().take(take).collect();
            if !group.is_empty() {
                let id = self.launch_assault(&group, &target, center);
                self.state.enemy.assault = Some(Assault { id, size: group.len() as f64, at: now, continue_at: now + 12.0 });
                for &u in &group {
                    self.state.units[u].assault = Some(id);
                }
            }
        }
    }

    pub fn strategic_ai(&mut self, dt: f64) {
        self.enemy_economy(dt);
        self.regional_ai(dt);
    }

    fn regional_company(&mut self, members: &[usize], destination: Pt, base_id: u32) {
        if members.is_empty() {
            return;
        }
        let id = self.next_uid();
        let center = self.avg_pos(members);
        let goal = self.find_free(destination);
        let angle = atan2(goal.y - center.y, goal.x - center.x);
        for (i, &u) in members.iter().enumerate() {
            let ty = self.state.units[u].ty;
            let rear = (i as f64 / 5.0).floor() * 48.0 + if ty == UType::Trebuchet { 380.0 } else { 0.0 };
            let side = ((i % 5) as f64 - 2.0) * 48.0;
            let p = self.find_free(Pt::new(goal.x - cos(angle) * rear - sin(angle) * side, goal.y - sin(angle) * rear + cos(angle) * side));
            let order = Order { x: p.x, y: p.y, attack: Some(true), formation: Some(id), ..Default::default() };
            let un = &mut self.state.units[u];
            un.regional_mission = Some(base_id);
            un.order = Some(order.clone());
            un.march_offset = Some(Pt::new(p.x - goal.x, p.y - goal.y));
            un.path.clear();
            un.path_goal = None;
            un.path_request = None;
            if ty == UType::Trebuchet && un.deployment != "packed" {
                un.deployment = "packing".into();
                un.deploy_timer = 4.0;
                un.pending_order = Some(order);
                un.order = None;
            }
        }
        let speed = members.iter().map(|&u| data().ty(self.state.units[u].ty).speed).fold(f64::INFINITY, f64::min);
        let rs = self.find_free(center);
        self.state.formations.push(Formation {
            id,
            members: members.iter().map(|&u| self.state.units[u].id).collect(),
            anchor: center,
            route_start: Some(rs),
            destination: goal,
            shared_route: Some(true),
            route_ready: Some(false),
            path: Vec::new(),
            revision: self.nav.revision as i64,
            speed,
            arrived: false,
            wait: 0.0,
            ..Default::default()
        });
    }

    pub fn regional_ai(&mut self, dt: f64) {
        let d = data();
        let rt = self.state.regional_think.unwrap_or(0.0) - dt;
        self.state.regional_think = Some(rt);
        if rt > 0.0 {
            return;
        }
        self.state.regional_think = Some(5.0);
        if !self.state.regions.is_object() {
            self.state.regions = serde_json::json!({});
        }
        if !self.state.city_economies.is_object() {
            self.state.city_economies = serde_json::json!({});
        }
        let level = if self.state.mode == "campaign" { self.state.level as f64 } else { 0.0 };
        let scale = plan_for(&self.state.difficulty).think;
        let now = self.state.time;
        let (w, h) = (self.geo.w, self.geo.h);
        let bases: Vec<usize> = (0..self.state.buildings.len())
            .filter(|&i| {
                let b = &self.state.buildings[i];
                b.kind == BKind::Towncenter && (b.team == 1 || b.team == 3) && b.hp > 0.0 && b.progress >= 1.0
            })
            .collect();
        for bi in bases {
            let (bid, bteam, bpos, bcity) = {
                let b = &self.state.buildings[bi];
                (b.id, b.team, Pt::new(b.x, b.y), b.city)
            };
            let city: Option<City> = if bteam == 3 { self.state.cities.iter().find(|c| Some(c.id) == bcity).cloned() } else { None };
            if bteam == 3 && city.as_ref().map(|c| c.captured).unwrap_or(true) {
                continue;
            }
            let key = bid.to_string();
            if self.state.regions.get(&key).is_none() {
                self.state.regions[&key] = serde_json::json!({
                    "patrolAt": now + 70.0 + (bid % 4) as f64 * 12.0,
                    "invasionAt": now + 80f64.max(180.0 - level * 17.0),
                    "phase": 0, "patrols": 0, "invasions": 0
                });
            }
            let troops: Vec<usize> = self
                .fighters(bteam)
                .into_iter()
                .filter(|&u| {
                    let un = &self.state.units[u];
                    (if bteam == 3 { un.city == city.as_ref().map(|c| c.id) } else { un.campaign_post.is_none() })
                        && un.fixed_defense != Some(true)
                        && un.curtain_guard != Some(true)
                        && un.scout != Some(true)
                        && dist(Pt::new(un.x, un.y), bpos) < city.as_ref().map(|c| c.radius).filter(|r| *r != 0.0).unwrap_or(1400.0)
                })
                .collect();
            for &u in &troops {
                let un = &mut self.state.units[u];
                if un.regional_mission == Some(bid) && un.order.is_none() && un.pending_order.is_none() && un.target.is_none() {
                    un.regional_mission = None;
                }
            }
            let mut available: Vec<usize> = troops
                .iter()
                .copied()
                .filter(|&u| {
                    let un = &self.state.units[u];
                    un.order.as_ref().and_then(|o| o.formation).is_none() && un.pending_order.is_none() && un.regional_mission.is_none() && un.hp / un.max_hp > 0.55
                })
                .collect();
            if let Some(c) = &city {
                let ckey = c.id.to_string();
                if self.state.city_economies.get(&ckey).is_none() {
                    self.state.city_economies[&ckey] = serde_json::json!({"food": 700, "wood": 700, "gold": 900, "stone": 500, "time": now, "cycle": 0});
                }
                let eco_time = self.state.city_economies[&ckey]["time"].as_f64().unwrap_or(now);
                let elapsed = 10f64.min(now - eco_time);
                let citizens = self.state.units.iter().filter(|u| u.city == Some(c.id) && u.ty == UType::Civilian && u.hp > 0.0).count() as f64;
                self.state.city_economies[&ckey]["time"] = serde_json::json!(now);
                for (resource, share) in [("food", 0.4), ("wood", 0.25), ("gold", 0.25), ("stone", 0.1)] {
                    let cur = self.state.city_economies[&ckey][resource].as_f64().unwrap_or(0.0);
                    self.state.city_economies[&ckey][resource] = serde_json::json!(3000f64.min(cur + elapsed * citizens * 0.8 * share));
                }
                let live = self.state.units.iter().filter(|u| u.city == Some(c.id) && u.team == 3 && u.hp > 0.0).count() as f64;
                if live < 110.0 + level * 8.0 {
                    let cyc = [UType::Sword, UType::Archer, UType::Sword, UType::Knight, UType::Archer];
                    let cycle_n = self.state.city_economies[&ckey]["cycle"].as_f64().unwrap_or(0.0) as usize;
                    let ty = cyc[cycle_n % cyc.len()];
                    let spec = d.ty(ty);
                    let mut producers: Vec<usize> = (0..self.state.buildings.len())
                        .filter(|&i| {
                            let b = &self.state.buildings[i];
                            b.city == Some(c.id) && b.team == 3 && Some(b.kind) == spec.producer && b.progress >= 1.0 && b.hp > 0.0
                        })
                        .collect();
                    producers.sort_by(|&a, &b| self.state.buildings[a].queue.len().cmp(&self.state.buildings[b].queue.len()));
                    if let Some(&p) = producers.first() {
                        let cost = spec.cost.clone().unwrap();
                        let can = self.state.buildings[p].queue.len() < 2 && cost.0.iter().all(|(r, n)| self.state.city_economies[&ckey][res_name(*r)].as_f64().unwrap_or(0.0) >= *n);
                        if can {
                            for (r, n) in &cost.0 {
                                let cur = self.state.city_economies[&ckey][res_name(*r)].as_f64().unwrap_or(0.0);
                                self.state.city_economies[&ckey][res_name(*r)] = serde_json::json!(cur - n);
                            }
                            self.state.buildings[p].queue.push(QueueItem { kind: "unit".into(), ty: Some(ty), tech: None, time: 0.0, duration: spec.train, cost: Some(cost_json(&cost)), extra: Default::default() });
                            self.state.city_economies[&ckey]["cycle"] = serde_json::json!(cycle_n as f64 + 1.0);
                        }
                    }
                }
            }
            let known: Vec<Building> = {
                let mut v: Vec<Building> = self.known_buildings(if bteam == 3 { 3 } else { 1 }).into_iter().filter(|b| dist(Pt::new(b.x, b.y), bpos) < 6000.0).collect();
                v.sort_by(|a, b| cmp(dist(Pt::new(a.x, a.y), bpos), dist(Pt::new(b.x, b.y), bpos)));
                v
            };
            let reserve = if city.is_some() { 28.0 + level * 4.0 } else { 8.0 };
            let invasion_at = self.state.regions[&key]["invasionAt"].as_f64().unwrap_or(f64::INFINITY);
            if now >= invasion_at && !known.is_empty() && available.len() as f64 >= reserve + 8.0 {
                let size = 24usize.min((available.len() as f64 - reserve) as usize);
                let target = Pt::new(known[0].x, known[0].y);
                available.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), target), dist(self.unit_pt(b), target)));
                let group: Vec<usize> = available.iter().copied().take(size).collect();
                self.regional_company(&group, target, bid);
                let inv = self.state.regions[&key]["invasions"].as_f64().unwrap_or(0.0);
                self.state.regions[&key]["invasions"] = serde_json::json!(inv + 1.0);
                self.state.regions[&key]["invasionAt"] = serde_json::json!(now + 65f64.max(150.0 - level * 10.0) * (scale / 6.0));
                continue;
            }
            let patrol_at = self.state.regions[&key]["patrolAt"].as_f64().unwrap_or(f64::INFINITY);
            if now >= patrol_at && available.len() as f64 >= reserve + 4.0 {
                let phase = self.state.regions[&key]["phase"].as_f64().unwrap_or(0.0);
                self.state.regions[&key]["phase"] = serde_json::json!(phase + 1.0);
                let angle = phase * 1.91 + bid as f64 * 0.17;
                let radius = city.as_ref().map(|c| c.radius).filter(|r| *r != 0.0).unwrap_or(700.0) + 250.0 + 1800f64.min((phase + 1.0) * 220.0);
                let destination = Pt::new(clamp(bpos.x + cos(angle) * radius, 250.0, w - 250.0), clamp(bpos.y + sin(angle) * radius, 250.0, h - 250.0));
                let mut gates: Vec<usize> = (0..self.state.buildings.len())
                    .filter(|&i| {
                        let b = &self.state.buildings[i];
                        b.team == bteam && b.kind == BKind::Gate && b.hp > 0.0 && (if let Some(c) = &city { b.city == Some(c.id) } else { dist(Pt::new(b.x, b.y), bpos) < 1800.0 })
                    })
                    .collect();
                gates.sort_by(|&a, &b| cmp(dist(Self::bpt(&self.state.buildings[a]), destination), dist(Self::bpt(&self.state.buildings[b]), destination)));
                let focus = gates.first().map(|&g| Self::bpt(&self.state.buildings[g])).unwrap_or(destination);
                available.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), focus), dist(self.unit_pt(b), focus)));
                let group: Vec<usize> = available.iter().copied().take(4).collect();
                self.regional_company(&group, destination, bid);
                let pc = self.state.regions[&key]["patrols"].as_f64().unwrap_or(0.0);
                self.state.regions[&key]["patrols"] = serde_json::json!(pc + 1.0);
                self.state.regions[&key]["patrolAt"] = serde_json::json!(now + 55f64.max(110.0 - level * 9.0) * (scale / 6.0));
            }
        }
    }
}

fn res_name(r: Res) -> &'static str {
    match r {
        Res::Food => "food",
        Res::Wood => "wood",
        Res::Gold => "gold",
        Res::Stone => "stone",
    }
}

#[allow(dead_code)]
fn unused(_: Plot, _: Gt, _: Plan) {}
