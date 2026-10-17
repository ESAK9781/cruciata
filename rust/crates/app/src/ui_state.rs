//! Interface state (selection, modes, placement) and the command helpers the
//! HUD and map input share. Everything that changes the game goes through
//! `Game::issue`, so single-player and LAN behave identically.

use crate::game::Game;
use crate::text::cost_text;
use cruciata_core::build::COLOSSUS_MIN_RANGE;
use cruciata_core::commands::Command;
use cruciata_core::data::data;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::nav::Pt;
use cruciata_core::orders::OrderCmd;
use eframe::egui::Pos2;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Mode {
    Move,
    Build,
    Attack,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tab {
    Army,
    Settlement,
    Research,
}

#[derive(Clone, Debug)]
pub struct Drag {
    pub start: Pt,
    pub end: Pt,
    pub screen_start: Pos2,
    pub shift: bool,
    pub alt: bool,
}

pub struct Toast {
    pub text: String,
    pub at: f64,
}

pub struct Ring {
    pub x: f64,
    pub y: f64,
    pub t: f64,
    pub color: &'static str,
}

pub struct UiState {
    pub sound_select: bool,
    pub selected: HashSet<u32>,
    pub sel_buildings: Vec<u32>,
    pub sel_node: Option<u32>,
    pub mode: Mode,
    pub placement: Option<BKind>,
    pub rotation: f64,
    pub wall_anchor: Option<Pt>,
    pub wall_drag: Option<(Pt, Pt)>,
    pub drag: Option<Drag>,
    pub mouse: Pt,
    pub pointer_on_map: bool,
    pub tab: Tab,
    pub action_turns: HashMap<String, u32>,
    pub toasts: Vec<Toast>,
    pub rings: Vec<Ring>,
    pub groups: HashMap<u8, Vec<u32>>,
    pub alert: Option<(f64, f64, f64)>,
    pub alerts: Vec<(f64, f64, f64)>,
    pub impacts: Vec<(f64, f64, f64, bool)>,
    pub shake: f64,
    pub clock: f64,
    pub show_help: bool,
    pub show_settings: bool,
    pub show_menu: bool,
    /// Chapter/quickmatch intro card still waiting for "Begin the march".
    pub intro: bool,
    pub show_debug: bool,
    pub orders_collapsed: bool,
}

impl UiState {
    pub fn new() -> UiState {
        UiState {
            sound_select: false,
            selected: HashSet::new(),
            sel_buildings: Vec::new(),
            sel_node: None,
            mode: Mode::Move,
            placement: None,
            rotation: 0.0,
            wall_anchor: None,
            wall_drag: None,
            drag: None,
            mouse: Pt::new(0.0, 0.0),
            pointer_on_map: false,
            tab: Tab::Army,
            action_turns: HashMap::new(),
            toasts: Vec::new(),
            rings: Vec::new(),
            groups: HashMap::new(),
            alert: None,
            alerts: Vec::new(),
            impacts: Vec::new(),
            shake: 0.0,
            clock: 0.0,
            show_help: false,
            show_settings: false,
            show_menu: false,
            intro: false,
            show_debug: false,
            orders_collapsed: false,
        }
    }

    pub fn toast(&mut self, text: impl Into<String>) {
        self.toasts.push(Toast { text: text.into(), at: self.clock });
        if self.toasts.len() > 4 {
            self.toasts.remove(0);
        }
    }

    pub fn clear_selection(&mut self) {
        self.selected.clear();
        self.sel_buildings.clear();
        self.sel_node = None;
    }

    pub fn building_selected(&self, id: u32) -> bool {
        self.sel_buildings.contains(&id)
    }

    pub fn first_building(&self) -> Option<u32> {
        self.sel_buildings.first().copied()
    }

    /// Live owned selected structures (`selectedStructures`), in world order.
    pub fn selected_structures(&self, g: &Game, pred: &dyn Fn(&Building) -> bool) -> Vec<usize> {
        (0..g.sim.state.buildings.len())
            .filter(|&i| {
                let b = &g.sim.state.buildings[i];
                b.team == g.me && b.hp > 0.0 && self.sel_buildings.contains(&b.id) && pred(b)
            })
            .collect()
    }

    pub fn selected_units(&self, g: &Game) -> Vec<usize> {
        g.my_units().into_iter().filter(|&i| self.selected.contains(&g.sim.state.units[i].id)).collect()
    }

    pub fn selected_fighters(&self, g: &Game) -> Vec<usize> {
        g.my_fighters().into_iter().filter(|&i| self.selected.contains(&g.sim.state.units[i].id)).collect()
    }

    /// `nextStructure`: rotate through eligible structures, one per click.
    pub fn next_structure(&mut self, g: &Game, key: &str, list: &[usize], advance: bool) -> Option<usize> {
        if list.is_empty() {
            return None;
        }
        let last = self.action_turns.get(key).copied();
        let bs = &g.sim.state.buildings;
        let index = last.and_then(|l| list.iter().position(|&i| bs[i].id == l));
        let mut pick = match index {
            Some(k) => list[(k + 1) % list.len()],
            None => list[0],
        };
        if index.is_none() {
            if let Some(l) = last {
                if self.sel_buildings.contains(&l) {
                    if let Some(pos) = bs.iter().position(|b| b.id == l) {
                        pick = list.iter().copied().find(|&i| i > pos).unwrap_or(list[0]);
                    }
                }
            }
        }
        if advance {
            self.action_turns.insert(key.to_string(), bs[pick].id);
        }
        Some(pick)
    }

    // ---- training / research --------------------------------------------------

    /// `trainers(type)`: producers that would receive a recruit command.
    pub fn trainers(&self, g: &Game, ty: UType) -> Vec<usize> {
        let spec = data().ty(ty);
        let producer = spec.producer;
        if !self.sel_buildings.is_empty() && !self.selected_structures(g, &|_| true).is_empty() {
            return self.selected_structures(g, &|b| Some(b.kind) == producer && b.progress >= 1.0 && b.queue.len() < 8);
        }
        let mut done: Vec<usize> = g.sim.complete_buildings(producer, g.me);
        done.sort_by_key(|&i| g.sim.state.buildings[i].queue.len());
        match done.first() {
            Some(&b) if g.sim.state.buildings[b].queue.len() < 8 => vec![b],
            _ => vec![],
        }
    }

    pub fn recruit(&mut self, g: &mut Game, ty: UType) {
        let t = self.trainers(g, ty);
        if t.is_empty() {
            let spec = data().ty(ty);
            let selected_producers = !self.selected_structures(g, &|b| Some(b.kind) == spec.producer && b.progress >= 1.0).is_empty();
            let name = spec.producer.map(|k| data().bld(k).name.to_lowercase()).unwrap_or_default();
            self.toast(if selected_producers { "This structure already has a full training queue.".to_string() } else { format!("Build a {} to train {}s.", name, spec.name.to_lowercase()) });
            return;
        }
        let ids: Vec<u32> = t.iter().map(|&i| g.sim.state.buildings[i].id).collect();
        if let Some(&first) = ids.first() {
            self.action_turns.insert(format!("train:{:?}", ty), first);
        }
        g.issue(PlayerCommand::Game(Command::Recruit { ty, producers: ids }));
    }

    pub fn research(&mut self, g: &mut Game, key: &str) {
        let Some(t) = data().tech(key) else { return };
        let list = self.selected_structures(g, &|b| b.kind == t.producer && b.progress >= 1.0 && b.queue.len() < 8);
        let Some(b) = self.next_structure(g, "research", &list, false) else {
            self.toast("Research needs its completed structure and the listed resources.");
            return;
        };
        let id = g.sim.state.buildings[b].id;
        self.action_turns.insert("research".into(), id);
        g.issue(PlayerCommand::Game(Command::Research { key: key.to_string(), producer: id }));
    }

    // ---- build mode ------------------------------------------------------------

    pub fn begin_build(&mut self, g: &Game, kind: BKind) {
        if kind == BKind::Gate {
            return;
        }
        if !g.sim.is_unlocked(kind, g.me) {
            let need = if kind == BKind::Greatengine { "Great engines" } else { "Colossal engineering" };
            self.toast(format!("Research {} at a siege workshop to build this.", need));
            return;
        }
        if kind == BKind::Colossus && g.sim.colossus_of(g.me).is_some() {
            self.toast("You may only have one Colossal siege engine at a time (even one under construction).");
            return;
        }
        let cost = data().bld(kind).cost.clone().unwrap_or_default();
        if !g.sim.afford(&cost, g.me) {
            self.toast("Not enough resources for this structure.");
            return;
        }
        self.wall_anchor = None;
        self.placement = Some(kind);
        self.rotation = 0.0;
        self.mode = Mode::Build;
        let wall = matches!(kind, BKind::Wall | BKind::Bastionwall);
        self.toast(format!(
            "Place {} on clear, explored ground. Unfinished foundations provide no vision. {}Right-click or Escape cancels.",
            data().bld(kind).name.to_lowercase(),
            if wall { "Drag to lay a continuous wall; bends join automatically. " } else { "" }
        ));
    }

    pub fn cancel_mode(&mut self) {
        self.wall_drag = None;
        self.wall_anchor = None;
        self.placement = None;
        self.mode = Mode::Move;
    }

    pub fn place(&mut self, g: &mut Game, p: Pt, append: bool) {
        let Some(kind) = self.placement else { return };
        let builders: Vec<u32> = self.selected_units(g).into_iter().filter(|&i| g.sim.state.units[i].ty == UType::Worker).map(|i| g.sim.state.units[i].id).collect();
        let ok_site = g.sim.valid_site(kind, p, g.me, self.rotation, None);
        g.issue(PlayerCommand::Game(Command::PlaceBuild { kind, x: p.x, y: p.y, rotation: self.rotation, builders, append }));
        if g.is_lan() || ok_site {
            // In LAN play the result arrives with the turn; assume success when the site looked valid.
            if !(append && ok_site) {
                self.placement = None;
                self.mode = Mode::Move;
            }
            self.sel_buildings.clear();
        }
    }

    pub fn place_wall(&mut self, g: &mut Game, a: Pt, b: Pt, append: bool) {
        let kind = if self.placement == Some(BKind::Bastionwall) { BKind::Bastionwall } else { BKind::Wall };
        let builders: Vec<u32> = self.selected_units(g).into_iter().filter(|&i| g.sim.state.units[i].ty == UType::Worker).map(|i| g.sim.state.units[i].id).collect();
        let points = g.sim.wall_line(a, b);
        g.issue(PlayerCommand::Game(Command::PlaceWall { kind, ax: a.x, ay: a.y, bx: b.x, by: b.y, builders, append }));
        self.wall_drag = None;
        self.wall_anchor = if append { points.last().copied() } else { None };
        self.placement = if append { Some(kind) } else { None };
        self.mode = if append { Mode::Build } else { Mode::Move };
    }

    // ---- orders ----------------------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    pub fn issue_order(&mut self, g: &mut Game, p: Pt, attack: bool, append: bool, enemy: Option<u32>, node: Option<u32>, building: Option<u32>, escort: Option<u32>) {
        if self.mode == Mode::Build {
            self.cancel_mode();
            return;
        }
        let units: Vec<u32> = self.selected.iter().copied().collect();
        let structures = self.sel_buildings.clone();
        g.issue(PlayerCommand::Order(OrderCmd { units, structures, x: p.x, y: p.y, attack: attack || self.mode == Mode::Attack, append, enemy, node, building, escort }));
        self.rings.push(Ring { x: p.x, y: p.y, t: 0.0, color: if enemy.is_some() || attack { "#a54831" } else { "#ece0b3" } });
        self.mode = Mode::Move;
    }

    pub fn set_stance(&mut self, g: &mut Game, value: &str) {
        g.issue(PlayerCommand::Stance { units: self.selected.iter().copied().collect(), structures: self.sel_buildings.clone(), value: value.into() });
    }

    pub fn hold(&mut self, g: &mut Game) {
        g.issue(PlayerCommand::Hold { units: self.selected.iter().copied().collect() });
        self.placement = None;
        self.mode = Mode::Move;
    }

    pub fn bless(&mut self, g: &mut Game) {
        let units: Vec<u32> = self.selected_fighters(g).into_iter().map(|i| g.sim.state.units[i].id).collect();
        if units.is_empty() || g.faith() < 30.0 {
            self.toast("Select soldiers and gather 30 faith for a benediction.");
            return;
        }
        g.issue(PlayerCommand::Bless { units });
    }

    pub fn deploy(&mut self, g: &mut Game) {
        g.issue(PlayerCommand::Deploy { units: self.selected.iter().copied().collect() });
    }

    pub fn scout(&mut self, g: &mut Game) {
        g.issue(PlayerCommand::Game(Command::Scout { units: self.selected.iter().copied().collect() }));
    }

    pub fn cancel_targeting(&mut self, g: &mut Game) {
        g.issue(PlayerCommand::CancelSiege { units: self.selected.iter().copied().collect(), structures: self.sel_buildings.clone() });
    }

    pub fn wall_upgrade(&mut self, g: &mut Game, kind: BKind) {
        let list = self.selected_structures(g, &|b| b.kind == BKind::Wall);
        let eligible: Vec<usize> = list.into_iter().filter(|&i| g.sim.available_wall(i) && (kind != BKind::Gate || g.sim.gate_partner(i, false).is_some())).collect();
        let key = format!("wall-upgrade:{}", if kind == BKind::Gate { "gate" } else { "tower" });
        let Some(first) = self.next_structure(g, &key, &eligible, false) else { return };
        let id = g.sim.state.buildings[first].id;
        self.action_turns.insert(key, id);
        g.issue(PlayerCommand::Game(Command::WallUpgrade { kind, first: id }));
    }

    pub fn destroy(&mut self, g: &mut Game) {
        let list = self.selected_structures(g, &|b| b.city_center != Some(true));
        let Some(b) = self.next_structure(g, "destroy", &list, true) else { return };
        let id = g.sim.state.buildings[b].id;
        g.issue(PlayerCommand::Game(Command::Destroy { id }));
        self.sel_buildings.retain(|&x| x != id);
    }

    pub fn toggle_gate(&mut self, g: &mut Game) {
        let list = self.selected_structures(g, &|b| b.kind == BKind::Gate && b.progress >= 1.0);
        let Some(b) = self.next_structure(g, "gate", &list, true) else { return };
        let id = g.sim.state.buildings[b].id;
        g.issue(PlayerCommand::Game(Command::ToggleGate { id }));
    }

    /// The Cancel button / X key.
    pub fn cancel(&mut self, g: &mut Game) {
        if self.mode != Mode::Move || self.placement.is_some() || self.wall_drag.is_some() || self.wall_anchor.is_some() {
            self.cancel_mode();
            return;
        }
        let mut targets: Vec<usize> = Vec::new();
        for i in self.selected_structures(g, &|_| true) {
            let b = &g.sim.state.buildings[i];
            let t = match b.upgrade_owner.and_then(|o| g.sim.get_object(o)) {
                Some(cruciata_core::sim::Obj::Building(o)) => o,
                _ => i,
            };
            if !targets.contains(&t) {
                targets.push(t);
            }
        }
        let cancellable: Vec<usize> = targets.into_iter().filter(|&i| g.sim.state.buildings[i].progress < 1.0 || !g.sim.state.buildings[i].queue.is_empty()).collect();
        if let Some(t) = self.next_structure(g, "cancel", &cancellable, true) {
            let id = g.sim.state.buildings[t].id;
            g.issue(PlayerCommand::CancelBuild { id });
        }
    }

    pub fn can_cancel(&self, g: &Game) -> bool {
        self.placement.is_some()
            || self.mode == Mode::Attack
            || g.sim.state.buildings.iter().any(|b| b.team == g.me && b.hp > 0.0 && self.sel_buildings.contains(&b.id) && (b.progress < 1.0 || !b.queue.is_empty() || b.upgrade_owner.is_some()))
    }

    // ---- selection shortcuts -----------------------------------------------------

    pub fn select_army(&mut self, g: &Game) {
        self.selected = g.my_fighters().into_iter().map(|i| g.sim.state.units[i].id).collect();
        self.sel_buildings.clear();
        self.tab = Tab::Army;
    }

    pub fn select_workers(&mut self, g: &Game) {
        self.selected = g.my_workers().into_iter().map(|i| g.sim.state.units[i].id).collect();
        self.sel_buildings.clear();
        self.tab = Tab::Settlement;
    }

    /// Selects an idle villager and returns where to look.
    pub fn idle_worker(&mut self, g: &Game) -> Option<(f64, f64)> {
        let u = g.my_workers().into_iter().map(|i| &g.sim.state.units[i]).find(|u| u.job.is_none() && u.order.is_none());
        match u {
            Some(u) => {
                self.selected = HashSet::from([u.id]);
                self.sel_buildings.clear();
                self.tab = Tab::Settlement;
                Some((u.x, u.y))
            }
            None => {
                self.toast("All villagers are working.");
                None
            }
        }
    }

    pub fn control_group(&mut self, g: &Game, group: u8, assign: bool, add: bool) {
        let owned = |id: u32| g.sim.state.units.iter().any(|u| u.id == id && u.team == g.me && u.hp > 0.0) || g.sim.state.buildings.iter().any(|b| b.id == id && b.team == g.me && b.hp > 0.0);
        if assign {
            let mut members: Vec<u32> = if add { self.groups.get(&group).cloned().unwrap_or_default().into_iter().filter(|&i| owned(i)).collect() } else { vec![] };
            for id in self.selected.iter().chain(self.sel_buildings.iter()) {
                if owned(*id) && !members.contains(id) {
                    members.push(*id);
                }
            }
            let n = members.len();
            self.toast(format!("Group {} {} ({} members).", group, if n > 0 { "assigned" } else { "cleared" }, n));
            self.groups.insert(group, members);
        } else {
            let members: Vec<u32> = self.groups.get(&group).cloned().unwrap_or_default().into_iter().filter(|&i| owned(i)).collect();
            self.selected = members.iter().copied().filter(|&i| g.sim.state.units.iter().any(|u| u.id == i)).collect();
            self.sel_buildings = members.iter().copied().filter(|&i| g.sim.state.buildings.iter().any(|b| b.id == i)).collect();
            self.sel_node = None;
            self.cancel_mode();
            if members.is_empty() {
                self.toast(format!("Group {} is empty. Select units or buildings and press Ctrl+{}.", group, group));
            } else if !self.sel_buildings.is_empty() {
                self.tab = Tab::Army;
            }
        }
    }

    /// Drop selected ids that no longer exist.
    pub fn prune(&mut self, g: &Game) {
        let alive_u: HashSet<u32> = g.sim.state.units.iter().filter(|u| u.hp > 0.0 && u.team == g.me).map(|u| u.id).collect();
        self.selected.retain(|i| alive_u.contains(i));
        self.sel_buildings.retain(|i| g.sim.state.buildings.iter().any(|b| b.id == *i && b.hp > 0.0));
        if let Some(n) = self.sel_node {
            if !g.sim.state.nodes.iter().any(|x| x.id == n && x.remaining > 0.0) {
                self.sel_node = None;
            }
        }
    }
}

pub fn min_range_text(kind: BKind) -> String {
    if kind == BKind::Colossus {
        format!("Minimum range {}", COLOSSUS_MIN_RANGE)
    } else {
        cost_text(&data().bld(kind).cost.clone().unwrap_or_default())
    }
}
