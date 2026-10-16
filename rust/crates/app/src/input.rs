//! Pointer and keyboard handling for the battlefield.

use crate::game::Game;
use crate::pick::*;
use crate::ui_state::*;
use crate::view::View;
use cruciata_core::model::*;
use cruciata_core::nav::Pt;
use eframe::egui::{self, Key, PointerButton, Pos2, Response};

fn dist(a: Pt, b: Pt) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

pub struct Targets {
    pub enemy: Option<u32>,
    pub node: Option<u32>,
    pub building: Option<u32>,
    pub escort: Option<u32>,
}

/// Resolve what lies under world point `p` for an order (`issueOrder`'s lookups).
pub fn resolve_targets(g: &Game, p: Pt) -> Targets {
    let me = g.me;
    let sim = &g.sim;
    let sees = |x: f64, y: f64| g.sees(x, y);
    let node = if g.remembers(p.x, p.y) { resource_at(sim, p, &|x, y| g.remembers(x, y), me) } else { None };
    let building = structure_at(sim, p, 6.0, false, me, &sees);
    let mut foes: Vec<usize> = (0..sim.state.units.len())
        .filter(|&i| {
            let u = &sim.state.units[i];
            u.team != me && u.team != 2 && u.hp > 0.0 && sees(u.x, u.y) && hit_unit(u, p, 24.0)
        })
        .collect();
    foes.sort_by(|&a, &b| dist(Pt::new(sim.state.units[a].x, sim.state.units[a].y), p).partial_cmp(&dist(Pt::new(sim.state.units[b].x, sim.state.units[b].y), p)).unwrap_or(std::cmp::Ordering::Equal));
    let enemy = foes.first().map(|&i| sim.state.units[i].id).or_else(|| {
        building.and_then(|bi| {
            let b = &sim.state.buildings[bi];
            if b.team != me && b.team != 2 && b.city_center != Some(true) && sees(b.x, b.y) {
                Some(b.id)
            } else {
                None
            }
        })
    });
    let escort = g
        .my_units()
        .into_iter()
        .map(|i| &sim.state.units[i])
        .find(|u| matches!(u.ty, UType::Pilgrim | UType::Merchant) && hit_unit(u, p, 35.0))
        .map(|u| u.id);
    Targets { enemy, node, building: building.map(|i| sim.state.buildings[i].id), escort }
}

fn order_here(ui: &mut UiState, g: &mut Game, p: Pt, attack: bool, append: bool) {
    let t = resolve_targets(g, p);
    ui.issue_order(g, p, attack, append, t.enemy, t.node, t.building, t.escort);
}

pub struct PanDrag {
    pub last: Pos2,
}

#[derive(Default)]
pub struct InputState {
    pub pan: Option<Pos2>,
    pub pan_button_is_right: bool,
}

/// Process this frame's pointer input over the map.
pub fn map_input(ctx: &egui::Context, resp: &Response, view: &mut View, ui: &mut UiState, g: &mut Game, st: &mut InputState) {
    let hovered = resp.hovered();
    ui.pointer_on_map = hovered;
    let pos = ctx.input(|i| i.pointer.latest_pos());
    if let Some(p) = pos {
        if view.rect.contains(p) || st.pan.is_some() || ui.drag.is_some() || ui.wall_drag.is_some() {
            let (x, y) = view.to_world(p);
            ui.mouse = Pt::new(x, y);
        }
    }
    if hovered {
        let scroll = ctx.input(|i| i.raw_scroll_delta.y);
        if scroll != 0.0 {
            if let Some(p) = pos {
                view.zoom_at(if scroll > 0.0 { 0.1 } else { -0.1 }, p);
            }
        }
    }
    let (shift, alt, ctrl) = ctx.input(|i| (i.modifiers.shift, i.modifiers.alt, i.modifiers.command));
    let _ = ctrl;
    let playable = g.sim.playable();
    // Pressed this frame (only when the pointer is over the map itself).
    let pressed = |b: PointerButton| hovered && ctx.input(|i| i.pointer.button_pressed(b));
    let released = |b: PointerButton| ctx.input(|i| i.pointer.button_released(b));
    if playable {
        if pressed(PointerButton::Middle) {
            st.pan = pos;
            st.pan_button_is_right = false;
        }
        if pressed(PointerButton::Secondary) {
            if ui.mode == Mode::Build {
                ui.cancel_mode();
            } else if ui.selected.is_empty() && ui.sel_buildings.is_empty() {
                st.pan = pos;
                st.pan_button_is_right = true;
            } else {
                let m = ui.mouse;
                let attack = ui.mode == Mode::Attack;
                order_here(ui, g, m, attack, shift);
            }
        }
        if pressed(PointerButton::Primary) {
            let m = ui.mouse;
            match ui.mode {
                Mode::Build => {
                    if matches!(ui.placement, Some(BKind::Wall | BKind::Bastionwall)) {
                        ui.wall_drag = Some((ui.wall_anchor.unwrap_or(m), m));
                    } else {
                        ui.place(g, m, shift);
                    }
                }
                Mode::Attack => order_here(ui, g, m, true, false),
                Mode::Move => {
                    ui.drag = Some(Drag { start: m, end: m, screen_start: pos.unwrap_or(Pos2::ZERO), shift, alt });
                }
            }
        }
    }
    // Panning drags.
    if let (Some(last), Some(now)) = (st.pan, pos) {
        let d = now - last;
        view.cx -= d.x as f64 / view.zoom;
        view.cy -= d.y as f64 / view.zoom;
        view.update();
        st.pan = Some(now);
    }
    if st.pan.is_some() && (released(PointerButton::Middle) || released(PointerButton::Secondary)) {
        st.pan = None;
    }
    if let Some(d) = ui.drag.as_mut() {
        d.end = ui.mouse;
    }
    if let Some(w) = ui.wall_drag.as_mut() {
        w.1 = ui.mouse;
    }
    if released(PointerButton::Primary) {
        if let Some((a, b)) = ui.wall_drag.take() {
            ui.place_wall(g, a, b, shift);
            return;
        }
        if let Some(d) = ui.drag.take() {
            finish_drag(ui, g, view, d);
        }
    }
    if hovered && ctx.input(|i| i.pointer.button_double_clicked(PointerButton::Primary)) && ui.mode == Mode::Move && playable {
        let p = ui.mouse;
        let pool = g.my_units();
        if let Some(i) = unit_at(&g.sim, p, &pool) {
            let ty = g.sim.state.units[i].ty;
            for j in pool {
                let o = &g.sim.state.units[j];
                if o.ty == ty && view.on_screen(o.x, o.y, 0.0) {
                    ui.selected.insert(o.id);
                }
            }
        }
    }
}

fn finish_drag(ui: &mut UiState, g: &mut Game, view: &View, d: Drag) {
    let clicked = dist(d.start, d.end) * view.zoom < 7.0;
    let end = if clicked { d.start } else { d.end };
    let mut clicked_node = if clicked && g.remembers(end.x, end.y) { resource_at(&g.sim, end, &|x, y| g.remembers(x, y), g.me) } else { None };
    if let Some(id) = clicked_node {
        let is_farm = g.sim.state.buildings.iter().any(|b| b.id == id);
        if !is_farm {
            let sees = |x: f64, y: f64| g.sees(x, y);
            if let Some(bi) = structure_at(&g.sim, end, 0.0, true, g.me, &sees) {
                let b = &g.sim.state.buildings[bi];
                let n = g.sim.state.nodes.iter().find(|n| n.id == id).map(|n| n.y).unwrap_or(0.0);
                if b.y + b.h / 2.0 > n {
                    clicked_node = None;
                }
            }
        }
    }
    ui.sel_node = clicked_node;
    if !d.shift && clicked_node.is_none() {
        ui.clear_selection();
        ui.sel_node = None;
    }
    if clicked {
        let pool = g.my_units();
        if let Some(i) = unit_at(&g.sim, end, &pool) {
            let u = &g.sim.state.units[i];
            if d.shift && ui.selected.contains(&u.id) {
                ui.selected.remove(&u.id);
            } else {
                ui.selected.insert(u.id);
            }
            if u.ty == UType::Worker {
                ui.tab = Tab::Settlement;
            }
        } else {
            let sees = |x: f64, y: f64| g.sees(x, y);
            let b = structure_at(&g.sim, end, 0.0, false, g.me, &sees);
            if b.is_none() && g.remembers(end.x, end.y) {
                ui.sel_node = clicked_node.or_else(|| resource_at(&g.sim, end, &|x, y| g.remembers(x, y), g.me));
            }
            if let Some(bi) = b {
                let b = &g.sim.state.buildings[bi];
                let id = b.id;
                if d.shift && ui.sel_buildings.contains(&id) {
                    ui.sel_buildings.retain(|&x| x != id);
                } else if !ui.sel_buildings.contains(&id) {
                    ui.sel_buildings.push(id);
                }
                if !d.shift {
                    ui.selected.clear();
                }
                if matches!(b.kind, BKind::Towncenter | BKind::Barracks | BKind::Stable | BKind::Chapel | BKind::Siegeworkshop) {
                    ui.tab = Tab::Army;
                }
            }
        }
    } else {
        let (x0, x1) = (d.start.x.min(d.end.x), d.start.x.max(d.end.x));
        let (y0, y1) = (d.start.y.min(d.end.y), d.start.y.max(d.end.y));
        let inside = |x: f64, y: f64| x >= x0 && x <= x1 && y >= y0 && y <= y1;
        let troops: Vec<u32> = g.my_units().into_iter().map(|i| &g.sim.state.units[i]).filter(|u| inside(u.x, u.y)).map(|u| u.id).collect();
        if !troops.is_empty() && !d.alt {
            ui.selected.extend(troops);
        } else {
            ui.selected.clear();
            for b in g.sim.state.buildings.iter().filter(|b| b.team == g.me && b.hp > 0.0 && inside(b.x, b.y)) {
                if !ui.sel_buildings.contains(&b.id) {
                    ui.sel_buildings.push(b.id);
                }
            }
            if !ui.sel_buildings.is_empty() {
                ui.tab = Tab::Army;
            }
        }
    }
    ui.sound_select = true;
}

/// Keyboard shortcuts; returns a world point to look at (home / alert / idle villager).
pub fn keys(ctx: &egui::Context, view: &mut View, ui: &mut UiState, g: &mut Game, dt: f64) -> Option<(f64, f64)> {
    if ctx.wants_keyboard_input() || ui.show_help || ui.show_settings || ui.show_menu {
        return None;
    }
    let mut look = None;
    ctx.input(|i| {
        let speed = 450.0 * dt / view.zoom;
        let down = |k: &[Key]| k.iter().any(|&k| i.key_down(k));
        if down(&[Key::A, Key::ArrowLeft]) {
            view.cx -= speed;
        }
        if down(&[Key::D, Key::ArrowRight]) {
            view.cx += speed;
        }
        if down(&[Key::W, Key::ArrowUp]) {
            view.cy -= speed;
        }
        if down(&[Key::S, Key::ArrowDown]) {
            view.cy += speed;
        }
    });
    view.update();
    let pressed = |k: Key| ctx.input(|i| i.key_pressed(k));
    if pressed(Key::Escape) {
        if ui.mode != Mode::Move || ui.placement.is_some() {
            ui.cancel_mode();
        } else {
            ui.show_menu = true;
            if !g.is_lan() {
                g.sim.state.paused = true;
            }
        }
        return None;
    }
    if !g.sim.playable() {
        return None;
    }
    if pressed(Key::Space) {
        ui.select_army(g);
    }
    if pressed(Key::F) && !ui.selected.is_empty() {
        ui.mode = Mode::Attack;
        ui.placement = None;
        ui.toast("Left-click a destination to advance in formation and engage.");
    }
    if pressed(Key::H) {
        ui.hold(g);
    }
    if pressed(Key::G) {
        ui.scout(g);
    }
    if pressed(Key::B) {
        ui.bless(g);
    }
    if pressed(Key::T) {
        ui.deploy(g);
    }
    if pressed(Key::E) {
        ui.select_workers(g);
    }
    if pressed(Key::V) {
        look = ui.idle_worker(g);
    }
    if pressed(Key::Q) {
        if let Some(b) = g.sim.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == g.me) {
            look = Some((b.x + 150.0, b.y - 100.0));
        }
    }
    if pressed(Key::Z) {
        if let Some((x, y, _)) = ui.alert {
            look = Some((x, y));
        }
    }
    if pressed(Key::X) {
        ui.cancel(g);
    }
    if pressed(Key::R) && ui.mode == Mode::Build && ui.placement == Some(BKind::Gate) {
        ui.rotation = if ui.rotation == 0.0 { 90.0 } else { 0.0 };
    }
    let digits = [Key::Num0, Key::Num1, Key::Num2, Key::Num3, Key::Num4, Key::Num5, Key::Num6, Key::Num7, Key::Num8, Key::Num9];
    let types = [UType::Sword, UType::Archer, UType::Knight, UType::Chaplain, UType::Worker, UType::Standard, UType::Trebuchet];
    let (shift, command) = ctx.input(|i| (i.modifiers.shift, i.modifiers.command));
    for (n, k) in digits.iter().enumerate() {
        if pressed(*k) {
            if shift && !command && (1..=7).contains(&n) {
                ui.recruit(g, types[n - 1]);
            } else {
                ui.control_group(g, n as u8, command, shift);
            }
        }
    }
    look
}
