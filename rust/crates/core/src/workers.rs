//! Villager work: gathering, building and repair, plus civilians and caravans.

use crate::data::data;
use crate::js::{atan2, cos, hypot, round, sin};
use crate::model::*;
use crate::movement::{dist, surface_distance, Target};
use crate::nav::Pt;
use crate::sim::{Obj, Sim};
use crate::world::*;

/// A resource a villager can work: a deposit or a farm building.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Gt {
    Node(usize),
    Farm(usize),
}

fn cmp(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

impl Sim {
    pub fn gt_target(&self, g: Gt) -> Target {
        match g {
            Gt::Node(i) => Target::from_node(&self.state.nodes[i]),
            Gt::Farm(i) => Target::from_building(&self.state.buildings[i]),
        }
    }

    pub fn gt_id(&self, g: Gt) -> u32 {
        match g {
            Gt::Node(i) => self.state.nodes[i].id,
            Gt::Farm(i) => self.state.buildings[i].id,
        }
    }

    pub fn resource_cluster(&self, target: Gt) -> Vec<u32> {
        if let Gt::Farm(i) = target {
            return vec![self.state.buildings[i].id];
        }
        let Gt::Node(ti) = target else { unreachable!() };
        let kind = self.state.nodes[ti].kind;
        let mut members: Vec<usize> = vec![ti];
        let mut ids: Vec<u32> = vec![self.state.nodes[ti].id];
        let mut i = 0;
        while i < members.len() {
            let m = Pt::new(self.state.nodes[members[i]].x, self.state.nodes[members[i]].y);
            for (ni, n) in self.state.nodes.iter().enumerate() {
                if n.kind == kind && !ids.contains(&n.id) && dist(Pt::new(n.x, n.y), m) <= 180.0 {
                    ids.push(n.id);
                    members.push(ni);
                }
            }
            i += 1;
        }
        ids
    }

    pub fn fog_remembers_for(&self, team: i32, x: f64, y: f64) -> bool {
        if team == 0 {
            self.fog.remembers(x, y)
        } else {
            self.enemy_fog.remembers(x, y)
        }
    }

    pub fn assign_depot_gather(&mut self, ui: usize, bi: usize) -> bool {
        let d = data();
        let (team, depot_id, depot_pos) = (self.state.units[ui].team, self.state.buildings[bi].id, Pt::new(self.state.buildings[bi].x, self.state.buildings[bi].y));
        let types: Vec<Res> = d.bld(self.state.buildings[bi].kind).drop.clone().unwrap_or_default();
        let mut candidates: Vec<Gt> = self
            .state
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| types.contains(&n.kind) && n.remaining > 0.0 && self.fog_remembers_for(team, n.x, n.y))
            .map(|(i, _)| Gt::Node(i))
            .collect();
        if types.contains(&Res::Food) {
            for fi in self.complete_buildings(Some(BKind::Farm), team) {
                candidates.push(Gt::Farm(fi));
            }
        }
        let pos = |s: &Sim, g: Gt| -> Pt {
            let t = s.gt_target(g);
            Pt::new(t.x, t.y)
        };
        candidates.sort_by(|&a, &b| cmp(dist(pos(self, a), depot_pos), dist(pos(self, b), depot_pos)));
        let mut found: Option<Gt> = None;
        for c in candidates {
            let t = self.gt_target(c);
            if !self.edge_point(ui, &t, 16.0).1 {
                found = Some(c);
                break;
            }
        }
        let Some(target) = found else { return false };
        let (res, node) = match target {
            Gt::Farm(_) => (Res::Food, target),
            Gt::Node(i) => (self.state.nodes[i].kind, target),
        };
        self.assign_gather(ui, res, Some(node), None, Some(depot_id))
    }

    pub fn workers_on(&self, ui: usize, target_id: u32) -> usize {
        let uid = self.state.units[ui].id;
        self.state.units.iter().filter(|w| w.id != uid && w.job.as_ref().and_then(|j| j.target) == Some(target_id)).count()
    }

    pub fn assign_gather(&mut self, ui: usize, resource: Res, node: Option<Gt>, cluster: Option<Vec<u32>>, depot: Option<u32>) -> bool {
        let team = self.state.units[ui].team;
        let upt = self.unit_pt(ui);
        let target: Option<Gt> = if let Some(n) = node {
            Some(n)
        } else {
            let mut choices: Vec<Gt> = self
                .state
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| n.kind == resource && cluster.as_ref().map(|c| c.contains(&n.id)).unwrap_or(true) && n.remaining > 0.0 && self.fog_remembers_for(team, n.x, n.y))
                .map(|(i, _)| Gt::Node(i))
                .collect();
            if resource == Res::Food {
                for fi in self.complete_buildings(Some(BKind::Farm), team) {
                    let b = &self.state.buildings[fi];
                    if cluster.as_ref().map(|c| c.contains(&b.id)).unwrap_or(true) && self.workers_on(ui, b.id) < 5 {
                        choices.push(Gt::Farm(fi));
                    }
                }
            }
            choices.sort_by(|&a, &b| {
                let ta = self.gt_target(a);
                let tb = self.gt_target(b);
                cmp(dist(upt, ta.pos()), dist(upt, tb.pos()))
            });
            let mut pick: Option<Gt> = None;
            for c in choices {
                let t = self.gt_target(c);
                if !self.edge_point(ui, &t, 16.0).1 {
                    pick = Some(c);
                    break;
                }
            }
            pick
        };
        let blocked_farm = match target {
            Some(Gt::Farm(fi)) => {
                let id = self.state.buildings[fi].id;
                self.workers_on(ui, id) >= 5
            }
            _ => false,
        };
        let Some(target) = target.filter(|_| !blocked_farm) else {
            let u = &mut self.state.units[ui];
            u.job = None;
            u.moving = false;
            u.path.clear();
            u.exhausted_cluster = Some(cluster.is_some());
            return false;
        };
        let cl = match &cluster {
            Some(c) => c.clone(),
            None => self.resource_cluster(target),
        };
        let tid = self.gt_id(target);
        let u = &mut self.state.units[ui];
        u.exhausted_cluster = Some(false);
        u.job = Some(Job {
            kind: "gather".into(),
            depot,
            cluster: Some(cl),
            resource: Some(resource),
            target: Some(tid),
            phase: Some(if u.carry > 0.0 { "deliver".into() } else { "approach".into() }),
            extra: Default::default(),
        });
        u.order = None;
        u.hold = false;
        u.path_timer = 0.0;
        true
    }

    pub fn harvest_spot(&mut self, ui: usize, target: Gt, farm: bool) -> HarvestSpot {
        let t = self.gt_target(target);
        {
            let u = &self.state.units[ui];
            if let Some(hs) = &u.harvest_spot {
                if hs.target == t.id && self.ground_free(hs.x, hs.y, 6.0) {
                    return hs.clone();
                }
            }
        }
        let uid = self.state.units[ui].id;
        let upt = self.unit_pt(ui);
        let reserved: Vec<Pt> = self
            .state
            .units
            .iter()
            .filter(|a| a.id != uid && a.hp > 0.0 && a.job.as_ref().and_then(|j| j.target) == Some(t.id) && a.harvest_spot.as_ref().map(|h| h.target == t.id).unwrap_or(false))
            .map(|a| {
                let h = a.harvest_spot.as_ref().unwrap();
                Pt::new(h.x, h.y)
            })
            .collect();
        let heading = atan2(upt.y - t.y, upt.x - t.x);
        let is_wood = matches!(target, Gt::Node(i) if self.state.nodes[i].kind == Res::Wood);
        let radius = if is_wood { 46.0 } else { (if t.r != 0.0 { t.r } else { 24.0 }) + 12.0 };
        let mut best: Option<Pt> = None;
        let mut score = f64::INFINITY;
        let count = if farm { 5 } else { 24 };
        for i in 0..count {
            let a = heading + (i as f64 * std::f64::consts::PI) / 12.0;
            let p = if farm {
                Pt::new(t.x + (((i % 3) as f64) - 1.0) * t.w * 0.23, t.y + (if i < 3 { -0.22 } else { 0.22 }) * t.h)
            } else {
                Pt::new(t.x + cos(a) * radius, t.y + sin(a) * radius)
            };
            if !self.ground_free(p.x, p.y, 6.0) || reserved.iter().any(|q| dist(p, *q) < 22.0) {
                continue;
            }
            let value = dist(p, upt);
            if value < score {
                score = value;
                best = Some(p);
            }
        }
        let best = match best {
            Some(b) => b,
            None => self.edge_point(ui, &t, 16.0).0,
        };
        let hs = HarvestSpot { x: best.x, y: best.y, target: t.id };
        self.state.units[ui].harvest_spot = Some(hs.clone());
        hs
    }

    pub fn construction_finished(&mut self, ui: usize, bi: usize) {
        let d = data();
        self.state.units[ui].job = None;
        loop {
            let next_id = {
                let u = &mut self.state.units[ui];
                match u.build_queue.as_mut() {
                    Some(q) if !q.is_empty() => Some(q.remove(0)),
                    _ => None,
                }
            };
            let Some(id) = next_id else { break };
            if let Some(Obj::Building(ni)) = self.get_object(id) {
                if self.state.buildings[ni].progress < 1.0 {
                    let u = &mut self.state.units[ui];
                    u.job = Some(Job { kind: "build".into(), target: Some(self.state.buildings[ni].id), ..Default::default() });
                    u.path_timer = 0.0;
                    return;
                }
            }
        }
        let (bkind, bpos, bteam) = {
            let b = &self.state.buildings[bi];
            (b.kind, Pt::new(b.x, b.y), b.team)
        };
        let _ = bteam;
        if d.bld(bkind).drop.is_none() {
            let team = self.state.units[ui].team;
            let upt = self.unit_pt(ui);
            let mut next: Vec<usize> = self
                .state
                .buildings
                .iter()
                .enumerate()
                .filter(|(_, c)| c.team == team && c.hp > 0.0 && c.progress < 1.0 && dist(Pt::new(c.x, c.y), bpos) <= 420.0)
                .map(|(i, _)| i)
                .collect();
            next.sort_by(|&a, &b| cmp(dist(Pt::new(self.state.buildings[a].x, self.state.buildings[a].y), upt), dist(Pt::new(self.state.buildings[b].x, self.state.buildings[b].y), upt)));
            for ci in next {
                let t = Target::from_building(&self.state.buildings[ci]);
                if !self.edge_point(ui, &t, 12.0).1 {
                    let u = &mut self.state.units[ui];
                    u.job = Some(Job { kind: "build".into(), target: Some(t.id), ..Default::default() });
                    u.path_timer = 0.0;
                    u.path_request = None;
                    return;
                }
            }
        }
        if bkind == BKind::Farm {
            if !self.assign_gather(ui, Res::Food, Some(Gt::Farm(bi)), None, None) {
                self.assign_gather(ui, Res::Food, None, None, None);
            }
            return;
        }
        if d.bld(bkind).drop.is_some() {
            self.assign_depot_gather(ui, bi);
        }
    }

    pub fn worker_ai(&mut self, ui: usize, dt: f64) {
        let d = data();
        let (team, uid) = (self.state.units[ui].team, self.state.units[ui].id);
        let threats: Vec<usize> = self
            .nearby(ui, 190.0)
            .into_iter()
            .filter(|&e| {
                let e = &self.state.units[e];
                e.team != team && e.team != 2 && !matches!(e.ty, UType::Chaplain | UType::Trebuchet)
            })
            .collect();
        let stance = if self.state.units[ui].stance.is_empty() { "fight".to_string() } else { self.state.units[ui].stance.clone() };
        if stance != "fight" {
            if self.state.units[ui].order.is_some() {
                self.march_unit(ui, dt);
            }
            return;
        }
        let now = self.state.time;
        let upt = self.unit_pt(ui);
        if !threats.is_empty() {
            self.state.units[ui].flee_until = now + 5.0;
            let mut shelters: Vec<usize> = self
                .complete_buildings(None, team)
                .into_iter()
                .filter(|&b| matches!(self.state.buildings[b].kind, BKind::Towncenter | BKind::Tower))
                .collect();
            shelters.sort_by(|&a, &b| cmp(dist(upt, Pt::new(self.state.buildings[a].x, self.state.buildings[a].y)), dist(upt, Pt::new(self.state.buildings[b].x, self.state.buildings[b].y))));
            if let Some(&si) = shelters.first() {
                let mut t2 = threats.clone();
                t2.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
                let e = self.unit_pt(t2[0]);
                let s = &self.state.buildings[si];
                let a = atan2(s.y - e.y, s.x - e.x);
                let spot = self.find_free(Pt::new(s.x + cos(a) * (s.r + 50.0), s.y + sin(a) * (s.r + 50.0)));
                self.state.units[ui].shelter = Some(spot);
            }
        }
        if self.state.units[ui].flee_until > now {
            if let Some(sh) = self.state.units[ui].shelter {
                self.move_unit(ui, sh, dt, 6.0);
                return;
            }
        }
        if self.state.units[ui].order.is_some() {
            self.march_unit(ui, dt);
            return;
        }
        if self.state.units[ui].job.is_none() || self.state.units[ui].hold {
            return;
        }
        let job = self.state.units[ui].job.clone().unwrap();
        if job.kind == "crew" {
            self.state.units[ui].job = None;
            return;
        }
        if job.kind == "build" || job.kind == "repair" {
            let bi = self.state.buildings.iter().position(|b| Some(b.id) == job.target && b.hp > 0.0 && b.team == team);
            let Some(bi) = bi else {
                self.state.units[ui].job = None;
                return;
            };
            if job.kind == "build" && self.state.buildings[bi].progress >= 1.0 {
                self.construction_finished(ui, bi);
                return;
            }
            let bt = Target::from_building(&self.state.buildings[bi]);
            if surface_distance(upt, &bt) > 14.0 {
                self.build_contact_move(ui, bi, dt);
                return;
            }
            {
                let u = &mut self.state.units[ui];
                u.working = true;
                u.work_phase = Some(u.work_phase.unwrap_or(0.0) + dt);
                if u.work_phase.unwrap() >= 1.0 {
                    u.work_phase = Some(u.work_phase.unwrap() % 1.0);
                    self.events.push(crate::sim::Event::Sound { kind: "build".into(), x: Some(upt.x), y: Some(upt.y), team: Some(team) });
                }
                let (bx, by) = (self.state.buildings[bi].x, self.state.buildings[bi].y);
                self.state.units[ui].angle = atan2(by - upt.y, bx - upt.x);
            }
            if job.kind == "build" {
                if self.state.buildings[bi].progress >= 1.0 {
                    self.construction_finished(ui, bi);
                    return;
                }
                let spec_time = {
                    let b = &self.state.buildings[bi];
                    d.bld(if b.fortified { BKind::Bastionwall } else { b.kind }).time
                };
                let progress = (1.0 - self.state.buildings[bi].progress).min(dt / spec_time);
                {
                    let b = &mut self.state.buildings[bi];
                    b.progress = 1f64.min(b.progress + progress);
                    b.hp = b.max_hp.min(b.hp + b.max_hp * 0.8 * progress);
                }
                if self.state.buildings[bi].progress >= 1.0 {
                    {
                        let b = &mut self.state.buildings[bi];
                        b.hp = b.max_hp.min(round(b.hp * 1000.0) / 1000.0);
                    }
                    self.state.stats.built += 1.0;
                    let bkind = self.state.buildings[bi].kind;
                    if team == 0 {
                        let extra = if bkind == BKind::Colossus { " Select it, then right-click anywhere to fire." } else { "" };
                        self.toast(format!("{} is complete.{}", d.bld(bkind).name, extra));
                    } else if bkind == BKind::Colossus {
                        self.toast("The enemy Colossus is complete. It can now bombard anywhere on the map!");
                        self.sound("horn", None);
                    }
                    self.sound("bell", None);
                    self.construction_finished(ui, bi);
                }
            } else {
                let b = &self.state.buildings[bi];
                if b.hp >= b.max_hp {
                    self.state.units[ui].job = None;
                    return;
                }
                let repair = (10.0 * dt).min(b.max_hp - b.hp);
                if self.stock(team).wood >= repair * 0.08 {
                    self.pay(&Cost::of(&[(Res::Wood, repair * 0.08)]), 1.0, team);
                    self.state.buildings[bi].hp += repair;
                } else {
                    self.state.units[ui].working = false;
                }
            }
            return;
        }
        if job.kind == "clear" {
            let n = job.target.and_then(|id| self.get_object(id));
            let Some(Obj::Node(ni)) = n else {
                self.state.units[ui].job = None;
                return;
            };
            if self.state.nodes[ni].remaining <= 0.0 {
                self.state.units[ui].job = None;
                return;
            }
            let nt = Target::from_node(&self.state.nodes[ni]);
            if surface_distance(upt, &nt) > 60.0 {
                let p = self.edge_point(ui, &nt, 12.0).0;
                self.move_unit(ui, p, dt, 6.0);
                return;
            }
            {
                let kind = self.state.nodes[ni].kind;
                let u = &mut self.state.units[ui];
                u.working = true;
                u.work_phase = Some(u.work_phase.unwrap_or(0.0) + dt);
                u.gather_source = Some(match kind {
                    Res::Wood => "wood",
                    Res::Stone => "stone",
                    Res::Gold => "gold",
                    Res::Food => "food",
                }
                .to_string());
                u.angle = atan2(nt.y - upt.y, nt.x - upt.x);
            }
            let n = &mut self.state.nodes[ni];
            n.remaining = 0f64.max(n.remaining - dt * 45.0);
            if n.remaining == 0.0 {
                self.state.nav_dirty = true;
                self.state.units[ui].job = None;
            }
            return;
        }
        if job.kind == "gather" {
            self.gather_work(ui, dt);
        }
    }

    /// Walk to a free spot beside a structure under construction or repair.
    fn build_contact_move(&mut self, ui: usize, bi: usize, dt: f64) {
        let now = self.state.time;
        let (b_id, bx, by, bw, bh, bfort, wall_line) = {
            let b = &self.state.buildings[bi];
            (b.id, b.x, b.y, b.w, b.h, b.fortified, b.kind == BKind::Wall && b.wall_angle.map(|a| a.is_finite()).unwrap_or(false))
        };
        let need = {
            let u = &self.state.units[ui];
            match &u.build_contact {
                None => true,
                Some(c) => c.target != b_id || c.revision != self.nav.revision as i64 || c.expires < now,
            }
        };
        if need {
            let mut candidates: Vec<Pt> = Vec::new();
            let bt = Target::from_building(&self.state.buildings[bi]);
            if wall_line {
                let arms = wall_arms(self.state.buildings[bi].links.as_ref(), self.state.buildings[bi].wall_angle, 0.0);
                let reach = (if bfort { 24.0 } else { 15.0 }) + 7.0;
                for arm in &arms {
                    let length = {
                        let l = hypot(arm.x, arm.y);
                        if l == 0.0 { 1.0 } else { l }
                    };
                    let ux = arm.x / length;
                    let uy = arm.y / length;
                    for t in [0.3, 0.65, 1.0] {
                        for side in [-1.0, 1.0] {
                            candidates.push(Pt::new(bx + arm.x * t - uy * side * reach, by + arm.y * t + ux * side * reach));
                        }
                    }
                }
                for i in 0..12 {
                    candidates.push(Pt::new(bx + cos((i as f64 * std::f64::consts::PI) / 6.0) * reach, by + sin((i as f64 * std::f64::consts::PI) / 6.0) * reach));
                }
                candidates.retain(|c| self.ground_free(c.x, c.y, 6.0) && surface_distance(*c, &bt) <= 12.0);
            } else {
                let half_w = bw / 2.0;
                let half_h = bh / 2.0;
                for i in 0..24 {
                    let angle = (i as f64 * std::f64::consts::PI) / 12.0;
                    let cx = cos(angle);
                    let cy = sin(angle);
                    let radius = (half_w / 0.01f64.max(cx.abs())).min(half_h / 0.01f64.max(cy.abs())) + 10.0;
                    let p = Pt::new(bx + cx * radius, by + cy * radius);
                    if self.ground_free(p.x, p.y, 6.0) {
                        candidates.push(p);
                    }
                }
            }
            let upt = self.unit_pt(ui);
            candidates.sort_by(|a, c| cmp(dist(upt, *a), dist(upt, *c)));
            let mut point: Option<Pt> = None;
            for c in candidates {
                if self.route_possible(ui, c) {
                    point = Some(c);
                    break;
                }
            }
            self.state.units[ui].build_contact = point.map(|p| BuildContact { x: p.x, y: p.y, target: b_id, revision: self.nav.revision as i64, expires: now + 2.0 });
        }
        let contact = self.state.units[ui].build_contact.clone();
        if let Some(c) = contact {
            self.state.units[ui].build_blocked_at = None;
            self.move_unit(ui, Pt::new(c.x, c.y), dt, 3.0);
        } else {
            let job_target = self.state.units[ui].job.as_ref().and_then(|j| j.target);
            let u = &mut self.state.units[ui];
            u.moving = false;
            if u.build_blocked_at.is_none() {
                u.build_blocked_at = Some(now);
            }
            if now - u.build_blocked_at.unwrap() > 2.5 {
                if let Some(q) = u.build_queue.as_mut() {
                    if !q.is_empty() {
                        if let Some(jt) = job_target {
                            q.push(jt);
                        }
                        let nextid = q.remove(0);
                        u.job = Some(Job { kind: "build".into(), target: Some(nextid), ..Default::default() });
                        u.build_blocked_at = None;
                        u.build_contact = None;
                    }
                }
            }
        }
    }

    fn gather_work(&mut self, ui: usize, dt: f64) {
        let d = data();
        let team = self.state.units[ui].team;
        let upt = self.unit_pt(ui);
        let mut job = self.state.units[ui].job.clone().unwrap();
        let target_obj = job.target.and_then(|id| self.get_object(id));
        if job.cluster.is_none() {
            job.cluster = Some(match target_obj {
                Some(Obj::Node(i)) => self.resource_cluster(Gt::Node(i)),
                Some(Obj::Building(i)) => self.resource_cluster(Gt::Farm(i)),
                _ => Vec::new(),
            });
            self.state.units[ui].job = Some(job.clone());
        }
        let resource = job.resource.unwrap_or(Res::Food);
        let target_gone = match target_obj {
            None => true,
            Some(Obj::Building(i)) => self.state.buildings[i].hp == 0.0,
            Some(Obj::Node(i)) => self.state.nodes[i].remaining == 0.0,
            _ => false,
        };
        let mut target = target_obj;
        if target_gone {
            if self.state.units[ui].carry > 0.0 {
                job.phase = Some("deliver".into());
                self.state.units[ui].job = Some(job.clone());
            } else {
                let cl = job.cluster.clone();
                self.assign_gather(ui, resource, None, cl, job.depot);
                return;
            }
        }
        // A farm only counts as "gone" when destroyed; mirror JS: remaining===0 && kind!=="farm".
        if let Some(Obj::Building(_)) = target {
            // farms keep their record
        }
        let capacity = 16.0;
        let carry = self.state.units[ui].carry;
        let phase = job.phase.clone().unwrap_or_default();
        if phase == "deliver" || carry >= capacity {
            job.phase = Some("deliver".into());
            self.state.units[ui].job = Some(job.clone());
            let carry_type = self.state.units[ui].carry_type.unwrap_or(resource);
            let preferred = job.depot.and_then(|id| self.get_object(id));
            let mut drop: Option<usize> = None;
            if let Some(Obj::Building(pi)) = preferred {
                let b = &self.state.buildings[pi];
                let ok = b.team == team && b.hp > 0.0 && b.progress >= 1.0 && d.bld(b.kind).drop.as_ref().map(|dr| dr.contains(&carry_type)).unwrap_or(false);
                if ok {
                    let t = Target::from_building(&self.state.buildings[pi]);
                    if !self.edge_point(ui, &t, 20.0).1 {
                        drop = Some(pi);
                    }
                }
            }
            if drop.is_none() {
                let mut cands: Vec<usize> = self.complete_buildings(None, team).into_iter().filter(|&bi| d.bld(self.state.buildings[bi].kind).drop.as_ref().map(|dr| dr.contains(&carry_type)).unwrap_or(false)).collect();
                cands.sort_by(|&a, &b| cmp(dist(Pt::new(self.state.buildings[a].x, self.state.buildings[a].y), upt), dist(Pt::new(self.state.buildings[b].x, self.state.buildings[b].y), upt)));
                drop = cands.first().copied();
            }
            let Some(di) = drop else { return };
            let dt_target = Target::from_building(&self.state.buildings[di]);
            let p = self.edge_point(ui, &dt_target, 20.0).0;
            if surface_distance(upt, &dt_target) > 65.0 {
                self.move_unit(ui, p, dt, 6.0);
                return;
            }
            let carry = self.state.units[ui].carry;
            if carry > 0.0 {
                *self.stock_mut(team).get_mut(carry_type) += carry;
                if team == 0 {
                    *self.state.stats.gathered.get_mut(carry_type) += carry;
                } else {
                    *self.state.enemy.gathered.get_mut(carry_type) += carry;
                }
                self.sound("deliver", Some((upt.x, upt.y, team)));
                let u = &mut self.state.units[ui];
                u.carry = 0.0;
                u.carry_type = None;
            }
            if let Some(j) = self.state.units[ui].job.as_mut() {
                j.phase = Some("approach".into());
            }
            self.state.units[ui].path_timer = 0.0;
            return;
        }
        let Some(target_o) = target else {
            self.state.units[ui].job = None;
            return;
        };
        target = Some(target_o);
        let gt = match target_o {
            Obj::Node(i) => Gt::Node(i),
            Obj::Building(i) => Gt::Farm(i),
            _ => {
                self.state.units[ui].job = None;
                return;
            }
        };
        let tt = self.gt_target(gt);
        if self.edge_point(ui, &tt, 16.0).1 {
            let cl = job.cluster.clone();
            self.assign_gather(ui, resource, None, cl, job.depot);
            return;
        }
        let farm = matches!(gt, Gt::Farm(_));
        let work_spot = self.harvest_spot(ui, gt, farm);
        let wp = Pt::new(work_spot.x, work_spot.y);
        if dist(upt, wp) > 8.0 {
            let dd = dist(upt, wp);
            let amount = dd.min(d.ty(UType::Worker).speed * dt);
            let p = Pt::new(upt.x + ((wp.x - upt.x) / dd) * amount, upt.y + ((wp.y - upt.y) / dd) * amount);
            if dd < 110.0 && self.ground_free(p.x, p.y, 6.0) && self.ground_free(wp.x, wp.y, 6.0) {
                let visual = self.visual;
                let u = &mut self.state.units[ui];
                u.angle = atan2(p.y - upt.y, p.x - upt.x);
                u.x = p.x;
                u.y = p.y;
                u.moving = true;
                if visual {
                    u.anim += dt * 10.0;
                }
                return;
            }
            if farm || surface_distance(upt, &tt) > 60.0 {
                let goal = if farm { wp } else { self.edge_point(ui, &tt, 12.0).0 };
                self.move_unit(ui, goal, dt, 6.0);
                return;
            }
        }
        if let Gt::Farm(fi) = gt {
            if self.state.buildings[fi].remaining.unwrap_or(0.0) <= 0.0 {
                let b = &mut self.state.buildings[fi];
                let rr = b.replant_remaining.unwrap_or(8.0);
                b.replant_remaining = Some(0f64.max(rr - dt));
                {
                    let u = &mut self.state.units[ui];
                    u.working = true;
                    u.gather_source = Some("sowing".into());
                    u.work_phase = Some(u.work_phase.unwrap_or(0.0) + dt);
                }
                if self.state.buildings[fi].replant_remaining.unwrap_or(0.0) <= 0.0 {
                    let b = &mut self.state.buildings[fi];
                    b.remaining = Some(b.max.filter(|m| *m != 0.0).unwrap_or(2400.0));
                    b.replant_remaining = None;
                    if team == 0 {
                        self.toast("Grain field replanted. Harvesting resumes.");
                    }
                }
                return;
            }
        }
        {
            let u = &mut self.state.units[ui];
            u.working = true;
            u.gather_source = Some(if farm {
                "farm".to_string()
            } else {
                match resource {
                    Res::Wood => "wood",
                    Res::Stone => "stone",
                    Res::Gold => "gold",
                    Res::Food => "food",
                }
                .to_string()
            });
            u.work_phase = Some(u.work_phase.unwrap_or(0.0) + dt);
            if u.work_phase.unwrap() >= 1.0 {
                u.work_phase = Some(u.work_phase.unwrap() % 1.0);
                let kind = match resource {
                    Res::Wood => "wood",
                    Res::Stone => "stone",
                    Res::Gold => "gold",
                    Res::Food => "food",
                };
                self.events.push(crate::sim::Event::Sound { kind: kind.into(), x: Some(upt.x), y: Some(upt.y), team: Some(team) });
            }
            let tt_pos = Pt::new(tt.x, tt.y);
            self.state.units[ui].angle = atan2(tt_pos.y - upt.y, tt_pos.x - upt.x);
        }
        let near_drop = self.complete_buildings(None, team).into_iter().any(|bi| {
            let b = &self.state.buildings[bi];
            b.kind != BKind::Towncenter && d.bld(b.kind).drop.as_ref().map(|dr| dr.contains(&resource)).unwrap_or(false) && dist(Pt::new(b.x, b.y), Pt::new(tt.x, tt.y)) < 350.0
        });
        let survival = d.levels[self.state.level].kind == "survival" && resource == Res::Food;
        let rate = (if resource == Res::Gold || resource == Res::Stone { 3.0 } else { 3.7 }) * (if near_drop { 1.15 } else { 1.0 }) * (if survival { 0.72 } else { 1.0 });
        let remaining = match gt {
            Gt::Node(i) => self.state.nodes[i].remaining,
            Gt::Farm(i) => self.state.buildings[i].remaining.unwrap_or(0.0),
        };
        let carry_now = self.state.units[ui].carry;
        let amount = (rate * dt).min(capacity - carry_now).min(remaining);
        {
            let u = &mut self.state.units[ui];
            u.carry += amount;
            u.carry_type = Some(resource);
            if let Some(j) = u.job.as_mut() {
                j.phase = Some("harvest".into());
            }
        }
        let new_remaining = 0f64.max(remaining - amount);
        match gt {
            Gt::Node(i) => {
                self.state.nodes[i].remaining = new_remaining;
                if new_remaining == 0.0 && self.state.nodes[i].kind != Res::Food {
                    self.state.nav_dirty = true;
                }
            }
            Gt::Farm(i) => {
                self.state.buildings[i].remaining = Some(new_remaining);
            }
        }
        let _ = target;
        if self.state.units[ui].carry >= capacity - 0.001 || new_remaining == 0.0 {
            if let Some(j) = self.state.units[ui].job.as_mut() {
                j.phase = Some("deliver".into());
            }
            self.state.units[ui].path_timer = 0.0;
        }
    }

    pub fn civilian_ai(&mut self, ui: usize, dt: f64) {
        let d = data();
        let (team, uid) = (self.state.units[ui].team, self.state.units[ui].id);
        let upt = self.unit_pt(ui);
        let threats: Vec<usize> = self
            .nearby(ui, 180.0)
            .into_iter()
            .filter(|&e| {
                let e = &self.state.units[e];
                e.team != team && e.team != 2 && d.ty(e.ty).damage > 0.0
            })
            .collect();
        let now = self.state.time;
        if !threats.is_empty() && now >= self.state.units[ui].flee_at.unwrap_or(0.0) {
            self.state.units[ui].flee_at = Some(now + 0.5);
            let mut t2 = threats.clone();
            t2.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
            let c = self.unit_pt(t2[0]);
            let a = atan2(upt.y - c.y, upt.x - c.x);
            let p = self.find_free(Pt::new(upt.x + cos(a) * 170.0, upt.y + sin(a) * 170.0));
            let u = &mut self.state.units[ui];
            u.order = Some(Order { x: p.x, y: p.y, ..Default::default() });
            u.wander = Some(6.0);
        }
        if let Some(w) = self.state.units[ui].wander.as_mut() {
            *w -= dt;
        }
        let wander = self.state.units[ui].wander;
        if self.state.units[ui].order.is_none() && wander.map(|w| w <= 0.0).unwrap_or(false) {
            let a = (uid as f64 * 1.71 + (now / 9.0).floor()) * 2.4;
            let home = self.state.units[ui].home.unwrap_or(upt);
            let p = self.find_free(Pt::new(home.x + cos(a) * 115.0, home.y + sin(a) * 100.0));
            let u = &mut self.state.units[ui];
            u.order = Some(Order { x: p.x, y: p.y, ..Default::default() });
            u.wander = Some(6.0 + (uid % 6) as f64);
        }
        if let Some(o) = self.state.units[ui].order.clone() {
            if self.move_unit(ui, Pt::new(o.x, o.y), dt, 6.0) {
                self.state.units[ui].order = None;
            }
        }
    }

    pub fn caravan_ai(&mut self, ui: usize, dt: f64) {
        let d = data();
        let upt = self.unit_pt(ui);
        let escort = self.nearby(ui, 220.0).into_iter().any(|a| {
            let a = &self.state.units[a];
            a.team == 0 && !matches!(a.ty, UType::Worker | UType::Chaplain | UType::Trebuchet | UType::Civilian | UType::Pilgrim | UType::Merchant)
        });
        let danger = self.nearby(ui, 260.0).into_iter().any(|a| {
            let a = &self.state.units[a];
            a.team != 0 && a.team != 2 && d.ty(a.ty).damage > 0.0
        }) || self.state.buildings.iter().any(|b| {
            b.team != 0
                && b.team != 2
                && b.hp > 0.0
                && b.progress >= 1.0
                && d.bld(b.kind).damage.map(|x| x != 0.0).unwrap_or(false)
                && dist(Pt::new(b.x, b.y), upt) < d.bld(b.kind).range.unwrap_or(0.0) + 50.0
                && (self.cheat_reveal() || self.fog.sees(b.x, b.y))
        });
        let waiting = !escort || danger;
        self.state.units[ui].escort_waiting = Some(waiting);
        if waiting {
            return;
        }
        let (route, idx, ty) = {
            let u = &self.state.units[ui];
            (u.route.clone().unwrap_or_default(), u.route_index.unwrap_or(0), u.ty)
        };
        let Some(goal) = route.get(idx).copied() else { return };
        if self.move_unit(ui, goal, dt, 35.0) {
            let u = &mut self.state.units[ui];
            u.route_index = Some(idx + 1);
            u.path_timer = 0.0;
            if idx + 1 >= route.len() {
                if ty == UType::Merchant {
                    self.state.stats.delivered = Some(self.state.stats.delivered.unwrap_or(0.0) + 1.0);
                } else {
                    self.state.stats.rescued += 1.0;
                }
                self.toast(if ty == UType::Merchant { "A supply caravan has reached the road settlement." } else { "A pilgrim caravan has reached the refuge." });
                let u = &mut self.state.units[ui];
                u.evacuated = Some(true);
                u.hp = 0.0;
            }
        }
    }
}
