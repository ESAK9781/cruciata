//! Player commands. Each takes explicit entity ids and a team (no UI
//! selection), so the same code drives a local player, the network
//! lockstep and tests. Mirrors `recruit`, `research`, `placeBuild`,
//! `queueWallUpgrade` and `destroySelectedBuilding` in `src/game.js`.

use crate::build::cost_json;
use crate::combat::DmgSource;
use crate::data::data;
use crate::js::hypot;
use crate::model::*;
use crate::nav::Pt;
use crate::sim::{Obj, Sim};

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Command {
    Recruit { ty: UType, producers: Vec<u32> },
    Research { key: String, producer: u32 },
    PlaceBuild { kind: BKind, x: f64, y: f64, rotation: f64, builders: Vec<u32>, append: bool },
    WallUpgrade { kind: BKind, first: u32 },
    Destroy { id: u32 },
    PlaceWall { kind: BKind, ax: f64, ay: f64, bx: f64, by: f64, builders: Vec<u32>, append: bool },
    Scout { units: Vec<u32> },
    ToggleGate { id: u32 },
}

impl Sim {
    fn bidx(&self, id: u32) -> Option<usize> {
        self.state.buildings.iter().position(|b| b.id == id)
    }

    /// Apply a command for `team`; returns whether it took effect.
    pub fn apply(&mut self, team: i32, cmd: &Command) -> bool {
        if !self.playable() {
            return false;
        }
        match cmd {
            Command::Recruit { ty, producers } => self.cmd_recruit(team, *ty, producers),
            Command::Research { key, producer } => self.cmd_research(team, key, *producer),
            Command::PlaceBuild { kind, x, y, rotation, builders, append } => self.cmd_place(team, *kind, Pt::new(*x, *y), *rotation, builders, *append),
            Command::WallUpgrade { kind, first } => self.cmd_wall_upgrade(team, *kind, *first),
            Command::Destroy { id } => self.cmd_destroy(team, *id),
            Command::PlaceWall { kind, ax, ay, bx, by, builders, append } => self.cmd_place_wall(team, *kind, Pt::new(*ax, *ay), Pt::new(*bx, *by), builders, *append),
            Command::Scout { units } => self.cmd_scout(team, units),
            Command::ToggleGate { id } => self.cmd_toggle_gate(team, *id),
        }
    }

    fn cmd_recruit(&mut self, team: i32, ty: UType, producers: &[u32]) -> bool {
        let d = data();
        let t = d.ty(ty);
        let cost = t.cost.clone().unwrap_or_default();
        let targets: Vec<usize> = producers
            .iter()
            .filter_map(|&id| self.bidx(id))
            .filter(|&i| {
                let b = &self.state.buildings[i];
                b.team == team && b.hp > 0.0 && Some(b.kind) == t.producer && b.progress >= 1.0 && b.queue.len() < 8
            })
            .collect();
        if targets.is_empty() {
            self.toast("This structure already has a full training queue.");
            return false;
        }
        let (mut made, mut reason) = (0, String::new());
        for &bi in &targets {
            let pop = self.population(team);
            if !self.afford(&cost, team) {
                reason = "Your storehouses do not have enough resources.".into();
                break;
            }
            if pop.used + pop.queued >= pop.cap {
                reason = "Build a house to expand your population capacity.".into();
                break;
            }
            if self.state.buildings[bi].queue.len() >= 8 {
                reason = "This structure already has a full training queue.".into();
                continue;
            }
            self.pay(&cost, 1.0, team);
            self.state.buildings[bi].queue.push(QueueItem {
                kind: "unit".into(),
                ty: Some(ty),
                tech: None,
                time: 0.0,
                duration: t.train,
                cost: Some(cost_json(&cost)),
                extra: Default::default(),
            });
            made += 1;
        }
        if made == 0 {
            self.toast(reason);
            return false;
        }
        self.sound("recruit", None);
        true
    }

    fn cmd_research(&mut self, team: i32, key: &str, producer: u32) -> bool {
        let Some(t) = data().tech(key) else { return false };
        if self.has_tech(key, team) || !self.tech_available(key, team) || self.state.buildings.iter().any(|b| b.queue.iter().any(|q| q.tech.as_deref() == Some(key))) {
            return false;
        }
        let ok = self.bidx(producer).filter(|&i| {
            let b = &self.state.buildings[i];
            b.team == team && b.kind == t.producer && b.progress >= 1.0 && b.queue.len() < 8
        });
        let Some(bi) = ok.filter(|_| self.afford(&t.cost, team)) else {
            self.toast("Research needs its completed structure and the listed resources.");
            return false;
        };
        self.pay(&t.cost, 1.0, team);
        self.state.buildings[bi].queue.push(QueueItem {
            kind: "research".into(),
            ty: None,
            tech: Some(key.to_string()),
            time: 0.0,
            duration: t.time,
            cost: Some(cost_json(&t.cost)),
            extra: Default::default(),
        });
        true
    }

    fn cmd_place(&mut self, team: i32, kind: BKind, p: Pt, rotation: f64, builders: &[u32], append: bool) -> bool {
        if kind == BKind::Gate || !self.is_unlocked(kind, team) {
            return false;
        }
        if kind == BKind::Colossus && self.colossus_of(team).is_some() {
            self.toast("You already have a Colossal siege engine.");
            return false;
        }
        let cost = data().bld(kind).cost.clone().unwrap_or_default();
        if !self.afford(&cost, team) || !self.valid_site(kind, p, team, rotation, None) {
            self.toast("Choose clear ground away from structures, trees, deposits, and water.");
            return false;
        }
        self.pay(&cost, 1.0, team);
        let mut b = self.make_building(kind, team, p.x, p.y, 0.0);
        b.rotation = Some(rotation);
        let id = b.id;
        self.state.buildings.push(b);
        self.rebuild_navigation();
        let crew: Vec<usize> = builders
            .iter()
            .filter_map(|&u| self.state.units.iter().position(|x| x.id == u))
            .filter(|&i| {
                let u = &self.state.units[i];
                u.team == team && u.hp > 0.0 && u.ty == UType::Worker
            })
            .collect();
        let bi = self.state.buildings.len() - 1;
        self.queue_construction(&crew, &[id], append);
        if kind == BKind::Colossus {
            self.announce_colossus(bi);
        }
        true
    }

    // ---- wall upgrades ---------------------------------------------------

    pub fn available_wall(&self, bi: usize) -> bool {
        let b = &self.state.buildings[bi];
        b.kind == BKind::Wall && b.hp > 0.0 && b.progress >= 1.0 && b.queue.is_empty() && b.upgrade_owner.is_none()
    }

    pub fn gate_partner(&self, bi: usize, upgrading: bool) -> Option<usize> {
        if !self.straight_wall(bi) || (!upgrading && !self.available_wall(bi)) {
            return None;
        }
        let b = &self.state.buildings[bi];
        (0..self.state.buildings.len()).find(|&oi| {
            let o = &self.state.buildings[oi];
            o.id != b.id
                && self.straight_wall(oi)
                && (if upgrading { o.upgrade_owner == Some(b.id) } else { self.available_wall(oi) })
                && (o.x - b.x).abs() <= 40.0
                && (o.y - b.y).abs() <= 40.0
                && hypot(o.x - b.x, o.y - b.y) >= 24.0
                && b.links.as_ref().map(|l| l.values().any(|p| (p.x * 2.0 - (o.x - b.x)).abs() < 1.0 && (p.y * 2.0 - (o.y - b.y)).abs() < 1.0)).unwrap_or(false)
        })
    }

    pub fn wall_upgrade_cost(&self, kind: BKind, first: usize) -> Cost {
        let d = data();
        let walls: Vec<usize> = if kind == BKind::Gate { std::iter::once(first).chain(self.gate_partner(first, false)).collect() } else { vec![first] };
        let target = if kind == BKind::Gate && walls.iter().any(|&w| self.state.buildings[w].fortified) { BKind::Bastiongate } else { kind };
        let base = d.bld(target).cost.clone().unwrap_or_default();
        Cost(
            base.0
                .iter()
                .map(|&(r, n)| {
                    let spent: f64 = walls
                        .iter()
                        .map(|&w| {
                            let k = if self.state.buildings[w].fortified { BKind::Bastionwall } else { BKind::Wall };
                            d.bld(k).cost.as_ref().map(|c| c.0.iter().find(|(x, _)| *x == r).map(|x| x.1).unwrap_or(0.0)).unwrap_or(0.0)
                        })
                        .sum();
                    (r, (n - spent).max(0.0))
                })
                .collect(),
        )
    }

    fn cmd_wall_upgrade(&mut self, team: i32, kind: BKind, first_id: u32) -> bool {
        let Some(fi) = self.bidx(first_id) else { return false };
        if self.state.buildings[fi].team != team || !matches!(kind, BKind::Gate | BKind::Tower) || !self.available_wall(fi) || (kind == BKind::Gate && self.gate_partner(fi, false).is_none()) {
            return false;
        }
        let cost = self.wall_upgrade_cost(kind, fi);
        if !self.afford(&cost, team) {
            self.toast("Not enough resources for this wall upgrade.");
            return false;
        }
        let partner = if kind == BKind::Gate { self.gate_partner(fi, false) } else { None };
        self.pay(&cost, 1.0, team);
        let bast = kind == BKind::Gate && (self.state.buildings[fi].fortified || partner.map(|p| self.state.buildings[p].fortified).unwrap_or(false));
        let spec = if bast { BKind::Bastiongate } else { kind };
        let mut extra = Extra::default();
        extra.insert("targetKind".into(), serde_json::json!(kind));
        extra.insert("targetSpec".into(), serde_json::json!(spec));
        extra.insert("partnerId".into(), partner.map(|p| serde_json::json!(self.state.buildings[p].id)).unwrap_or(serde_json::Value::Null));
        self.state.buildings[fi].queue.push(QueueItem { kind: "building-upgrade".into(), ty: None, tech: None, time: 0.0, duration: data().bld(spec).time, cost: Some(cost_json(&cost)), extra });
        if let Some(p) = partner {
            self.state.buildings[p].upgrade_owner = Some(first_id);
        }
        self.toast(if kind == BKind::Gate { "Gatehouse upgrade queued." } else { "Guard tower upgrade queued." });
        true
    }

    fn cmd_destroy(&mut self, team: i32, id: u32) -> bool {
        let Some(bi) = self.bidx(id) else { return false };
        if self.state.buildings[bi].team != team || self.state.buildings[bi].city_center == Some(true) {
            return false;
        }
        let queue = self.state.buildings[bi].queue.clone();
        for item in &queue {
            self.release_wall_upgrade(bi, item);
        }
        let max = self.state.buildings[bi].max_hp;
        self.damage(Obj::Building(bi), max * 100.0, Some(DmgSource { id: None, team, ty: None }), true);
        self.rebuild_navigation();
        true
    }
}

impl Sim {
    fn cmd_place_wall(&mut self, team: i32, kind: BKind, a: Pt, b: Pt, builders: &[u32], append: bool) -> bool {
        let kind = if kind == BKind::Bastionwall { BKind::Bastionwall } else { BKind::Wall };
        let cost = data().bld(kind).cost.clone().unwrap_or_default();
        let points = self.wall_line(a, b);
        let mut projects: Vec<u32> = Vec::new();
        for (i, p) in points.iter().enumerate() {
            if self.state.buildings.iter().any(|x| x.hp > 0.0 && x.kind == BKind::Wall && hypot(x.x - p.x, x.y - p.y) < 12.0) {
                continue;
            }
            if !self.valid_site(BKind::Wall, *p, team, 0.0, None) || !self.afford(&cost, team) {
                continue;
            }
            self.pay(&cost, 1.0, team);
            let next = points.get(i + 1).or_else(|| if i > 0 { points.get(i - 1) } else { None }).copied().unwrap_or(Pt::new(p.x + 32.0, p.y));
            let mut w = self.make_building(kind, team, p.x, p.y, 0.0);
            w.wall_angle = Some(crate::js::atan2(next.y - p.y, next.x - p.x));
            projects.push(w.id);
            self.state.buildings.push(w);
        }
        if projects.is_empty() {
            self.toast("No clear ground or insufficient stone for this wall.");
            return false;
        }
        self.rebuild_navigation();
        let crew: Vec<usize> = (0..self.state.units.len())
            .filter(|&i| {
                let u = &self.state.units[i];
                u.team == team && u.hp > 0.0 && u.ty == UType::Worker && builders.contains(&u.id)
            })
            .collect();
        self.queue_construction(&crew, &projects, append);
        self.toast(format!("{} wall sections planned. Villagers build along the line automatically.", projects.len()));
        true
    }

    fn cmd_scout(&mut self, team: i32, units: &[u32]) -> bool {
        let members: Vec<usize> = self
            .fighters(team)
            .into_iter()
            .filter(|&i| units.contains(&self.state.units[i].id) && (self.state.units[i].ty != UType::Trebuchet || self.state.units[i].deployment == "packed"))
            .collect();
        if members.is_empty() {
            self.toast("Select a company to explore together.");
            return false;
        }
        let id = self.next_uid();
        for &i in &members {
            let u = &mut self.state.units[i];
            u.auto_scout = Some(id);
            u.target = None;
            u.manual_target = false;
            u.hold = false;
            u.order = None;
            u.path_timer = 0.0;
        }
        let ids: Vec<u32> = members.iter().map(|&i| self.state.units[i].id).collect();
        self.state.scouting_groups.get_or_insert_with(Vec::new).push(ScoutGroup { id, members: ids, think: 0.0, retreat_until: 0.0, status: "exploring".into(), goal: None, formation: None, extra: Default::default() });
        self.toast("The company will explore unseen land together and withdraw from attacks. Move, attack or hold ends scouting.");
        true
    }

    fn cmd_toggle_gate(&mut self, team: i32, id: u32) -> bool {
        let Some(bi) = self.bidx(id) else { return false };
        let b = &mut self.state.buildings[bi];
        if b.team != team || b.kind != BKind::Gate || b.progress < 1.0 {
            return false;
        }
        b.auto_closed = Some(false);
        b.closed = Some(b.closed != Some(true));
        self.state.nav_dirty = true;
        true
    }
}
