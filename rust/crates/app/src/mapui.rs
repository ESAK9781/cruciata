//! Controls drawn over the battlefield: place label, camera buttons, control
//! groups, the war-orders card, minimap and quick buttons (all positioned
//! like the absolutely placed elements of the web page).

use crate::game::Game;
use crate::overlay::FogTex;
use crate::paint::col;
use crate::style::*;
use crate::ui_state::*;
use crate::view::View;
use cruciata_core::data::data;
use cruciata_core::model::*;
use eframe::egui::{self, Align2, Color32, Id, Pos2, Rect, Sense, Stroke, TextureId, Vec2};

fn c(s: &str) -> Color32 {
    col(s)
}

fn small_button(ui: &mut egui::Ui, id: &str, rect: Rect, st: &ButtonStyle, label: &str, active: bool) -> egui::Response {
    let resp = ui.interact(rect, Id::new(id), Sense::click());
    paint_button(ui.painter(), rect, label, st, active, true, resp.hovered());
    resp
}

fn arrow(p: &egui::Painter, r: Rect, dir: Vec2, color: Color32) {
    let c0 = r.center();
    let a = c0 - dir * 5.0;
    let b = c0 + dir * 5.0;
    let n = Vec2::new(-dir.y, dir.x);
    p.line_segment([a, b], Stroke::new(1.4, color));
    p.line_segment([b, b - dir * 3.5 + n * 3.0], Stroke::new(1.4, color));
    p.line_segment([b, b - dir * 3.5 - n * 3.0], Stroke::new(1.4, color));
}

pub struct MapOut {
    pub look: Option<(f64, f64)>,
    pub minimap_order: Option<(f64, f64, bool)>,
}

#[allow(clippy::too_many_arguments)]
pub fn draw(ui: &mut egui::Ui, inner: Rect, g: &Game, st: &mut UiState, view: &mut View, fog: &FogTex, terrain: Option<TextureId>, icons: &Icons) -> MapOut {
    let p = ui.painter().clone();
    let ctx = ui.ctx().clone();
    let mut out = MapOut { look: None, minimap_order: None };
    let lvl = &data().levels[g.sim.state.level.min(data().levels.len() - 1)];
    let quick = g.sim.state.mode == "quickmatch";
    let o = inner.min;

    // Place label.
    let name = if quick { "THE THEATRE OF WAR".to_string() } else { lvl.sub.to_string() };
    let nw = spaced_width(&ctx, &name, sans(8.0), 1.2);
    let label = Rect::from_min_size(o + Vec2::new(14.0, 13.0), Vec2::new(nw + 52.0, 38.0));
    p.rect_filled(label, 0.0, c("#34372cdd"));
    p.rect_stroke(label, 0.0, Stroke::new(1.0, c("#9c8557")));
    icons.draw(&p, "cross-dim", Rect::from_center_size(label.min + Vec2::new(20.0, 19.0), Vec2::splat(15.0)));
    spaced(&p, Pos2::new(label.min.x + 38.0, label.center().y - 5.0), &name, sans(8.0), c("#dfd0ac"), 1.2);

    // Camera buttons.
    let ob = ButtonStyle::overlay(13.0);
    let step = 160.0 / view.zoom;
    let dirs = [(Vec2::new(-1.0, 0.0), -step, 0.0), (Vec2::new(0.0, -1.0), 0.0, -step), (Vec2::new(0.0, 1.0), 0.0, step), (Vec2::new(1.0, 0.0), step, 0.0)];
    for (i, (d, dx, dy)) in dirs.iter().enumerate() {
        let r = Rect::from_min_size(o + Vec2::new(14.0 + i as f32 * 28.0, 52.0), Vec2::new(25.0, 24.0));
        let resp = small_button(ui, &format!("cam{i}"), r, &ob, "", false);
        arrow(&p, r, *d, c("#d0c69b"));
        if resp.clicked() {
            view.cx += dx;
            view.cy += dy;
            view.update();
        }
    }
    for (i, (label, delta)) in [("\u{2212}", -0.15), ("+", 0.15)].iter().enumerate() {
        let r = Rect::from_min_size(o + Vec2::new(14.0 + (4 + i) as f32 * 28.0, 52.0), Vec2::new(25.0, 24.0));
        let resp = small_button(ui, &format!("zoom{i}"), r, &ob, label, false);
        if resp.clicked() {
            view.zoom += delta;
            view.update();
        }
    }
    // Control groups: two rows of five.
    let gs = ButtonStyle { font: serif(11.0), fg: c("#9b987d"), top: c("#18251ee6"), bottom: c("#18251ee6"), border: c("#635f45"), hover_top: c("#243a2d"), hover_bottom: c("#243a2d"), hover_border: c("#8e8a66") };
    let (command, shift) = ctx.input(|i| (i.modifiers.command, i.modifiers.shift));
    for (k, n) in [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 0].iter().enumerate() {
        let (row, colm) = (k / 5, k % 5);
        let r = Rect::from_min_size(o + Vec2::new(14.0 + colm as f32 * 27.0, 82.0 + row as f32 * 25.0), Vec2::new(24.0, 22.0));
        let members = st.groups.get(n).map(|m| m.len()).unwrap_or(0);
        let mut style = ButtonStyle { font: gs.font.clone(), fg: gs.fg, top: gs.top, bottom: gs.bottom, border: gs.border, hover_top: gs.hover_top, hover_bottom: gs.hover_bottom, hover_border: gs.hover_border };
        if members > 0 {
            style.fg = c("#f0dfb4");
            style.top = c("#5d4930");
            style.bottom = c("#5d4930");
            style.border = c("#a98a56");
        }
        let resp = small_button(ui, &format!("grp{n}"), r, &style, &n.to_string(), false);
        let resp = resp.on_hover_text(format!("Group {n}: {members} members. Ctrl+{n} assigns; Ctrl+Shift+{n} adds; {n} selects."));
        if resp.clicked() {
            st.control_group(g, *n, command, shift);
        }
    }

    // War orders.
    let obj = g.sim.objective_state();
    let (otxt, osub) = if quick { ("Destroy the enemy town center".to_string(), "Protect your own. Both armies begin with the same stores, soldiers and villagers.".to_string()) } else { (lvl.objective.to_string(), format!("{} Destroy the opposing capital for immediate victory; losing your capital is defeat.", lvl.desc)) };
    let card_w = 228.0;
    let pad = 12.0;
    let text_w = card_w - pad * 2.0;
    let h_obj = paragraph_height(&ctx, text_w, &otxt, fell(19.0), 24.0);
    let h_sub = paragraph_height(&ctx, text_w, &osub, sans(9.0), 15.0);
    let h_stage = paragraph_height(&ctx, text_w - 36.0, &obj.text, sans(8.0), 11.0);
    let card_h = pad + 10.0 + 7.0 + h_obj + 7.0 + h_sub + 12.0 + h_stage + 6.0 + 4.0 + pad;
    let card = Rect::from_min_size(Pos2::new(inner.max.x - 14.0 - card_w, o.y + 13.0), Vec2::new(card_w, card_h));
    gradient_v(&p, card, c("#f1d49f"), c("#d8b576"));
    p.rect_stroke(card, 0.0, Stroke::new(1.0, c("#795328")));
    p.circle_filled(card.min + Vec2::new(7.0, 7.0), 2.5, c("#745333"));
    p.circle_filled(card.max - Vec2::new(7.0, card_h - 7.0), 2.5, c("#745333"));
    let mut y = card.min.y + pad;
    spaced(&p, Pos2::new(card.min.x + pad, y), "WAR ORDERS", sans(7.0), c("#856b47"), 1.4);
    y += 10.0 + 7.0;
    y += paragraph(&p, Pos2::new(card.min.x + pad, y), text_w, &otxt, fell(19.0), c("#392513"), 24.0) + 7.0;
    y += paragraph(&p, Pos2::new(card.min.x + pad, y), text_w, &osub, sans(9.0), c("#5e4226"), 15.0);
    y += 12.0;
    paragraph(&p, Pos2::new(card.min.x + pad, y), text_w - 36.0, &obj.text, sans(8.0), c("#54482c"), 11.0);
    p.text(Pos2::new(card.max.x - pad, y), Align2::RIGHT_TOP, format!("{}%", (obj.progress * 100.0).round()), sans(8.0), c("#54482c"));
    y += h_stage + 6.0;
    let track = Rect::from_min_size(Pos2::new(card.min.x + pad, y), Vec2::new(text_w, 4.0));
    p.rect_filled(track, 0.0, c("#a7916b55"));
    p.rect_filled(Rect::from_min_size(track.min, Vec2::new(track.width() * obj.progress.clamp(0.0, 1.0) as f32, 4.0)), 0.0, c("#905444"));

    // Season label and quick buttons (bottom-left).
    let by = inner.max.y - 12.0;
    let qs = ButtonStyle { font: sans(8.0), fg: c(INK), top: c("#333b2cdf"), bottom: c("#333b2cdf"), border: c("#9c895d"), hover_top: c("#46513c"), hover_bottom: c("#46513c"), hover_border: c("#cdb882") };
    let army = Rect::from_min_size(Pos2::new(o.x + 14.0, by - 26.0), Vec2::new(107.0, 26.0));
    let resp = ui.interact(army, Id::new("quick-army"), Sense::click());
    paint_button(&p, army, "", &qs, false, true, resp.hovered());
    p.text(Pos2::new(army.min.x + 11.0, army.center().y), Align2::LEFT_CENTER, "Select army", sans(8.0), c(INK));
    kbd(&p, Pos2::new(army.max.x - 8.0, army.center().y), "SPACE");
    if resp.clicked() {
        st.select_army(g);
    }
    let home = Rect::from_min_size(Pos2::new(army.max.x + 4.0, army.min.y), Vec2::new(46.0, 26.0));
    let resp = ui.interact(home, Id::new("quick-home"), Sense::click());
    paint_button(&p, home, "Home", &qs, false, true, resp.hovered());
    if resp.clicked() {
        if let Some(b) = g.sim.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == g.me) {
            out.look = Some((b.x + 150.0, b.y - 100.0));
        }
    }
    if !quick {
        let tw = spaced_width(&ctx, lvl.date, sans(7.0), 1.3);
        let r = Rect::from_min_size(Pos2::new(o.x + 14.0, by - 26.0 - 9.0 - 21.0), Vec2::new(tw + 18.0, 21.0));
        p.rect_filled(r, 0.0, c("#354032c2"));
        spaced(&p, Pos2::new(r.min.x + 9.0, r.center().y - 4.0), lvl.date, sans(8.0), c("#f0e3c3"), 1.3);
    }

    // Minimap.
    let (w, h) = (g.sim.geo.w, g.sim.geo.h);
    let cw = 152.0;
    let ch = (cw as f64 * h / w) as f32;
    let frame = Rect::from_min_size(Pos2::new(inner.max.x - 14.0 - (cw + 12.0), by - (ch + 12.0 + 20.0)), Vec2::new(cw + 12.0, ch + 12.0 + 20.0));
    p.rect_filled(frame, 0.0, c("#423925"));
    ridge(&p, frame, 2.0, c("#aa8c58"));
    let mrect = Rect::from_min_size(frame.min + Vec2::new(6.0, 6.0), Vec2::new(cw, ch));
    let resp = ui.interact(mrect, Id::new("minimap"), Sense::click_and_drag());
    let mp = p.with_clip_rect(mrect);
    mp.rect_filled(mrect, 0.0, c("#101a20"));
    if let Some(t) = terrain {
        mp.image(t, mrect, Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
    }
    let (sx, sy) = (cw as f64 / w, ch as f64 / h);
    let at = |x: f64, y: f64| Pos2::new(mrect.min.x + (x * sx) as f32, mrect.min.y + (y * sy) as f32);
    for f in &g.sim.state.terrain_features {
        if f.forest == Some(true) {
            for t in &f.tiles {
                mp.rect_filled(Rect::from_min_size(at(t.x as f64 * f.cell, t.y as f64 * f.cell), Vec2::new((f.cell * sx) as f32 + 0.6, (f.cell * sy) as f32 + 0.6)), 0.0, c("#3f5b2f"));
            }
        }
    }
    for n in &g.sim.state.nodes {
        if n.remaining > 0.0 {
            let k = match n.kind {
                Res::Wood => "#566d35",
                Res::Food => "#c9ae61",
                Res::Gold => "#edd070",
                Res::Stone => "#a1a391",
            };
            mp.rect_filled(Rect::from_center_size(at(n.x, n.y), Vec2::splat(2.0)), 0.0, c(k));
        }
    }
    for b in g.sim.state.buildings.iter().filter_map(|b| if b.team == g.me || g.sees(b.x, b.y) { Some(b) } else { g.fog().known.get(&b.id) }) {
        if b.hp > 0.0 {
            let k = match b.team {
                3 => "#be923d",
                2 => "#9a8c67",
                t if t == g.me => "#eadbb0",
                _ => "#843d2d",
            };
            mp.rect_filled(Rect::from_center_size(at(b.x, b.y), Vec2::new(((b.w * sx) as f32).max(3.0), ((b.h * sy) as f32).max(3.0))), 0.0, c(k));
        }
    }
    for u in &g.sim.state.units {
        if u.hp <= 0.0 || (u.team != g.me && !g.sees(u.x, u.y)) {
            continue;
        }
        let k = match u.team {
            3 => "#c99c46",
            2 => "#c8b581",
            t if t != g.me => "#ac3b29",
            _ if st.selected.contains(&u.id) => "#fffbe5",
            _ if u.ty == UType::Worker => "#85b47b",
            _ => "#e8d79c",
        };
        mp.rect_filled(Rect::from_center_size(at(u.x, u.y), Vec2::splat(2.0)), 0.0, c(k));
    }
    fog.paint_rect(&mp, mrect);
    for b in g.sim.state.buildings.iter().filter(|b| b.kind == BKind::Colossus && b.hp > 0.0 && (b.team == 0 || b.team == 1)) {
        let pulse = 0.5 + (g.sim.state.time * 4.0).sin() * 0.5;
        let k = if b.team != g.me { c("#ff5a3c") } else { c("#f4d27a") };
        mp.circle_stroke(at(b.x, b.y), (7.0 + pulse * 4.0) as f32, Stroke::new(2.0, k));
        let m = at(b.x, b.y);
        mp.add(egui::Shape::convex_polygon(vec![m + Vec2::new(0.0, -5.0), m + Vec2::new(5.0, 0.0), m + Vec2::new(0.0, 5.0), m + Vec2::new(-5.0, 0.0)], k, Stroke::NONE));
    }
    for &(x, y, t0) in &st.alerts {
        let t = st.clock - t0;
        if t < 8.0 {
            mp.circle_stroke(at(x, y), (5.0 + (t * 12.0) % 14.0) as f32, Stroke::new(2.0, c("#ff6a4a").gamma_multiply(((1.0 - t / 8.0) as f32).max(0.2))));
        }
    }
    mp.rect_stroke(Rect::from_min_size(at(view.x, view.y), Vec2::new((view.w * sx) as f32, (view.h * sy) as f32)), 0.0, Stroke::new(1.2, c("#fbefc6")));
    let to_world = |pos: Pos2| ((((pos.x - mrect.min.x) / cw).clamp(0.0, 1.0)) as f64 * w, (((pos.y - mrect.min.y) / ch).clamp(0.0, 1.0)) as f64 * h);
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
            out.minimap_order = Some((x, y, st.mode == Mode::Attack));
        }
    }
    let lw = spaced_width(&ctx, "THE THEATRE OF WAR", sans(6.0), 1.3);
    spaced(&p, Pos2::new(frame.center().x - lw / 2.0, mrect.max.y + 8.0), "THE THEATRE OF WAR", sans(7.0), c("#dcc296"), 1.3);
    out
}

/// Short messages (the web page's `#toast`).
pub fn toasts(ui: &mut egui::Ui, inner: Rect, st: &mut UiState) {
    let now = st.clock;
    st.toasts.retain(|t| now - t.at < 3.4);
    let p = ui.painter().clone();
    let ctx = ui.ctx().clone();
    let mut y = inner.max.y - 56.0;
    for t in st.toasts.iter().rev().take(3) {
        let a = (1.0 - ((now - t.at) - 2.9).max(0.0) / 0.5).clamp(0.0, 1.0) as f32;
        let w = (text_width(&ctx, &t.text, sans(10.0)) + 34.0).min(inner.width() * 0.7);
        let h = paragraph_height(&ctx, w - 34.0, &t.text, sans(10.0), 14.0) + 22.0;
        let r = Rect::from_center_size(Pos2::new(inner.center().x, y - h / 2.0), Vec2::new(w, h));
        p.rect_filled(r, 0.0, c("#27352b").gamma_multiply(0.93 * a));
        p.rect_stroke(r, 0.0, Stroke::new(1.0, c("#b59a67").gamma_multiply(a)));
        paragraph(&p, Pos2::new(r.min.x + 17.0, r.min.y + 11.0), w - 34.0, &t.text, sans(10.0), c("#e8d9b6").gamma_multiply(a), 14.0);
        y -= h + 6.0;
    }
}
