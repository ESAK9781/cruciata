//! The baked ground: grass blotches, strokes, sea, shore, river and bridge
//! (`Art.terrain` plus the static parts of `terrainDetails`), drawn once with
//! tiny-skia and uploaded as one texture.

use crate::paint::Straight;
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
    let [r, g, b, a] = col(c).straight();
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
pub fn bake(state: &State, w: f64, h: f64, level: i32, coast: bool, details: bool) -> (ColorImage, ColorImage) {
    let scale = 0.5f64.min(2560.0 / w).min(1800.0 / h);
    let (pw, ph) = ((w * scale).ceil() as u32, (h * scale).ceil() as u32);
    let mut cv = Cv { pm: Pixmap::new(pw.max(1), ph.max(1)).unwrap(), s: scale as f32 };
    let mut cw = Cv { pm: Pixmap::new(pw.max(1), ph.max(1)).unwrap(), s: scale as f32 };
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
        cw.polygon_gradient(&pts, 0.0, 420.0, &[(0.0, "#174a5d"), (0.75, "#247584"), (1.0, "#47958d")]);
        let mut shore = vec![];
        let mut y = 0.0;
        while y <= h {
            shore.push((coast_x(y), y));
            y += 10.0;
        }
        cw.line(&shore, 22.0, "#d4c592");
        cw.line(&shore.iter().map(|&(x, y)| (x - 15.0, y)).collect::<Vec<_>>(), 3.0, "#bdd2b7");
        if details {
            // The live `terrainDetails` strand: a wider sand band over the baked shore, a
            // shallow-water edge on the sea side and a dry-sand edge on the land side.
            cw.line(&shore, 24.0, "#d5c28c");
            cw.line(&shore.iter().map(|&(x, y)| (x - 11.0, y)).collect::<Vec<_>>(), 3.0, "#82bbb0");
            cw.line(&shore.iter().map(|&(x, y)| (x + 8.0, y)).collect::<Vec<_>>(), 2.0, "#b9a77c");
        }
        for _ in 0..600 {
            let y = rand.next() * h;
            let x = rand.next() * coast_x(y);
            let len = 8.0 + rand.next() * 15.0;
            cw.line(&[(x, y), (x + len, y)], 1.0, "#81c1c266");
        }
    }
    if level == 1 {
        let mut pts = vec![];
        let mut y = 0.0;
        while y < h {
            pts.push((river_x(state, w, y), y));
            y += 10.0;
        }
        cw.line(&pts, 110.0, "#6c9690");
        cw.line(&pts, 78.0, "#7aa39a");
        cw.line(&pts.iter().map(|&(x, y)| (x + 38.0, y)).collect::<Vec<_>>(), 2.0, "#b2c7a5");
        let by = bridge_y(state, h);
        let bx = river_x(state, w, by);
        cw.rect(bx - 85.0, by - 47.0, 170.0, 94.0, "#a3946c");
        let mut x = bx - 82.0;
        while x < bx + 82.0 {
            cw.line(&[(x, by - 42.0), (x, by + 42.0)], 2.0, "#cfbb8e");
            x += 12.0;
        }
        cw.line(&[(bx - 87.0, by - 50.0), (bx + 87.0, by - 50.0)], 6.0, "#a99a77");
        cw.line(&[(bx - 87.0, by + 50.0), (bx + 87.0, by + 50.0)], 6.0, "#a99a77");
    }
    let to_image = |pm: &Pixmap| -> ColorImage {
        let px: Vec<eframe::egui::Color32> = pm
            .pixels()
            .iter()
            .map(|p| {
                let c = p.demultiply();
                crate::paint::rgba(c.red(), c.green(), c.blue(), c.alpha())
            })
            .collect();
        ColorImage { size: [pw as usize, ph as usize], pixels: px }
    };
    let _ = (sin(0.0), cos(0.0));
    (to_image(&cv.pm), to_image(&cw.pm))
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

/// World-space bounding boxes (with the rim's reach) of every rock mass: (min x, min y, max x, max y).
pub fn rock_boxes(state: &State) -> Vec<(usize, [f64; 4])> {
    let mut out = Vec::new();
    for (i, f) in state.terrain_features.iter().enumerate() {
        if f.kind != "rockmass" || f.forest == Some(true) {
            continue;
        }
        let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        for c in &f.contours {
            for p in c {
                b = [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)];
            }
        }
        if b[0].is_finite() {
            out.push((i, [b[0] - 44.0, b[1] - 44.0, b[2] + 48.0, b[3] + 50.0]));
        }
    }
    out
}

struct RockDetail {
    walls: [Option<tiny_skia::Path>; 3],
    fractures: Option<tiny_skia::Path>,
    chips: [Option<tiny_skia::Path>; 2],
    highlights: Option<tiny_skia::Path>,
}

/// Port of the lazily built `detail` paths of `Art.rockMass`: three stratified
/// wall bands along every edge, fracture lines, chipped stones and their highlights.
fn rock_detail(contours: &[Vec<cruciata_core::nav::Pt>]) -> RockDetail {
    let mut walls = [PathBuilder::new(), PathBuilder::new(), PathBuilder::new()];
    let mut fractures = PathBuilder::new();
    let mut chips = [PathBuilder::new(), PathBuilder::new()];
    let mut highlights = PathBuilder::new();
    for contour in contours {
        let n = contour.len();
        for i in 0..n {
            let (a, b) = (contour[i], contour[(i + 1) % n]);
            let length = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
            if length < 1e-6 {
                continue;
            }
            let (dx, dy) = ((b.x - a.x) / length, (b.y - a.y) / length);
            let (nx, ny) = (-dy, dx);
            for (band, path) in walls.iter_mut().enumerate() {
                let near = band as f64 * 10.0 + 3.0;
                let far = near + 11.0;
                path.move_to((a.x + nx * near) as f32, (a.y + ny * near) as f32);
                path.line_to((b.x + nx * near) as f32, (b.y + ny * near) as f32);
                path.line_to((b.x + nx * far) as f32, (b.y + ny * far) as f32);
                path.line_to((a.x + nx * far) as f32, (a.y + ny * far) as f32);
                path.close();
            }
            let mut t = 12.0;
            while t < length {
                let (x, y) = (a.x + dx * t, a.y + dy * t);
                fractures.move_to((x - dy * 6.0) as f32, (y + dx * 6.0) as f32);
                fractures.line_to((x - dy * 17.0 + dx * 2.0) as f32, (y + dx * 17.0 + dy * 2.0) as f32);
                fractures.line_to((x - dy * 32.0) as f32, (y + dx * 32.0) as f32);
                t += 27.0;
            }
            let mut t = 7.0;
            while t < length - 3.0 {
                let jitter = (a.x * 0.31 + a.y * 0.17 + t).sin() * 5.0;
                let (x, y) = (a.x + dx * t - dy * jitter, a.y + dy * t + dx * jitter);
                let radius = 5.0 + ((x * 0.9 + y * 0.7).sin() + 1.0) * 2.5;
                let pts: Vec<(f32, f32)> = (0..6)
                    .map(|k| {
                        let angle = k as f64 * std::f64::consts::PI / 3.0 + 0.3;
                        let rr = radius * (0.75 + 0.2 * (x + y + k as f64 * 9.0).sin());
                        ((x + angle.cos() * rr) as f32, (y + angle.sin() * rr) as f32)
                    })
                    .collect();
                let chip = &mut chips[if (x + y).sin() > 0.0 { 0 } else { 1 }];
                chip.move_to(pts[0].0, pts[0].1);
                for p in &pts[1..] {
                    chip.line_to(p.0, p.1);
                }
                chip.close();
                highlights.move_to(pts[3].0, pts[3].1);
                highlights.line_to(pts[4].0, pts[4].1);
                highlights.line_to(pts[5].0, pts[5].1);
                t += 15.0;
            }
        }
    }
    let [w0, w1, w2] = walls;
    let [c0, c1] = chips;
    RockDetail { walls: [w0.finish(), w1.finish(), w2.finish()], fractures: fractures.finish(), chips: [c0.finish(), c1.finish()], highlights: highlights.finish() }
}

/// One square tile of the rock layer at `ppu` pixels per world unit, or `None`
/// when no mass reaches it. Rocks are redrawn at the camera's own resolution so
/// they stay crisp at any zoom, like the web's live vector drawing.
pub fn bake_rock_tile(state: &State, boxes: &[(usize, [f64; 4])], x0: f64, y0: f64, size: f64, ppu: f64) -> Option<ColorImage> {
    let hits: Vec<usize> = boxes.iter().filter(|(_, b)| b[2] >= x0 && b[0] <= x0 + size && b[3] >= y0 && b[1] <= y0 + size).map(|(i, _)| *i).collect();
    if hits.is_empty() {
        return None;
    }
    let px = (size * ppu).ceil() as u32;
    let mut cv = Cv { pm: Pixmap::new(px, px)?, s: ppu as f32 };
    let sk = Transform::from_scale(ppu as f32, ppu as f32).pre_translate(-(x0 as f32), -(y0 as f32));
    for i in hits {
        let f = &state.terrain_features[i];
        let Some(path) = rock_path(&f.contours) else { continue };
        let rim = match f.biome as i32 {
            1 => ["#627465", "#93a48e", "#b7c4a9"],
            2 => ["#644321", "#c3a06b", "#f0d7a3"],
            3 => ["#718184", "#a8b9b8", "#d5dfd6"],
            _ => ["#6d7162", "#a2a38d", "#c1bea5"],
        };
        let round = |w: f32| Stroke { width: w, line_join: tiny_skia::LineJoin::Round, line_cap: tiny_skia::LineCap::Round, ..Default::default() };
        let thin = |w: f32| Stroke { width: w, ..Default::default() };
        let shadow = sk.pre_translate(4.0, 6.0);
        cv.pm.fill_path(&path, &Cv::paint("#19201955"), FillRule::EvenOdd, shadow, None);
        cv.pm.stroke_path(&path, &Cv::paint("#19201940"), &round(34.0), shadow, None);
        cv.pm.fill_path(&path, &Cv::paint("#080b0a"), FillRule::EvenOdd, sk, None);
        cv.pm.stroke_path(&path, &Cv::paint(rim[0]), &round(28.0), sk, None);
        cv.pm.stroke_path(&path, &Cv::paint(rim[1]), &round(18.0), sk, None);
        cv.pm.stroke_path(&path, &Cv::paint(rim[2]), &round(1.0), sk, None);
        let detail = rock_detail(&f.contours);
        let faces = if f.biome as i32 == 2 { ["#a47a43", "#664422", "#302016"] } else { [rim[0], "#44483d", "#202820"] };
        if let Some(mut mask) = tiny_skia::Mask::new(px, px) {
            mask.fill_path(&path, FillRule::EvenOdd, true, sk);
            for (k, wall) in detail.walls.iter().enumerate() {
                if let Some(p) = wall {
                    cv.pm.fill_path(p, &Cv::paint(faces[k]), FillRule::Winding, sk, Some(&mask));
                }
            }
            if let Some(p) = &detail.fractures {
                cv.pm.stroke_path(p, &Cv::paint(if f.biome as i32 == 2 { "#1e120cc0" } else { "#111b14aa" }), &thin(1.2), sk, Some(&mask));
            }
        }
        for k in 0..2 {
            if let Some(p) = &detail.chips[k] {
                cv.pm.fill_path(p, &Cv::paint(rim[k]), FillRule::Winding, sk, None);
                cv.pm.stroke_path(p, &Cv::paint("#383e3480"), &thin(1.0), sk, None);
            }
        }
        if let Some(p) = &detail.highlights {
            cv.pm.stroke_path(p, &Cv::paint(rim[2]), &thin(0.8), sk, None);
        }
    }
    let pixels: Vec<eframe::egui::Color32> = cv
        .pm
        .pixels()
        .iter()
        .map(|p| {
            let c = p.demultiply();
            crate::paint::rgba(c.red(), c.green(), c.blue(), c.alpha())
        })
        .collect();
    Some(ColorImage { size: [px as usize, px as usize], pixels })
}

/// The 512-unit grass/ground tile the web version repeats over the land (`groundTexture`).
pub fn ground_tile(level: i32) -> ColorImage {
    let mut cv = Cv { pm: Pixmap::new(512, 512).unwrap(), s: 1.0 };
    let mut seed: u32 = 9381u32.wrapping_add((level as u32).wrapping_mul(71));
    let mut rand = || {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        seed as f64 / 4294967296.0
    };
    for i in 0..38 {
        let (x, y, r) = (rand() * 512.0, rand() * 512.0, 15.0 + rand() * 48.0);
        let shade = match level {
            3 => "#354f5b15",
            2 => "#66432113",
            _ => {
                if i % 3 != 0 {
                    "#345c2e19"
                } else {
                    "#b6945930"
                }
            }
        };
        let [rr, gg, bb, aa] = col(shade).straight();
        fade(&mut cv, x, y, r, [rr, gg, bb], aa as f64 / 255.0);
        for _ in 0..18 {
            let a = rand() * std::f64::consts::TAU;
            let d = rand() * r;
            let (e1, e2) = (rand() * 2.0 + 0.4, rand() + 0.4);
            cv.ellipse(x + a.cos() * d, y + a.sin() * d, e1, e2, if level == 3 { "#eeeede35" } else { "#d7bf8d29" });
        }
    }
    for i in 0..6500 {
        let (x, y) = (rand() * 512.0, rand() * 512.0);
        if level == 2 {
            let (e1, e2) = (0.5 + rand() * 1.6, 0.4 + rand());
            cv.ellipse(x, y, e1, e2, if i % 3 != 0 { "#59432424" } else { "#fff1b329" });
            if i % 20 == 0 {
                cv.line(&[(x, y), (x + 5.0, y + 1.0), (x + 9.0, y - 1.0)], 0.6, "#715b3523");
            }
        } else if level == 3 {
            let (e1, e2) = (1.0 + rand() * 3.0, 0.5 + rand() * 1.5);
            cv.ellipse(x, y, e1, e2, if i % 3 != 0 { "#405b6b18" } else { "#f5f5e333" });
        } else {
            let (dx, dy) = (rand() * 3.0 - 1.5, 2.0 + rand() * 4.0);
            cv.line(&[(x, y), (x + dx, y - dy)], 0.7, if i % 3 != 0 { "#233c232e" } else { "#c8d78c39" });
            if i % 24 == 0 {
                cv.ellipse(x, y, 1.3, 0.8, "#e5cdad44");
            }
        }
    }
    let px: Vec<eframe::egui::Color32> = cv.pm.pixels().iter().map(|p| {
        let c = p.demultiply();
        crate::paint::rgba(c.red(), c.green(), c.blue(), c.alpha())
    }).collect();
    ColorImage { size: [512, 512], pixels: px }
}

/// Radial gradient from `a0` at the centre to nothing at `r`, built from
/// concentric ellipses whose alphas composite to the linear profile.
fn fade(cv: &mut Cv, x: f64, y: f64, r: f64, rgb: [u8; 3], a0: f64) {
    profile(cv, x, y, r, r, rgb, |f| a0 * (1.0 - f));
}

pub fn profile(cv: &mut Cv, x: f64, y: f64, rx: f64, ry: f64, rgb: [u8; 3], target: impl Fn(f64) -> f64) {
    const N: usize = 16;
    let mut prev = 0.0f64;
    for k in 0..N {
        let f = 1.0 - k as f64 / N as f64;
        let want = target(f - 0.5 / N as f64).clamp(0.0, 0.99);
        let a = (1.0 - (1.0 - want) / (1.0 - prev)).clamp(0.0, 1.0);
        prev = want.max(prev);
        let al = (a * 255.0).round() as u8;
        if al == 0 {
            continue;
        }
        cv.ellipse(x, y, rx * f, ry * f, &format!("#{:02x}{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2], al));
    }
}
