//! Things drawn over the map (minimap, objective panel, toasts, banners)
//! and the modal dialogs.

use crate::game::Game;
use crate::hud::*;
use crate::paint::col;
use crate::text::HELP;
use crate::ui_state::*;
use crate::style::{fell, gradient_v, sans};
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
            px.push(crate::paint::rgba(8, 16, 23, a));
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
            for &(x, y, at_t) in &ui_state.alerts {
                let t = ui_state.clock - at_t;
                if t < 8.0 {
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
    // Dim everything behind the dialog.
    egui::Area::new("dialog-dim".into()).order(egui::Order::Middle).fixed_pos(ctx.screen_rect().min).interactable(true).show(ctx, |ui| {
        let r = ctx.screen_rect();
        ui.allocate_rect(r, egui::Sense::click());
        ui.painter().rect_filled(r, 0.0, Color32::from_black_alpha(150));
    });
    let mut keep = *open;
    egui::Window::new(RichText::new(title).font(crate::style::fell(24.0)).color(col("#f0dfb4")))
        .open(&mut keep)
        .collapsible(false)
        .resizable(false)
        .order(egui::Order::Foreground)
        .anchor(Align2::CENTER_CENTER, Vec2::ZERO)
        .frame(egui::Frame::none().fill(col("#2a1f17")).stroke(Stroke::new(2.0, col("#a98a56"))).inner_margin(egui::Margin::same(24.0)))
        .show(ctx, |ui| {
            ui.visuals_mut().override_text_color = Some(col("#f1e3c3"));
            ui.visuals_mut().widgets.inactive.bg_fill = col("#5a4630");
            ui.visuals_mut().widgets.inactive.weak_bg_fill = col("#5a4630");
            ui.visuals_mut().widgets.hovered.bg_fill = col("#7a5f3e");
            ui.visuals_mut().widgets.hovered.weak_bg_fill = col("#7a5f3e");
            ui.visuals_mut().selection.bg_fill = col("#b98a4a");
            ui.spacing_mut().item_spacing = Vec2::new(10.0, 10.0);
            add(ui);
        });
    *open = keep;
}

pub fn help_dialog(ctx: &egui::Context, open: &mut bool) {
    if !*open {
        return;
    }
    parchment_window(ctx, "Build a kingdom. Lead a company.", open, |ui| {
        ui.set_width(660.0);
        egui::ScrollArea::vertical().max_height(480.0).show(ui, |ui| {
            ui.label(RichText::new("Your villagers gather food, wood, gold, and stone. Resources are credited only when they return to a suitable storehouse. Protect those routes.").size(13.0));
            for (h, t) in HELP {
                ui.add_space(6.0);
                ui.label(RichText::new(*h).font(crate::style::fell(17.0)).color(col("#e2b46a")));
                ui.label(RichText::new(*t).size(13.0));
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
    if !*open {
        return false;
    }
    let mut skip = false;
    parchment_window(ctx, "Settings", open, |ui| {
        ui.set_width(420.0);
        ui.label(RichText::new("MAKE CAMP").size(11.0).color(col("#c8a467")));
        for (label, value) in [("Music", &mut s.music), ("Sound effects", &mut s.effects)] {
            ui.label(RichText::new(label).size(14.0));
            ui.add(egui::Slider::new(value, 0.0..=1.0).custom_formatter(|v, _| format!("{}%", (v * 100.0).round())).trailing_fill(true));
        }
        ui.label(RichText::new(now_playing).size(12.0).color(col("#d9c79d")));
        if ui.add(egui::Button::new(RichText::new("Next track").size(13.0))).clicked() {
            skip = true;
        }
        ui.checkbox(&mut s.battle_sounds, RichText::new("Battle sounds").size(14.0));
        ui.checkbox(&mut s.gore, RichText::new("Blood & fallen soldiers").size(14.0));
        ui.label(RichText::new("Campaign completion and active games are stored on this computer.").size(11.0).color(col("#c9b78f")));
    });
    skip
}

pub enum ResultChoice {
    Menu,
    Next,
    Again,
}

/// The end-of-battle card (`finish` in game.js). Returns the player's choice.
pub fn result_dialog(ctx: &egui::Context, map: Rect, g: &Game) -> Option<ResultChoice> {
    let won = g.outcome()?;
    let st = &g.sim.state;
    let l = &data().levels[st.level.min(data().levels.len() - 1)];
    let quick = st.mode == "quickmatch";
    let (label, title, body, button) = if quick {
        (
            "BATTLE COMPLETE",
            if won { if g.is_lan() { "Victory over your rival." } else { "Quickmatch won." } } else if g.is_lan() { "Your town center has fallen." } else { "Your settlement has fallen." },
            if won { "The opposing town center is destroyed. Your host holds the battlefield." } else { "Your town center has fallen. Return to the menu to prepare another host." }.to_string(),
            "Return to the menu".to_string(),
        )
    } else {
        (
            if won { "CHAPTER COMPLETE" } else { "THE CHRONICLE REMEMBERS" },
            if won { if st.level == 5 { "Jerusalem is taken." } else { "The standard still flies." } } else { "The settlement has fallen." },
            if won { l.win.to_string() } else { "Your town centre or your entrusted pilgrims have been lost. Gather the company, protect your workers, and try a different plan.".to_string() },
            if won && st.level < 5 { format!("Continue to {}", data().levels[st.level + 1].name) } else { "March again".to_string() },
        )
    };
    let body = format!("{} Your people who fell: {}.", body, st.losses);
    let mut choice = None;
    let second = !quick && !g.is_lan();
    match card(ctx, map, label, title, &body, &button, if second { Some("Return to the menu") } else { None }) {
        Some(0) => choice = Some(if quick || g.is_lan() { ResultChoice::Menu } else if won && st.level < 5 { ResultChoice::Next } else { ResultChoice::Again }),
        Some(_) => choice = Some(ResultChoice::Menu),
        None => {}
    }
    choice
}

/// The playtesting menu (F2). Returns the cheat the player chose.
pub fn debug_dialog(ctx: &egui::Context, open: &mut bool, g: &Game) -> Option<&'static str> {
    if !*open {
        return None;
    }
    let mut chosen = None;
    parchment_window(ctx, "Command the battlefield", open, |ui| {
        ui.set_width(460.0);
        ui.label(RichText::new("PLAYTESTING / DEBUG MODE").size(11.0).color(col("#c8a467")));
        ui.label(RichText::new("Cheats affect this session. Toggle buttons stay active until switched off.").size(13.0));
        for (id, label) in [
            ("resources", "Grant 10,000 of every resource"),
            ("army", "Raise 48 troops"),
            ("heal", "Heal all your people & structures"),
            ("invulnerable", "Toggle invulnerability"),
            ("instant", "Toggle instant building & training"),
            ("reveal", "Toggle map reveal"),
            ("speed", "Toggle 4x simulation speed"),
            ("peace", "Remove enemy combat troops"),
            ("victory", "Win this battle"),
        ] {
            let active = if id == "speed" { g.sim.speed_cheat() == 4.0 } else { g.sim.cheat_on(id) };
            let b = egui::Button::new(RichText::new(label).size(13.0)).fill(if active { col("#8a5a2d") } else { col("#5a4630") }).min_size(Vec2::new(440.0, 30.0));
            if ui.add(b).clicked() {
                chosen = Some(id);
            }
        }
    });
    chosen
}

/// The web's `#overlay`: a dimmed card over the battlefield with a cross, eyebrow, title,
/// text and a bronze button (intro, pause and result screens). Returns the clicked button.
pub fn card(ctx: &egui::Context, map: Rect, label: &str, title: &str, body: &str, button: &str, second: Option<&str>) -> Option<usize> {
    let mut clicked = None;
    egui::Area::new("overlay-card".into()).order(egui::Order::Foreground).fixed_pos(map.min).interactable(true).show(ctx, |ui| {
        ui.allocate_rect(map, Sense::click());
        let p = ui.painter().clone();
        p.rect_filled(map, 0.0, col("#252b21df"));
        let galley = p.layout(body.to_string(), sans(12.0), col("#b6ae92"), 540.0_f32.min(map.width() - 60.0));
        let body_h = galley.size().y.max(12.0 * 1.9) * 1.0 + 12.0;
        let total = 50.0 + 15.0 + 12.0 + 16.0 + 44.0 + 16.0 + body_h + 20.0 + 46.0 + if second.is_some() { 54.0 } else { 0.0 };
        let cx = map.center().x;
        let mut y = map.center().y - total / 2.0;
        // Maltese cross.
        let c = Pos2::new(cx, y + 25.0);
        let gold = col("#b88c57");
        for k in 0..4 {
            let a = k as f32 * std::f32::consts::FRAC_PI_2;
            let (cs, sn) = (a.cos(), a.sin());
            let rot = |x: f32, yy: f32| Pos2::new(c.x + x * cs - yy * sn, c.y + x * sn + yy * cs);
            p.add(egui::Shape::convex_polygon(vec![rot(0.0, 0.0), rot(21.0, -8.0), rot(23.0, 0.0), rot(21.0, 8.0)], gold, Stroke::NONE));
        }
        y += 50.0 + 15.0;
        spaced_center(&p, cx, y, label, sans(9.0), col("#b49968"), 1.6);
        y += 12.0 + 16.0;
        p.text(Pos2::new(cx, y), Align2::CENTER_TOP, title, fell(44.0), col("#e4d2aa"));
        y += 44.0 + 22.0;
        p.galley(Pos2::new(cx - galley.size().x / 2.0, y), galley.clone(), col("#b6ae92"));
        y += body_h + 8.0;
        let mut btn = |ui: &mut egui::Ui, y: f32, text: &str, i: usize| {
            let w = (text.chars().count() as f32 * 8.0 + 56.0).max(120.0);
            let r = Rect::from_center_size(Pos2::new(cx, y + 21.0), Vec2::new(w, 42.0));
            let resp = ui.interact(r, egui::Id::new(("overlay-btn", i)), Sense::click());
            let (a, b) = if resp.hovered() { (col("#ad8450"), col("#85603b")) } else { (col("#9a7545"), col("#745131")) };
            gradient_v(&p, r, a, b);
            p.rect_stroke(r, 0.0, Stroke::new(1.0, col("#b59861")));
            p.text(r.center(), Align2::CENTER_CENTER, text, fell(16.0), col("#f0dfb7"));
            if resp.clicked() {
                clicked = Some(i);
            }
        };
        btn(ui, y, button, 0);
        if let Some(t) = second {
            btn(ui, y + 54.0, t, 1);
        }
    });
    clicked
}

fn spaced_center(p: &egui::Painter, cx: f32, y: f32, text: &str, font: egui::FontId, color: Color32, spacing: f32) {
    let w = text.chars().count() as f32 * (font.size * 0.62 + spacing);
    crate::style::spaced(p, Pos2::new(cx - w / 2.0, y), text, font, color, spacing);
}
