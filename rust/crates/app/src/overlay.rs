//! Things drawn over the map (minimap, objective panel, toasts, banners)
//! and the modal dialogs.

use crate::game::Game;
use crate::hud::*;
use crate::paint::col;
use crate::text::HELP;
use crate::ui_state::*;
use crate::view::View;
use cruciata_core::data::data;
use cruciata_core::model::*;
use eframe::egui::{self, Align2, Color32, ColorImage, Pos2, Rect, RichText, Sense, Stroke, TextureHandle, TextureOptions, Vec2};

/// GPU copy of the player's fog grid.
pub struct FogTex {
    tex: Option<TextureHandle>,
    revision: u64,
    team: i32,
}

impl FogTex {
    pub fn new() -> FogTex {
        FogTex { tex: None, revision: u64::MAX, team: -1 }
    }

    pub fn update(&mut self, ctx: &egui::Context, g: &Game) {
        let fog = g.fog();
        if self.tex.is_some() && self.revision == fog.revision && self.team == g.me {
            return;
        }
        let n = (fog.cols * fog.rows) as usize;
        let mut px = Vec::with_capacity(n);
        for i in 0..n {
            let a = if fog.visible[i] != 0 { 0 } else if fog.explored[i] != 0 { 155 } else { 255 };
            px.push(Color32::from_rgba_unmultiplied(8, 16, 23, a));
        }
        let img = ColorImage { size: [fog.cols as usize, fog.rows as usize], pixels: px };
        match &mut self.tex {
            Some(t) => t.set(img, TextureOptions::LINEAR),
            None => self.tex = Some(ctx.load_texture("fog", img, TextureOptions::LINEAR)),
        }
        self.revision = fog.revision;
        self.team = g.me;
    }

    pub fn paint(&self, painter: &egui::Painter, view: &View, world_w: f64, world_h: f64) {
        if let Some(t) = &self.tex {
            let tl = view.to_screen(0.0, 0.0);
            let br = view.to_screen(world_w, world_h);
            painter.image(t.id(), Rect::from_min_max(tl, br), Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
        }
    }

    pub fn paint_rect(&self, painter: &egui::Painter, rect: Rect) {
        if let Some(t) = &self.tex {
            painter.image(t.id(), rect, Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
        }
    }
}

pub fn minimap(ctx: &egui::Context, rect: Rect, g: &Game, ui_state: &mut UiState, view: &mut View, fog: &FogTex, ground: Color32, terrain: Option<egui::TextureId>) -> Option<(f64, f64, bool)> {
    let mut command: Option<(f64, f64, bool)> = None;
    egui::Area::new("minimap".into()).pivot(Align2::RIGHT_BOTTOM).fixed_pos(rect.right_bottom() + Vec2::new(-12.0, -12.0)).order(egui::Order::Foreground).show(ctx, |ui| {
        egui::Frame::none().fill(col("#1b1e18")).stroke(Stroke::new(1.0, col("#806647"))).inner_margin(egui::Margin::same(4.0)).show(ui, |ui| {
            let (w, h) = (g.sim.geo.w, g.sim.geo.h);
            let size = Vec2::new(208.0, (208.0 * h / w) as f32);
            let (mrect, resp) = ui.allocate_exact_size(size, Sense::click_and_drag());
            let p = ui.painter_at(mrect);
            p.rect_filled(mrect, 0.0, ground);
            if let Some(t) = terrain {
                p.image(t, mrect, Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
            }
            let (sx, sy) = (size.x as f64 / w, size.y as f64 / h);
            let at = |x: f64, y: f64| Pos2::new(mrect.min.x + (x * sx) as f32, mrect.min.y + (y * sy) as f32);
            for f in &g.sim.state.terrain_features {
                if f.forest == Some(true) {
                    for t in &f.tiles {
                        p.rect_filled(Rect::from_min_size(at(t.x as f64 * f.cell, t.y as f64 * f.cell), Vec2::new((f.cell * sx) as f32 + 0.6, (f.cell * sy) as f32 + 0.6)), 0.0, col("#3f5b2f"));
                    }
                } else if f.kind == "rockmass" || f.kind == "cliff" {
                    p.circle_filled(at(f.x, f.y), ((f.rx.max(f.ry)) * sx).max(1.5) as f32, col("#22251d"));
                }
            }
            for n in &g.sim.state.nodes {
                if n.remaining > 0.0 {
                    let c = match n.kind {
                        Res::Wood => "#566d35",
                        Res::Food => "#c9ae61",
                        Res::Gold => "#edd070",
                        Res::Stone => "#a1a391",
                    };
                    p.rect_filled(Rect::from_center_size(at(n.x, n.y), Vec2::splat(2.0)), 0.0, col(c));
                }
            }
            for b in g.sim.state.buildings.iter().map(|b| if b.team == g.me || g.sees(b.x, b.y) { Some(b) } else { g.fog().known.get(&b.id) }).flatten() {
                if b.hp > 0.0 {
                    let c = match b.team {
                        3 => "#be923d",
                        2 => "#9a8c67",
                        t if t == g.me => "#eadbb0",
                        _ => "#843d2d",
                    };
                    p.rect_filled(Rect::from_center_size(at(b.x, b.y), Vec2::new(((b.w * sx) as f32).max(3.0), ((b.h * sy) as f32).max(3.0))), 0.0, col(c));
                }
            }
            for u in &g.sim.state.units {
                if u.hp <= 0.0 || (u.team != g.me && !g.sees(u.x, u.y)) {
                    continue;
                }
                let c = match u.team {
                    3 => "#c99c46",
                    2 => "#c8b581",
                    t if t != g.me => "#ac3b29",
                    _ if ui_state.selected.contains(&u.id) => "#fffbe5",
                    _ if u.ty == UType::Worker => "#85b47b",
                    _ => "#e8d79c",
                };
                p.rect_filled(Rect::from_center_size(at(u.x, u.y), Vec2::splat(2.0)), 0.0, col(c));
            }
            fog.paint_rect(&p, mrect);
            for b in g.sim.state.buildings.iter().filter(|b| b.kind == BKind::Colossus && b.hp > 0.0 && (b.team == 0 || b.team == 1)) {
                let pulse = 0.5 + (g.sim.state.time * 4.0).sin() * 0.5;
                let c = if b.team != g.me { col("#ff5a3c") } else { col("#f4d27a") };
                p.circle_stroke(at(b.x, b.y), (7.0 + pulse * 4.0) as f32, Stroke::new(2.0, c));
                let m = at(b.x, b.y);
                p.add(egui::Shape::convex_polygon(vec![m + Vec2::new(0.0, -5.0), m + Vec2::new(5.0, 0.0), m + Vec2::new(0.0, 5.0), m + Vec2::new(-5.0, 0.0)], c, Stroke::NONE));
            }
            if let Some(alerts) = &g.sim.state.alerts {
                for a in alerts {
                    let (x, y, t) = (a["x"].as_f64().unwrap_or(0.0), a["y"].as_f64().unwrap_or(0.0), a["t"].as_f64().unwrap_or(0.0));
                    p.circle_stroke(at(x, y), (5.0 + (t * 12.0) % 14.0) as f32, Stroke::new(2.0, col("#ff6a4a").gamma_multiply(((1.0 - t / 8.0) as f32).max(0.2))));
                }
            }
            p.rect_stroke(Rect::from_min_size(at(view.x, view.y), Vec2::new((view.w * sx) as f32, (view.h * sy) as f32)), 0.0, Stroke::new(1.2, col("#fbefc6")));
            let to_world = |pos: Pos2| ((((pos.x - mrect.min.x) / size.x).clamp(0.0, 1.0)) as f64 * w, (((pos.y - mrect.min.y) / size.y).clamp(0.0, 1.0)) as f64 * h);
            if resp.is_pointer_button_down_on() && ctx.input(|i| i.pointer.primary_down()) {
                if let Some(pos) = resp.interact_pointer_pos() {
                    let (x, y) = to_world(pos);
                    view.cx = x;
                    view.cy = y;
                    view.update();
                }
            }
            if resp.secondary_clicked() {
                if let Some(pos) = resp.interact_pointer_pos() {
                    let (x, y) = to_world(pos);
                    command = Some((x, y, ui_state.mode == Mode::Attack));
                }
            }
            ui.label(RichText::new("THE THEATRE OF WAR").size(8.0).color(col(MUTED)));
        });
    });
    command
}

pub fn objective_panel(ctx: &egui::Context, rect: Rect, g: &Game) {
    let o = g.sim.objective_state();
    egui::Area::new("objective".into()).pivot(Align2::RIGHT_TOP).fixed_pos(rect.right_top() + Vec2::new(-12.0, 12.0)).order(egui::Order::Foreground).show(ctx, |ui| {
        egui::Frame::none().fill(col("#1b1e18e6")).stroke(Stroke::new(1.0, col("#655039"))).inner_margin(egui::Margin::same(10.0)).show(ui, |ui| {
            ui.set_width(220.0);
            eyebrow(ui, "WAR ORDERS");
            let st = &g.sim.state;
            let l = &data().levels[st.level.min(data().levels.len() - 1)];
            ui.label(RichText::new(if st.mode == "quickmatch" { "Destroy the enemy town center" } else { l.objective }).size(12.0).color(col("#e4cda2")));
            ui.label(RichText::new(if st.mode == "quickmatch" { "Protect your own." } else { l.desc }).size(9.5).color(col(MUTED)));
            ui.horizontal(|ui| {
                ui.label(RichText::new(&o.text).size(9.5).color(col(INK)));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| ui.label(RichText::new(format!("{}%", (o.progress * 100.0).round())).strong()));
            });
            let (r, _) = ui.allocate_exact_size(Vec2::new(200.0, 5.0), Sense::hover());
            ui.painter().rect_filled(r, 0.0, col("#1c241c"));
            ui.painter().rect_filled(Rect::from_min_size(r.min, Vec2::new(r.width() * o.progress.clamp(0.0, 1.0) as f32, 5.0)), 0.0, col("#c8a467"));
        });
    });
}

pub fn toasts(ctx: &egui::Context, rect: Rect, ui_state: &mut UiState) {
    let now = ui_state.clock;
    ui_state.toasts.retain(|t| now - t.at < 3.6);
    if ui_state.toasts.is_empty() {
        return;
    }
    egui::Area::new("toasts".into()).pivot(Align2::CENTER_TOP).fixed_pos(rect.center_top() + Vec2::new(0.0, 16.0)).order(egui::Order::Tooltip).interactable(false).show(ctx, |ui| {
        for t in ui_state.toasts.iter().rev().take(3) {
            let a = (1.0 - ((now - t.at) - 3.0).max(0.0) / 0.6).clamp(0.0, 1.0) as f32;
            egui::Frame::none().fill(col("#1b1e18").gamma_multiply(0.92 * a)).stroke(Stroke::new(1.0, col("#806647").gamma_multiply(a))).rounding(2.0).inner_margin(egui::Margin::symmetric(14.0, 7.0)).show(ui, |ui| {
                ui.set_max_width(520.0);
                ui.label(RichText::new(&t.text).size(12.0).color(col(INK).gamma_multiply(a)));
            });
        }
    });
}

pub fn colossus_banner(ctx: &egui::Context, rect: Rect, g: &Game) -> Option<(f64, f64)> {
    let foe = g.sim.state.buildings.iter().find(|b| b.kind == BKind::Colossus && b.team == 1 - g.me && b.hp > 0.0)?;
    let text = if foe.progress < 1.0 {
        format!("\u{26a0} ENEMY COLOSSUS UNDER CONSTRUCTION \u{2014} {}%. Click to look. Destroy it before it is finished.", (foe.progress * 100.0).floor())
    } else {
        "\u{26a0} ENEMY COLOSSUS OPERATIONAL \u{2014} it can bombard anywhere. Click to look.".to_string()
    };
    let mut look = None;
    egui::Area::new("colossus-banner".into()).pivot(Align2::CENTER_TOP).fixed_pos(rect.center_top() + Vec2::new(0.0, 64.0)).order(egui::Order::Foreground).show(ctx, |ui| {
        let pulse = 0.6 + 0.4 * ((g.sim.state.time * 4.0).sin() as f32 * 0.5 + 0.5);
        let r = ui.add(egui::Button::new(RichText::new(text).size(12.0).strong().color(Color32::from_rgb(255, 224, 214))).fill(col("#7a2a22").gamma_multiply(pulse)));
        if r.clicked() {
            look = Some((foe.x, foe.y));
        }
    });
    look
}

/// Zoom, pan and control-group buttons plus army shortcuts.
pub fn map_controls(ctx: &egui::Context, rect: Rect, g: &Game, ui_state: &mut UiState, view: &mut View, look: &mut Option<(f64, f64)>) {
    egui::Area::new("zoom".into()).pivot(Align2::LEFT_BOTTOM).fixed_pos(rect.left_bottom() + Vec2::new(12.0, -12.0)).order(egui::Order::Foreground).show(ctx, |ui| {
        ui.horizontal(|ui| {
            let step = 160.0 / view.zoom;
            for (t, dx, dy) in [("<", -step, 0.0), ("^", 0.0, -step), ("v", 0.0, step), (">", step, 0.0)] {
                if ui.button(t).clicked() {
                    view.cx += dx;
                    view.cy += dy;
                    view.update();
                }
            }
            if ui.button("-").clicked() {
                view.zoom -= 0.15;
                view.update();
            }
            if ui.button("+").clicked() {
                view.zoom += 0.15;
                view.update();
            }
            if ui.button("Select army  [SPACE]").clicked() {
                ui_state.select_army(g);
            }
            if ui.button("Home").clicked() {
                if let Some(b) = g.sim.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == g.me) {
                    *look = Some((b.x + 150.0, b.y - 100.0));
                }
            }
        });
    });
    egui::Area::new("groups".into()).pivot(Align2::LEFT_TOP).fixed_pos(rect.left_top() + Vec2::new(12.0, 12.0)).order(egui::Order::Foreground).show(ctx, |ui| {
        ui.horizontal(|ui| {
            for n in [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 0] {
                let members = ui_state.groups.get(&n).map(|m| m.len()).unwrap_or(0);
                let (command, shift) = ctx.input(|i| (i.modifiers.command, i.modifiers.shift));
                let label = RichText::new(n.to_string()).size(11.0).color(if members > 0 { col("#f0dfb4") } else { col(MUTED) });
                let r = ui.add(egui::Button::new(label).fill(if members > 0 { col("#5d4930") } else { col("#2f3128cc") }).min_size(Vec2::new(22.0, 22.0)));
                if r.on_hover_text(format!("Group {}: {} members. Ctrl+{} assigns; Ctrl+Shift+{} adds; {} selects.", n, members, n, n, n)).clicked() {
                    ui_state.control_group(g, n, command, shift);
                }
            }
        });
    });
}

fn parchment_window(ctx: &egui::Context, title: &str, open: &mut bool, add: impl FnOnce(&mut egui::Ui)) {
    let mut keep = *open;
    egui::Window::new(RichText::new(title).size(20.0).color(col("#493e28")))
        .open(&mut keep)
        .collapsible(false)
        .resizable(false)
        .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
        .frame(egui::Frame::none().fill(col("#d9c79d")).stroke(Stroke::new(3.0, col("#907345"))).inner_margin(egui::Margin::same(22.0)))
        .show(ctx, |ui| {
            ui.visuals_mut().override_text_color = Some(col("#493e28"));
            add(ui);
        });
    *open = keep;
}

pub fn help_dialog(ctx: &egui::Context, open: &mut bool) {
    parchment_window(ctx, "Build a kingdom. Lead a company.", open, |ui| {
        ui.set_width(620.0);
        egui::ScrollArea::vertical().max_height(480.0).show(ui, |ui| {
            ui.label(RichText::new("Your villagers gather food, wood, gold, and stone. Resources are credited only when they return to a suitable storehouse. Protect those routes.").size(12.0));
            for (h, t) in HELP {
                ui.add_space(6.0);
                ui.label(RichText::new(*h).strong().size(13.0).color(col("#7a5a2e")));
                ui.label(RichText::new(*t).size(11.5));
            }
        });
    });
}

pub struct Settings {
    pub music: f32,
    pub effects: f32,
    pub battle_sounds: bool,
    pub gore: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { music: 0.20, effects: 0.65, battle_sounds: true, gore: true }
    }
}

pub fn settings_dialog(ctx: &egui::Context, open: &mut bool, s: &mut Settings, now_playing: &str) -> bool {
    let mut skip = false;
    parchment_window(ctx, "Settings", open, |ui| {
        ui.set_width(360.0);
        ui.add(egui::Slider::new(&mut s.music, 0.0..=1.0).text("Music").custom_formatter(|v, _| format!("{}%", (v * 100.0).round())));
        ui.add(egui::Slider::new(&mut s.effects, 0.0..=1.0).text("Sound effects").custom_formatter(|v, _| format!("{}%", (v * 100.0).round())));
        ui.label(RichText::new(now_playing).size(10.0));
        if ui.button("Next track").clicked() {
            skip = true;
        }
        ui.checkbox(&mut s.battle_sounds, "Battle sounds");
        ui.checkbox(&mut s.gore, "Blood & fallen soldiers");
    });
    skip
}
