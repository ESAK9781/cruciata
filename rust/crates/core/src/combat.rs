//! Targeting, damage, and the fighting AI (`acquire`, `damage`, `combatAI`,
//! `siegeAI`, `supportAI`, `fire`).

use crate::data::data;
use crate::js::{atan2, cos, hypot, sin};
use crate::model::*;
use crate::movement::{dist, surface_distance, Target};
use crate::nav::Pt;
use crate::sim::{Event, Obj, Sim};
use crate::world::*;
use std::cmp::Ordering;

#[derive(Clone, Copy, Debug)]
pub struct DmgSource {
    pub id: Option<u32>,
    pub team: i32,
    pub ty: Option<UType>,
}

fn cmp(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

impl Sim {
    pub fn obj_target(&self, o: Obj) -> Target {
        match o {
            Obj::Unit(i) => Target::from_unit(&self.state.units[i]),
            Obj::Building(i) => Target::from_building(&self.state.buildings[i]),
            Obj::Node(i) => Target::from_node(&self.state.nodes[i]),
        }
    }

    pub fn obj_id(&self, o: Obj) -> u32 {
        match o {
            Obj::Unit(i) => self.state.units[i].id,
            Obj::Building(i) => self.state.buildings[i].id,
            Obj::Node(i) => self.state.nodes[i].id,
        }
    }

    pub fn obj_is_building(&self, o: Obj) -> bool {
        matches!(o, Obj::Building(_))
    }

    pub fn nearby_structures(&mut self, x: f64, y: f64, team: i32, r: f64) -> Vec<usize> {
        if !self.combat_ready {
            return (0..self.state.buildings.len()).collect();
        }
        let reach = r + self.combat_structure_radius;
        let mut out: Vec<u32> = Vec::new();
        let buildings = &self.state.buildings;
        for (t, tree) in self.combat_structures.iter_mut() {
            if *t != team {
                tree.query(x, y, reach, &|i| (buildings[i as usize].x, buildings[i as usize].y), &mut out);
            }
        }
        out.into_iter().map(|i| i as usize).collect()
    }

    pub fn target_score(&self, ui: usize, ei: usize) -> f64 {
        let u = &self.state.units[ui];
        let e = &self.state.units[ei];
        let d = dist(Pt::new(u.x, u.y), Pt::new(e.x, e.y));
        let mut score = d;
        if u.ty == UType::Knight && matches!(e.ty, UType::Archer | UType::Chaplain | UType::Trebuchet) {
            score -= 115.0;
        }
        if u.ty == UType::Archer && matches!(e.ty, UType::Archer | UType::Chaplain | UType::Standard) {
            score -= 60.0;
        }
        if u.ty == UType::Sword && e.ty == UType::Knight {
            score -= 40.0;
        }
        if e.target == Some(u.id) {
            score -= 55.0;
        }
        if e.hp / e.max_hp < 0.3 {
            score -= 25.0;
        }
        score
    }

    pub fn acquire(&mut self, ui: usize, r: f64) -> Option<Obj> {
        let (stance, hold, team, ty, cdef, has_attack_order, home, ux, uy) = {
            let u = &self.state.units[ui];
            (u.stance.clone(), u.hold, u.team, u.ty, u.city_defender.unwrap_or(false), u.order.as_ref().map(|o| o.attack == Some(true)).unwrap_or(false), u.home, u.x, u.y)
        };
        if stance == "stand-down" {
            return None;
        }
        let may_pursue = (if stance.is_empty() { "fight" } else { stance.as_str() }) == "fight" && !hold;
        let range = data().ty(ty).range;
        let upt = Pt::new(ux, uy);
        let enemies: Vec<usize> = self
            .nearby(ui, r)
            .into_iter()
            .filter(|&ei| {
                let e = &self.state.units[ei];
                e.team != team
                    && e.team != 2
                    && e.ty != UType::Civilian
                    && (may_pursue || surface_distance(upt, &Target::from_unit(e)) <= range + 5.0)
                    && self.observer_sees(team, e.x, e.y)
            })
            .collect();
        let mut best: Option<usize> = None;
        let mut score = f64::INFINITY;
        for ei in enemies {
            let e = &self.state.units[ei];
            if (team == 1 || cdef) && !has_attack_order {
                if let Some(h) = home {
                    if dist(Pt::new(e.x, e.y), h) > 420.0 {
                        continue;
                    }
                }
            }
            let n = self.target_score(ui, ei);
            if n < score {
                best = Some(ei);
                score = n;
            }
        }
        if let Some(b) = best {
            return Some(Obj::Unit(b));
        }
        let mut cands: Vec<usize> = self
            .nearby_structures(ux, uy, team, r)
            .into_iter()
            .filter(|&bi| {
                let b = &self.state.buildings[bi];
                b.team != team
                    && b.team != 2
                    && b.city_center != Some(true)
                    && b.hp > 0.0
                    && dist(upt, Pt::new(b.x, b.y)) < r + b.r
                    && self.observer_sees(team, b.x, b.y)
                    && (may_pursue || surface_distance(upt, &Target::from_building(b)) <= range + 15.0)
            })
            .collect();
        cands.sort_by(|&a, &b| cmp(dist(Pt::new(self.state.buildings[a].x, self.state.buildings[a].y), upt), dist(Pt::new(self.state.buildings[b].x, self.state.buildings[b].y), upt)));
        cands.first().map(|&i| Obj::Building(i))
    }

    pub fn projectile(&mut self, sx: f64, sy: f64, team: i32, ty: UType, target: Obj, damage: f64) {
        let tp = self.obj_pos(target);
        let tid = self.obj_id(target);
        self.state.arrows.push(Arrow { x: sx, y: sy, tx: tp.x, ty: tp.y, target: Some(tid), team, damage, siege: ty == UType::Ballista, life: 2.5, sx, sy, extra: Default::default() });
    }

    pub fn raise_alert(&mut self, x: f64, y: f64, kind: Option<BKind>) {
        let alerts = self.state.alerts.get_or_insert_with(Vec::new);
        let near = alerts.iter_mut().find(|a| {
            let ax = a.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let ay = a.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            hypot(ax - x, ay - y) < 500.0
        });
        match near {
            Some(a) => {
                a["t"] = serde_json::json!(0);
                a["x"] = serde_json::json!(x);
                a["y"] = serde_json::json!(y);
            }
            None => alerts.push(serde_json::json!({"x": x, "y": y, "t": 0})),
        }
        self.events.push(Event::Alert { x, y, kind });
    }

    /// `damage(target, amount, source, siege)`.
    pub fn damage(&mut self, target: Obj, amount: f64, source: Option<DmgSource>, siege: bool) {
        let d = data();
        if self.cheat_invulnerable() && self.obj_team(target) == 0 {
            return;
        }
        let (hp, team) = (self.obj_hp(target), self.obj_team(target));
        if hp <= 0.0 || team == 2 {
            return;
        }
        if let Obj::Building(bi) = target {
            let b = &self.state.buildings[bi];
            if b.city_center == Some(true) && !self.state.cities.iter().find(|c| Some(c.id) == b.city).map(|c| c.captured).unwrap_or(false) {
                return;
            }
        }
        let (kind, fortified, blessed) = match target {
            Obj::Building(bi) => {
                let b = &self.state.buildings[bi];
                (Some(b.kind), b.kind == BKind::Wall || b.kind == BKind::Gate || b.gate == Some(true) || b.wall_attachment.is_some(), 0.0)
            }
            Obj::Unit(ui) => (None, false, self.state.units[ui].blessed),
            _ => return,
        };
        let armored = if fortified {
            if siege {
                3.0
            } else if source.and_then(|s| s.ty) == Some(UType::Archer) {
                0.035
            } else {
                0.12
            }
        } else if kind == Some(BKind::Fort) {
            if siege {
                0.95
            } else {
                0.22
            }
        } else {
            1.0
        };
        let dmg = amount * armored * if blessed > 0.0 { 0.75 } else { 1.0 };
        match target {
            Obj::Building(bi) => self.state.buildings[bi].hp -= dmg,
            Obj::Unit(ui) => self.state.units[ui].hp -= dmg,
            _ => {}
        }
        let tpos = self.obj_pos(target);
        if team == 0 {
            if let Some(s) = source {
                if s.team != 0 && s.team != 2 && amount > 0.0 {
                    let k = if let Obj::Building(bi) = target { Some(self.state.buildings[bi].kind) } else { None };
                    self.raise_alert(tpos.x, tpos.y, k);
                }
            }
        }
        if kind == Some(BKind::Fort) && siege && source.map(|s| s.team) == Some(0) {
            self.state.stats.siege_hits += 1.0;
        }
        if let Obj::Unit(ui) = target {
            let now = self.state.time;
            let u = &mut self.state.units[ui];
            u.last_attacker = source.and_then(|s| s.id);
            u.last_hit = Some(now);
        }
        if self.obj_hp(target) > 0.0 {
            return;
        }
        match target {
            Obj::Building(bi) => self.state.buildings[bi].hp = 0.0,
            Obj::Unit(ui) => self.state.units[ui].hp = 0.0,
            _ => {}
        }
        if let Obj::Building(bi) = target {
            self.state.nav_combat = true;
            let (bid, bteam, bkind) = {
                let b = &self.state.buildings[bi];
                (b.id, b.team, b.kind)
            };
            if self.is_capital(bi) {
                self.finish(bteam != 0);
                return;
            }
            if bid == self.state.buildings[0].id {
                self.finish(false);
                return;
            }
            if self.state.buildings.get(1).map(|b| b.id) == Some(bid) && d.levels[self.state.level].kind == "occupation" {
                self.state.citadel_taken = bteam != 0;
                self.state.occupation = 0.0;
                let taken = self.state.citadel_taken;
                {
                    let b = &mut self.state.buildings[bi];
                    b.team = if taken { 0 } else { 1 };
                    b.hp = 1600.0;
                    b.max_hp = 1600.0;
                    b.queue = Vec::new();
                }
                if taken {
                    self.state.wave_timer = self.state.wave_timer.min(12.0);
                }
                self.toast(if taken {
                    "The citadel is taken. Secure the holy sites and prepare for the counterattack!"
                } else {
                    "The citadel has been retaken. Regroup and recover it!"
                });
                self.sound("horn", None);
            } else {
                self.toast(format!("{} has fallen.", d.bld(bkind).name));
            }
            self.sound("collapse", Some((tpos.x, tpos.y, bteam)));
            return;
        }
        if let Obj::Unit(ui) = target {
            if team == 0 {
                self.state.losses += 1.0;
            } else if team == 1 {
                self.state.kills += 1.0;
            }
            if self.settings.gore {
                let u = &self.state.units[ui];
                let corpse = serde_json::json!({"x": u.x, "y": u.y, "angle": u.angle, "shattered": siege, "rank": u.rank.unwrap_or(0.0), "type": u.ty, "team": u.team, "t": 0});
                self.state.corpses.push(corpse);
                let r = 12.0 + self.rng.next() * 12.0;
                let (ux, uy) = (u.x, u.y);
                self.state.marks.push(serde_json::json!({"x": ux, "y": uy, "r": r, "t": 0}));
            }
        }
    }

    pub fn fire(&mut self, ui: usize, target: Obj) {
        let d = data();
        if self.state.units[ui].stance == "stand-down" {
            return;
        }
        let (ux, uy, ty, team) = {
            let u = &self.state.units[ui];
            (u.x, u.y, u.ty, u.team)
        };
        let tp = self.obj_pos(target);
        let aim = atan2(tp.y - uy, tp.x - ux);
        {
            let u = &mut self.state.units[ui];
            u.aim_angle = Some(aim);
            u.angle = aim;
            u.cooldown = d.ty(ty).cooldown;
            u.strike = 0.35;
        }
        let rank = self.state.units[ui].rank.unwrap_or(0.0);
        let mut n = d.ty(ty).damage * (1.0 + rank * 0.25);
        let is_building = self.obj_is_building(target);
        let charge = ty == UType::Knight
            && !is_building
            && self.state.units[ui].run_up.unwrap_or(0.0) > 170.0
            && self.state.time - self.state.units[ui].run_at.unwrap_or(-9.0) < 0.5;
        if charge {
            n *= 1.6;
            self.state.units[ui].run_up = Some(0.0);
        }
        if self.state.units[ui].blessed > 0.0 {
            n *= 1.25;
        }
        if self.stock(team).food < 1.0 {
            n *= 0.75;
        }
        let standard_near = self.nearby(ui, 180.0).into_iter().any(|a| self.state.units[a].team == team && self.state.units[a].ty == UType::Standard);
        if standard_near {
            n *= 1.12;
        }
        if ty == UType::Archer || ty == UType::Ballista {
            self.projectile(ux, uy, team, ty, target, n);
        } else {
            let id = self.state.units[ui].id;
            self.damage(target, n, Some(DmgSource { id: Some(id), team, ty: Some(ty) }), ty == UType::Ram || ty == UType::Ballista);
        }
        self.sound(if ty == UType::Archer { "arrow" } else { "hit" }, Some((ux, uy, team)));
    }

    pub fn combat_ai(&mut self, ui: usize, dt: f64) {
        let d = data();
        let (stance, ty, team) = {
            let u = &self.state.units[ui];
            (u.stance.clone(), u.ty, u.team)
        };
        if stance == "stand-down" && !matches!(ty, UType::Chaplain | UType::Trebuchet) {
            let u = &mut self.state.units[ui];
            u.target = None;
            u.manual_target = false;
            if u.order.is_some() {
                self.march_unit(ui, dt);
            }
            return;
        }
        if ty == UType::Chaplain {
            self.support_ai(ui, dt);
            return;
        }
        if ty == UType::Trebuchet {
            self.siege_ai(ui, dt);
            return;
        }
        self.clear_invalid_manual_target(ui);
        let upt = self.unit_pt(ui);
        let mut target: Option<Obj> = self.state.units[ui].target.and_then(|id| self.get_object(id));
        let manual = self.state.units[ui].manual_target;
        if let Some(t) = target {
            let tp = self.obj_pos(t);
            let tteam = self.obj_team(t);
            if tteam == team || tteam == 2 || (!manual && !self.observer_sees(team, tp.x, tp.y)) || (dist(upt, tp) > 650.0 && !manual) {
                target = None;
            }
        }
        let hold = self.state.units[ui].hold;
        let stance_eff = if stance.is_empty() { "fight".to_string() } else { stance.clone() };
        let autonomous = stance_eff == "fight" && !hold;
        let range = d.ty(ty).range;
        if !autonomous && !manual {
            if let Some(t) = target {
                let tg = self.obj_target(t);
                if surface_distance(upt, &tg) > range + if self.obj_is_building(t) { 15.0 } else { 5.0 } {
                    target = None;
                }
            }
        }
        if team == 1 && self.state.units[ui].scout == Some(true) {
            self.state.units[ui].target = None;
            let danger = {
                let mut c: Vec<usize> = self
                    .nearby(ui, 290.0)
                    .into_iter()
                    .filter(|&ei| {
                        let e = &self.state.units[ei];
                        e.team == 0 && d.ty(e.ty).damage > 0.0 && self.enemy_fog.sees(e.x, e.y)
                    })
                    .collect();
                c.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
                c.first().copied()
            };
            if let Some(di) = danger {
                let dp = self.unit_pt(di);
                let a = atan2(upt.y - dp.y, upt.x - dp.x);
                let goal = self.find_free(Pt::new(upt.x + cos(a) * 240.0, upt.y + sin(a) * 240.0));
                self.move_unit(ui, goal, dt, 6.0);
                self.state.units[ui].order = None;
            } else if self.state.units[ui].order.is_some() {
                self.march_unit(ui, dt);
            }
            return;
        }
        let (order, last_hit, uid) = {
            let u = &self.state.units[ui];
            (u.order.clone(), u.last_hit, u.id)
        };
        let now = self.state.time;
        let committed = team == 0 && order.as_ref().map(|o| o.attack != Some(true)).unwrap_or(false);
        let arriving = order.as_ref().map(|o| dist(upt, Pt::new(o.x, o.y)) < if committed { 48.0 } else { 200.0 }).unwrap_or(false);
        let recently_hit2 = last_hit.map(|h| h > now - 2.0).unwrap_or(false);
        let engage = order.is_none() || order.as_ref().unwrap().attack == Some(true) || arriving || (!committed && recently_hit2);
        if target.is_none() && engage {
            let formation = order.as_ref().and_then(|o| o.formation).and_then(|f| self.state.formations.iter().find(|x| x.id == f && !x.arrived)).cloned();
            let r = if arriving && order.as_ref().map(|o| o.attack != Some(true)).unwrap_or(true) {
                range + 35.0
            } else if formation.is_some() {
                220f64.min(range + 50.0)
            } else {
                310.0
            };
            let acquire_at = {
                let u = &mut self.state.units[ui];
                if u.acquire_at.is_none() {
                    u.acquire_at = Some(if u.order.is_some() { now + (uid % 13) as f64 * 0.016 } else { 0.0 });
                }
                u.acquire_at.unwrap()
            };
            let near_anchor = formation.as_ref().map(|f| dist(upt, f.anchor) < 270.0).unwrap_or(true);
            let hit_recent = last_hit.map(|h| h > now - 2.0).unwrap_or(false);
            let hit_very_recent = last_hit.map(|h| h > now - 0.5).unwrap_or(false);
            if (near_anchor || hit_recent) && (now >= acquire_at || hit_very_recent) {
                self.state.units[ui].acquire_at = Some(now + 0.2 + (uid % 11) as f64 * 0.025);
                target = self.acquire(ui, if !autonomous { range + 35.0 } else { r });
            }
            if !autonomous {
                if let Some(t) = target {
                    let tg = self.obj_target(t);
                    if surface_distance(upt, &tg) > range + if self.obj_is_building(t) { 15.0 } else { 5.0 } {
                        target = None;
                    }
                }
            }
        }
        if let Some(t) = target {
            if ty == UType::Archer {
                let tp = self.obj_pos(t);
                self.state.units[ui].aim_angle = Some(atan2(tp.y - upt.y, tp.x - upt.x));
            }
        }
        if let Some(t) = target {
            if ty == UType::Archer && autonomous && !manual {
                let threat = {
                    let mut c: Vec<usize> = self
                        .nearby(ui, 100.0)
                        .into_iter()
                        .filter(|&ei| {
                            let e = &self.state.units[ei];
                            e.team != team && e.team != 2 && matches!(e.ty, UType::Sword | UType::Knight)
                        })
                        .collect();
                    c.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
                    c.first().copied()
                };
                if let Some(thi) = threat {
                    let tp = self.obj_pos(t);
                    if dist(upt, tp) < 225.0 && self.state.units[ui].cooldown <= 0.0 {
                        self.fire(ui, t);
                    }
                    let allies = {
                        let mut c: Vec<usize> = self
                            .nearby(ui, 300.0)
                            .into_iter()
                            .filter(|&ai| {
                                let a = &self.state.units[ai];
                                a.team == team && matches!(a.ty, UType::Sword | UType::Knight)
                            })
                            .collect();
                        c.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
                        c
                    };
                    let anchor = allies.first().map(|&i| self.unit_pt(i)).unwrap_or(upt);
                    let thp = self.unit_pt(thi);
                    let a = atan2(anchor.y - thp.y, anchor.x - thp.x);
                    let goal = self.find_free(Pt::new(anchor.x + cos(a) * 130.0, anchor.y + sin(a) * 130.0));
                    self.move_unit(ui, goal, dt, 6.0);
                    let tid = self.obj_id(t);
                    self.state.units[ui].target = Some(tid);
                    return;
                }
            }
        }
        self.state.units[ui].target = target.map(|t| self.obj_id(t));
        if let Some(t) = target {
            let is_b = self.obj_is_building(t);
            let range_eff = range + if is_b { 15.0 } else { 5.0 };
            let tp = self.obj_pos(t);
            let tt = self.obj_target(t);
            let dd = if is_b {
                hypot(((upt.x - tp.x).abs() - tt.w / 2.0).max(0.0), ((upt.y - tp.y).abs() - tt.h / 2.0).max(0.0))
            } else {
                dist(upt, tp)
            };
            self.state.units[ui].angle = atan2(tp.y - upt.y, tp.x - upt.x);
            if dd <= range_eff {
                if self.state.units[ui].cooldown <= 0.0 {
                    self.fire(ui, t);
                }
            } else if autonomous || manual {
                let mut goal = if is_b { self.edge_point(ui, &tt, 16.0).0 } else { tp };
                if ty == UType::Knight && !is_b {
                    let tty = if let Obj::Unit(ti) = t { Some(self.state.units[ti].ty) } else { None };
                    if matches!(tty, Some(UType::Archer | UType::Chaplain | UType::Trebuchet)) && dd > 90.0 {
                        let a = atan2(tp.y - upt.y, tp.x - upt.x) + (if uid % 2 == 1 { 1.0 } else { -1.0 }) * 0.6;
                        goal = Pt::new(tp.x - cos(a) * 55.0, tp.y - sin(a) * 55.0);
                    }
                }
                self.move_unit(ui, goal, dt, 6.0);
            }
            return;
        }
        self.state.units[ui].manual_target = false;
        if self.state.units[ui].order.is_some() {
            self.march_unit(ui, dt);
        } else if autonomous && (team == 1 || self.state.units[ui].city_defender == Some(true)) {
            if let Some(h) = self.state.units[ui].home {
                if dist(upt, h) > 60.0 {
                    self.move_unit(ui, h, dt, 6.0);
                }
            }
        }
    }

    /// A manual target that is gone (or friendly) is dropped along with the order.
    pub fn clear_invalid_manual_target(&mut self, ui: usize) {
        let (manual, tid, team) = {
            let u = &self.state.units[ui];
            (u.manual_target, u.target, u.team)
        };
        if !manual {
            return;
        }
        let commanded = tid.and_then(|id| self.get_object(id));
        let bad = match commanded {
            None => true,
            Some(o) => self.obj_team(o) == team || self.obj_team(o) == 2,
        };
        if bad {
            let u = &mut self.state.units[ui];
            u.manual_target = false;
            u.target = None;
            u.order = None;
            u.pending_order = None;
            u.fire_target = None;
        }
    }

    pub fn siege_ai(&mut self, ui: usize, dt: f64) {
        let d = data();
        {
            let u = &mut self.state.units[ui];
            if u.deployment == "setting-up" || u.deployment == "packing" {
                u.deploy_timer -= dt;
                if u.deploy_timer <= 0.0 {
                    if u.deployment == "setting-up" {
                        u.deployment = "deployed".into();
                        u.cooldown = u.cooldown.max(1.0);
                    } else {
                        u.deployment = "packed".into();
                        u.order = u.pending_order.take();
                    }
                    u.path_timer = 0.0;
                }
                return;
            }
            if u.stance == "stand-down" {
                u.target = None;
                u.fire_target = None;
                if u.deployment == "packed" && u.order.is_some() {
                    self.march_unit(ui, dt);
                }
                return;
            }
        }
        self.clear_invalid_manual_target(ui);
        let upt = self.unit_pt(ui);
        let (team, uid, manual) = {
            let u = &self.state.units[ui];
            (u.team, u.id, u.manual_target)
        };
        let mut target: Option<Obj> = self.state.units[ui].target.and_then(|id| self.get_object(id));
        if let Some(t) = target {
            let tp = self.obj_pos(t);
            if self.obj_team(t) == team || self.obj_team(t) == 2 || (!manual && !self.observer_sees(team, tp.x, tp.y)) {
                target = None;
            }
        }
        let deployment = self.state.units[ui].deployment.clone();
        if deployment == "deployed" {
            if self.state.units[ui].hold {
                return;
            }
            // A fire target is a bare ground point.
            let mut point: Option<Pt> = self.state.units[ui].fire_target;
            let mut tpos: Option<Pt> = if let Some(fp) = point { Some(fp) } else { target.map(|t| self.obj_pos(t)) };
            if point.is_some() {
                target = None;
            }
            if let Some(tp) = tpos {
                if manual && (dist(upt, tp) < 180.0 || dist(upt, tp) > 690.0) {
                    if team == 0 {
                        return;
                    }
                    let u = &mut self.state.units[ui];
                    u.deployment = "packing".into();
                    u.deploy_timer = 4.0;
                    u.pending_order = Some(Order { x: tp.x, y: tp.y, attack: Some(true), ..Default::default() });
                    return;
                }
                if dist(upt, tp) < 180.0 || dist(upt, tp) > 690.0 {
                    tpos = None;
                    target = None;
                    point = None;
                }
            }
            let _ = point;
            if tpos.is_none() {
                // Nearest hostile structure in range, else the thickest cluster.
                let mut bs: Vec<usize> = (0..self.state.buildings.len())
                    .filter(|&bi| {
                        let b = &self.state.buildings[bi];
                        b.team != team && b.team != 2 && b.hp > 0.0 && self.observer_sees(team, b.x, b.y) && dist(upt, Pt::new(b.x, b.y)) < d.ty(UType::Trebuchet).range && dist(upt, Pt::new(b.x, b.y)) > 180.0
                    })
                    .collect();
                bs.sort_by(|&a, &b| cmp(dist(Pt::new(self.state.buildings[a].x, self.state.buildings[a].y), upt), dist(Pt::new(self.state.buildings[b].x, self.state.buildings[b].y), upt)));
                if let Some(&bi) = bs.first() {
                    tpos = Some(Pt::new(self.state.buildings[bi].x, self.state.buildings[bi].y));
                    target = Some(Obj::Building(bi));
                } else {
                    let mut es: Vec<usize> = self
                        .nearby(ui, 690.0)
                        .into_iter()
                        .filter(|&ei| {
                            let e = &self.state.units[ei];
                            e.team != team && e.team != 2 && self.observer_sees(team, e.x, e.y) && dist(upt, Pt::new(e.x, e.y)) > 180.0
                        })
                        .collect();
                    // Sort by how many of its own side stand near each candidate (descending).
                    let counts: Vec<(usize, usize)> = es
                        .iter()
                        .map(|&e| {
                            let p = self.unit_pt(e);
                            let t = self.state.units[e].team;
                            let n = self.nearby_at(p.x, p.y, 85.0).into_iter().filter(|&c| self.state.units[c].team == t).count();
                            (e, n)
                        })
                        .collect();
                    es.sort_by(|&a, &b| {
                        let ca = counts.iter().find(|(e, _)| *e == a).unwrap().1 as i64;
                        let cb = counts.iter().find(|(e, _)| *e == b).unwrap().1 as i64;
                        cb.cmp(&ca)
                    });
                    if let Some(&e) = es.first() {
                        tpos = Some(self.unit_pt(e));
                        target = Some(Obj::Unit(e));
                    }
                }
            }
            if let Some(tp) = tpos {
                if dist(upt, tp) >= 180.0 && dist(upt, tp) <= 690.0 && self.state.units[ui].cooldown <= 0.0 {
                    let rank = self.state.units[ui].rank.unwrap_or(0.0);
                    {
                        let u = &mut self.state.units[ui];
                        u.angle = atan2(tp.y - upt.y, tp.x - upt.x);
                        u.cooldown = 8.0;
                        u.strike = 1.0;
                    }
                    self.state.boulders.push(Boulder {
                        x: upt.x,
                        y: upt.y,
                        tx: tp.x,
                        ty: tp.y,
                        sx: upt.x,
                        sy: upt.y,
                        t: 0.0,
                        duration: 2.1,
                        heavy: false,
                        team,
                        source: Some(uid),
                        damage: 135.0 * (1.0 + rank * 0.25),
                        r: 100.0,
                        lift: Some(75.0),
                        hit: None,
                        extra: Default::default(),
                    });
                    self.sound("siege", Some((upt.x, upt.y, team)));
                }
            }
            return;
        }
        if let Some(order) = self.state.units[ui].order.clone() {
            let stance_eff = if self.state.units[ui].stance.is_empty() { "fight".to_string() } else { self.state.units[ui].stance.clone() };
            if order.attack == Some(true) && (team == 1 || manual) && stance_eff == "fight" {
                if target.is_none() {
                    target = self.acquire(ui, 690.0);
                }
                if let Some(t) = target {
                    let tp = self.obj_pos(t);
                    let dd = dist(upt, tp);
                    if dd < 620.0 && dd > 210.0 && team != 0 {
                        let tid = self.obj_id(t);
                        let u = &mut self.state.units[ui];
                        u.target = Some(tid);
                        u.deployment = "setting-up".into();
                        u.deploy_timer = 6.0;
                        u.order = None;
                        u.path.clear();
                        return;
                    }
                    let a = atan2(upt.y - tp.y, upt.x - tp.x);
                    let goal = self.find_free(Pt::new(tp.x + cos(a) * 540.0, tp.y + sin(a) * 540.0));
                    self.move_unit(ui, goal, dt, 6.0);
                    return;
                }
            }
            self.march_unit(ui, dt);
        }
    }

    pub fn support_ai(&mut self, ui: usize, dt: f64) {
        let d = data();
        let (team, uid) = {
            let u = &self.state.units[ui];
            (u.team, u.id)
        };
        let upt = self.unit_pt(ui);
        let friendly: Vec<usize> = self.nearby(ui, 650.0).into_iter().filter(|&a| self.state.units[a].team == team && self.state.units[a].hp > 0.0).collect();
        let threats: Vec<usize> = self
            .nearby(ui, 300.0)
            .into_iter()
            .filter(|&e| {
                let e = &self.state.units[e];
                e.team != team && e.team != 2 && d.ty(e.ty).damage > 0.0
            })
            .collect();
        let heal_range = d.ty(UType::Chaplain).range;
        let mut wounded: Vec<usize> = friendly.iter().copied().filter(|&a| self.state.units[a].hp < self.state.units[a].max_hp && dist(upt, self.unit_pt(a)) < heal_range).collect();
        wounded.sort_by(|&a, &b| {
            let ua = &self.state.units[a];
            let ub = &self.state.units[b];
            let sa = ua.hp / ua.max_hp - if ua.ty == UType::Sword { 0.08 } else { 0.0 };
            let sb = ub.hp / ub.max_hp - if ub.ty == UType::Sword { 0.08 } else { 0.0 };
            cmp(sa, sb)
        });
        if !wounded.is_empty() && self.state.units[ui].cooldown <= 0.0 {
            let ai = wounded[0];
            let rank = self.state.units[ui].rank.unwrap_or(0.0);
            let amount = (16.0 * (1.0 + rank * 0.25)).min(self.state.units[ai].max_hp - self.state.units[ai].hp);
            self.state.units[ai].hp += amount;
            self.state.healed += amount;
            self.state.units[ui].cooldown = 1.5;
            let ap = self.unit_pt(ai);
            self.state.rings.push(serde_json::json!({"x": ap.x, "y": ap.y, "t": 0, "color": "#ebd18a", "r": 15}));
        }
        let fighters_near: Vec<usize> = friendly
            .iter()
            .copied()
            .filter(|&a| !matches!(self.state.units[a].ty, UType::Worker | UType::Chaplain | UType::Trebuchet | UType::Civilian | UType::Pilgrim | UType::Merchant))
            .collect();
        if !threats.is_empty() {
            let mut sorted = threats.clone();
            sorted.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
            let closest = sorted[0];
            if dist(upt, self.unit_pt(closest)) < 190.0 {
                let mut fn_sorted = fighters_near.clone();
                fn_sorted.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
                let anchor = if let Some(&a) = fn_sorted.first() {
                    self.unit_pt(a)
                } else if let Some(&tc) = self.complete_buildings(Some(BKind::Towncenter), team).first() {
                    Pt::new(self.state.buildings[tc].x, self.state.buildings[tc].y)
                } else if let Some(h) = self.state.units[ui].home {
                    h
                } else {
                    upt
                };
                let cp = self.unit_pt(closest);
                let a = atan2(anchor.y - cp.y, anchor.x - cp.x);
                let goal = self.find_free(Pt::new(anchor.x + cos(a) * 115.0, anchor.y + sin(a) * 115.0));
                self.move_unit(ui, goal, dt, 6.0);
                return;
            }
        }
        if self.state.units[ui].hold {
            return;
        }
        let (has_order, attack) = {
            let u = &self.state.units[ui];
            (u.order.is_some(), u.order.as_ref().map(|o| o.attack == Some(true)).unwrap_or(false))
        };
        if has_order && !attack {
            self.march_unit(ui, dt);
            return;
        }
        let order_formation = self.state.units[ui].order.as_ref().and_then(|o| o.formation);
        let escorts: Vec<usize> = fighters_near
            .iter()
            .copied()
            .filter(|&a| !has_order || self.state.units[a].order.as_ref().and_then(|o| o.formation) == order_formation)
            .collect();
        let mut candidates = if !escorts.is_empty() { escorts } else { fighters_near.clone() };
        let mut injured: Vec<usize> = candidates.iter().copied().filter(|&a| self.state.units[a].hp < self.state.units[a].max_hp).collect();
        injured.sort_by(|&a, &b| cmp(self.state.units[a].hp / self.state.units[a].max_hp, self.state.units[b].hp / self.state.units[b].max_hp));
        let ally = if let Some(&i) = injured.first() {
            Some(i)
        } else {
            candidates.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), upt), dist(self.unit_pt(b), upt)));
            candidates.first().copied()
        };
        let ally = match ally {
            Some(a) => a,
            None => return,
        };
        let enemy: Option<Pt> = if let Some(&t) = threats.first() {
            Some(self.unit_pt(t))
        } else {
            self.state.buildings.iter().find(|b| b.team != team && b.team != 2 && b.kind == BKind::Fort && b.hp > 0.0).map(|b| Pt::new(b.x, b.y))
        };
        let ap = self.unit_pt(ally);
        let direction = match enemy {
            Some(e) => atan2(e.y - ap.y, e.x - ap.x),
            None => self.state.units[ally].angle,
        };
        let goal = self.find_free(Pt::new(ap.x - cos(direction) * 105.0, ap.y - sin(direction) * 105.0));
        if dist(upt, goal) > 35.0 {
            self.move_unit(ui, goal, dt, 6.0);
        }
        let _ = uid;
    }
}

impl Sim {
    /// End the game (`finish` in game.js); the front end shows the result.
    pub fn finish(&mut self, win: bool) {
        if self.state.result.is_some() {
            return;
        }
        self.state.result = Some(if win { "won".to_string() } else { "lost".to_string() });
        self.events.push(Event::Finished(win));
    }
}
