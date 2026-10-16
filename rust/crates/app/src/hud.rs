//! Panels: header, sidebar, resource bar, selection summary, command cards,
//! overlays on the map and dialogs.

use crate::atlas::Atlas;
use crate::game::Game;
use crate::keys::*;
use crate::paint::{col, with_alpha};
use crate::text::*;
use crate::ui_state::*;
use cruciata_core::build::COLOSSUS_MIN_RANGE;
use cruciata_core::data::data;
use cruciata_core::model::*;
use eframe::egui::{self, Align2, Color32, FontId, Pos2, Rect, RichText, Sense, Stroke, Vec2};

pub const INK: &str = "#e7d8b8";
pub const GOLD: &str = "#c8a467";
pub const MUTED: &str = "#a79c82";

pub fn apply_theme(ctx: &egui::Context) {
    let mut v = egui::Visuals::dark();
    v.panel_fill = col("#282b23");
    v.window_fill = col("#2f3128");
    v.override_text_color = Some(col(INK));
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, col("#655039"));
    v.widgets.inactive.bg_fill = col("#4a3b2a");
    v.widgets.inactive.weak_bg_fill = col("#4a3b2a");
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, col("#806647"));
    v.widgets.hovered.bg_fill = col("#695236");
    v.widgets.hovered.weak_bg_fill = col("#695236");
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, col("#b2915d"));
    v.widgets.active.bg_fill = col("#754a2d");
    v.widgets.active.weak_bg_fill = col("#754a2d");
    v.selection.bg_fill = col("#754a2d");
    v.widgets.noninteractive.rounding = 2.0.into();
    v.widgets.inactive.rounding = 2.0.into();
    v.widgets.hovered.rounding = 2.0.into();
    v.widgets.active.rounding = 2.0.into();
    ctx.set_visuals(v);
    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(6.0, 5.0);
    style.spacing.button_padding = egui::vec2(8.0, 4.0);
    ctx.set_style(style);
}

pub fn eyebrow(ui: &mut egui::Ui, text: &str) {
    ui.label(RichText::new(text).size(9.5).color(col(GOLD)).extra_letter_spacing(1.2));
}

/// Draw an atlas sprite centred at `c` with screen scale `s`.
#[allow(clippy::too_many_arguments)]
pub fn paint_frame(painter: &egui::Painter, atlas: &mut Atlas, key: &str, ox: f64, oy: f64, c: Pos2, s: f32, tint: Color32) -> bool {
    let Some((f, tex)) = atlas.lookup(key) else { return false };
    let Some(tex) = tex else { return true };
    let a = f.res;
    let tl = Pos2::new(c.x + (f.dx - ox as f32) * s, c.y + (f.dy - oy as f32) * s);
    let size = Vec2::new(f.w / a * s, f.h / a * s);
    let uv = Rect::from_min_max(Pos2::new(f.x / 1024.0, f.y / 1024.0), Pos2::new((f.x + f.w) / 1024.0, (f.y + f.h) / 1024.0));
    painter.image(tex, Rect::from_min_size(tl, size), uv, tint);
    true
}

fn fake_unit(t: UType) -> Unit {
    Unit { ty: t, team: 0, angle: -std::f64::consts::FRAC_PI_2, deployment: "packed".into(), ..Default::default() }
}

/// Portrait of a unit type or a building kind inside `rect`.
pub fn portrait_unit(painter: &egui::Painter, atlas: &mut Atlas, t: UType, team: i32, rank: f64, rect: Rect, scale: f32) {
    let mut u = fake_unit(t);
    u.team = team;
    u.rank = Some(rank);
    let c = rect.center();
    match t {
        UType::Ram | UType::Ballista | UType::Trebuchet => {
            paint_frame(painter, atlas, &siege_machine_key(&u, 0.0, u.angle), 80.0, 120.0, Pos2::new(c.x, c.y + 6.0), scale * 0.5, Color32::WHITE);
        }
        UType::Pilgrim | UType::Merchant => {
            paint_frame(painter, atlas, &caravan_frame(&u, 0.0, u.angle), 80.0, 120.0, Pos2::new(c.x, c.y + 4.0), scale * 0.5, Color32::WHITE);
        }
        _ => {
            paint_frame(painter, atlas, &person_key(&u, u.angle), 50.0, 95.0, Pos2::new(c.x, c.y + 18.0 * scale * 0.5), scale * 0.72, Color32::WHITE);
        }
    }
}

pub fn portrait_building(painter: &egui::Painter, atlas: &mut Atlas, kind: BKind, rect: Rect, max: (f32, f32)) {
    let spec = data().bld(kind);
    let (k, fort) = if kind == BKind::Bastionwall { (BKind::Wall, true) } else { (kind, false) };
    let b = Building { kind: k, fortified: fort, team: 0, w: spec.w, h: spec.h, hp: spec.hp, max_hp: spec.hp, progress: 1.0, ..Default::default() };
    if matches!(k, BKind::Wall) {
        let c = rect.center();
        painter.rect_filled(Rect::from_center_size(c, Vec2::new(26.0, 12.0)), 2.0, col(if fort { "#6d6a63" } else { "#a09a89" }));
        return;
    }
    if matches!(k, BKind::Greatengine | BKind::Colossus) {
        paint_frame(painter, atlas, &great_engine_key(&Building { aim_angle: Some(-std::f64::consts::FRAC_PI_2), ..b.clone() }, 0.0), 150.0, 240.0, rect.center() + Vec2::new(0.0, 8.0), 0.18, Color32::WHITE);
        return;
    }
    let s = (max.0 as f64 / spec.w).min(max.1 as f64 / spec.h) as f32;
    let (width, _h, oy) = building_canvas(&b);
    paint_frame(painter, atlas, &building_key(&b), width / 2.0, oy, rect.center(), s, Color32::WHITE);
}

pub struct Frame<'a> {
    pub g: &'a mut Game,
    pub ui: &'a mut UiState,
    pub atlas: &'a mut Atlas,
}

fn button(ui: &mut egui::Ui, text: &str, enabled: bool) -> egui::Response {
    ui.add_enabled(enabled, egui::Button::new(RichText::new(text).size(11.5)))
}

pub fn header(ctx: &egui::Context, f: &mut Frame, actions: &mut Vec<Action>) {
    egui::TopBottomPanel::top("header").exact_height(40.0).frame(egui::Frame::none().fill(col("#1f211b")).inner_margin(egui::Margin::symmetric(14.0, 6.0))).show(ctx, |ui| {
        ui.horizontal_centered(|ui| {
            ui.label(RichText::new("+").size(22.0).color(col(GOLD)));
            ui.label(RichText::new("cruciāta").size(20.0).color(col("#e4cda2")).italics());
            ui.label(RichText::new("A PILGRIM'S EMPIRE").size(8.0).color(col(MUTED)));
            ui.add_space(24.0);
            ui.label(RichText::new("IN HOC SIGNO VINCES").size(10.0).color(col("#8f7c58")).extra_letter_spacing(2.0));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if button(ui, "Opt", true).on_hover_text("Settings").clicked() {
                    actions.push(Action::Settings);
                }
                if button(ui, "?", true).on_hover_text("Field guide").clicked() {
                    actions.push(Action::Help);
                }
                let label = if f.g.paused() { "Resume" } else { "II Pause" };
                if button(ui, label, !f.g.is_lan()).clicked() {
                    actions.push(Action::Pause);
                }
                if !f.g.is_lan() && button(ui, "Save", true).clicked() {
                    actions.push(Action::Save);
                }
                if button(ui, "Menu", true).clicked() {
                    actions.push(Action::Menu);
                }
                if f.g.is_lan() {
                    ui.label(RichText::new(format!("LAN \u{b7} vs {}", f.g.peer_name.clone().unwrap_or_default())).size(10.0).color(col("#9cc07a")));
                }
            });
        });
    });
}

#[derive(Debug, PartialEq, Clone)]
pub enum Action {
    Debug,
    Settings,
    Help,
    Pause,
    Menu,
    Save,
    Restart,
    Home,
    Look(f64, f64),
    Level(usize),
}

pub fn sidebar(ctx: &egui::Context, f: &mut Frame, actions: &mut Vec<Action>) {
    egui::SidePanel::left("sidebar").exact_width(188.0).frame(egui::Frame::none().fill(col("#23261f")).inner_margin(egui::Margin::same(12.0))).show(ctx, |ui| {
        eyebrow(ui, "THE PILGRIM'S CHRONICLE");
        ui.add_space(4.0);
        ui.label(RichText::new("The road to").size(20.0).color(col("#e4cda2")));
        ui.label(RichText::new("Jerusalem").size(24.0).italics().color(col(GOLD)));
        ui.add_space(8.0);
        let st = &f.g.sim.state;
        if st.mode != "quickmatch" {
            for (i, l) in data().levels.iter().enumerate() {
                let current = i == st.level;
                let txt = RichText::new(format!("{}  {}", l.roman, l.name)).size(12.0).color(if current { col("#f0dfb4") } else { col(MUTED) });
                let r = ui.add(egui::Button::new(txt).fill(if current { col("#5d4930") } else { Color32::TRANSPARENT }).frame(current).min_size(Vec2::new(ui.available_width(), 24.0)));
                if r.clicked() && !f.g.is_lan() {
                    actions.push(Action::Level(i));
                }
            }
            ui.add_space(8.0);
        }
        eyebrow(ui, "STEWARDSHIP");
        if button(ui, "Find settlement   [Q]", true).clicked() {
            actions.push(Action::Home);
        }
        let idle = f.g.my_workers().into_iter().filter(|&i| f.g.sim.state.units[i].job.is_none() && f.g.sim.state.units[i].order.is_none()).count();
        if button(ui, &format!("Idle villagers  {}   [V]", idle), true).clicked() {
            if let Some((x, y)) = f.ui.idle_worker(f.g) {
                actions.push(Action::Look(x, y));
            }
        }
        if button(ui, "All villagers   [E]", true).clicked() {
            f.ui.select_workers(f.g);
        }
        ui.add_space(4.0);
        for r in Res::ALL {
            let n = f.g.my_workers().into_iter().filter(|&i| f.g.sim.state.units[i].job.as_ref().and_then(|j| j.resource) == Some(r)).count();
            ui.horizontal(|ui| {
                ui.label(RichText::new(format!("{} hands", cap(res_name(r)))).size(10.5).color(col(MUTED)));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| ui.label(RichText::new(n.to_string()).size(10.5)));
            });
        }
        ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
            if !f.g.is_lan() && button(ui, "Restart chapter", true).clicked() {
                actions.push(Action::Restart);
            }
            ui.label(RichText::new("Guard the fields. Shelter the pilgrims. Preserve your company.").size(9.5).color(col(MUTED)));
            eyebrow(ui, "A KINGDOM IS BUILT BY MANY HANDS");
        });
    });
}

fn res_icon(ui: &mut egui::Ui, kind: &str) {
    let (r, _) = ui.allocate_exact_size(Vec2::splat(22.0), Sense::hover());
    let p = ui.painter();
    p.rect_filled(r, 11.0, col("#3a3326"));
    p.rect_stroke(r, 11.0, Stroke::new(1.0, col("#7d6540")));
    let c = r.center();
    match kind {
        "food" => {
            p.circle_filled(c, 5.5, col("#d9863d"));
            p.line_segment([c + Vec2::new(0.0, -5.0), c + Vec2::new(2.0, -8.0)], Stroke::new(1.5, col("#6c9a4e")));
        }
        "wood" => {
            p.rect_filled(Rect::from_center_size(c, Vec2::new(12.0, 5.0)), 2.0, col("#8a5e34"));
            p.circle_filled(c + Vec2::new(6.0, 0.0), 2.6, col("#c79a62"));
        }
        "gold" => {
            p.circle_filled(c, 5.5, col("#e3bd4a"));
            p.circle_stroke(c, 5.5, Stroke::new(1.0, col("#9a7a22")));
        }
        "stone" => {
            p.add(egui::Shape::convex_polygon(vec![c + Vec2::new(-6.0, 4.0), c + Vec2::new(-3.0, -5.0), c + Vec2::new(4.0, -5.0), c + Vec2::new(7.0, 4.0)], col("#9a9a90"), Stroke::new(1.0, col("#5f5f58"))));
        }
        "people" => {
            p.circle_filled(c + Vec2::new(0.0, -3.0), 3.0, col("#d8c39a"));
            p.rect_filled(Rect::from_center_size(c + Vec2::new(0.0, 4.0), Vec2::new(10.0, 6.0)), 3.0, col("#d8c39a"));
        }
        _ => {
            p.line_segment([c + Vec2::new(0.0, -7.0), c + Vec2::new(0.0, 7.0)], Stroke::new(2.2, col("#e9d6a1")));
            p.line_segment([c + Vec2::new(-5.0, -2.0), c + Vec2::new(5.0, -2.0)], Stroke::new(2.2, col("#e9d6a1")));
        }
    }
}

pub fn resource_bar(ctx: &egui::Context, f: &mut Frame) {
    egui::TopBottomPanel::top("resources").frame(egui::Frame::none().fill(col("#2a2d24")).inner_margin(egui::Margin::symmetric(14.0, 6.0))).show(ctx, |ui| {
        let st = &f.g.sim.state;
        let l = &data().levels[st.level.min(data().levels.len() - 1)];
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                if st.mode == "quickmatch" {
                    eyebrow(ui, if f.g.is_lan() { "LAN BATTLE" } else { "QUICKMATCH" });
                    ui.label(RichText::new(if f.g.is_lan() { "Player versus player" } else { "Generated battlefield" }).size(17.0).color(col("#e4cda2")));
                } else {
                    eyebrow(ui, &format!("CHAPTER {} \u{b7} {}", l.roman, l.sub));
                    ui.label(RichText::new(l.title).size(17.0).color(col("#e4cda2")));
                }
            });
            ui.add_space(14.0);
            let r = f.g.stock();
            let pop = f.g.sim.population(f.g.me);
            for (kind, label, val) in [
                ("food", "Food", r.food.floor().to_string()),
                ("wood", "Wood", r.wood.floor().to_string()),
                ("gold", "Gold", r.gold.floor().to_string()),
                ("stone", "Stone", r.stone.floor().to_string()),
                ("people", "People", format!("{} / {}", pop.used + pop.queued, pop.cap)),
                ("faith", "Faith", f.g.faith().floor().to_string()),
            ] {
                res_icon(ui, kind);
                ui.vertical(|ui| {
                    ui.label(RichText::new(val).size(14.0).strong());
                    ui.label(RichText::new(label).size(8.5).color(col(MUTED)));
                });
                ui.add_space(8.0);
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let t = st.time;
                ui.label(RichText::new(format!("{:02}:{:02}", (t / 60.0).floor() as i64, (t % 60.0).floor() as i64)).size(20.0).color(col("#e4cda2")));
                let status = if let Some(w) = f.g.outcome() { if w { "VICTORY" } else { "DEFEAT" }.to_string() } else if f.g.waiting() { "WAITING FOR OPPONENT".into() } else if f.g.paused() { "AT REST".into() } else if f.g.stock().food < 1.0 { "FOOD SHORTAGE".into() } else { "THE HOST MARCHES".into() };
                ui.label(RichText::new(status).size(9.5).color(col(GOLD)));
            });
        });
    });
}
