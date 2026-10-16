//! The baked ground: grass blotches, strokes, sea, shore, river and bridge
//! (`Art.terrain` plus the static parts of `terrainDetails`), drawn once with
//! tiny-skia and uploaded as one texture.

use crate::paint::col;
use cruciata_core::js::{cos, sin, Seeded};
use cruciata_core::model::State;
use cruciata_core::world::{bridge_y, coast_x, river_x};
use eframe::egui::ColorImage;
use tiny_skia::{Color, FillRule, GradientStop, LinearGradient, Paint, PathBuilder, Pixmap, Point, SpreadMode, Stroke, Transform};

struct Cv {
    pm: Pixmap,
    s: f32,
}

fn color(c: &str) -> Color {
    let [r, g, b, a] = col(c).to_srgba_unmultiplied();
    Color::from_rgba8(r, g, b, a)
}

impl Cv {
    fn paint(c: &str) -> Paint<'static> {
        let mut p = Paint::default();
        p.set_color(color(c));
        p.anti_alias = true;
        p
    }

    fn rect(&mut self, x: f64, y: f64, w: f64, h: f64, c: &str) {
        let mut pb = PathBuilder::new();
        if let Some(r) = tiny_skia::Rect::from_xywh(x as f32, y as f32, w as f32, h as f32) {
            pb.push_rect(r);
        }
        if let Some(p) = pb.finish() {
            self.pm.fill_path(&p, &Self::paint(c), FillRule::Winding, Transform::from_scale(self.s, self.s), None);
        }
    }

    fn ellipse(&mut self, x: f64, y: f64, rx: f64, ry: f64, c: &str) {
        let mut pb = PathBuilder::new();
        if let Some(r) = tiny_skia::Rect::from_xywh((x - rx) as f32, (y - ry) as f32, (rx * 2.0) as f32, (ry * 2.0) as f32) {
            pb.push_oval(r);
        }
        if let Some(p) = pb.finish() {
            self.pm.fill_path(&p, &Self::paint(c), FillRule::Winding, Transform::from_scale(self.s, self.s), None);
        }
    }

    fn line(&mut self, pts: &[(f64, f64)], width: f64, c: &str) {
        let mut pb = PathBuilder::new();
        for (i, &(x, y)) in pts.iter().enumerate() {
            if i == 0 {
                pb.move_to(x as f32, y as f32);
            } else {
                pb.line_to(x as f32, y as f32);
            }
        }
        if let Some(p) = pb.finish() {
            let stroke = Stroke { width: width as f32, line_cap: tiny_skia::LineCap::Round, line_join: tiny_skia::LineJoin::Round, ..Default::default() };
            self.pm.stroke_path(&p, &Self::paint(c), &stroke, Transform::from_scale(self.s, self.s), None);
        }
    }

    fn polygon_gradient(&mut self, pts: &[(f64, f64)], x0: f64, x1: f64, stops: &[(f32, &str)]) {
        let mut pb = PathBuilder::new();
        for (i, &(x, y)) in pts.iter().enumerate() {
            if i == 0 {
                pb.move_to(x as f32, y as f32);
            } else {
                pb.line_to(x as f32, y as f32);
            }
        }
        pb.close();
        let Some(p) = pb.finish() else { return };
        let gs: Vec<GradientStop> = stops.iter().map(|(o, c)| GradientStop::new(*o, color(c))).collect();
        if let Some(sh) = LinearGradient::new(Point::from_xy(x0 as f32, 0.0), Point::from_xy(x1 as f32, 0.0), gs, SpreadMode::Pad, Transform::identity()) {
            let mut paint = Paint::default();
            paint.shader = sh;
            paint.anti_alias = true;
            self.pm.fill_path(&p, &paint, FillRule::Winding, Transform::from_scale(self.s, self.s), None);
        }
    }
}

/// Bake the ground. `level` is the biome index used by the original
/// (0 coastal, 1 river, 2 arid, 3 winter); `coast` enables the sea.
pub fn bake(state: &State, w: f64, h: f64, level: i32, coast: bool) -> ColorImage {
    let scale = 0.5f64.min(2560.0 / w).min(1800.0 / h);
    let (pw, ph) = ((w * scale).ceil() as u32, (h * scale).ceil() as u32);
    let mut cv = Cv { pm: Pixmap::new(pw.max(1), ph.max(1)).unwrap(), s: scale as f32 };
    let mut rand = Seeded::new(state.seed);
    let colors: [&str; 3] = match level {
        2 => ["#cba766", "#d9ba7c", "#b89759"],
        3 => ["#aabbb4", "#c9d2c7", "#83958b"],
        _ => ["#628444", "#74984f", "#537337"],
    };
    cv.rect(0.0, 0.0, w, h, colors[0]);
    for i in 0..1600 {
        let (x, y) = (rand.next() * w, rand.next() * h);
        let (rx, ry) = (60.0 + rand.next() * 200.0, 40.0 + rand.next() * 140.0);
        cv.ellipse(x, y, rx, ry, &format!("{}18", colors[1 + (i % 2)]));
    }
    let stroke_col = if level == 2 { "#ae9e6c55" } else { "#758c5650" };
    for _ in 0..16000 {
        let (x, y) = (rand.next() * w, rand.next() * h);
        cv.line(&[(x, y), (x + 1.0, y - 2.0), (x + 3.0, y)], 0.6, stroke_col);
    }
    if level == 0 && coast {
        let mut pts = vec![(0.0, 0.0), (coast_x(0.0), 0.0)];
        let mut y = 0.0;
        while y <= h {
            pts.push((coast_x(y), y));
            y += 10.0;
        }
        pts.push((0.0, h));
        cv.polygon_gradient(&pts, 0.0, 420.0, &[(0.0, "#174a5d"), (0.75, "#247584"), (1.0, "#47958d")]);
        let mut shore = vec![];
        let mut y = 0.0;
        while y <= h {
            shore.push((coast_x(y), y));
            y += 10.0;
        }
        cv.line(&shore, 22.0, "#d4c592");
        cv.line(&shore.iter().map(|&(x, y)| (x - 15.0, y)).collect::<Vec<_>>(), 3.0, "#bdd2b7");
        cv.line(&shore.iter().map(|&(x, y)| (x + 8.0, y)).collect::<Vec<_>>(), 2.0, "#b9a77c");
        for _ in 0..600 {
            let y = rand.next() * h;
            let x = rand.next() * coast_x(y);
            let len = 8.0 + rand.next() * 15.0;
            cv.line(&[(x, y), (x + len, y)], 1.0, "#81c1c266");
        }
    }
    if level == 1 {
        let mut pts = vec![];
        let mut y = 0.0;
        while y < h {
            pts.push((river_x(state, w, y), y));
            y += 10.0;
        }
        cv.line(&pts, 110.0, "#6c9690");
        cv.line(&pts, 78.0, "#7aa39a");
        cv.line(&pts.iter().map(|&(x, y)| (x + 38.0, y)).collect::<Vec<_>>(), 2.0, "#b2c7a5");
        let by = bridge_y(state, h);
        let bx = river_x(state, w, by);
        cv.rect(bx - 85.0, by - 47.0, 170.0, 94.0, "#a3946c");
        let mut x = bx - 82.0;
        while x < bx + 82.0 {
            cv.line(&[(x, by - 42.0), (x, by + 42.0)], 2.0, "#cfbb8e");
            x += 12.0;
        }
        cv.line(&[(bx - 87.0, by - 50.0), (bx + 87.0, by - 50.0)], 6.0, "#a99a77");
        cv.line(&[(bx - 87.0, by + 50.0), (bx + 87.0, by + 50.0)], 6.0, "#a99a77");
    }
    // Faint grass tufts that the original tiled over the ground.
    let _ = (sin(0.0), cos(0.0));
    let px: Vec<eframe::egui::Color32> = cv.pm.pixels().iter().map(|p| {
        let c = p.demultiply();
        eframe::egui::Color32::from_rgba_unmultiplied(c.red(), c.green(), c.blue(), c.alpha())
    }).collect();
    ColorImage { size: [pw as usize, ph as usize], pixels: px }
}

fn rock_path(contours: &[Vec<cruciata_core::nav::Pt>]) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    for c in contours {
        let n = c.len();
        if n < 3 {
            continue;
        }
        for i in 0..n {
            let (prev, p, next) = (c[(i + n - 1) % n], c[i], c[(i + 1) % n]);
            let incoming = ((p.x - prev.x).powi(2) + (p.y - prev.y).powi(2)).sqrt();
            let outgoing = ((next.x - p.x).powi(2) + (next.y - p.y).powi(2)).sqrt();
            let round = 12.0;
            let ka = (round / incoming.max(1e-9)).min(0.3);
            let kb = (round / outgoing.max(1e-9)).min(0.3);
            let a = (p.x + (prev.x - p.x) * ka, p.y + (prev.y - p.y) * ka);
            let b = (p.x + (next.x - p.x) * kb, p.y + (next.y - p.y) * kb);
            if i == 0 {
                pb.move_to(a.0 as f32, a.1 as f32);
            } else {
                pb.line_to(a.0 as f32, a.1 as f32);
            }
            pb.quad_to(p.x as f32, p.y as f32, b.0 as f32, b.1 as f32);
        }
        pb.close();
    }
    pb.finish()
}

/// Rock masses (blocking cliffs and boulder fields) painted onto a transparent overlay.
pub fn bake_rocks(state: &State, w: f64, h: f64) -> ColorImage {
    let scale = 0.5f64.min(2560.0 / w).min(1800.0 / h);
    let (pw, ph) = ((w * scale).ceil() as u32, (h * scale).ceil() as u32);
    let mut cv = Cv { pm: Pixmap::new(pw.max(1), ph.max(1)).unwrap(), s: scale as f32 };
    let sk = Transform::from_scale(scale as f32, scale as f32);
    for f in state.terrain_features.iter().filter(|f| f.kind == "rockmass" && f.forest != Some(true)) {
        let Some(path) = rock_path(&f.contours) else { continue };
        let rim = match f.biome as i32 {
            1 => ["#627465", "#93a48e", "#b7c4a9"],
            2 => ["#644321", "#c3a06b", "#f0d7a3"],
            3 => ["#718184", "#a8b9b8", "#d5dfd6"],
            _ => ["#6d7162", "#a2a38d", "#c1bea5"],
        };
        let round = |w: f32| Stroke { width: w, line_join: tiny_skia::LineJoin::Round, line_cap: tiny_skia::LineCap::Round, ..Default::default() };
        let shadow = sk.pre_translate(4.0, 6.0);
        cv.pm.fill_path(&path, &Cv::paint("#19201955"), FillRule::EvenOdd, shadow, None);
        cv.pm.stroke_path(&path, &Cv::paint("#19201940"), &round(34.0), shadow, None);
        cv.pm.fill_path(&path, &Cv::paint("#080b0a"), FillRule::EvenOdd, sk, None);
        cv.pm.stroke_path(&path, &Cv::paint(rim[0]), &round(28.0), sk, None);
        cv.pm.stroke_path(&path, &Cv::paint(rim[1]), &round(18.0), sk, None);
        cv.pm.stroke_path(&path, &Cv::paint(rim[2]), &round(1.0), sk, None);
    }
    let px: Vec<eframe::egui::Color32> = cv.pm.pixels().iter().map(|p| {
        let c = p.demultiply();
        eframe::egui::Color32::from_rgba_unmultiplied(c.red(), c.green(), c.blue(), c.alpha())
    }).collect();
    ColorImage { size: [pw as usize, ph as usize], pixels: px }
}
