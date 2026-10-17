//! Faction insignia for the lobby: the same crosses `src/orders-art.js` paints on banners
//! and tabards (Templar cross pattee, Hospitaller eight-pointed cross, Teutonic cross) and
//! the Muslim crescent, drawn on heater shields.

use crate::paint::col;
use cruciata_core::factions;
use eframe::egui::{epaint::Mesh, Color32, Painter, Pos2, Rect, Shape, Stroke, Vec2};

/// One arm of each cross, pointing up (y up).
fn arm(slot: i32) -> &'static [(f32, f32)] {
    match slot {
        factions::TEMPLAR => &[(-0.2, 0.2), (-0.2, 0.5), (-0.56, 1.0), (0.56, 1.0), (0.2, 0.5), (0.2, 0.2)],
        factions::HOSPITALLER => &[(-0.16, 0.16), (-0.46, 0.98), (0.0, 0.74), (0.46, 0.98), (0.16, 0.16)],
        _ => &[(-0.2, 0.2), (-0.2, 0.7), (-0.31, 1.0), (0.31, 1.0), (0.2, 0.7), (0.2, 0.2)],
    }
}

fn turn((x, y): (f32, f32), k: usize) -> (f32, f32) {
    match k {
        0 => (x, y),
        1 => (y, -x),
        2 => (-x, -y),
        _ => (-y, x),
    }
}

/// Closed outline of the cross in unit coordinates (y up).
pub fn outline(slot: i32) -> Vec<(f32, f32)> {
    (0..4).flat_map(|k| arm(slot).iter().map(move |&p| turn(p, k))).collect()
}

fn hex(s: &str) -> Color32 {
    col(s)
}

/// Draw the insignia of `slot` centred at `c`; `size` is half the width of a cross.
pub fn draw(p: &Painter, c: Pos2, size: f32, slot: i32) {
    let Some(f) = factions::info(slot) else { return };
    let (mark, field) = (hex(f.mark), hex(f.field));
    if slot == factions::MUSLIM {
        p.circle_filled(c, size * 0.8, mark);
        p.circle_filled(c + Vec2::new(size * 0.32, -size * 0.1), size * 0.68, field);
        p.circle_filled(c + Vec2::new(size * 0.52, -size * 0.12), size * 0.2, mark);
        return;
    }
    let pts: Vec<Pos2> = outline(slot).into_iter().map(|(x, y)| Pos2::new(c.x + x * size, c.y - y * size)).collect();
    // The cross is star-shaped around its centre, so a triangle fan fills it exactly.
    let mut mesh = Mesh::default();
    mesh.colored_vertex(c, mark);
    for q in &pts {
        mesh.colored_vertex(*q, mark);
    }
    for i in 0..pts.len() {
        mesh.add_triangle(0, 1 + i as u32, 1 + ((i + 1) % pts.len()) as u32);
    }
    p.add(Shape::mesh(mesh));
    let edge = if slot == factions::HOSPITALLER { col("#9d988a") } else if slot == factions::TEMPLAR { col("#6f1612") } else { col("#000000") };
    p.add(Shape::closed_line(pts, Stroke::new((size * 0.09).max(0.6), edge)));
}

/// A heater shield in the faction's colours bearing its insignia.
pub fn shield(p: &Painter, rect: Rect, slot: i32) {
    let Some(f) = factions::info(slot) else { return };
    let (w, h) = (rect.width(), rect.height());
    let at = |x: f32, y: f32| Pos2::new(rect.center().x + x * w, rect.center().y + y * h);
    let pts = vec![at(-0.5, -0.5), at(0.5, -0.5), at(0.5, 0.0), at(0.38, 0.26), at(0.0, 0.5), at(-0.38, 0.26), at(-0.5, 0.0)];
    let rim = if slot == factions::TEUTONIC || slot == factions::TEMPLAR { col("#8c7b52") } else { col("#b8a36a") };
    p.add(Shape::convex_polygon(pts, hex(f.field), Stroke::new(1.6, rim)));
    draw(p, at(0.0, -0.06), w.min(h) * 0.3, slot);
}
