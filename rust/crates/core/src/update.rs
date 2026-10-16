//! The fixed-step simulation loop (`update(dt)` in game.js) and the systems it
//! runs: gates, scouting, formations, buildings, projectiles, capture rules.

use crate::build::COLOSSUS_MIN_RANGE;
use crate::combat::DmgSource;
use crate::data::data;
use crate::js::{atan2, clamp, cos, hypot, sin};
use crate::model::*;
use crate::movement::{dist, surface_distance, Target};
use crate::nav::Pt;
use crate::sim::{Event, Obj, Sim};
use crate::world::*;
use std::cmp::Ordering;

fn cmp(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

pub struct Objective {
    pub progress: f64,
    pub text: String,
    pub won: bool,
}

impl Sim {
    pub fn playable(&self) -> bool {
        !self.state.paused && self.state.result.is_none()
    }

    pub fn refresh_fog(&mut self) {
        let shots = self.siege_shots();
        let r0 = self.colossus_reveals(0);
        let r1 = self.colossus_reveals(1);
        self.fog.update(&self.state.units, &self.state.buildings, &shots, &r0);
        self.enemy_fog.update(&self.state.units, &self.state.buildings, &shots, &r1);
    }

    pub fn rebuild_spatial(&mut self) {
        let (w, h) = (self.geo.w, self.geo.h);
        if self.unit_tree.width != w || self.unit_tree.height != h {
            self.unit_tree = crate::quadtree::Quadtree::new(w, h);
        }
        self.unit_tree.clear();
        self.object_index.clear();
        for (i, u) in self.state.units.iter().enumerate() {
            self.object_index.insert(u.id, Obj::Unit(i));
        }
        for (i, b) in self.state.buildings.iter().enumerate() {
            self.object_index.insert(b.id, Obj::Building(i));
        }
        for (i, n) in self.state.nodes.iter().enumerate() {
            self.object_index.insert(n.id, Obj::Node(i));
        }
        for (i, u) in self.state.units.iter().enumerate() {
            if u.hp > 0.0 {
                self.unit_tree.insert(i as u32, u.x, u.y);
            }
        }
    }

    // ---- scouting ------------------------------------------------------------

    pub fn scout_company(&mut self, gi: usize, members: &[usize], destination: Pt) {
        let d = data();
        let id = self.next_uid();
        let center = {
            let n = members.len() as f64;
            let mut p = Pt::new(0.0, 0.0);
            for &m in members {
                p.x += self.state.units[m].x / n;
                p.y += self.state.units[m].y / n;
            }
            p
        };
        let a = atan2(destination.y - center.y, destination.x - center.x);
        let mut slots = crate::movement::SlotBook::default();
        let cols = 3f64.max((members.len() as f64).sqrt().ceil());
        let mut sorted: Vec<usize> = members.to_vec();
        sorted.sort_by(|&x, &y| d.ty(self.state.units[x].ty).rank.cmp(&d.ty(self.state.units[y].ty).rank));
        for (i, &m) in sorted.iter().enumerate() {
            let ty = self.state.units[m].ty;
            let rear = (i as f64 / cols).floor() * 32.0 + if ty == UType::Chaplain { 90.0 } else { 0.0 };
            let side = ((i as f64 % cols) - (cols - 1.0) / 2.0) * 32.0;
            let target = self.march_point(Pt::new(destination.x - cos(a) * rear - sin(a) * side, destination.y - sin(a) * rear + cos(a) * side));
            let goal = self.reserve_slot(target, &mut slots, None);
            let order = Order { x: goal.x, y: goal.y, attack: Some(false), formation: Some(id), ..Default::default() };
            let u = &mut self.state.units[m];
            u.march_offset = Some(Pt::new(goal.x - destination.x, goal.y - destination.y));
            u.path_timer = 0.0;
            u.target = None;
            if ty == UType::Trebuchet && u.deployment != "packed" {
                u.deployment = "packing".into();
                u.deploy_timer = 4.0;
                u.pending_order = Some(order);
                u.order = None;
            } else {
                u.order = Some(order);
            }
        }
        let speed = members.iter().map(|&m| d.ty(self.state.units[m].ty).speed).fold(f64::INFINITY, f64::min);
        self.state.formations.push(Formation {
            id,
            members: members.iter().map(|&m| self.state.units[m].id).collect(),
            anchor: center,
            destination,
            path: Vec::new(),
            revision: self.nav.revision as i64,
            speed,
            arrived: false,
            wait: 0.0,
            ..Default::default()
        });
        let groups = self.state.scouting_groups.get_or_insert_with(Vec::new);
        groups[gi].goal = Some(destination);
        groups[gi].formation = Some(id);
    }

    pub fn update_scouting(&mut self, dt: f64) {
        let d = data();
        let groups_exist = {
            let ids: Vec<ScoutGroup> = self.state.scouting_groups.clone().unwrap_or_default();
            let keep: Vec<ScoutGroup> = ids
                .into_iter()
                .filter(|g| g.members.iter().any(|id| self.state.units.iter().any(|u| u.id == *id && u.hp > 0.0 && u.auto_scout == Some(g.id))))
                .collect();
            self.state.scouting_groups = Some(keep.clone());
            keep
        };
        let now = self.state.time;
        for (gi, g) in groups_exist.iter().enumerate() {
            let members: Vec<usize> = self.state.units.iter().enumerate().filter(|(_, u)| u.hp > 0.0 && u.auto_scout == Some(g.id)).map(|(i, _)| i).collect();
            {
                let gg = &mut self.state.scouting_groups.as_mut().unwrap()[gi];
                gg.think -= dt;
                if gg.think > 0.0 {
                    continue;
                }
                gg.think = 0.6;
            }
            let n = members.len() as f64;
            let mut center = Pt::new(0.0, 0.0);
            for &m in &members {
                center.x += self.state.units[m].x / n;
                center.y += self.state.units[m].y / n;
            }
            let mut threats: Vec<usize> = self
                .state
                .units
                .iter()
                .enumerate()
                .filter(|(_, u)| u.team == 1 && u.hp > 0.0 && d.ty(u.ty).damage > 0.0 && self.fog.sees(u.x, u.y) && members.iter().any(|&m| dist(self.unit_pt(m), Pt::new(u.x, u.y)) < 240.0))
                .map(|(i, _)| i)
                .collect();
            threats.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), center), dist(self.unit_pt(b), center)));
            let threat = threats.first().copied();
            let attacked = members.iter().any(|&m| self.state.units[m].last_hit.map(|h| h > now - 4.0).unwrap_or(false));
            let retreat_until = self.state.scouting_groups.as_ref().unwrap()[gi].retreat_until;
            if (threat.is_some() || attacked) && now >= retreat_until {
                let attacker: Option<Pt> = match threat {
                    Some(t) => Some(self.unit_pt(t)),
                    None => {
                        let who = members.iter().find(|&&m| self.state.units[m].last_hit.map(|h| h > now - 4.0).unwrap_or(false)).and_then(|&m| self.state.units[m].last_attacker);
                        who.and_then(|id| self.get_object(id)).map(|o| self.obj_pos(o))
                    }
                };
                let a = match attacker {
                    Some(p) => atan2(center.y - p.y, center.x - p.x),
                    None => atan2(self.state.buildings[0].y - center.y, self.state.buildings[0].x - center.x),
                };
                let goal = self.find_free(Pt::new(center.x + cos(a) * 600.0, center.y + sin(a) * 600.0));
                self.scout_company(gi, &members, goal);
                let gg = &mut self.state.scouting_groups.as_mut().unwrap()[gi];
                gg.retreat_until = now + 10.0;
                gg.status = "withdrawing".into();
                continue;
            }
            if now < retreat_until {
                continue;
            }
            let fid = self.state.scouting_groups.as_ref().unwrap()[gi].formation;
            let formation = fid.and_then(|f| self.state.formations.iter().find(|x| x.id == f));
            if let Some(f) = formation {
                if !f.arrived && members.iter().any(|&m| self.state.units[m].order.is_some() || self.state.units[m].pending_order.is_some()) {
                    continue;
                }
            }
            let origin = self.nav.nearest(center.x, center.y, None);
            let region = origin.map(|o| self.nav.components[(o.1 * self.nav.cols + o.0) as usize]);
            let mut best: Option<Pt> = None;
            let mut score = f64::INFINITY;
            let (w, h) = (self.geo.w, self.geo.h);
            let mut y = 240.0;
            while y < h - 120.0 {
                let mut x = 240.0;
                while x < w - 120.0 {
                    let p = Pt::new(x, y);
                    if self.fog.remembers(x, y) || dist(center, p) < 180.0 || !self.ground_free(x, y, 24.0) {
                        x += 240.0;
                        continue;
                    }
                    let cell = self.nav.nearest(x, y, None);
                    match cell {
                        None => {
                            x += 240.0;
                            continue;
                        }
                        Some(c) => {
                            if Some(self.nav.components[(c.1 * self.nav.cols + c.0) as usize]) != region {
                                x += 240.0;
                                continue;
                            }
                        }
                    }
                    let value = dist(center, p);
                    if value < score {
                        best = Some(p);
                        score = value;
                    }
                    x += 240.0;
                }
                y += 240.0;
            }
            match best {
                Some(b) => {
                    self.state.scouting_groups.as_mut().unwrap()[gi].status = "exploring".into();
                    let f = self.find_free(b);
                    self.scout_company(gi, &members, f);
                }
                None => {
                    let gg = &mut self.state.scouting_groups.as_mut().unwrap()[gi];
                    gg.status = "survey complete".into();
                    gg.goal = None;
                }
            }
        }
    }

    // ---- formations ------------------------------------------------------------

    pub fn update_formations(&mut self) {
        let mut formations = std::mem::take(&mut self.state.formations);
        let active = |units: &Vec<Unit>, id: u32, f: &Formation| -> bool {
            units.iter().find(|u| u.id == id).map(|u| u.hp > 0.0 && (u.order.as_ref().and_then(|o| o.formation) == Some(f.id) || u.pending_order.as_ref().and_then(|o| o.formation) == Some(f.id))).unwrap_or(false)
        };
        let mut kept: Vec<Formation> = Vec::new();
        for f in formations.drain(..) {
            let live = f.members.iter().any(|&id| active(&self.state.units, id, &f));
            if !live {
                self.nav.cancel_owner(f.id * 2 + 1);
            } else {
                kept.push(f);
            }
        }
        for f in kept.iter_mut() {
            let members: Vec<usize> = f.members.iter().filter(|&&id| active(&self.state.units, id, f)).filter_map(|&id| self.state.units.iter().position(|u| u.id == id)).collect();
            if members.is_empty() {
                continue;
            }
            if let Some(esc) = f.escort_id {
                if let Some(Obj::Unit(wi)) = self.get_object(esc) {
                    let wagon = &self.state.units[wi];
                    let route = wagon.route.clone().unwrap_or_default();
                    let next = route.get(wagon.route_index.unwrap_or(0)).copied().unwrap_or(Pt::new(wagon.x, wagon.y));
                    let a = atan2(next.y - wagon.y, next.x - wagon.x);
                    let (wx, wy) = (wagon.x, wagon.y);
                    for &m in &members {
                        if self.state.units[m].order.is_some() {
                            let off = self.state.units[m].march_offset.unwrap_or(Pt::new(0.0, 0.0));
                            let target = Pt::new(wx + cos(a) * 90.0 + off.x, wy + sin(a) * 90.0 + off.y);
                            let goal = self.march_point(target);
                            if let Some(o) = self.state.units[m].order.as_mut() {
                                o.x = goal.x;
                                o.y = goal.y;
                            }
                        }
                    }
                }
            }
            if f.shared_route == Some(true) && f.escort_id.is_none() {
                if f.revision != self.nav.revision as i64 {
                    f.path.clear();
                    f.route_ready = Some(false);
                    f.route_start = Some(self.find_free(f.anchor));
                    f.revision = self.nav.revision as i64;
                }
                if f.route_ready != Some(true) {
                    let start = f.route_start.unwrap_or_else(|| self.find_free(f.anchor));
                    let path = self.nav_query(start, f.destination, if f.team == Some(0) { 2 } else { 0 }, Some(f.id * 2 + 1));
                    if let Some(p) = path {
                        f.path = if p.is_empty() {
                            Vec::new()
                        } else {
                            let mut v = vec![f.route_start.unwrap_or_else(|| self.find_free(f.anchor))];
                            v.extend(p);
                            v
                        };
                        f.route_ready = Some(true);
                    }
                }
            }
            let n = members.len() as f64;
            let mut anchor = Pt::new(0.0, 0.0);
            for &m in &members {
                anchor.x += self.state.units[m].x / n;
                anchor.y += self.state.units[m].y / n;
            }
            f.anchor = anchor;
            f.arrived = members.iter().all(|&m| {
                let u = &self.state.units[m];
                let goal = u.order.as_ref().or(u.pending_order.as_ref()).map(|o| Pt::new(o.x, o.y)).unwrap_or(Pt::new(0.0, 0.0));
                dist(Pt::new(u.x, u.y), goal) < 40.0
            });
        }
        self.state.formations = kept;
    }

    // ---- campaign pressure -----------------------------------------------------

    pub fn campaign_pressure(&mut self, dt: f64) {
        let d = data();
        if self.state.campaign_rules.is_none() || self.state.mode != "campaign" {
            return;
        }
        let think = self.state.campaign_rules.as_ref().unwrap().think.unwrap_or(0.0) - dt;
        self.state.campaign_rules.as_mut().unwrap().think = Some(think);
        if think > 0.0 {
            return;
        }
        self.state.campaign_rules.as_mut().unwrap().think = Some(1.0);
        let posts: Vec<Post> = self.state.campaign_rules.as_ref().unwrap().posts.clone();
        let now = self.state.time;
        for post in posts {
            let Some(Obj::Building(pb)) = self.get_object(post.id) else { continue };
            if self.state.buildings[pb].team != 1 {
                continue;
            }
            let ppos = Pt::new(post.x, post.y);
            let local: Vec<usize> = self
                .fighters(1)
                .into_iter()
                .filter(|&u| {
                    let un = &self.state.units[u];
                    un.fixed_defense != Some(true)
                        && un.curtain_guard != Some(true)
                        && un.scout != Some(true)
                        && un.order.as_ref().and_then(|o| o.formation).is_none()
                        && dist(Pt::new(un.x, un.y), ppos) < 650.0
                        && (un.campaign_post.is_none() || un.campaign_post == Some(post.id))
                })
                .collect();
            for &u in &local {
                let uid = self.state.units[u].id;
                {
                    let un = &mut self.state.units[u];
                    un.campaign_post = Some(post.id);
                    un.garrison_base = Some(post.id);
                }
                if self.state.units[u].home.is_none() {
                    let h = self.find_free(Pt::new(post.x - 120.0 + (uid % 5) as f64 * 40.0, post.y + 160.0));
                    self.state.units[u].home = Some(h);
                }
            }
            if self.state.wave_timer > 0.0 || local.len() < 6 {
                continue;
            }
            let mut visible: Vec<usize> = self
                .state
                .units
                .iter()
                .enumerate()
                .filter(|(_, u)| u.team == 0 && self.enemy_fog.sees(u.x, u.y) && dist(Pt::new(u.x, u.y), ppos) < 1800.0)
                .map(|(i, _)| i)
                .collect();
            visible.sort_by(|&a, &b| {
                let ra = if matches!(self.state.units[a].ty, UType::Pilgrim | UType::Merchant) { 0 } else { 1 };
                let rb = if matches!(self.state.units[b].ty, UType::Pilgrim | UType::Merchant) { 0 } else { 1 };
                ra.cmp(&rb).then(cmp(dist(self.unit_pt(a), ppos), dist(self.unit_pt(b), ppos)))
            });
            let visible_pt: Option<Pt> = visible.first().map(|&i| self.unit_pt(i));
            let defense: Option<usize> = if d.levels[self.state.level].kind == "survival" {
                let mut c: Vec<usize> = (0..self.state.buildings.len())
                    .filter(|&i| {
                        let b = &self.state.buildings[i];
                        b.team == 0 && b.hp > 0.0 && b.progress >= 1.0 && self.enemy_fog.sees(b.x, b.y)
                    })
                    .collect();
                c.sort_by(|&a, &b| cmp(dist(Pt::new(self.state.buildings[a].x, self.state.buildings[a].y), ppos), dist(Pt::new(self.state.buildings[b].x, self.state.buildings[b].y), ppos)));
                c.first().copied()
            } else {
                None
            };
            let take = 4.max(local.len().saturating_sub(3));
            let members: Vec<usize> = local.iter().copied().take(take).collect();
            let post_target = Target::point(ppos);
            let dest_raw: Pt = if let Some(def) = defense {
                let core = Target::from_building(&self.state.buildings[0]);
                let _ = core;
                // edgePoint is a unit helper; use the first member as the walker.
                let walker = members[0];
                let tc = Target::from_building(&self.state.buildings[0]);
                let ep = self.edge_point(walker, &tc, 40.0).0;
                if self.route_possible_from(ppos, ep) {
                    ep
                } else {
                    let dt2 = Target::from_building(&self.state.buildings[def]);
                    self.edge_point(walker, &dt2, 40.0).0
                }
            } else {
                visible_pt.unwrap_or(post.goal)
            };
            let _ = post_target;
            let destination = self.find_free(dest_raw);
            let id = self.next_uid();
            let n = members.len() as f64;
            let mut center = Pt::new(0.0, 0.0);
            for &m in &members {
                center.x += self.state.units[m].x / n;
                center.y += self.state.units[m].y / n;
            }
            let facing = atan2(destination.y - center.y, destination.x - center.x);
            for (i, &m) in members.iter().enumerate() {
                let ty = self.state.units[m].ty;
                let rear = (i as f64 / 5.0).floor() * 45.0 + if ty == UType::Trebuchet { 400.0 } else { 0.0 };
                let side = ((i % 5) as f64 - 2.0) * 45.0;
                let goal = self.find_free(Pt::new(destination.x - cos(facing) * rear - sin(facing) * side, destination.y - sin(facing) * rear + cos(facing) * side));
                let order = Order { x: goal.x, y: goal.y, attack: Some(true), formation: Some(id), ..Default::default() };
                let u = &mut self.state.units[m];
                u.order = Some(order.clone());
                u.march_offset = Some(Pt::new(goal.x - destination.x, goal.y - destination.y));
                u.path.clear();
                u.path_goal = None;
                u.path_request = None;
                u.home = Some(destination);
                if ty == UType::Trebuchet && u.deployment != "packed" {
                    u.deployment = "packing".into();
                    u.deploy_timer = 4.0;
                    u.pending_order = Some(order);
                    u.order = None;
                }
            }
            let speed = members.iter().map(|&m| d.ty(self.state.units[m].ty).speed).fold(f64::INFINITY, f64::min);
            let rs = self.find_free(center);
            self.state.formations.push(Formation {
                id,
                members: members.iter().map(|&m| self.state.units[m].id).collect(),
                anchor: center,
                route_start: Some(rs),
                destination,
                shared_route: Some(true),
                route_ready: Some(false),
                path: Vec::new(),
                revision: self.nav.revision as i64,
                speed,
                arrived: false,
                wait: 0.0,
                ..Default::default()
            });
            self.state.campaign_rules.as_mut().unwrap().attacks += 1.0;
        }
        if self.state.wave_timer <= 0.0 {
            self.state.wave_timer = self.state.campaign_rules.as_ref().unwrap().interval;
        }
        let _ = now;
    }

    /// `routePossible(post, point)` for a bare start position (campaign posts).
    pub fn route_possible_from(&mut self, start: Pt, p: Pt) -> bool {
        let route = self.nav_query(start, p, 0, None);
        route.is_none() || !route.unwrap().is_empty()
    }

    // ---- cities and sites ------------------------------------------------------

    pub fn capture_cities(&mut self, _dt: f64) {
        let ncities = self.state.cities.len();
        for ci in 0..ncities {
            if self.state.cities[ci].captured {
                continue;
            }
            let city = self.state.cities[ci].clone();
            let capital = self.state.buildings.iter().position(|b| Some(b.id) == city.center);
            let soldiers = self.state.units.iter().any(|u| {
                u.hp > 0.0
                    && u.team == 0
                    && matches!(u.ty, UType::Sword | UType::Archer | UType::Knight | UType::Standard)
                    && match capital {
                        Some(cb) => surface_distance(Pt::new(u.x, u.y), &Target::from_building(&self.state.buildings[cb])) < 35.0,
                        None => dist(Pt::new(u.x, u.y), Pt::new(city.x, city.y)) < 100.0,
                    }
            });
            if !soldiers {
                continue;
            }
            {
                let c = &mut self.state.cities[ci];
                c.capture = 12.0;
                c.captured = true;
            }
            if self.state.cities[ci].reward_claimed != Some(true) {
                let reward = self.state.cities[ci].reward.unwrap_or(Resources { food: 1800.0, wood: 2400.0, stone: 1800.0, gold: 2200.0 });
                for r in Res::ALL {
                    *self.state.resources.get_mut(r) += reward.get(r);
                }
                let c = &mut self.state.cities[ci];
                c.reward_claimed = Some(true);
                c.reward = Some(reward);
                self.state.stats.cities_captured = Some(self.state.stats.cities_captured.unwrap_or(0.0) + 1.0);
            }
            for b in self.state.buildings.iter_mut() {
                if b.city == Some(city.id) && b.hp > 0.0 {
                    b.team = 0;
                    if b.kind == BKind::Gate {
                        b.closed = Some(false);
                    }
                }
            }
            for u in self.state.units.iter_mut() {
                if u.city == Some(city.id) && u.hp > 0.0 {
                    u.team = 0;
                    if u.ty == UType::Civilian {
                        u.ty = UType::Worker;
                        u.max_hp = data().ty(UType::Worker).hp;
                        u.hp = u.max_hp;
                    }
                    u.city_defender = Some(false);
                    u.target = None;
                    u.order = None;
                    u.hold = false;
                    u.path.clear();
                    u.home = None;
                }
            }
            self.state.nav_dirty = true;
            self.refresh_fog();
            self.toast(format!("{} captured! +1,800 food, +2,400 wood, +1,800 stone, +2,200 gold. Surviving defenders and buildings join your host.", city.name));
            self.sound("horn", None);
        }
    }

    pub fn update_sites(&mut self, dt: f64) {
        let nsites = self.state.sites.len();
        for si in 0..nsites {
            if self.state.sites[si].name == "Pilgrim refuge" {
                continue;
            }
            let s = self.state.sites[si].clone();
            let owner = s.team.unwrap_or(if s.captured { 0 } else { 2 });
            let mut counts = [0i32; 2];
            for u in &self.state.units {
                if u.hp > 0.0
                    && u.team < 2
                    && !matches!(u.ty, UType::Worker | UType::Civilian | UType::Chaplain | UType::Trebuchet | UType::Pilgrim | UType::Merchant)
                    && dist(Pt::new(u.x, u.y), Pt::new(s.x, s.y)) < s.r
                {
                    counts[u.team as usize] += 1;
                }
            }
            let claimant: Option<i32> = if counts[0] >= 3 && counts[1] == 0 {
                Some(0)
            } else if counts[1] >= 3 && counts[0] == 0 {
                Some(1)
            } else {
                None
            };
            self.state.sites[si].team = Some(owner);
            match claimant {
                Some(c) if c != owner => {
                    {
                        let st = &mut self.state.sites[si];
                        if st.claiming_team != Some(c) {
                            st.claiming_team = Some(c);
                            st.claim_progress = Some(0.0);
                        }
                        st.claim_progress = Some(1f64.min(st.claim_progress.unwrap_or(0.0) + dt / 18.0));
                    }
                    if self.state.sites[si].claim_progress.unwrap_or(0.0) >= 1.0 {
                        {
                            let st = &mut self.state.sites[si];
                            st.team = Some(c);
                            st.captured = c == 0;
                            st.progress = 1.0;
                            st.claim_progress = Some(0.0);
                            st.claiming_team = None;
                        }
                        for b in self.state.buildings.iter_mut() {
                            if b.site == Some(s.id) && b.hp > 0.0 {
                                b.team = c;
                            }
                        }
                        for u in self.state.units.iter_mut() {
                            if u.site == Some(s.id) && u.hp > 0.0 {
                                u.team = c;
                                if u.ty == UType::Civilian {
                                    u.ty = UType::Worker;
                                    u.max_hp = data().ty(UType::Worker).hp;
                                    u.hp = u.max_hp;
                                }
                                u.home = None;
                                u.order = None;
                                u.job = None;
                                u.target = None;
                                u.path.clear();
                                u.hold = false;
                            }
                        }
                        self.toast(format!("{}{}", s.name, if c == 0 { " secured. Its residents now serve as villagers." } else { " captured by the opposing host." }));
                        self.sound("bell", None);
                    }
                }
                _ => {
                    let st = &mut self.state.sites[si];
                    st.claim_progress = Some(0f64.max(st.claim_progress.unwrap_or(0.0) - dt / 18.0));
                }
            }
            let st = &mut self.state.sites[si];
            st.captured = st.team == Some(0);
            if st.team == Some(2) {
                st.progress = st.claim_progress.unwrap_or(0.0);
            }
        }
    }

    // ---- Colossus --------------------------------------------------------------

    fn colossus_scatter(d: f64) -> f64 {
        20.0 + d * 0.045
    }

    fn colossus_impact(&mut self, bi: usize, target: Pt) -> Pt {
        let (w, h) = (self.geo.w, self.geo.h);
        let (bx, by, id) = (self.state.buildings[bi].x, self.state.buildings[bi].y, self.state.buildings[bi].id as f64);
        let d = dist(Pt::new(bx, by), target);
        let radius = Self::colossus_scatter(d);
        let shot = self.state.buildings[bi].shots.unwrap_or(0.0) + 1.0;
        self.state.buildings[bi].shots = Some(shot);
        let h1 = sin(id * 12.9898 + shot * 78.233) * 43758.5453;
        let h2 = sin(id * 93.9898 + shot * 67.345) * 24634.6345;
        let angle = (h1 - h1.floor()) * std::f64::consts::PI * 2.0;
        let reach = radius * (h2 - h2.floor()).sqrt();
        Pt::new(clamp(target.x + cos(angle) * reach, 10.0, w - 10.0), clamp(target.y + sin(angle) * reach, 10.0, h - 10.0))
    }

    fn colossus_tick(&mut self, bi: usize, dt: f64) {
        let d = data();
        {
            let b = &mut self.state.buildings[bi];
            b.guard_cooldown = 0f64.max(b.guard_cooldown - dt);
        }
        let (bx, by, bteam) = {
            let b = &self.state.buildings[bi];
            (b.x, b.y, b.team)
        };
        let mut target: Option<Pt> = self.state.buildings[bi].fire_target;
        if let Some(at) = self.state.buildings[bi].attack_target {
            let locked = self.get_object(at);
            let bad = match locked {
                None => true,
                Some(o) => self.obj_hp(o) <= 0.0 || self.obj_team(o) == bteam || self.obj_team(o) == 2,
            };
            if bad {
                self.state.buildings[bi].attack_target = None;
            } else {
                target = Some(self.obj_pos(locked.unwrap()));
            }
        }
        let Some(t) = target else { return };
        if dist(Pt::new(bx, by), t) < COLOSSUS_MIN_RANGE {
            return;
        }
        let aim = atan2(t.y - by, t.x - bx);
        let b = &mut self.state.buildings[bi];
        let cur = *b.aim_angle.get_or_insert(-std::f64::consts::PI / 2.0);
        let delta = atan2(sin(aim - cur), cos(aim - cur));
        b.aim_angle = Some(cur + clamp(delta, -0.85 * dt, 0.85 * dt));
        if b.guard_cooldown > 0.0 || delta.abs() > 0.06 {
            return;
        }
        let hit = self.colossus_impact(bi, t);
        let now = self.state.time;
        let b = &mut self.state.buildings[bi];
        b.guard_cooldown = d.bld(BKind::Colossus).reload.unwrap();
        b.last_shot = Some(now);
        let id = b.id;
        self.sound("great-launch", Some((bx, by, bteam)));
        self.state.boulders.push(Boulder {
            x: bx,
            y: by,
            tx: hit.x,
            ty: hit.y,
            sx: bx,
            sy: by,
            t: 0.0,
            duration: 3.6 + dist(Pt::new(bx, by), hit) / 1500.0,
            heavy: true,
            team: bteam,
            source: Some(id),
            damage: d.bld(BKind::Colossus).damage.unwrap(),
            r: 230.0,
            lift: Some(300.0),
            hit: None,
            extra: Default::default(),
        });
    }

    // ---- objectives -------------------------------------------------------------

    pub fn objective_state(&self) -> Objective {
        let d = data();
        let l = &d.levels[self.state.level];
        let rules = self.state.campaign_rules.as_ref();
        let fort = self.state.buildings.get(1);
        if self.state.mode == "quickmatch" {
            let remaining = self.state.buildings.iter().filter(|b| b.team == 1 && matches!(b.kind, BKind::Fort | BKind::Towncenter) && b.hp > 0.0).count();
            return Objective { progress: if remaining > 0 { 0.0 } else { 1.0 }, text: "Destroy the enemy town center".into(), won: remaining == 0 };
        }
        let rf = |v: Option<f64>, def: f64| -> f64 { v.filter(|x| *x != 0.0).unwrap_or(def) };
        match l.kind {
            "settlement" => {
                let farms = self.complete_buildings(Some(BKind::Farm), 0).len() as f64;
                let food = self.state.stats.gathered.food;
                let rfarms = rf(rules.map(|r| r.farms), 2.0);
                let rfood = rf(rules.map(|r| r.food), 200.0);
                let owned = fort.map(|f| f.team == 0).unwrap_or(false);
                Objective {
                    progress: (rfarms.min(farms) / rfarms + rfood.min(food) / rfood + if owned { 1.0 } else { 0.0 }) / 3.0,
                    text: format!(
                        "Farms {}/{} \u{b7} food gathered {}/{} \u{b7} outpost {}",
                        rfarms.min(farms),
                        rfarms,
                        rfood.min(food).floor(),
                        rfood,
                        if owned { "secured" } else { "unclaimed" }
                    ),
                    won: farms >= rfarms && food >= rfood && owned,
                }
            }
            "escort" => {
                let (rx, ry) = (river_x(&self.state, self.geo.w, 1150.0), 1150.0);
                let tower = self.complete_buildings(None, 0).into_iter().any(|b| {
                    let bb = &self.state.buildings[b];
                    matches!(bb.kind, BKind::Tower | BKind::Watchtower) && dist(Pt::new(bb.x, bb.y), Pt::new(rx, ry)) < 280.0
                });
                let rescued = self.state.stats.rescued;
                Objective {
                    progress: (2f64.min(rescued) / 2.0 + if tower { 1.0 } else { 0.0 }) / 2.0,
                    text: format!("Pilgrims {}/2 \u{b7} bridge {}", rescued, if tower { "fortified" } else { "unsecured" }),
                    won: rescued >= 2.0 && tower,
                }
            }
            "survival" => {
                let chapel = !self.complete_buildings(Some(BKind::Chapel), 0).is_empty();
                let surv = rf(rules.map(|r| r.survival), 360.0);
                let t = self.state.time;
                Objective {
                    progress: (surv.min(t) / surv + if chapel { 1.0 } else { 0.0 }) / 2.0,
                    text: format!("Hold {}/{}s \u{b7} chapel {}", t.min(surv).floor(), surv, if chapel { "complete" } else { "needed" }),
                    won: t >= surv && chapel,
                }
            }
            "liberation" => {
                let sites = self.state.sites.iter().filter(|s| s.optional != Some(true) && s.captured).count() as f64;
                let hold = rf(rules.map(|r| r.hold), 90.0);
                let delivered = self.state.stats.delivered.unwrap_or(0.0);
                let deliveries = rules.map(|r| r.deliveries).unwrap_or(0.0);
                Objective {
                    progress: (sites / 2.0 + hold.min(self.state.occupation) / hold) / 2.0,
                    text: format!("Supplies {}/{} | villages {}/2 \u{b7} hold {}/{}s", delivered, deliveries, sites, self.state.occupation.floor(), hold),
                    won: sites == 2.0 && self.state.occupation >= hold && delivered >= deliveries,
                }
            }
            "siege" => {
                let gates = self.state.buildings.iter().filter(|b| b.gate == Some(true) && b.hp <= 0.0).count() as f64;
                let rg = rf(rules.map(|r| r.gates), 2.0);
                let hits = self.state.stats.siege_hits;
                Objective {
                    progress: (rg.min(gates) / rg + if hits > 0.0 { 1.0 } else { 0.0 }) / 2.0,
                    text: format!("Gatehouses {}/{} \u{b7} siege hits {}", gates, rg, hits),
                    won: gates >= rg && hits > 0.0,
                }
            }
            _ => {
                let sites = self.state.sites.iter().filter(|s| s.optional != Some(true) && s.captured).count() as f64;
                let hold = rf(rules.map(|r| r.hold), 90.0);
                let taken = self.state.citadel_taken;
                Objective {
                    progress: ((if taken { 1.0 } else { 0.0 }) + sites / 2.0 + hold.min(self.state.occupation) / hold) / 3.0,
                    text: format!("Sites {}/2 \u{b7} citadel {} \u{b7} hold {}/{}s", sites, if taken { "taken" } else { "standing" }, self.state.occupation.floor(), hold),
                    won: taken && sites == 2.0 && self.state.occupation >= hold,
                }
            }
        }
    }

    // ---- the step ------------------------------------------------------------------

    pub fn update(&mut self, dt: f64) {
        if !self.playable() {
            return;
        }
        let d = data();
        let own_capital = self
            .state
            .buildings
            .iter()
            .find(|b| Some(b.id) == self.state.capitals.player)
            .or_else(|| self.state.buildings.iter().find(|b| b.team == 0 && b.kind == BKind::Towncenter))
            .map(|b| b.hp);
        let enemy_capital = self
            .state
            .buildings
            .iter()
            .find(|b| Some(b.id) == self.state.capitals.enemy)
            .or_else(|| self.state.buildings.iter().find(|b| b.team == 1 && b.kind == BKind::Towncenter))
            .map(|b| b.hp);
        if own_capital.map(|h| h <= 0.0).unwrap_or(false) {
            self.finish(false);
            return;
        }
        let outpost = self.state.buildings.get(1).and_then(|b| b.outpost).unwrap_or(false);
        if enemy_capital.map(|h| h <= 0.0).unwrap_or(false)
            || (self.state.mode != "quickmatch" && self.state.campaign_rules.is_none() && !outpost && self.state.buildings.get(1).map(|b| b.hp <= 0.0).unwrap_or(false))
        {
            self.finish(true);
            return;
        }
        if self.cheat_flag("instant") {
            for b in self.state.buildings.iter_mut() {
                if b.team == 0 && b.hp > 0.0 {
                    if b.progress < 1.0 {
                        b.progress = 1.0;
                        b.hp = b.max_hp;
                        self.state.nav_dirty = true;
                    }
                    if let Some(q) = b.queue.first_mut() {
                        q.time = q.duration;
                    }
                }
            }
        }
        self.state.time += dt;
        self.vision_timer -= dt;
        if self.vision_timer <= 0.0 {
            self.refresh_fog();
            let shots = self.siege_shots();
            self.militia_fog.update(&self.state.units, &self.state.buildings, &shots, &[]);
            self.vision_timer = 0.2;
        }
        self.state.wave_timer -= dt;
        self.campaign_pressure(dt);
        self.state.screen_shake = Some(0f64.max(self.state.screen_shake.unwrap_or(0.0) - dt * 16.0));
        self.state.save_timer -= dt;
        let food_use = self.fighters(0).len() as f64 * 0.025 * dt;
        self.state.resources.food = 0f64.max(self.state.resources.food - food_use);
        let consumption = self.state.enemy.resources.food.min(self.fighters(1).len() as f64 * 0.025 * dt);
        self.state.enemy.consumed += consumption;
        let chaplains1 = self.fighters(1).iter().filter(|&&u| self.state.units[u].ty == UType::Chaplain).count() as f64;
        let chapels1 = self.complete_buildings(Some(BKind::Chapel), 1).len() as f64;
        self.state.enemy.faith = 250f64.min(self.state.enemy.faith + (chaplains1 * 0.55 + chapels1 * 0.5) * dt);
        let f1 = self.fighters(1).len() as f64 * 0.025 * dt;
        self.state.enemy.resources.food = 0f64.max(self.state.enemy.resources.food - f1);
        let chaplains0 = self.fighters(0).iter().filter(|&&u| self.state.units[u].ty == UType::Chaplain).count() as f64;
        let chapels0 = self.complete_buildings(Some(BKind::Chapel), 0).len() as f64;
        self.state.faith = 250f64.min(self.state.faith + (chaplains0 * 0.55 + chapels0 * 0.5) * dt);
        if self.state.nav_combat && self.state.time - self.state.nav_at >= 0.3 {
            self.state.nav_dirty = true;
        }
        if self.state.nav_dirty {
            self.state.nav_dirty = false;
            self.rebuild_navigation();
        }
        self.rebuild_spatial();
        let gt = self.state.gate_timer.unwrap_or(0.0) - dt;
        self.state.gate_timer = Some(gt);
        if gt <= 0.0 {
            self.state.gate_timer = Some(0.25);
            self.update_gates();
        }
        self.update_scouting(dt);
        self.update_formations();
        self.strategic_ai(dt);
        self.update_buildings(dt);
        // Units.
        let n = self.state.units.len();
        for ui in 0..n {
            if self.state.units[ui].hp <= 0.0 {
                continue;
            }
            {
                let u = &mut self.state.units[ui];
                u.moving = false;
                u.working = false;
                u.cooldown -= dt;
                u.strike = 0f64.max(u.strike - dt);
                u.blessed = 0f64.max(u.blessed - dt);
            }
            let (auto_scout, ty) = (self.state.units[ui].auto_scout.is_some(), self.state.units[ui].ty);
            if auto_scout {
                let u = &mut self.state.units[ui];
                u.target = None;
                if ty == UType::Trebuchet && u.deployment == "packing" {
                    u.deploy_timer -= dt;
                    if u.deploy_timer <= 0.0 {
                        u.deployment = "packed".into();
                        u.order = u.pending_order.take();
                    }
                }
                if self.state.units[ui].order.is_some() {
                    self.march_unit(ui, dt);
                }
            } else {
                match ty {
                    UType::Worker => self.worker_ai(ui, dt),
                    UType::Civilian => self.civilian_ai(ui, dt),
                    UType::Pilgrim | UType::Merchant => self.caravan_ai(ui, dt),
                    _ => self.combat_ai(ui, dt),
                }
            }
        }
        self.crowd_separation(dt);
        self.update_arrows(dt);
        self.update_boulders(dt);
        self.capture_cities(dt);
        self.update_sites(dt);
        let all_captured = self.state.sites.iter().filter(|s| s.optional != Some(true)).all(|s| s.captured);
        if (self.state.citadel_taken || d.levels[self.state.level].kind == "liberation") && all_captured {
            self.state.occupation += dt;
        } else {
            self.state.occupation = 0.0;
        }
        if let Some(alerts) = self.state.alerts.as_mut() {
            if !alerts.is_empty() {
                for a in alerts.iter_mut() {
                    let t = a.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) + dt;
                    a["t"] = serde_json::json!(t);
                }
                alerts.retain(|a| a.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) < 8.0);
            }
        }
        for r in self.state.rings.iter_mut() {
            let t = r.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) + dt;
            r["t"] = serde_json::json!(t);
        }
        self.state.rings.retain(|r| r.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) < 1.0);
        if self.state.rings.len() > 80 {
            let cut = self.state.rings.len() - 80;
            self.state.rings.drain(0..cut);
        }
        for c in self.state.corpses.iter_mut() {
            let t = c.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) + dt;
            c["t"] = serde_json::json!(t);
        }
        for m in self.state.marks.iter_mut() {
            let t = m.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) + dt;
            m["t"] = serde_json::json!(t);
        }
        if self.state.corpses.len() > 260 {
            let cut = self.state.corpses.len() - 260;
            self.state.corpses.drain(0..cut);
        }
        if self.state.marks.len() > 260 {
            let cut = self.state.marks.len() - 260;
            self.state.marks.drain(0..cut);
        }
        self.state.units.retain(|u| u.hp > 0.0);
        let units = &self.state.units;
        self.state.squads.retain(|s| s.role == "guard" || units.iter().any(|u| u.squad.as_deref() == Some(s.id.as_str())));
        if let Some(rules) = &self.state.campaign_rules {
            if rules.deliveries != 0.0 {
                let pending = self.state.units.iter().filter(|u| u.ty == UType::Merchant && u.mission_supply == Some(true)).count() as f64;
                if self.state.stats.delivered.unwrap_or(0.0) + pending < rules.deliveries {
                    self.finish(false);
                    return;
                }
            }
        }
        if d.levels[self.state.level].kind == "escort" {
            let pilgrims = self.state.units.iter().filter(|u| u.ty == UType::Pilgrim).count() as f64;
            if self.state.stats.rescued + pilgrims < 2.0 {
                self.finish(false);
                return;
            }
        }
        {
            let (state, geo) = (&self.state, &self.geo);
            let now = self.state.time;
            self.nav.process(self.nav_jobs_per_step, now, &|x, y| ground_free(state, geo, x, y, 6.0, None, Adj::No));
        }
        if self.objective_state().won {
            self.finish(true);
        }
        if self.state.save_timer <= 0.0 {
            self.state.save_timer = 20.0;
            self.events.push(Event::Autosave);
        }
    }

    pub fn cheat_flag(&self, name: &str) -> bool {
        self.state.cheats.as_ref().and_then(|c| c.get(name)).map(|v| v.as_bool().unwrap_or(false)).unwrap_or(false)
    }

    fn update_gates(&mut self) {
        let n = self.state.buildings.len();
        for gi in 0..n {
            {
                let g = &self.state.buildings[gi];
                if g.kind != BKind::Gate || g.hp <= 0.0 || g.progress < 1.0 || g.team == 2 {
                    continue;
                }
            }
            let (gx, gy, gteam, auto_closed, closed, defence, militia) = {
                let g = &self.state.buildings[gi];
                (g.x, g.y, g.team, g.auto_closed.unwrap_or(false), g.closed.unwrap_or(false), g.defence.unwrap_or(false), g.militia_passage.unwrap_or(false))
            };
            let passage = gteam == 3
                && self.nearby_at(gx, gy, 280.0).into_iter().any(|u| {
                    let un = &self.state.units[u];
                    un.team == 3 && un.regional_mission.is_some() && un.hp > 0.0 && dist(Pt::new(un.x, un.y), Pt::new(gx, gy)) < 280.0
                });
            if gteam == 3 && passage && closed {
                let g = &mut self.state.buildings[gi];
                g.closed = Some(false);
                g.militia_passage = Some(true);
                self.state.nav_dirty = true;
            } else if gteam == 3 && militia && !passage {
                let g = &mut self.state.buildings[gi];
                g.closed = Some(true);
                g.militia_passage = None;
                self.state.nav_dirty = true;
            }
            let (closed, auto_closed) = {
                let g = &self.state.buildings[gi];
                (g.closed.unwrap_or(false), g.auto_closed.unwrap_or(auto_closed))
            };
            let radius = if auto_closed { 200.0 } else { 145.0 };
            let d = data();
            let threat = self.nearby_at(gx, gy, radius).into_iter().any(|u| {
                let un = &self.state.units[u];
                un.hp > 0.0 && un.team != gteam && un.team != 2 && d.ty(un.ty).damage > 0.0 && self.observer_sees(gteam, gx, gy)
            });
            let g = &mut self.state.buildings[gi];
            if threat && !closed {
                g.closed = Some(true);
                g.auto_closed = Some(true);
                self.state.nav_dirty = true;
            } else if !threat && auto_closed {
                g.closed = Some(false);
                g.auto_closed = Some(false);
                self.state.nav_dirty = true;
            } else if gteam == 1 && defence && !threat && closed {
                g.closed = Some(false);
                self.state.nav_dirty = true;
            }
        }
    }

    fn update_buildings(&mut self, dt: f64) {
        let d = data();
        let ids: Vec<u32> = self.state.buildings.iter().map(|b| b.id).collect();
        for id in ids {
            let Some(mut bi) = self.state.buildings.iter().position(|b| b.id == id) else { continue };
            // Stale upgrade reservations.
            if let Some(owner_id) = self.state.buildings[bi].upgrade_owner {
                let ok = match self.get_object(owner_id) {
                    Some(Obj::Building(oi)) => self.state.buildings[oi].hp > 0.0 && self.state.buildings[oi].queue.iter().any(|q| q.extra.get("partnerId").and_then(|v| v.as_u64()) == Some(id as u64)),
                    _ => false,
                };
                if !ok {
                    self.state.buildings[bi].upgrade_owner = None;
                }
            }
            {
                let b = &self.state.buildings[bi];
                if b.hp <= 0.0 || b.progress < 1.0 {
                    continue;
                }
            }
            // Gate upgrade validity.
            if let Some(item) = self.state.buildings[bi].queue.first().cloned() {
                if item.kind == "building-upgrade" && item.extra.get("targetKind").and_then(|v| v.as_str()) == Some("gate") {
                    let partner = item.extra.get("partnerId").and_then(|v| v.as_u64()).and_then(|p| self.get_object(p as u32));
                    let bad = match partner {
                        None => true,
                        Some(Obj::Building(pi)) => self.state.buildings[pi].hp <= 0.0 || !self.straight_wall(bi) || !self.straight_wall(pi),
                        _ => true,
                    };
                    if bad {
                        self.state.buildings[bi].queue.remove(0);
                        self.release_wall_upgrade(bi, &item);
                        if let Some(c) = &item.cost {
                            self.pay_json(c, -1.0, 0);
                        }
                        continue;
                    }
                }
            }
            if !self.state.buildings[bi].queue.is_empty() {
                self.state.buildings[bi].queue[0].time += dt;
                let done = {
                    let q = &self.state.buildings[bi].queue[0];
                    q.time >= q.duration
                };
                if done {
                    let item = self.state.buildings[bi].queue.remove(0);
                    if item.kind == "building-upgrade" {
                        self.complete_wall_upgrade(bi, &item);
                        // The gate replaced two walls; re-find this building's slot.
                        match self.state.buildings.iter().position(|b| b.id == id) {
                            Some(p) => bi = p,
                            None => continue,
                        }
                    } else if item.kind == "research" {
                        let key = item.tech.clone().unwrap_or_default();
                        let t = d.tech(&key).unwrap();
                        let bteam = self.state.buildings[bi].team;
                        if let Some(unlock) = t.unlock {
                            if bteam == 0 {
                                self.state.techs.insert(key.clone(), true);
                            } else {
                                self.state.enemy.techs.get_or_insert_with(Default::default).insert(key.clone(), true);
                            }
                            if bteam == 0 {
                                self.toast(format!("{} researched. The {} can now be built.", t.name, d.bld(unlock).name.to_lowercase()));
                            }
                        } else {
                            let tyname = match t.ty.unwrap() {
                                UType::Sword => "sword",
                                UType::Archer => "archer",
                                UType::Knight => "knight",
                                UType::Chaplain => "chaplain",
                                UType::Standard => "standard",
                                _ => "trebuchet",
                            };
                            let map = if bteam == 0 { &mut self.state.upgrades } else { &mut self.state.enemy.upgrades };
                            map.insert(tyname.to_string(), t.rank as f64);
                            if bteam == 0 {
                                self.state.techs.insert(key.clone(), true);
                            }
                            for ui in 0..self.state.units.len() {
                                if self.state.units[ui].team == bteam && self.state.units[ui].ty == t.ty.unwrap() {
                                    self.apply_rank(ui, t.rank as f64);
                                }
                            }
                            if bteam == 0 {
                                self.toast(format!("{} upgrade complete. Your whole company has been upgraded.", t.name));
                            }
                        }
                    } else {
                        let ty = item.ty.unwrap_or(UType::Sword);
                        let p = self.spawn_point(bi);
                        let mut u = self.make_unit(ty, self.state.buildings[bi].team, p.x, p.y);
                        let (bteam, bcity, rally) = (self.state.buildings[bi].team, self.state.buildings[bi].city, self.state.buildings[bi].rally);
                        if bteam == 3 {
                            if let Some(c) = bcity {
                                u.city = Some(c);
                                u.city_defender = Some(true);
                                u.home = Some(p);
                            }
                        }
                        self.state.units.push(u);
                        let ui = self.state.units.len() - 1;
                        let rank = self.rank_for(ty, bteam);
                        self.apply_rank(ui, rank);
                        if let Some(r) = rally {
                            let pos = self.rally_position(ui, r);
                            self.state.units[ui].order = Some(Order { x: pos.x, y: pos.y, rally: Some(r), attack: Some(true), ..Default::default() });
                        }
                        if bteam == 0 {
                            let name = crate::names::unit_name(&self.state.units[ui]);
                            self.toast(format!("{} has joined the settlement.", name));
                        }
                        self.sound("recruit", None);
                    }
                }
            }
            let (kind, progress, bteam) = {
                let b = &self.state.buildings[bi];
                (b.kind, b.progress, b.team)
            };
            if kind == BKind::Colossus && progress >= 1.0 && bteam != 2 {
                self.colossus_tick(bi, dt);
            }
            let spec = d.bld(kind);
            if spec.range.is_some() && bteam != 2 {
                self.state.buildings[bi].guard_cooldown -= dt;
                if self.state.buildings[bi].guard_cooldown <= 0.0 {
                    self.building_fire(bi, dt);
                }
            }
            let (bx, by, kind, bteam) = {
                let b = &self.state.buildings[bi];
                (b.x, b.y, b.kind, b.team)
            };
            if kind == BKind::Chapel && bteam != 2 {
                for ui in self.nearby_at(bx, by, 180.0) {
                    let u = &self.state.units[ui];
                    if u.team == bteam && u.hp < u.max_hp {
                        let heal = (u.max_hp - u.hp).min(dt * 2.0);
                        self.state.units[ui].hp += heal;
                        self.state.healed += heal;
                    }
                }
            }
        }
    }

    fn building_fire(&mut self, bi: usize, dt: f64) {
        let d = data();
        let (kind, bx, by, bteam, bid) = {
            let b = &self.state.buildings[bi];
            (b.kind, b.x, b.y, b.team, b.id)
        };
        let spec = d.bld(kind);
        let bpt = Pt::new(bx, by);
        let engine_stance = self.state.buildings[bi].stance.clone().unwrap_or_else(|| "fight".into());
        let mut locked: Option<Obj> = if kind == BKind::Greatengine && engine_stance != "stand-down" { self.state.buildings[bi].attack_target.and_then(|t| self.get_object(t)) } else { None };
        if let Some(l) = locked {
            if self.obj_team(l) == bteam || self.obj_team(l) == 2 {
                self.state.buildings[bi].attack_target = None;
                locked = None;
            }
        }
        // Target: (position, object if any).
        let target: Option<(Pt, Option<Obj>)> = if kind == BKind::Greatengine {
            if engine_stance == "stand-down" {
                None
            } else if let Some(ft) = self.state.buildings[bi].fire_target {
                let dd = dist(bpt, ft);
                if dd >= spec.min_range.unwrap() && dd <= spec.range.unwrap() {
                    Some((ft, None))
                } else {
                    None
                }
            } else if let Some(l) = locked {
                let lp = self.obj_pos(l);
                let dd = dist(bpt, lp);
                if dd >= spec.min_range.unwrap() && dd <= spec.range.unwrap() {
                    Some((lp, Some(l)))
                } else {
                    None
                }
            } else if engine_stance == "hold" {
                None
            } else {
                let mut c: Vec<usize> = (0..self.state.buildings.len())
                    .filter(|&i| {
                        let e = &self.state.buildings[i];
                        e.team != bteam
                            && e.team != 2
                            && e.hp > 0.0
                            && dist(bpt, Pt::new(e.x, e.y)) >= spec.min_range.unwrap()
                            && dist(bpt, Pt::new(e.x, e.y)) <= spec.range.unwrap()
                            && self.observer_sees(bteam, e.x, e.y)
                    })
                    .collect();
                c.sort_by(|&a, &b| cmp(dist(Pt::new(self.state.buildings[a].x, self.state.buildings[a].y), bpt), dist(Pt::new(self.state.buildings[b].x, self.state.buildings[b].y), bpt)));
                c.first().map(|&i| (Pt::new(self.state.buildings[i].x, self.state.buildings[i].y), Some(Obj::Building(i))))
            }
        } else {
            let range = spec.range.unwrap();
            let mut c: Vec<usize> = self.nearby_at(bx, by, range).into_iter().filter(|&u| self.state.units[u].team != bteam && self.state.units[u].team != 2 && self.observer_sees(bteam, self.state.units[u].x, self.state.units[u].y)).collect();
            c.sort_by(|&a, &b| cmp(dist(self.unit_pt(a), bpt), dist(self.unit_pt(b), bpt)));
            c.first().map(|&i| (self.unit_pt(i), Some(Obj::Unit(i))))
        };
        let Some((tpos, tobj)) = target else { return };
        if kind == BKind::Greatengine {
            let aim = atan2(tpos.y - by, tpos.x - bx);
            let b = &mut self.state.buildings[bi];
            let cur = *b.aim_angle.get_or_insert(-std::f64::consts::PI / 2.0);
            let delta = atan2(sin(aim - cur), cos(aim - cur));
            b.aim_angle = Some(cur + clamp(delta, -0.85 * dt, 0.85 * dt));
            if delta.abs() > 0.06 {
                return;
            }
            b.guard_cooldown = 18.0;
            let now = self.state.time;
            b.last_shot = Some(now);
            self.sound("great-launch", Some((bx, by, bteam)));
            self.state.boulders.push(Boulder {
                x: bx,
                y: by,
                tx: tpos.x,
                ty: tpos.y,
                sx: bx,
                sy: by,
                t: 0.0,
                duration: 3.6 + dist(bpt, tpos) / 1500.0,
                heavy: true,
                team: bteam,
                source: Some(bid),
                damage: spec.damage.unwrap(),
                r: 230.0,
                lift: Some(150.0),
                hit: None,
                extra: Default::default(),
            });
            return;
        }
        self.state.buildings[bi].guard_cooldown = 2.3;
        if let Some(t) = tobj {
            self.projectile(bx, by, bteam, UType::Archer, t, spec.damage.unwrap());
        }
    }

    fn crowd_separation(&mut self, dt: f64) {
        let crowding = |u: &Unit| u.moving || (u.target.is_some() && u.ty != UType::Trebuchet && u.ty != UType::Archer && u.ty != UType::Chaplain);
        let n = self.state.units.len();
        for ui in 0..n {
            {
                let u = &self.state.units[ui];
                if u.hp <= 0.0 || !crowding(u) {
                    continue;
                }
            }
            let my_r = if crate::movement::is_heavy(self.state.units[ui].ty) { 26.0 } else { 14.0 };
            for oi in self.nearby(ui, my_r + 28.0) {
                let (oid, ohp, oty) = {
                    let o = &self.state.units[oi];
                    (o.id, o.hp, o.ty)
                };
                if oid <= self.state.units[ui].id || ohp <= 0.0 {
                    continue;
                }
                let other_r = if crate::movement::is_heavy(oty) { 26.0 } else { 14.0 };
                let (up, op) = (self.unit_pt(ui), self.unit_pt(oi));
                let dd = dist(up, op);
                let min_dist = (my_r + other_r) * 0.85;
                if dd < min_dist && dd > 0.1 {
                    let push = (min_dist - dd) * 0.08f64.min(dt * 2.0);
                    let dx = ((up.x - op.x) / dd) * push;
                    let dy = ((up.y - op.y) / dd) * push;
                    if self.ground_free(up.x + dx, up.y + dy, 6.0) {
                        self.state.units[ui].x += dx;
                        self.state.units[ui].y += dy;
                    }
                    if crowding(&self.state.units[oi]) && self.ground_free(op.x - dx, op.y - dy, 6.0) {
                        self.state.units[oi].x -= dx;
                        self.state.units[oi].y -= dy;
                    }
                }
            }
        }
    }

    fn update_arrows(&mut self, dt: f64) {
        let mut arrows = std::mem::take(&mut self.state.arrows);
        for a in arrows.iter_mut() {
            let target = a.target.and_then(|t| self.get_object(t));
            if let Some(t) = target {
                if self.obj_hp(t) > 0.0 {
                    let p = self.obj_pos(t);
                    a.tx = p.x;
                    a.ty = p.y;
                }
            }
            let dd = hypot(a.tx - a.x, a.ty - a.y);
            if dd < 480.0 * dt {
                if let Some(t) = target {
                    if self.obj_hp(t) > 0.0 {
                        self.damage(t, a.damage, Some(DmgSource { id: Some(0), team: a.team, ty: Some(if a.siege { UType::Ballista } else { UType::Archer }) }), a.siege);
                    }
                }
                a.life = 0.0;
            } else {
                a.x += ((a.tx - a.x) / dd) * 480.0 * dt;
                a.y += ((a.ty - a.y) / dd) * 480.0 * dt;
                a.life -= dt;
            }
        }
        arrows.retain(|a| a.life > 0.0);
        // Arrows fired during damage() (none) would be lost; merge any new ones.
        let fresh = std::mem::take(&mut self.state.arrows);
        arrows.extend(fresh);
        self.state.arrows = arrows;
    }

    fn update_boulders(&mut self, dt: f64) {
        let mut boulders = std::mem::take(&mut self.state.boulders);
        for stone in boulders.iter_mut() {
            stone.t += dt;
            let flight = clamp(0f64.max(stone.t - dt * 2.0) / stone.duration, 0.0, 1.0);
            stone.x = stone.sx + (stone.tx - stone.sx) * flight;
            stone.y = stone.sy + (stone.ty - stone.sy) * flight;
            if stone.t >= stone.duration && stone.hit != Some(true) {
                stone.hit = Some(true);
                self.state.shot_sights.get_or_insert_with(Vec::new).push(serde_json::json!({"x": stone.tx, "y": stone.ty, "team": stone.team, "t": 0}));
                let source = DmgSource { id: stone.source, team: stone.team, ty: None };
                let tpt = Pt::new(stone.tx, stone.ty);
                let nunits = self.state.units.len();
                for ui in 0..nunits {
                    let (hp, team, x, y) = {
                        let u = &self.state.units[ui];
                        (u.hp, u.team, u.x, u.y)
                    };
                    if hp > 0.0 && team != 2 {
                        let dd = dist(tpt, Pt::new(x, y));
                        if dd < stone.r {
                            let amount = stone.damage * (1.0 - clamp(dd / (stone.r + 0.0), 0.0, 0.7));
                            self.damage(Obj::Unit(ui), amount, Some(source), true);
                        }
                    }
                }
                let nb = self.state.buildings.len();
                for bi in 0..nb {
                    let (hp, team, x, y, r) = {
                        let b = &self.state.buildings[bi];
                        (b.hp, b.team, b.x, b.y, b.r)
                    };
                    if hp > 0.0 && team != 2 {
                        let dd = dist(tpt, Pt::new(x, y));
                        if dd < stone.r + r * 0.6 {
                            let amount = stone.damage * (1.0 - clamp(dd / (stone.r + r), 0.0, 0.7));
                            self.damage(Obj::Building(bi), amount, Some(source), true);
                        }
                    }
                }
                self.state.rings.push(serde_json::json!({"x": stone.tx, "y": stone.ty, "t": 0, "color": "#efaa4e", "r": stone.r}));
                self.state.marks.push(serde_json::json!({"x": stone.tx, "y": stone.ty, "r": stone.r * if stone.heavy { 0.5 } else { 0.4 }, "t": 0, "kind": "scorch"}));
                if stone.heavy {
                    self.state.rings.push(serde_json::json!({"x": stone.tx, "y": stone.ty, "t": 0, "color": "#ffe2a9", "r": stone.r * 1.8}));
                }
                self.sound(if stone.heavy { "great-impact" } else { "explosion" }, Some((stone.tx, stone.ty, stone.team)));
                self.events.push(Event::Impact { x: stone.tx, y: stone.ty, heavy: stone.heavy });
            }
        }
        boulders.retain(|s| s.hit != Some(true));
        let fresh = std::mem::take(&mut self.state.boulders);
        boulders.extend(fresh);
        self.state.boulders = boulders;
        if let Some(sights) = self.state.shot_sights.as_mut() {
            if !sights.is_empty() {
                for w in sights.iter_mut() {
                    let t = w.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) + dt;
                    w["t"] = serde_json::json!(t);
                }
                sights.retain(|w| w.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0) < 3.0 + 5.0);
            }
        }
    }

    // ---- wall upgrades -------------------------------------------------------------

    pub fn straight_wall(&self, bi: usize) -> bool {
        let b = &self.state.buildings[bi];
        if b.kind != BKind::Wall || b.progress < 1.0 || b.hp <= 0.0 || b.team != 0 {
            return false;
        }
        let links: Vec<&Link> = b.links.as_ref().map(|l| l.values().collect()).unwrap_or_default();
        if links.len() > 2 {
            return false;
        }
        links.len() < 2 || ((links[0].x * links[1].y - links[0].y * links[1].x).abs() < 1.0 && links[0].x * links[1].x + links[0].y * links[1].y < 0.0)
    }

    pub fn release_wall_upgrade(&mut self, bi: usize, item: &QueueItem) {
        let id = self.state.buildings[bi].id;
        if let Some(p) = item.extra.get("partnerId").and_then(|v| v.as_u64()) {
            if let Some(Obj::Building(pi)) = self.get_object(p as u32) {
                if self.state.buildings[pi].upgrade_owner == Some(id) {
                    self.state.buildings[pi].upgrade_owner = None;
                }
            }
        }
    }

    pub fn pay_json(&mut self, cost: &serde_json::Value, mult: f64, team: i32) {
        if let Some(m) = cost.as_object() {
            for (k, v) in m {
                let r = match k.as_str() {
                    "food" => Res::Food,
                    "wood" => Res::Wood,
                    "gold" => Res::Gold,
                    _ => Res::Stone,
                };
                *self.stock_mut(team).get_mut(r) -= v.as_f64().unwrap_or(0.0) * mult;
                if team == 1 {
                    *self.state.enemy.paid.get_mut(r) += v.as_f64().unwrap_or(0.0) * mult;
                }
            }
        }
    }

    pub fn complete_wall_upgrade(&mut self, fi: usize, item: &QueueItem) {
        let d = data();
        let target_kind = item.extra.get("targetKind").and_then(|v| v.as_str()).unwrap_or("");
        if target_kind == "tower" {
            let health = self.state.buildings[fi].hp / self.state.buildings[fi].max_hp;
            let tower = d.bld(BKind::Tower);
            let b = &mut self.state.buildings[fi];
            b.wall_attachment = Some(WallAttachment { x: b.x, y: b.y, w: b.w, h: b.h, wall_angle: b.wall_angle, fortified: Some(b.fortified), links: b.links.clone(), extra: Default::default() });
            b.kind = BKind::Tower;
            b.w = tower.w;
            b.h = tower.h;
            b.r = tower.w.max(tower.h) / 2.0;
            b.max_hp = b.max_hp.max(tower.hp);
            b.guard_cooldown = 1.0;
            b.hp = b.max_hp * health;
            if let (Some(cost), Some(spent)) = (&item.cost, b.spent.as_mut()) {
                if let (Some(c), Some(s)) = (cost.as_object(), spent.as_object_mut()) {
                    for (k, v) in c {
                        let cur = s.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
                        s.insert(k.clone(), serde_json::json!(cur + v.as_f64().unwrap_or(0.0)));
                    }
                }
            }
            self.rebuild_navigation();
            self.toast("Wall upgraded to a guard tower.");
            return;
        }
        let second = item.extra.get("partnerId").and_then(|v| v.as_u64()).and_then(|p| self.get_object(p as u32));
        let si = match second {
            Some(Obj::Building(si)) if self.state.buildings[si].hp > 0.0 && self.straight_wall(fi) && self.straight_wall(si) => si,
            _ => {
                self.release_wall_upgrade(fi, item);
                if let Some(c) = &item.cost {
                    self.pay_json(c, -1.0, 0);
                }
                return;
            }
        };
        let (first, secondb) = (self.state.buildings[fi].clone(), self.state.buildings[si].clone());
        let segments: Vec<GateSegment> = [&first, &secondb]
            .iter()
            .map(|b| GateSegment { x: b.x, y: b.y, w: b.w, h: b.h, wall_angle: b.wall_angle, fortified: Some(b.fortified), links: Some(b.links.clone().unwrap_or_default()), extra: Default::default() })
            .collect();
        let mut gate = self.make_building(BKind::Gate, 0, (first.x + secondb.x) / 2.0, (first.y + secondb.y) / 2.0, 1.0);
        gate.gate_segments = Some(segments.clone());
        gate.gate_angle = Some(atan2(secondb.y - first.y, secondb.x - first.x));
        gate.closed = Some(true);
        gate.rotation = Some(0.0);
        gate.w = (first.x - secondb.x).abs() + 32.0;
        gate.h = (first.y - secondb.y).abs() + 32.0;
        gate.r = hypot(gate.w, gate.h) / 2.0;
        gate.max_hp = gate.max_hp.max(first.max_hp).max(secondb.max_hp);
        if segments.iter().any(|p| p.fortified == Some(true)) {
            gate.bastion_gate = Some(true);
            gate.fortified = true;
            gate.max_hp = d.bld(BKind::Bastiongate).hp;
        }
        gate.hp = (gate.max_hp * (first.hp / first.max_hp + secondb.hp / secondb.max_hp)) / 2.0;
        let (fid, sid, gid) = (first.id, secondb.id, gate.id);
        self.state.buildings.retain(|b| b.id != fid && b.id != sid);
        self.state.buildings.push(gate);
        self.events.push(Event::Replaced { old: vec![fid, sid], new: gid });
        self.rebuild_navigation();
        self.toast("Gatehouse upgrade complete.");
    }
}
