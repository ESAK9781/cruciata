//! The frame around the battlefield, laid out with the same metrics as the
//! web page (header 56px, sidebar 195px, resource bar, ridged map and command
//! panel). Everything is painted explicitly so text aligns exactly.

use crate::game::Game;
use crate::hud::Action;
use crate::keys::res_name;
use crate::paint::col;
use crate::style::*;
use crate::text::cap;
use crate::ui_state::UiState;
use cruciata_core::data::data;
use cruciata_core::model::*;
use eframe::egui::{self, Align2, Color32, Id, Pos2, Rect, Sense, Stroke, Vec2};

pub struct Layout {
    pub screen: Rect,
    pub header: Rect,
    pub sidebar: Rect,
    pub heading: Rect,
    pub resbar: Rect,
    pub map: Rect,
    pub panel: Rect,
    pub footer: Rect,
}

pub fn layout(screen: Rect) -> Layout {
    let header = Rect::from_min_size(screen.min, Vec2::new(screen.width(), 56.0));
    let sidebar = Rect::from_min_max(Pos2::new(screen.min.x, header.max.y), Pos2::new(screen.min.x + 195.0, screen.max.y));
    let (x0, x1) = (sidebar.max.x + 12.0, screen.max.x - 12.0);
    let top = header.max.y + 8.0;
    let heading = Rect::from_min_size(Pos2::new(x0, top), Vec2::new(x1 - x0, 37.0));
    let resbar = Rect::from_min_size(Pos2::new(x0, top + 45.0), Vec2::new(x1 - x0, 36.0));
    let footer = Rect::from_min_max(Pos2::new(x0, screen.max.y - 20.0), Pos2::new(x1, screen.max.y - 8.0));
    let panel = Rect::from_min_max(Pos2::new(x0, footer.min.y - 6.0 - 190.0), Pos2::new(x1, footer.min.y - 6.0));
    let map = Rect::from_min_max(Pos2::new(x0, resbar.max.y + 6.0), Pos2::new(x1, panel.min.y - 6.0));
    Layout { screen, header, sidebar, heading, resbar, map, panel, footer }
}

fn c(s: &str) -> Color32 {
    col(s)
}

/// Draws header, sidebar, heading, resource bar and the frames. Returns actions requested.
pub fn draw(ui: &mut egui::Ui, lay: &Layout, g: &Game, st: &mut UiState, icons: &Icons, actions: &mut Vec<Action>, status: &str) {
    let p = ui.painter().clone();
    let ctx = ui.ctx().clone();
    p.rect_filled(lay.screen, 0.0, c("#101a20"));

    // ---- header ----
    gradient_h(&p, lay.header, c("#231713"), c("#332219"));
    double_line(&p, Pos2::new(lay.header.min.x, lay.header.max.y - 3.0), Pos2::new(lay.header.max.x, lay.header.max.y - 3.0), c("#927347"), true);
    icons.draw(&p, "cross-rust", Rect::from_min_size(Pos2::new(24.0, 8.0), Vec2::splat(38.0)));
    p.text(Pos2::new(69.0, 6.0), Align2::LEFT_TOP, "cruciāta", fell(36.0), c("#e9d8b1"));
    spaced(&p, Pos2::new(69.0, 43.0), "A PILGRIM'S EMPIRE", sans(7.0), c("#bc9d70"), 2.0);
    // Right-hand actions, laid out right to left like the flex row.
    let mut x = lay.header.max.x - 24.0;
    let bs = ButtonStyle::standard(10.0);
    let mut btn = |ui: &mut egui::Ui, x: &mut f32, w: f32, label: &str, id: &str| -> bool {
        let r = Rect::from_min_size(Pos2::new(*x - w, 12.0), Vec2::new(w, 29.0));
        let resp = ui.interact(r, Id::new(id), Sense::click());
        paint_button(ui.painter(), r, label, &bs, false, true, resp.hovered());
        *x -= w + 7.0;
        resp.clicked()
    };
    {
        // Settings gear.
        let w = 30.0;
        let r = Rect::from_min_size(Pos2::new(x - w, 12.0), Vec2::new(w, 29.0));
        let resp = ui.interact(r, Id::new("btn-settings"), Sense::click());
        paint_button(&p, r, "", &bs, false, true, resp.hovered());
        gear(&p, r.center(), c("#f4e5c9"));
        if resp.clicked() {
            actions.push(Action::Settings);
        }
        x -= w + 7.0;
    }
    if btn(ui, &mut x, 30.0, "?", "btn-help") {
        actions.push(Action::Help);
    }
    if btn(ui, &mut x, 62.0, if g.paused() { "\u{25b6} Resume" } else { "II Pause" }, "btn-pause") && !g.is_lan() {
        actions.push(Action::Pause);
    }
    if !g.is_lan() && btn(ui, &mut x, 48.0, "Save", "btn-save") {
        actions.push(Action::Save);
    }
    x -= 5.0;
    let label = if g.is_lan() { format!("LAN \u{b7} VS {}", g.peer_name.clone().unwrap_or_default().to_uppercase()) } else { status.to_string() };
    let w = spaced_width(&ctx, &label, sans(8.0), 1.0);
    spaced(&p, Pos2::new(x - w, 28.0 - 5.0), &label, sans(8.0), c("#9b927b"), 1.0);
    x -= w + 12.0;
    if btn(ui, &mut x, 48.0, "Menu", "btn-menu") {
        actions.push(Action::Menu);
    }
    let cx = (69.0 + 118.0 + x) / 2.0 + 60.0;
    let mw = spaced_width(&ctx, "IN HOC SIGNO VINCES", fell(11.0), 3.0);
    spaced(&p, Pos2::new(cx - mw / 2.0, 20.0), "IN HOC SIGNO VINCES", fell(11.0), c("#ad976e"), 3.0);

    // ---- sidebar ----
    let sb = lay.sidebar;
    gradient_h(&p, sb, c("#142026"), c("#1c2829"));
    p.line_segment([Pos2::new(sb.max.x - 3.0, sb.min.y), Pos2::new(sb.max.x - 3.0, sb.max.y)], Stroke::new(1.0, c("#796045")));
    p.line_segment([Pos2::new(sb.max.x - 1.0, sb.min.y), Pos2::new(sb.max.x - 1.0, sb.max.y)], Stroke::new(1.0, c("#796045")));
    let y0 = sb.min.y;
    icons.draw(&p, "cross-dim", Rect::from_min_size(Pos2::new(sb.min.x + 10.0, y0 + 20.0), Vec2::splat(16.0)));
    spaced(&p, Pos2::new(sb.min.x + 31.0, y0 + 25.0), "THE PILGRIM'S CHRONICLE", sans(6.0), c("#bba279"), 1.0);
    p.text(Pos2::new(sb.min.x + 15.0, y0 + 54.0), Align2::LEFT_TOP, "The road to", fell(27.0), c(INK));
    p.text(Pos2::new(sb.min.x + 15.0, y0 + 85.0), Align2::LEFT_TOP, "Jerusalem", fell_italic(27.0), c("#c99468"));
    p.line_segment([Pos2::new(sb.min.x + 10.0, y0 + 153.0), Pos2::new(sb.max.x - 13.0, y0 + 153.0)], Stroke::new(1.0, c("#705a3c")));
    spaced(&p, Pos2::new(sb.min.x + 14.0, y0 + 172.0), "STEWARDSHIP", sans(8.0), c("#bba279"), 1.4);
    let idle = g.my_workers().into_iter().filter(|&i| g.sim.state.units[i].job.is_none() && g.sim.state.units[i].order.is_none()).count();
    let rows: [(&str, String, &str, &str); 3] = [("\u{2302}", "Find settlement".into(), "Q", "side-home"), ("\u{2659}", format!("Idle villagers   {}", idle), "V", "side-idle"), ("", "All villagers".into(), "E", "side-workers")];
    for (i, (_icon, label, key, id)) in rows.iter().enumerate() {
        let r = Rect::from_min_size(Pos2::new(sb.min.x + 14.0, y0 + 195.0 + i as f32 * 34.0), Vec2::new(sb.width() - 28.0 - 3.0, 34.0));
        let resp = ui.interact(r, Id::new(*id), Sense::click());
        let fg = if resp.hovered() { c("#e6d8b6") } else { c("#c3b391") };
        let tx = if i < 2 { r.min.x + 16.0 } else { r.min.x };
        if i == 0 {
            // house glyph
            let m = Pos2::new(r.min.x + 5.0, r.center().y + 1.0);
            p.add(egui::Shape::line(vec![m + Vec2::new(-4.0, 3.0), m + Vec2::new(-4.0, -1.0), m + Vec2::new(0.0, -5.0), m + Vec2::new(4.0, -1.0), m + Vec2::new(4.0, 3.0), m + Vec2::new(-4.0, 3.0)], Stroke::new(1.0, fg)));
        } else if i == 1 {
            let m = Pos2::new(r.min.x + 5.0, r.center().y);
            p.circle_filled(m + Vec2::new(0.0, -3.0), 2.0, fg);
            p.rect_filled(Rect::from_center_size(m + Vec2::new(0.0, 3.0), Vec2::new(6.0, 5.0)), 1.0, fg);
        }
        p.text(Pos2::new(tx, r.center().y), Align2::LEFT_CENTER, label, sans(10.0), fg);
        kbd(&p, Pos2::new(r.max.x, r.center().y), key);
        if resp.clicked() {
            match *id {
                "side-home" => actions.push(Action::Home),
                "side-idle" => {
                    if let Some((x, y)) = st.idle_worker(g) {
                        actions.push(Action::Look(x, y));
                    }
                }
                _ => st.select_workers(g),
            }
        }
    }
    for (i, r_) in Res::ALL.iter().enumerate() {
        let n = g.my_workers().into_iter().filter(|&u| g.sim.state.units[u].job.as_ref().and_then(|j| j.resource) == Some(*r_)).count();
        let y = y0 + 306.0 + i as f32 * 20.5;
        p.text(Pos2::new(sb.min.x + 14.0, y), Align2::LEFT_CENTER, format!("{} hands", cap(res_name(*r_))), sans(9.0), c("#948e75"));
        p.text(Pos2::new(sb.max.x - 17.0, y), Align2::RIGHT_CENTER, n.to_string(), sans(9.0), c("#d1be92"));
    }
    let by = y0 + 407.0;
    p.line_segment([Pos2::new(sb.min.x + 10.0, by), Pos2::new(sb.max.x - 13.0, by)], Stroke::new(1.0, c("#705a3c")));
    spaced(&p, Pos2::new(sb.min.x + 15.0, by + 15.0), "A KINGDOM IS BUILT BY MANY HANDS", sans(6.0), c("#bba279"), 1.0);
    p.text(Pos2::new(sb.min.x + 15.0, by + 36.0), Align2::LEFT_TOP, "Guard the fields. Shelter the", fell_italic(14.0), c("#a29375"));
    p.text(Pos2::new(sb.min.x + 15.0, by + 58.0), Align2::LEFT_TOP, "pilgrims. Preserve your company.", fell_italic(14.0), c("#a29375"));
    if !g.is_lan() {
        let r = Rect::from_min_size(Pos2::new(sb.min.x + 15.0, by + 94.0), Vec2::new(120.0, 28.0));
        let resp = ui.interact(r, Id::new("side-restart"), Sense::click());
        let fg = if resp.hovered() { c("#d8c39a") } else { c("#b49c76") };
        p.text(Pos2::new(r.min.x + 12.0, r.center().y), Align2::LEFT_CENTER, "Restart chapter", sans(9.0), fg);
        p.text(Pos2::new(r.min.x, r.center().y), Align2::LEFT_CENTER, "\u{21bb}", sans(9.0), fg);
        if resp.clicked() {
            actions.push(Action::Restart);
        }
    }

    // ---- heading ----
    let stt = &g.sim.state;
    let l = &data().levels[stt.level.min(data().levels.len() - 1)];
    let (eyebrow_txt, title) = if stt.mode == "quickmatch" {
        (if g.is_lan() { "LAN BATTLE".to_string() } else { "QUICKMATCH".to_string() }, if g.is_lan() { "Player versus player".to_string() } else { "Standards over the frontier".to_string() })
    } else {
        (format!("CHAPTER {} \u{b7} {}", l.roman, l.sub), l.title.to_string())
    };
    spaced(&p, Pos2::new(lay.heading.min.x, lay.heading.min.y + 1.0), &eyebrow_txt, sans(7.0), c("#bba279"), 1.4);
    p.text(Pos2::new(lay.heading.min.x, lay.heading.min.y + 11.0), Align2::LEFT_TOP, title, fell(22.0), c(INK));
    let t = stt.time;
    p.text(Pos2::new(lay.heading.max.x, lay.heading.min.y + 20.0), Align2::RIGHT_CENTER, format!("{:02}:{:02}", (t / 60.0).floor() as i64, (t % 60.0).floor() as i64), sans(12.0), c("#b4a27b"));

    // ---- resource bar ----
    let rb = lay.resbar;
    gradient_v(&p, rb, c("#34241b"), c("#231c17"));
    p.line_segment([rb.left_top(), rb.right_top()], Stroke::new(1.0, c("#7a633e")));
    p.line_segment([rb.left_top(), rb.left_bottom()], Stroke::new(1.0, c("#7a633e")));
    p.line_segment([rb.right_top(), rb.right_bottom()], Stroke::new(1.0, c("#7a633e")));
    p.line_segment([rb.left_top() + Vec2::new(1.0, 1.0), rb.right_top() + Vec2::new(-1.0, 1.0)], Stroke::new(1.0, c("#cab07526")));
    let r = g.stock();
    let pop = g.sim.population(g.me);
    let items: [(&str, &str, String); 6] = [
        ("food", "Food", format!("{}", r.food.floor())),
        ("wood", "Wood", format!("{}", r.wood.floor())),
        ("gold", "Gold", format!("{}", r.gold.floor())),
        ("stone", "Stone", format!("{}", r.stone.floor())),
        ("people", "People", format!("{} / {}", pop.used + pop.queued, pop.cap)),
        ("faith", "Faith", format!("{}", g.faith().floor())),
    ];
    let mut x = rb.min.x + 12.0;
    let cy = rb.center().y;
    for (icon, label, value) in items {
        icons.draw(&p, icon, Rect::from_center_size(Pos2::new(x + 12.0, cy), Vec2::splat(26.0)));
        x += 24.0 + 6.0;
        let vw = text_width(&ctx, &value, sans(13.0)).max(21.0);
        p.text(Pos2::new(x, cy), Align2::LEFT_CENTER, &value, sans(13.0), c("#ffebbd"));
        x += vw + 6.0;
        p.text(Pos2::new(x, cy + 1.0), Align2::LEFT_CENTER, label, sans(8.0), c("#d5bd95"));
        x += text_width(&ctx, label, sans(8.0)) + 24.0;
    }
    let status_txt = if let Some(w) = g.outcome() { if w { "VICTORY" } else { "DEFEAT" }.to_string() } else if g.paused() { "AT REST".into() } else if g.stock().food < 1.0 { "FOOD SHORTAGE".into() } else { "THE HOST MARCHES".into() };
    let sw = spaced_width(&ctx, &status_txt, sans(7.0), 1.0);
    spaced(&p, Pos2::new(rb.max.x - 12.0 - sw, cy - 4.0), &status_txt, sans(7.0), c("#a6997b"), 1.0);

    // ---- map frame ----
    ridge(&p, lay.map, 3.0, c("#9c8052"));
    // ---- command panel frame ----
    gradient_v(&p, lay.panel, c("#302019"), c("#221914"));
    ridge(&p, lay.panel, 2.0, c("#a67736"));
    // ---- footer ----
    spaced(&p, Pos2::new(lay.footer.min.x, lay.footer.min.y + 1.0), "LMB select \u{b7} Shift-drag company \u{b7} empty RMB drag pan \u{b7} RMB command \u{b7} WASD / arrows pan \u{b7} wheel zoom", sans(8.0), c("#958469"), 0.2);
    let right = if g.sim.state.result.is_some() { "Battle concluded".to_string() } else if g.is_lan() { "Player versus player".to_string() } else { format!("Enemy command \u{b7} {} AI", g.sim.state.difficulty) };
    let rw = spaced_width(&ctx, &right, sans(8.0), 0.2);
    spaced(&p, Pos2::new(lay.footer.max.x - rw, lay.footer.min.y + 1.0), &right, sans(8.0), c("#958469"), 0.2);
}

fn gear(p: &egui::Painter, c0: Pos2, color: Color32) {
    p.circle_stroke(c0, 4.5, Stroke::new(1.6, color));
    p.circle_filled(c0, 1.4, color);
    for i in 0..8 {
        let a = i as f32 * std::f32::consts::FRAC_PI_4;
        let d = Vec2::new(a.cos(), a.sin());
        p.line_segment([c0 + d * 5.5, c0 + d * 7.5], Stroke::new(2.0, color));
    }
}
