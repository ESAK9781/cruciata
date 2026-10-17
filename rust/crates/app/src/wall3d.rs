//! Runtime curtain-wall art: the projected prism model from
//! `src/isometric-art.js` (`curtainLayout` / `wallModel`) drawn with
//! egui polygons. Layouts are cached per curtain shape and translated per use.

use cruciata_core::js::hypot;
use cruciata_core::model::Building;
use eframe::egui::Color32;
use std::collections::HashMap;

pub const STONE: &str = "#bcaf8c";
pub const BASTION: &str = "#697566";

fn parse(hex: &str) -> [f64; 3] {
    let n = u32::from_str_radix(&hex[1..], 16).unwrap_or(0);
    [((n >> 16) & 255) as f64, ((n >> 8) & 255) as f64, (n & 255) as f64]
}

pub fn shade(hex: &str, light: f64) -> Color32 {
    let c = parse(hex);
    let f = |v: f64| (v * light).round().clamp(0.0, 255.0) as u8;
    Color32::from_rgb(f(c[0]), f(c[1]), f(c[2]))
}

#[derive(Clone)]
pub struct Face {
    pub pts: Vec<[f32; 2]>,
    pub color: Color32,
    /// Stroke width in world units; `None` for filled polygons.
    pub width: Option<f32>,
    pub depth: f32,
}

#[derive(Default, Clone)]
pub struct Model {
    pub faces: Vec<Face>,
}

type P3 = [f64; 3];

fn project(p: P3) -> [f32; 2] {
    [p[0] as f32, (p[1] * 0.72 - p[2]) as f32]
}

impl Model {
    /// `face(points, color, outline, light, cull)` with camera angle 0 and rise 1.
    pub fn face(&mut self, v: &[P3], color: &str, light: Option<f64>, cull: bool) {
        let light = match light {
            Some(l) => l,
            None => {
                let a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
                let b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
                let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
                if cull && n[1] + 0.72 * n[2] <= 0.0 {
                    return;
                }
                let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
                let len = if len == 0.0 { 1.0 } else { len };
                0.78 + 0.25 * (n[2] / len).abs() - (0.13 * n[0]) / len - (0.1 * n[1]) / len
            }
        };
        let depth = v.iter().map(|p| p[1] + p[2] * 0.72).sum::<f64>() / v.len() as f64;
        self.faces.push(Face { pts: v.iter().map(|&p| project(p)).collect(), color: shade(color, light), width: None, depth: depth as f32 });
    }

    pub fn face_col(&mut self, v: &[P3], color: Color32, light: f64) {
        let depth = v.iter().map(|p| p[1] + p[2] * 0.72).sum::<f64>() / v.len() as f64;
        let [r, g, b, _] = color.to_array();
        let f = |c: u8| (c as f64 * light).round().clamp(0.0, 255.0) as u8;
        self.faces.push(Face { pts: v.iter().map(|&p| project(p)).collect(), color: Color32::from_rgb(f(r), f(g), f(b)), width: None, depth: depth as f32 });
    }

    pub fn stroke(&mut self, v: &[P3], width: f32, color: Color32) {
        let depth = v.iter().map(|p| p[1] + p[2] * 0.72).sum::<f64>() / v.len() as f64 + 0.05;
        self.faces.push(Face { pts: v.iter().map(|&p| project(p)).collect(), color, width: Some(width), depth: depth as f32 });
    }

    pub fn sort(&mut self) {
        self.faces.sort_by(|a, b| a.depth.partial_cmp(&b.depth).unwrap_or(std::cmp::Ordering::Equal));
    }
}

struct Piece {
    x: f64,
    y: f64,
    length: f64,
    ux: f64,
    uy: f64,
    back: f64,
}

struct Layout {
    fort: bool,
    hw: f64,
    height: f64,
    pieces: Vec<Piece>,
}

fn layout(b: &Building) -> Layout {
    let fort = b.fortified;
    let hw = if fort { 24.0 } else { 15.0 };
    let arms: Vec<(f64, f64)> = b
        .links
        .as_ref()
        .map(|l| {
            l.iter()
                .map(|(key, p)| {
                    if hypot(p.x, p.y) >= 1.0 {
                        (p.x, p.y)
                    } else {
                        let dx = (if key.contains('e') { 1.0 } else { 0.0 }) - (if key.contains('w') { 1.0 } else { 0.0 });
                        let dy = (if key.contains('s') { 1.0 } else { 0.0 }) - (if key.contains('n') { 1.0 } else { 0.0 });
                        let n = hypot(dx, dy);
                        let n = if n == 0.0 { 1.0 } else { n };
                        ((dx / n) * 16.0, (dy / n) * 16.0)
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let mut real: Vec<(f64, f64)> = arms.iter().copied().filter(|p| hypot(p.0, p.1) >= 1.0).collect();
    let angle = b.wall_angle.filter(|a| a.is_finite()).unwrap_or(0.0);
    if real.len() == 1 && arms.len() == 1 {
        real.push((-real[0].0, -real[0].1));
    }
    if real.is_empty() {
        real.push((angle.cos() * 16.0, angle.sin() * 16.0));
        real.push((-angle.cos() * 16.0, -angle.sin() * 16.0));
    }
    let mut pieces: Vec<Piece> = real
        .iter()
        .map(|a| {
            let length = hypot(a.0, a.1);
            Piece { x: a.0, y: a.1, length, ux: a.0 / length, uy: a.1 / length, back: 0.0 }
        })
        .collect();
    let dirs: Vec<(f64, f64)> = pieces.iter().map(|p| (p.ux, p.uy)).collect();
    for (i, p) in pieces.iter_mut().enumerate() {
        p.back = if dirs.iter().enumerate().any(|(j, o)| j != i && (p.ux * o.1 - p.uy * o.0).abs() > 0.2 && p.ux * o.0 + p.uy * o.1 > -0.97) { hw } else { 0.0 };
    }
    Layout { fort, hw, height: if fort { 38.0 } else { 27.0 }, pieces }
}

/// Cache key identifying a curtain's shape (matches the JS `curtain2:` key).
pub fn key(b: &Building) -> String {
    let l = layout(b);
    let mut parts: Vec<String> = l.pieces.iter().map(|p| format!("{:.1},{:.1}", p.x, p.y)).collect();
    parts.sort();
    format!("{}:{}", l.fort, parts.join(";"))
}

fn rect(p: &Piece, from: f64, to: f64, half: f64) -> Vec<[f64; 2]> {
    let (nx, ny) = (-p.uy, p.ux);
    let at = |t: f64, o: f64| [p.ux * t + nx * o, p.uy * t + ny * o];
    vec![at(from, -half), at(to, -half), at(to, half), at(from, half)]
}

fn lip_rect(p: &Piece, from: f64, to: f64, offset: f64, half: f64) -> Vec<[f64; 2]> {
    let (nx, ny) = (-p.uy, p.ux);
    vec![
        [p.ux * from + nx * (offset - half), p.uy * from + ny * (offset - half)],
        [p.ux * to + nx * (offset - half), p.uy * to + ny * (offset - half)],
        [p.ux * to + nx * (offset + half), p.uy * to + ny * (offset + half)],
        [p.ux * from + nx * (offset + half), p.uy * from + ny * (offset + half)],
    ]
}

fn prism(m: &mut Model, poly: &[[f64; 2]], z: f64, h: f64, color: Color32) {
    let area: f64 = poly.iter().enumerate().map(|(i, p)| {
        let q = poly[(i + 1) % poly.len()];
        p[0] * q[1] - q[0] * p[1]
    }).sum();
    let ring: Vec<[f64; 2]> = if area < 0.0 { poly.iter().rev().copied().collect() } else { poly.to_vec() };
    for i in 0..ring.len() {
        let j = (i + 1) % ring.len();
        let v = [[ring[i][0], ring[i][1], z], [ring[j][0], ring[j][1], z], [ring[j][0], ring[j][1], z + h], [ring[i][0], ring[i][1], z + h]];
        // Lighting uses the same normal formula as `Model::face`.
        let a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
        let b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        if n[1] + 0.72 * n[2] <= 0.0 {
            continue;
        }
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        let len = if len == 0.0 { 1.0 } else { len };
        let light = 0.78 + 0.25 * (n[2] / len).abs() - (0.13 * n[0]) / len - (0.1 * n[1]) / len;
        m.face_col(&v, color, light);
    }
    let top: Vec<P3> = ring.iter().map(|p| [p[0], p[1], z + h]).collect();
    if top.len() >= 3 {
        let a = [top[1][0] - top[0][0], top[1][1] - top[0][1], 0.0];
        let b = [top[2][0] - top[0][0], top[2][1] - top[0][1], 0.0];
        let nz = a[0] * b[1] - a[1] * b[0];
        if nz != 0.0 {
            let n = [0.0, 0.0, nz];
            let _ = n;
            let light = 0.78 + 0.25;
            m.face_col(&top, color, light);
        }
    }
}

/// Build the model for a curtain centred on the origin.
pub fn build(b: &Building) -> Model {
    let l = layout(b);
    let stone = if l.fort { BASTION } else { STONE };
    let sc = parse(stone);
    let stone_col = Color32::from_rgb(sc[0] as u8, sc[1] as u8, sc[2] as u8);
    let (hw, height) = (l.hw, l.height);
    let mut m = Model::default();
    let covered = |me: usize, x: f64, y: f64, margin: f64| -> bool {
        l.pieces.iter().enumerate().any(|(i, o)| {
            if i == me {
                return false;
            }
            let (nx, ny) = (-o.uy, o.ux);
            let t = x * o.ux + y * o.uy;
            let d = x * nx + y * ny;
            t > -o.back + margin && t < o.length - margin && d.abs() < hw - margin
        })
    };
    let runs = |me: usize, p: &Piece, offset: f64, step: f64| -> Vec<(f64, f64)> {
        let mut out = vec![];
        let mut start: Option<f64> = None;
        let mut t = -p.back;
        while t <= p.length + 0.01 {
            let (nx, ny) = (-p.uy * offset, p.ux * offset);
            let open = !covered(me, p.ux * t + nx, p.uy * t + ny, 1.0);
            if open && start.is_none() {
                start = Some(t);
            }
            if (!open || t + step > p.length + 0.01) && start.is_some() {
                out.push((start.unwrap(), if open { t } else { t - step }));
                start = None;
            }
            t += step;
        }
        out.into_iter().filter(|(a, c)| c - a > 2.0).collect()
    };
    let dark = |f: f64| {
        let f2 = |v: f64| (v * f).round().clamp(0.0, 255.0) as u8;
        Color32::from_rgb(f2(sc[0]), f2(sc[1]), f2(sc[2]))
    };
    for p in &l.pieces {
        prism(&mut m, &rect(p, -p.back, p.length, hw + 1.5), 0.0, 3.0, dark(0.8));
    }
    for p in &l.pieces {
        prism(&mut m, &rect(p, -p.back, p.length, hw), 2.0, height - 2.0, stone_col);
    }
    for p in &l.pieces {
        let poly: Vec<P3> = rect(p, -p.back, p.length, hw - 5.0).iter().map(|q| [q[0], q[1], height + 0.35]).collect();
        m.face_col(&poly, stone_col, 0.82);
    }
    for (i, p) in l.pieces.iter().enumerate() {
        for side in [-1.0, 1.0] {
            let offset = side * (hw - 2.0);
            for (a, c) in runs(i, p, offset, 1.5) {
                prism(&mut m, &lip_rect(p, a, c, offset, 1.5), height, 2.2, dark(1.05));
                let mut t = a + 3.0;
                while t < c - 4.0 {
                    prism(&mut m, &lip_rect(p, t, t + 6.5, offset, 2.6), height, 7.0, stone_col);
                    t += 11.0;
                }
            }
        }
    }
    for (i, p) in l.pieces.iter().enumerate() {
        for side in [-1.0, 1.0] {
            let outward = side * p.ux;
            if outward <= 0.05 {
                continue;
            }
            let offset = side * (hw + 0.2);
            for (a, c) in runs(i, p, side * hw, 3.0) {
                let (nx, ny) = (-p.uy * offset, p.ux * offset);
                let mut z = 8.0;
                let mut row = 0;
                while z < height {
                    m.stroke(&[[p.ux * a + nx, p.uy * a + ny, z], [p.ux * c + nx, p.uy * c + ny, z]], 0.6, dark(0.55));
                    let mut t = a + 4.0 + (row % 2) as f64 * 7.0;
                    while t < c - 1.0 {
                        m.stroke(&[[p.ux * t + nx, p.uy * t + ny, z - 7.0], [p.ux * t + nx, p.uy * t + ny, z]], 0.55, dark(0.62));
                        t += 14.0;
                    }
                    z += 8.0;
                    row += 1;
                }
            }
        }
    }
    m.sort();
    m
}

#[derive(Default)]
pub struct WallCache {
    map: HashMap<String, Model>,
}

impl WallCache {
    pub fn get(&mut self, b: &Building) -> &Model {
        let k = key(b);
        self.map.entry(k).or_insert_with(|| build(b))
    }
}
