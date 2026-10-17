//! The campaign atlas of the front menu (`campaign()` in `src/menus.js`): the Natural Earth
//! coast of the eastern Mediterranean with relief, the dashed march route, chapter markers,
//! lapping surf and the waving red standard that walks to the next chapter.

use crate::paint::col;
use crate::style::{sans, serif, spaced};
use eframe::egui::{self, Align2, Color32, Pos2, Rect, Shape, Stroke, TextureHandle, TextureOptions, Vec2};
use tiny_skia::{FillRule, GradientStop, LineCap, LineJoin, LinearGradient, Mask, Paint, PathBuilder, Pixmap, Point, SpreadMode, StrokeDash, Transform};

pub const STOPS: [[f32; 2]; 6] = [[258.0, 108.0], [300.0, 167.0], [275.0, 228.0], [255.0, 370.0], [220.0, 550.0], [202.0, 640.0]];
const LOCATIONS: [[f64; 2]; 6] = [[35.96, 36.08], [36.12, 36.2], [36.16, 36.2], [35.84, 34.44], [35.23, 31.84], [35.23, 31.78]];
const NAMES: [&str; 6] = ["I. Saint Symeon", "II. Orontes", "III. Antioch", "IV. Tripoli", "V. Approach", "VI. Jerusalem"];
const FALLBACK_COAST: [[f64; 2]; 16] = [[35.1, 37.0], [35.7, 36.7], [35.9, 36.35], [35.78, 36.05], [35.9, 35.55], [35.8, 35.1], [35.65, 34.7], [35.84, 34.44], [35.5, 34.0], [35.48, 33.9], [35.22, 33.3], [35.08, 32.8], [34.86, 32.3], [34.5, 31.6], [34.2, 31.2], [33.6, 31.1]];

type Line = Vec<(f64, f64)>;

pub struct Geo {
    coast: Vec<Line>,
    land: Vec<Line>,
}

fn project(lon: f64, lat: f64) -> (f32, f32) {
    ((70.0 + (lon - 34.0) * 120.0 * (34.0f64.to_radians()).cos()) as f32, (50.0 + (37.0 - lat) * 112.0) as f32)
}

fn project_land(lon: f64, lat: f64) -> (f32, f32) {
    let mut p = project(lon, lat);
    if lon >= 37.5 {
        p.0 = 441.0;
    }
    p
}

/// Parse the `coast: [[[lon, lat], ...], ...]` and `land: [...]` lists of `assets/maps/levant-coast.js`.
fn parse_section(text: &str, key: &str) -> Vec<Line> {
    let Some(start) = text.find(&format!("{key}:")) else { return vec![] };
    let rest = &text[start + key.len() + 1..];
    let mut out: Vec<Line> = Vec::new();
    let (mut depth, mut num, mut nums) = (0, String::new(), Vec::<f64>::new());
    let flush = |num: &mut String, nums: &mut Vec<f64>| {
        if !num.is_empty() {
            if let Ok(v) = num.parse::<f64>() {
                nums.push(v);
            }
            num.clear();
        }
    };
    for c in rest.chars() {
        match c {
            '[' => {
                depth += 1;
                if depth == 2 {
                    out.push(Vec::new());
                }
                if depth == 3 {
                    nums.clear();
                }
            }
            ']' => {
                flush(&mut num, &mut nums);
                if depth == 3 && nums.len() >= 2 {
                    if let Some(l) = out.last_mut() {
                        l.push((nums[0], nums[1]));
                    }
                }
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            '0'..='9' | '.' | '-' | 'e' | 'E' | '+' => num.push(c),
            _ => flush(&mut num, &mut nums),
        }
    }
    out
}

pub fn load_geo() -> Geo {
    let dir = crate::assets::assets_dir();
    let text = std::fs::read_to_string(dir.join("maps").join("levant-coast.js")).unwrap_or_default();
    Geo { coast: parse_section(&text, "coast"), land: parse_section(&text, "land") }
}

impl Geo {
    /// The longest coastline (`mappedCoast`).
    fn main_coast(&self) -> Line {
        let mut best: Option<&Line> = None;
        for l in &self.coast {
            if best.map(|b| l.len() > b.len()).unwrap_or(true) {
                best = Some(l);
            }
        }
        best.cloned().unwrap_or_else(|| FALLBACK_COAST.iter().map(|p| (p[0], p[1])).collect())
    }
}

fn paint_rgba(r: u8, g: u8, b: u8, a: u8) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(r, g, b, a);
    p.anti_alias = true;
    p
}

fn hex(s: &str) -> Paint<'static> {
    let h = s.trim_start_matches('#');
    let v = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).unwrap_or(0);
    paint_rgba(v(0), v(2), v(4), if h.len() >= 8 { v(6) } else { 255 })
}

fn stroke(width: f32) -> tiny_skia::Stroke {
    tiny_skia::Stroke { width, ..Default::default() }
}

fn gradient(x0: f32, x1: f32, a: [u8; 3], b: [u8; 3]) -> Paint<'static> {
    let mut p = Paint::default();
    p.anti_alias = true;
    let c = |c: [u8; 3]| tiny_skia::Color::from_rgba8(c[0], c[1], c[2], 255);
    if let Some(sh) = LinearGradient::new(Point::from_xy(x0, 0.0), Point::from_xy(x1.max(x0 + 1.0), 0.0), vec![GradientStop::new(0.0, c(a)), GradientStop::new(1.0, c(b))], SpreadMode::Pad, Transform::identity()) {
        p.shader = sh;
    }
    p
}

fn polyline(points: &[(f32, f32)], close: bool) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    for (i, p) in points.iter().enumerate() {
        if i == 0 {
            pb.move_to(p.0, p.1);
        } else {
            pb.line_to(p.0, p.1);
        }
    }
    if close {
        pb.close();
    }
    pb.finish()
}

fn to_image(p: &Pixmap) -> egui::ColorImage {
    let mut bytes = Vec::with_capacity(p.data().len());
    for px in p.pixels() {
        let c = px.demultiply();
        bytes.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    crate::paint::image_from_straight([p.width() as usize, p.height() as usize], &bytes)
}

/// Static layers at `s` pixels per atlas unit: the water, and everything on land.
fn bake(geo: &Geo, s: f32, completed: &[usize], unlocked: usize) -> Option<(Pixmap, Pixmap)> {
    let (w, h) = ((440.0 * s).round() as u32, (710.0 * s).round() as u32);
    let t = Transform::from_scale(s, s);
    let mut water = Pixmap::new(w, h)?;
    let mut rect = PathBuilder::new();
    rect.push_rect(tiny_skia::Rect::from_xywh(0.0, 0.0, 440.0, 710.0)?);
    water.fill_path(&rect.finish()?, &gradient(0.0, 440.0, [0x23, 0x4a, 0x55], [0x1c, 0x3e, 0x4c]), FillRule::Winding, t, None);

    let mut land = Pixmap::new(w, h)?;
    let coast = geo.main_coast();
    let polys: Vec<Vec<(f32, f32)>> = if geo.land.is_empty() {
        let mut pts: Vec<(f32, f32)> = coast.iter().map(|p| project(p.0, p.1)).collect();
        pts.extend([(440.0, 710.0), (440.0, 0.0), (0.0, 0.0)]);
        vec![pts]
    } else {
        geo.land.iter().map(|l| l.iter().map(|p| project_land(p.0, p.1)).collect()).collect()
    };
    let mut all = PathBuilder::new();
    for poly in &polys {
        let (min, max) = poly.iter().fold((f32::MAX, f32::MIN), |(a, b), p| (a.min(p.0), b.max(p.0)));
        if let Some(path) = polyline(poly, true) {
            land.fill_path(&path, &gradient(min, max, [0x8a, 0x91, 0x70], [0x9b, 0x92, 0x6c]), FillRule::Winding, t, None);
        }
        for (i, p) in poly.iter().enumerate() {
            if i == 0 {
                all.move_to(p.0, p.1);
            } else {
                all.line_to(p.0, p.1);
            }
        }
        all.close();
    }
    let coast_px: Vec<(f32, f32)> = coast.iter().map(|p| project(p.0, p.1)).collect();
    if let Some(path) = polyline(&coast_px, false) {
        land.stroke_path(&path, &hex("#d8bd7d"), &stroke(2.0), t, None);
    }
    // Relief, clipped to the land.
    if let (Some(mut mask), Some(land_path)) = (Mask::new(w, h), all.finish()) {
        mask.fill_path(&land_path, FillRule::Winding, true, t);
        let chain = |start: (f32, f32), c1: (f32, f32), e1: (f32, f32), rest: &[(f32, f32)]| {
            let mut pb = PathBuilder::new();
            pb.move_to(start.0, start.1);
            pb.quad_to(c1.0, c1.1, e1.0, e1.1);
            let (mut ctrl, mut cur) = (c1, e1);
            for &e in rest {
                ctrl = (2.0 * cur.0 - ctrl.0, 2.0 * cur.1 - ctrl.1);
                pb.quad_to(ctrl.0, ctrl.1, e.0, e.1);
                cur = e;
            }
            pb.finish()
        };
        for path in [chain((315.0, 35.0), (283.0, 140.0), (333.0, 255.0), &[(325.0, 475.0), (294.0, 685.0)]), chain((334.0, 45.0), (302.0, 152.0), (352.0, 264.0), &[(344.0, 480.0), (313.0, 694.0)]), chain((353.0, 58.0), (320.0, 165.0), (369.0, 278.0), &[(362.0, 496.0), (331.0, 710.0)])].into_iter().flatten() {
            land.stroke_path(&path, &hex("#4d4b3650"), &stroke(2.0), t, Some(&mask));
        }
        let peaks = |list: &[(f32, f32, f32, f32, f32, f32)]| {
            let mut pb = PathBuilder::new();
            for &(x, y, a, b, c, d) in list {
                pb.move_to(x, y);
                pb.line_to(x + a, y + b);
                pb.line_to(x + a + c, y + b + d);
            }
            pb.finish()
        };
        if let Some(p) = peaks(&[(303.0, 66.0, 12.0, -21.0, 11.0, 22.0), (317.0, 132.0, 13.0, -26.0, 12.0, 27.0), (318.0, 250.0, 14.0, -29.0, 14.0, 30.0), (300.0, 422.0, 14.0, -24.0, 14.0, 26.0), (285.0, 590.0, 11.0, -23.0, 13.0, 24.0)]) {
            land.fill_path(&p, &hex("#6a664355"), FillRule::Winding, t, Some(&mask));
            land.stroke_path(&p, &hex("#d3b87a55"), &stroke(2.0), t, Some(&mask));
        }
        if let Some(p) = peaks(&[(288.0, 60.0, 11.0, -18.0, 13.0, 21.0), (302.0, 125.0, 12.0, -22.0, 13.0, 25.0), (304.0, 242.0, 12.0, -24.0, 13.0, 28.0)]) {
            land.stroke_path(&p, &hex("#e0c58a66"), &stroke(1.0), t, Some(&mask));
        }
    }
    // The dashed route, other coastlines and chapter markers.
    let route: Vec<(f32, f32)> = STOPS.iter().map(|p| (p[0], p[1])).collect();
    if let Some(path) = polyline(&route, false) {
        let mut st = stroke(2.0);
        st.dash = StrokeDash::new(vec![5.0, 5.0], 0.0);
        land.stroke_path(&path, &hex("#e9d19e"), &st, t, None);
    }
    for line in &geo.coast {
        if line.len() == coast.len() && line.first() == coast.first() && line.last() == coast.last() {
            continue;
        }
        let pts: Vec<(f32, f32)> = line.iter().map(|p| project(p.0, p.1)).collect();
        if let Some(path) = polyline(&pts, false) {
            land.stroke_path(&path, &hex("#d8bd7d"), &stroke(1.5), t, None);
        }
    }
    let _ = LOCATIONS;
    for (i, st) in STOPS.iter().enumerate() {
        let (x, y) = (st[0], st[1]);
        let (lx, ly) = (x + 22.0, y + 4.0);
        let open = i <= unlocked;
        let r = if completed.contains(&i) { 7.0 } else { 5.0 };
        let mut pb = PathBuilder::new();
        pb.push_circle(x, y, r);
        if let Some(c) = pb.finish() {
            land.fill_path(&c, &hex(if open { "#f1cb78" } else { "#594d37" }), FillRule::Winding, t, None);
            land.stroke_path(&c, &hex(if open { "#503f28" } else { "#c7aa6c" }), &stroke(if open { 2.0 } else { 1.0 }), t, None);
        }
        if let Some(l) = polyline(&[(x + 8.0, y), (lx - 10.0, ly - 4.0), (lx - 3.0, ly - 4.0)], false) {
            land.stroke_path(&l, &hex("#dfc38d"), &stroke(0.8), t, None);
        }
    }
    let _ = (LineCap::Round, LineJoin::Round);
    Some((water, land))
}

fn smooth(k: f32) -> f32 {
    k * k * (3.0 - 2.0 * k)
}

fn lapping(time: f64, band: usize, along: f64, scale: f64) -> (f64, f64, f64) {
    let phase = (time * 9.0 + band as f64 * 38.0) % 190.0;
    ((-190.0 + phase + (along / 54.0 + time * 0.65 + band as f64).sin() * 4.0) * scale, (phase / 190.0 * std::f64::consts::PI).sin() * 0.28, (0.7 + phase / 150.0) * scale)
}

pub struct CampaignMap {
    geo: Option<Geo>,
    water: Option<TextureHandle>,
    land: Option<TextureHandle>,
    key: (u32, usize, usize),
    start: f64,
    from: usize,
    moving: bool,
}

impl CampaignMap {
    pub fn new() -> CampaignMap {
        CampaignMap { geo: None, water: None, land: None, key: (0, 0, 0), start: -1.0, from: 0, moving: false }
    }

    /// Restart the 4.5 second march (`transit` = the chapter the army walks from).
    pub fn enter(&mut self, transit: Option<usize>) {
        self.start = -1.0;
        self.moving = transit.is_some();
        self.from = transit.unwrap_or(0);
        self.key = (0, 0, 0);
    }

    /// Paint the atlas into `rect` (keeps the web's 440:710 aspect).
    pub fn paint(&mut self, ctx: &egui::Context, p: &egui::Painter, rect: Rect, completed: &[usize], unlocked: usize, next: usize) {
        let time = ctx.input(|i| i.time);
        if self.start < 0.0 {
            self.start = time;
        }
        let geo = self.geo.get_or_insert_with(load_geo);
        let k = rect.width() / 440.0;
        let px = ((k * ctx.pixels_per_point()).max(0.5) * 8.0).round() as u32;
        let key = (px, completed.len() + completed.iter().sum::<usize>() * 7, unlocked);
        if self.key != key || self.water.is_none() {
            if let Some((w, l)) = bake(geo, px as f32 / 8.0, completed, unlocked) {
                self.water = Some(ctx.load_texture("atlas-water", to_image(&w), TextureOptions::LINEAR));
                self.land = Some(ctx.load_texture("atlas-land", to_image(&l), TextureOptions::LINEAR));
            }
            self.key = key;
        }
        let to = |x: f32, y: f32| Pos2::new(rect.min.x + x * k, rect.min.y + y * k);
        let clip = p.with_clip_rect(rect);
        clip.rect_filled(rect, 0.0, col("#173642"));
        let uv = Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0));
        if let Some(t) = &self.water {
            clip.image(t.id(), rect, uv, Color32::WHITE);
        }
        // Lapping bands sit beneath the land layer, so they only show on the water.
        let coast = geo.main_coast();
        let shore: Vec<(f32, f32)> = coast.iter().map(|c| project(c.0, c.1)).collect();
        let drift = -12.0 + 24.0 * ((time % 7.0) / 7.0) as f32;
        for band in 0..5 {
            let (_, opacity, width) = lapping(time, band, 0.0, 0.11);
            let pts: Vec<Pos2> = shore.iter().map(|&(x, y)| to(x + lapping(time, band, y as f64 / 0.11, 0.11).0 as f32 + drift, y)).collect();
            clip.add(Shape::line(pts, Stroke::new((width.max(0.6) as f32 * k).max(0.5), crate::paint::rgba(0xdc, 0xf4, 0xe2, (opacity * 255.0) as u8))));
        }
        if let Some(t) = &self.land {
            clip.image(t.id(), rect, uv, Color32::WHITE);
        }
        // Surf along the shore pulses between 3 and 6 units wide.
        let tt = ((time % 5.0) / 5.0) as f32;
        let e = smooth(1.0 - (1.0 - 2.0 * tt).abs());
        let surf: Vec<Pos2> = shore.iter().map(|&(x, y)| to(x, y)).collect();
        clip.add(Shape::line(surf, Stroke::new((3.0 + 3.0 * e) * k, crate::paint::rgba(0xb0, 0xd5, 0xd5, ((0.1 + 0.2 * e) * 255.0) as u8))));

        // Labels.
        let outline = col("#58472d");
        for (i, name) in NAMES.iter().enumerate() {
            let (x, y) = (STOPS[i][0] + 22.0, STOPS[i][1] + 4.0);
            let font = serif(16.0 * k);
            for (dx, dy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0), (-0.7, -0.7), (0.7, 0.7), (-0.7, 0.7), (0.7, -0.7)] {
                clip.text(to(x + dx, y + dy + 3.4), Align2::LEFT_BOTTOM, *name, font.clone(), outline);
            }
            clip.text(to(x, y + 3.4), Align2::LEFT_BOTTOM, *name, font, col("#f7e6bc"));
        }
        spaced(&clip, to(280.0, 430.0 - 15.0), "LEVANT", serif(20.0 * k), col("#c1a372"), 6.0 * k);
        let galley = clip.layout_no_wrap("MARE MEDITERRANEUM".to_string(), serif(14.0 * k), col("#72919c"));
        let origin = to(16.0 - 11.0, 310.0);
        for (dx, dy) in [(-1.0f32, 0.0f32), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)] {
            clip.add(egui::epaint::TextShape::new(origin + Vec2::new(dx * k, dy * k), galley.clone(), outline).with_angle(-std::f32::consts::FRAC_PI_2).with_override_text_color(outline));
        }
        clip.add(egui::epaint::TextShape::new(origin, galley, col("#72919c")).with_angle(-std::f32::consts::FRAC_PI_2));

        // The army: walks from the last chapter to the next over 4.5 seconds.
        let dest = STOPS[next.min(5)];
        let from = if self.moving { STOPS[self.from.min(5)] } else { dest };
        let t = (((time - self.start) / 4.5).clamp(0.0, 1.0)) as f32;
        let ease = t * t * (3.0 - 2.0 * t);
        let pos = [from[0] + (dest[0] - from[0]) * ease, from[1] + (dest[1] - from[1]) * ease];
        let done = if completed.len() == 6 { 6 } else { next };
        let mut trail: Vec<Pos2> = STOPS[..done.min(6)].iter().map(|s| to(s[0], s[1])).collect();
        trail.push(to(pos[0], pos[1]));
        clip.add(Shape::line(trail.clone(), Stroke::new(3.0 * k, col("#b92f27"))));
        for q in &trail {
            clip.circle_filled(*q, 1.5 * k, col("#b92f27"));
        }
        let secs = time as f32;
        let at = |x: f32, y: f32| to(pos[0] + x, pos[1] + y);
        // Shadow, pole.
        let shadow: Vec<Pos2> = (0..24).map(|i| {
            let a = i as f32 / 24.0 * std::f32::consts::TAU;
            at(3.0 + a.cos() * 12.0, a.sin() * 4.0)
        }).collect();
        clip.add(Shape::convex_polygon(shadow, crate::paint::rgba(0x53, 0x41, 0x22, 0x77), Stroke::NONE));
        clip.add(Shape::line(vec![at(0.0, 0.0), at(0.0, -37.0)], Stroke::new(2.5 * k, col("#e3c881"))));
        // Cloth: a wavy quad swaying with the CSS skew/scale animation.
        let cyc = ((time % 3.2) / 3.2) as f32;
        let sway = smooth(1.0 - (1.0 - 2.0 * cyc).abs());
        let skew = (-5.0f32 + 10.0 * sway).to_radians().tan();
        let sx = 0.96 + 0.08 * sway;
        let warp = |x: f32, y: f32| {
            let dx = sx * (x - 2.0);
            (2.0 + dx, y + skew * dx)
        };
        let (mut top, mut bottom) = (Vec::new(), Vec::new());
        for i in 0..=12 {
            let u = i as f32 / 12.0;
            let wave = (secs * 2.6 - u * 6.0).sin() * 3.0 * u;
            top.push((1.0 + u * 27.0, -36.0 + wave));
            bottom.insert(0, (1.0 + u * 25.0, -14.0 + wave + u * 2.0));
        }
        let cloth: Vec<Pos2> = top.iter().chain(bottom.iter()).map(|&(x, y)| {
            let (x, y) = warp(x, y);
            at(x, y)
        }).collect();
        clip.add(Shape::Path(egui::epaint::PathShape { points: cloth, closed: true, fill: col("#942e23"), stroke: egui::epaint::PathStroke::new(1.0, col("#e2c176")) }));
        let ey = -25.0 + (secs * 2.6 - 3.0).sin() * 1.5;
        let seg = |a: (f32, f32), b: (f32, f32)| {
            let m = |p: (f32, f32)| {
                let (x, y) = warp(14.0 + p.0 * 0.11, ey + p.1 * 0.11);
                at(x, y)
            };
            Shape::line_segment([m(a), m(b)], Stroke::new(1.1 * k, col("#ffe1a0")))
        };
        for (a, b) in [((-50.0, 0.0), (50.0, 0.0)), ((0.0, -50.0), (0.0, 50.0)), ((-50.0, -10.0), (-50.0, 10.0)), ((50.0, -10.0), (50.0, 10.0)), ((-10.0, -50.0), (10.0, -50.0)), ((-10.0, 50.0), (10.0, 50.0)), ((-32.0, -23.0), (-32.0, -41.0)), ((-41.0, -32.0), (-23.0, -32.0)), ((32.0, -23.0), (32.0, -41.0)), ((23.0, -32.0), (41.0, -32.0)), ((-32.0, 23.0), (-32.0, 41.0)), ((-41.0, 32.0), (-23.0, 32.0)), ((32.0, 23.0), (32.0, 41.0)), ((23.0, 32.0), (41.0, 32.0))] {
            clip.add(seg(a, b));
        }
        p.rect_stroke(rect, 0.0, Stroke::new(1.0, col("#90774a")));
        let _ = sans;
    }
}
