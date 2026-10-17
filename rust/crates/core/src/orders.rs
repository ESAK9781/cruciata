//! Unit orders (`issueOrder` and the stance, hold, deployment, bless and
//! cancel commands). Targets under the pointer are resolved by the caller
//! (picking is a front-end concern) and arrive as ids, so the same code runs
//! for a local player, a remote lockstep peer and tests.

use crate::combat::DmgSource;
use crate::build::COLOSSUS_MIN_RANGE;
use crate::data::data;
use crate::js::{atan2, cos, sin};
use crate::model::*;
use crate::movement::{dist, surface_distance, SlotBook, Target};
use crate::nav::Pt;
use crate::sim::{Obj, Sim};
use crate::workers::Gt;

/// A right-click / attack-move order.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OrderCmd {
    /// Selected units (any order), selected structures.
    pub units: Vec<u32>,
    pub structures: Vec<u32>,
    pub x: f64,
    pub y: f64,
    pub attack: bool,
    pub append: bool,
    /// Visible enemy unit or structure under the pointer.
    pub enemy: Option<u32>,
    /// Resource node (or farm building) under the pointer.
    pub node: Option<u32>,
    /// Structure under the pointer (any owner).
    pub building: Option<u32>,
    /// Friendly caravan under the pointer.
    pub escort: Option<u32>,
}

fn rank_of(u: &Unit) -> i32 {
    data().ty(u.ty).rank
}

impl Sim {
    pub fn friend_units(&self, team: i32) -> Vec<usize> {
        (0..self.state.units.len()).filter(|&i| self.state.units[i].team == team && self.state.units[i].hp > 0.0).collect()
    }

    pub fn issue_order(&mut self, team: i32, c: &OrderCmd) {
        let d = data();
        let (w, h) = (self.geo.w, self.geo.h);
        let p = Pt::new(c.x.clamp(25.0, w - 25.0), c.y.clamp(25.0, h - 25.0));
        let enemy_obj = c.enemy.and_then(|id| self.get_object(id)).filter(|o| match o {
            Obj::Unit(i) => self.state.units[*i].team != team && self.state.units[*i].team != 2,
            Obj::Building(i) => self.state.buildings[*i].team != team && self.state.buildings[*i].team != 2,
            Obj::Node(_) => false,
        });
        let enemy_pos = enemy_obj.map(|o| self.obj_pos(o));
        let enemy_id = enemy_obj.map(|o| match o {
            Obj::Unit(i) => self.state.units[i].id,
            Obj::Building(i) => self.state.buildings[i].id,
            Obj::Node(i) => self.state.nodes[i].id,
        });
        let node_gt: Option<Gt> = c.node.and_then(|id| match self.get_object(id) {
            Some(Obj::Node(i)) => Some(Gt::Node(i)),
            Some(Obj::Building(i)) => Some(Gt::Farm(i)),
            _ => None,
        });
        let building: Option<usize> = c.building.and_then(|id| match self.get_object(id) {
            Some(Obj::Building(i)) => Some(i),
            _ => None,
        });
        let escort = c.escort.and_then(|id| self.state.units.iter().position(|u| u.id == id && u.hp > 0.0 && u.team == team));
        let units: Vec<usize> = self
            .friend_units(team)
            .into_iter()
            .filter(|&i| c.units.contains(&self.state.units[i].id) && !matches!(self.state.units[i].ty, UType::Pilgrim | UType::Merchant))
            .collect();
        let sel_structs: Vec<usize> = (0..self.state.buildings.len())
            .filter(|&i| {
                let b = &self.state.buildings[i];
                c.structures.contains(&b.id) && b.team == team && b.hp > 0.0
            })
            .collect();

        // ---- permanent engines ----
        let great: Vec<usize> = sel_structs.iter().copied().filter(|&i| self.state.buildings[i].kind == BKind::Greatengine && self.state.buildings[i].progress >= 1.0).collect();
        for &ei in &great {
            let spec = d.bld(BKind::Greatengine);
            let eb = Pt::new(self.state.buildings[ei].x, self.state.buildings[ei].y);
            let dd = dist(eb, enemy_pos.unwrap_or(p));
            if dd < spec.min_range.unwrap_or(0.0) || dd > spec.range.unwrap_or(0.0) {
                self.toast("Outside great engine range (320-2200).");
                continue;
            }
            let b = &mut self.state.buildings[ei];
            b.attack_target = enemy_id;
            b.fire_target = if enemy_id.is_some() { None } else { Some(p) };
            if b.stance.as_deref() == Some("stand-down") {
                b.stance = Some("fight".into());
            }
            self.sound("attack", Some((eb.x, eb.y, team)));
            self.toast("Great siege engine target set. The platform will turn and fire when ready.");
        }
        let colossi: Vec<usize> = sel_structs.iter().copied().filter(|&i| self.state.buildings[i].kind == BKind::Colossus && self.state.buildings[i].progress >= 1.0).collect();
        for &ei in &colossi {
            let eb = Pt::new(self.state.buildings[ei].x, self.state.buildings[ei].y);
            if dist(eb, enemy_pos.unwrap_or(p)) < COLOSSUS_MIN_RANGE {
                self.toast(format!("Too close: the Colossus cannot fire within {} units of itself.", COLOSSUS_MIN_RANGE));
                continue;
            }
            let b = &mut self.state.buildings[ei];
            b.attack_target = enemy_id;
            b.fire_target = if enemy_id.is_some() { None } else { Some(p) };
            self.sound("attack", Some((eb.x, eb.y, team)));
            self.toast("Colossus ordered to bombard this target.");
        }
        if units.is_empty() {
            let producers: Vec<usize> = sel_structs
                .iter()
                .copied()
                .filter(|&i| {
                    let b = &self.state.buildings[i];
                    b.progress >= 1.0 && d.types.iter().any(|(_, t)| t.producer == Some(b.kind))
                })
                .collect();
            for bi in &producers {
                let r = self.find_free(p);
                self.state.buildings[*bi].rally = Some(r);
            }
            if !colossi.is_empty() && producers.is_empty() {
                return;
            }
            self.toast(if !producers.is_empty() { "New troops from selected training buildings will rally here." } else { "This building cannot train troops and has no rally point." });
            return;
        }
        if enemy_id.is_some() && units.iter().any(|&i| d.ty(self.state.units[i].ty).damage > 0.0) {
            self.sound("attack", Some((p.x, p.y, team)));
        }

        // ---- trebuchets already in the field ----
        let field_engines: Vec<usize> = units.iter().copied().filter(|&i| self.state.units[i].ty == UType::Trebuchet && self.state.units[i].deployment != "packed").collect();
        for ui in field_engines {
            {
                let u = &mut self.state.units[ui];
                u.auto_scout = None;
                u.target = None;
                u.manual_target = false;
                if enemy_id.is_some() {
                    u.stance = "fight".into();
                }
            }
            if self.state.units[ui].stance == "stand-down" {
                self.state.units[ui].fire_target = None;
                self.toast("This engine is standing down. Choose Hold or Fight to fire.");
                continue;
            }
            let dep = self.state.units[ui].deployment.clone();
            if dep == "deployed" || dep == "setting-up" {
                let dd = dist(self.unit_pt(ui), enemy_pos.unwrap_or(p));
                if (180.0..=690.0).contains(&dd) {
                    let u = &mut self.state.units[ui];
                    u.fire_target = if enemy_id.is_some() { None } else { Some(p) };
                    u.target = enemy_id;
                    u.manual_target = enemy_id.is_some();
                    u.hold = false;
                    u.order = None;
                    self.toast("Trebuchet target set. The engine will fire when ready.");
                } else {
                    self.toast("Outside siege range (180-690). Press Pack up before moving the engine.");
                }
            } else {
                let f = self.find_free(p);
                self.state.units[ui].pending_order = Some(Order { x: f.x, y: f.y, attack: Some(false), ..Default::default() });
            }
        }

        // ---- formation ----
        let has_node = node_gt.is_some();
        let has_building = building.is_some();
        let combat: Vec<usize> = units
            .iter()
            .copied()
            .filter(|&i| {
                let u = &self.state.units[i];
                (u.ty != UType::Worker || (!has_node && !has_building)) && (u.ty != UType::Trebuchet || u.deployment == "packed")
            })
            .collect();
        let n = combat.len() as f64;
        let center = if combat.is_empty() {
            p
        } else {
            let mut a = Pt::new(0.0, 0.0);
            for &i in &combat {
                a = Pt::new(a.x + self.state.units[i].x / n, a.y + self.state.units[i].y / n);
            }
            a
        };
        let a = atan2(p.y - center.y, p.x - center.x);
        let front = Pt::new(cos(a), sin(a));
        let side = Pt::new(-front.y, front.x);
        let cols = ((combat.len() as f64).sqrt().ceil() as usize).max(1);
        let spacing = if combat.iter().any(|&i| matches!(self.state.units[i].ty, UType::Knight | UType::Trebuchet | UType::Ram | UType::Ballista)) { 56.0 } else { 32.0 };
        let mut sorted = combat.clone();
        sorted.sort_by_key(|&i| rank_of(&self.state.units[i]));
        let formation_id = self.next_uid();
        let mut slots = SlotBook::default();
        let swarm = c.attack && enemy_id.is_none() && escort.is_none();
        let arrive = if swarm { 14.0 * n.sqrt() } else { 0.0 };

        let mut start = 0;
        while start < sorted.len() {
            let mut end = start;
            while end < sorted.len() && rank_of(&self.state.units[sorted[end]]) == rank_of(&self.state.units[sorted[start]]) {
                end += 1;
            }
            let ahead = |s: &Sim, i: usize| (s.state.units[i].x - center.x) * front.x + (s.state.units[i].y - center.y) * front.y;
            let lateral = |s: &Sim, i: usize| (s.state.units[i].x - center.x) * side.x + (s.state.units[i].y - center.y) * side.y;
            let mut group: Vec<usize> = sorted[start..end].to_vec();
            group.sort_by(|&x, &y| ahead(self, y).partial_cmp(&ahead(self, x)).unwrap_or(std::cmp::Ordering::Equal));
            let mut k = 0;
            while k < group.len() {
                let mut last = k + 1;
                while last < group.len() && (start + last) % cols != 0 {
                    last += 1;
                }
                let mut row: Vec<usize> = group[k..last].to_vec();
                row.sort_by(|&x, &y| lateral(self, x).partial_cmp(&lateral(self, y)).unwrap_or(std::cmp::Ordering::Equal));
                for (j, v) in row.into_iter().enumerate() {
                    group[k + j] = v;
                }
                k = last;
            }
            for (k, v) in group.into_iter().enumerate() {
                sorted[start + k] = v;
            }
            start = end;
        }

        for (i, &ui) in sorted.iter().enumerate() {
            let ty = self.state.units[ui].ty;
            {
                let u = &mut self.state.units[ui];
                u.auto_scout = None;
                u.fire_target = None;
                if ty == UType::Worker {
                    u.job = None;
                    if !c.append {
                        u.build_queue = Some(Vec::new());
                    }
                }
            }
            let row = (i / cols) as f64;
            let column = (i % cols) as f64 - (cols as f64 - 1.0) / 2.0;
            let extra = if c.attack || enemy_id.is_some() {
                if ty == UType::Chaplain {
                    100.0
                } else if ty == UType::Trebuchet {
                    170.0
                } else {
                    0.0
                }
            } else {
                0.0
            };
            let mut goal = if swarm {
                self.march_point(p)
            } else {
                self.march_point(Pt::new(p.x + side.x * column * spacing - front.x * (row * spacing + extra), p.y + side.y * column * spacing - front.y * (row * spacing + extra)))
            };
            if !swarm && ty == UType::Knight && (c.attack || enemy_id.is_some()) {
                let flank = if i % 2 == 1 { -1.0 } else { 1.0 };
                goal = self.find_free(Pt::new(goal.x + side.x * flank * 55.0, goal.y + side.y * flank * 55.0));
            }
            if !swarm {
                let anchor = self.march_point(p);
                goal = self.reserve_slot(goal, &mut slots, Some(anchor));
            }
            let mut order = Order { x: goal.x, y: goal.y, attack: Some(c.attack || enemy_id.is_some() || escort.is_some()), formation: Some(formation_id), ..Default::default() };
            if swarm {
                order.swarm = Some(true);
                order.arrive = Some(arrive);
            }
            let u = &mut self.state.units[ui];
            u.target = if ty == UType::Chaplain { None } else { enemy_id };
            if enemy_id.is_some() {
                u.stance = "fight".into();
            }
            u.manual_target = enemy_id.is_some() && ty != UType::Chaplain;
            u.hold = false;
            u.path = Vec::new();
            u.path_goal = None;
            u.path_request = None;
            u.stuck = 0.0;
            u.arrival_avoid_side = None;
            u.formation = Some(serde_json::json!({"id": formation_id, "x": goal.x, "y": goal.y}));
            u.march_offset = Some(Pt::new(goal.x - p.x, goal.y - p.y));
            u.order = Some(order);
        }

        // ---- route-sharing companies ----
        let mut remaining: Vec<usize> = sorted.clone();
        while !remaining.is_empty() {
            let first = remaining.remove(0);
            let mut members = vec![first];
            let mut i = 0;
            while i < members.len() {
                let mi = self.unit_pt(members[i]);
                let mut k = 0;
                while k < remaining.len() {
                    let other = remaining[k];
                    let op = self.unit_pt(other);
                    if dist(mi, op) <= 240.0 && self.clear_line(mi, op) {
                        remaining.remove(k);
                        members.push(other);
                    } else {
                        k += 1;
                    }
                }
                i += 1;
            }
            let id = self.next_uid();
            let nm = members.len() as f64;
            let mut anchor = Pt::new(0.0, 0.0);
            for &m in &members {
                anchor = Pt::new(anchor.x + self.state.units[m].x / nm, anchor.y + self.state.units[m].y / nm);
            }
            let destination = self.march_point(p);
            for &m in &members {
                let u = &mut self.state.units[m];
                if let Some(o) = u.order.as_mut() {
                    o.formation = Some(id);
                }
                if let Some(f) = u.formation.as_mut().and_then(|f| f.as_object_mut()) {
                    f.insert("id".into(), serde_json::json!(id));
                }
                u.shared_route_revision = None;
            }
            let speed = members.iter().map(|&m| d.ty(self.state.units[m].ty).speed).fold(f64::INFINITY, f64::min);
            let route_start = self.find_free(anchor);
            let dest = self.find_free(destination);
            self.state.formations.push(Formation {
                id,
                members: members.iter().map(|&m| self.state.units[m].id).collect(),
                anchor,
                route_start: Some(route_start),
                destination: dest,
                path: Vec::new(),
                shared_route: Some(true),
                route_ready: Some(false),
                revision: self.nav.revision as i64,
                speed,
                arrived: false,
                wait: 0.0,
                escort_id: escort.map(|e| self.state.units[e].id),
                ..Default::default()
            });
        }

        // ---- villagers ----
        let villagers: Vec<usize> = units.iter().copied().filter(|&i| self.state.units[i].ty == UType::Worker && !combat.contains(&i)).collect();
        for ui in villagers {
            if !c.append {
                self.state.units[ui].build_queue = Some(Vec::new());
            }
            self.state.units[ui].hold = false;
            let work = building.filter(|&bi| {
                let b = &self.state.buildings[bi];
                b.team == team && (b.progress < 1.0 || b.hp < b.max_hp)
            });
            let take_node = match (node_gt, work) {
                (Some(g), None) => Some(g),
                (Some(g), Some(wi)) => {
                    let t = self.gt_target(g);
                    let wt = Target::from_building(&self.state.buildings[wi]);
                    if (dist(Pt::new(t.x, t.y), p) - t.r).max(0.0) <= surface_distance(p, &wt) {
                        Some(g)
                    } else {
                        None
                    }
                }
                _ => None,
            };
            if let Some(g) = take_node {
                let res = match g {
                    Gt::Farm(_) => Res::Food,
                    Gt::Node(i) => self.state.nodes[i].kind,
                };
                self.assign_gather(ui, res, Some(g), None, None);
            } else if let Some(bi) = building.filter(|&bi| self.state.buildings[bi].team == team && self.state.buildings[bi].progress >= 1.0 && d.bld(self.state.buildings[bi].kind).drop.is_some()) {
                if !self.assign_depot_gather(ui, bi) {
                    let u = &mut self.state.units[ui];
                    u.job = None;
                    u.order = None;
                    self.toast("No explored resource accepted by this depot is available.");
                }
            } else if let Some(bi) = work {
                if self.state.buildings[bi].progress < 1.0 {
                    let id = self.state.buildings[bi].id;
                    self.queue_construction(&[ui], &[id], c.append);
                } else {
                    let id = self.state.buildings[bi].id;
                    let u = &mut self.state.units[ui];
                    u.job = Some(Job { kind: "repair".into(), target: Some(id), ..Default::default() });
                    u.order = None;
                    u.path_timer = 0.0;
                }
            } else {
                let f = self.find_free(p);
                let u = &mut self.state.units[ui];
                u.job = None;
                u.order = Some(Order { x: f.x, y: f.y, attack: Some(false), ..Default::default() });
                u.path_timer = 0.0;
            }
        }
        if !combat.is_empty() && combat.iter().all(|&i| self.state.units[i].ty == UType::Chaplain) && (c.attack || enemy_id.is_some()) {
            for &i in &combat {
                self.state.units[i].order = None;
            }
            self.toast("Chaplains need an escort to advance into battle.");
        }
        if escort.is_some() && !combat.is_empty() {
            self.toast("The company will guard and follow the caravan. Defeat nearby threats to keep it moving.");
        }
        if enemy_id.is_none() {
            self.sound("order", None);
        }
    }

    pub fn set_stance(&mut self, team: i32, units: &[u32], structures: &[u32], value: &str) {
        if !matches!(value, "fight" | "hold" | "stand-down") {
            return;
        }
        for i in self.fighters(team) {
            if !units.contains(&self.state.units[i].id) {
                continue;
            }
            let u = &mut self.state.units[i];
            u.stance = value.to_string();
            u.hold = false;
            u.target = None;
            u.manual_target = false;
            if value == "stand-down" {
                u.fire_target = None;
            }
        }
        for b in self.state.buildings.iter_mut() {
            if structures.contains(&b.id) && b.team == team && b.hp > 0.0 && b.kind == BKind::Greatengine && b.progress >= 1.0 {
                b.stance = Some(value.to_string());
                if value == "stand-down" {
                    b.fire_target = None;
                    b.attack_target = None;
                }
            }
        }
    }

    pub fn hold_units(&mut self, team: i32, units: &[u32]) {
        for u in self.state.units.iter_mut().filter(|u| u.team == team && u.hp > 0.0 && units.contains(&u.id)) {
            u.auto_scout = None;
            u.fire_target = None;
            u.order = None;
            u.pending_order = None;
            u.target = None;
            u.job = None;
            u.build_queue = Some(Vec::new());
            if u.ty != UType::Worker {
                u.stance = "hold".into();
            }
            u.hold = u.ty == UType::Worker;
            u.path = Vec::new();
        }
    }

    pub fn bless(&mut self, team: i32, units: &[u32]) -> bool {
        let ids: Vec<usize> = self.fighters(team).into_iter().filter(|&i| units.contains(&self.state.units[i].id)).collect();
        let faith = if team == 0 { self.state.faith } else { self.state.enemy.faith };
        if ids.is_empty() || faith < 30.0 {
            self.toast("Select soldiers and gather 30 faith for a benediction.");
            return false;
        }
        if team == 0 {
            self.state.faith -= 30.0;
        } else {
            self.state.enemy.faith -= 30.0;
        }
        for i in ids {
            let u = &mut self.state.units[i];
            u.hp = u.max_hp.min(u.hp + 30.0);
            u.blessed = 15.0;
        }
        self.sound("bless", None);
        self.toast("In nomine Patris. The company receives a benediction.");
        true
    }

    pub fn toggle_deployment(&mut self, team: i32, units: &[u32]) {
        let engines: Vec<usize> = self.fighters(team).into_iter().filter(|&i| units.contains(&self.state.units[i].id) && self.state.units[i].ty == UType::Trebuchet).collect();
        if engines.is_empty() {
            self.toast("Select a trebuchet to set up or pack.");
            return;
        }
        for i in engines {
            let u = &mut self.state.units[i];
            u.auto_scout = None;
            u.fire_target = None;
            if u.deployment == "packed" {
                u.deployment = "setting-up".into();
                u.deploy_timer = 6.0;
                u.order = None;
                u.pending_order = None;
                u.path = Vec::new();
            } else if u.deployment == "deployed" {
                u.deployment = "packing".into();
                u.deploy_timer = 4.0;
                u.target = None;
            }
        }
    }

    pub fn cancel_siege_targeting(&mut self, team: i32, units: &[u32], structures: &[u32]) {
        for u in self.state.units.iter_mut().filter(|u| u.team == team && u.hp > 0.0 && units.contains(&u.id) && u.ty == UType::Trebuchet) {
            u.fire_target = None;
            u.target = None;
            u.manual_target = false;
        }
        for b in self.state.buildings.iter_mut().filter(|b| b.team == team && b.hp > 0.0 && structures.contains(&b.id) && matches!(b.kind, BKind::Greatengine | BKind::Colossus) && b.progress >= 1.0) {
            b.fire_target = None;
            b.attack_target = None;
        }
        self.toast("Siege targeting cancelled. Colossi cease fire; other engines resume watching for enemies.");
    }

    /// Cancel one unfinished structure or the front queue item of a structure.
    pub fn cancel_structure(&mut self, team: i32, id: u32) -> bool {
        let Some(bi) = self.state.buildings.iter().position(|b| b.id == id && b.team == team) else { return false };
        let target = match self.state.buildings[bi].upgrade_owner.and_then(|o| self.get_object(o)) {
            Some(Obj::Building(oi)) => oi,
            _ => bi,
        };
        if self.state.buildings[target].progress < 1.0 {
            let (tid, progress) = (self.state.buildings[target].id, self.state.buildings[target].progress);
            if let Some(spent) = self.state.buildings[target].spent.clone().and_then(|s| s.as_object().cloned()) {
                for (k, v) in spent {
                    let r = match k.as_str() {
                        "food" => Res::Food,
                        "wood" => Res::Wood,
                        "gold" => Res::Gold,
                        _ => Res::Stone,
                    };
                    *self.stock_mut(team).get_mut(r) += v.as_f64().unwrap_or(0.0) * (1.0 - progress) * 0.75;
                }
            }
            self.state.buildings.retain(|b| b.id != tid);
            for u in self.state.units.iter_mut().filter(|u| u.team == team && u.ty == UType::Worker && u.hp > 0.0) {
                if let Some(q) = u.build_queue.as_mut() {
                    q.retain(|&x| x != tid);
                }
                if u.job.as_ref().and_then(|j| j.target) == Some(tid) {
                    let next = u.build_queue.as_mut().filter(|q| !q.is_empty()).map(|q| q.remove(0));
                    u.job = next.map(|t| Job { kind: "build".into(), target: Some(t), ..Default::default() });
                    u.path_timer = 0.0;
                }
            }
            self.rebuild_navigation();
            self.toast("1 selected construction or training orders cancelled. Unused materials returned.");
            true
        } else if !self.state.buildings[target].queue.is_empty() {
            let item = self.state.buildings[target].queue.remove(0);
            self.release_wall_upgrade(target, &item);
            if let Some(cost) = &item.cost {
                self.pay_json(cost, -1.0, team);
            }
            self.toast("1 selected construction or training orders cancelled. Unused materials returned.");
            true
        } else {
            false
        }
    }
}

#[allow(dead_code)]
fn _keep(_: DmgSource) {}
