//! Runtime gatehouse art for headings the atlas has not baked
//! (`buildingModel`'s gate branch with its `tower` helper).

use crate::wall3d::{shade, Face, Model};
use cruciata_core::model::Building;
use eframe::egui::Color32;
use std::collections::HashMap;

const STONE: &str = "#bcaf8c";
const BASTION: &str = "#697566";
const WOOD: &str = "#977448";
const METAL: &str = "#87918c";
const PLASTER: &str = "#d9c59d";
const GOLD: &str = "#d9af54";

type P3 = [f64; 3];

struct M {
    m: Model,
    ca: f64,
    sa: f64,
    rise: f64,
}

impl M {
    fn world(&self, p: P3) -> P3 {
        [p[0] * self.ca - p[1] * self.sa, p[0] * self.sa + p[1] * self.ca, p[2] * self.rise]
    }

    fn face(&mut self, pts: &[P3], color: &str, light: Option<f64>, cull: bool) {
        let v: Vec<P3> = pts.iter().map(|&p| self.world(p)).collect();
        self.m.face(&v, color, light, cull);
    }

    fn stroke(&mut self, pts: &[P3], width: f32, color: Color32) {
        let v: Vec<P3> = pts.iter().map(|&p| self.world(p)).collect();
        self.m.stroke(&v, width, color);
    }

    fn box_(&mut self, x: f64, y: f64, z: f64, w: f64, d: f64, h: f64, color: &str) {
        let v = [[x - w / 2.0, y - d / 2.0, z], [x + w / 2.0, y - d / 2.0, z], [x + w / 2.0, y + d / 2.0, z], [x - w / 2.0, y + d / 2.0, z]];
        let top: Vec<P3> = v.iter().map(|p| [p[0], p[1], z + h]).collect();
        for i in 0..4 {
            let j = (i + 1) % 4;
            self.face(&[v[i], v[j], top[j], top[i]], color, None, true);
        }
        self.face(&top, color, None, true);
    }

    fn masonry(&mut self, x: f64, y: f64, z: f64, w: f64, d: f64, h: f64, color: &str) {
        self.box_(x, y, z, w, d, h, color);
        let mut k = 7.0;
        while k < h {
            for side in [-1.0, 1.0] {
                self.stroke(&[[x + side * (w / 2.0 + 0.15), y - d / 2.0, z + k], [x + side * (w / 2.0 + 0.15), y + d / 2.0, z + k]], 0.55, shade(color, 0.7));
            }
            self.stroke(&[[x - w / 2.0, y + d / 2.0 + 0.15, z + k], [x + w / 2.0, y + d / 2.0 + 0.15, z + k]], 0.65, shade(color, 0.65));
            let mut a = -w / 2.0 + (((k / 8.0) as i64) % 2) as f64 * 7.0 + 4.0;
            while a < w / 2.0 {
                self.stroke(&[[x + a, y + d / 2.0 + 0.2, z + k - 6.0], [x + a, y + d / 2.0 + 0.2, z + k]], 0.6, shade(color, 0.69));
                a += 14.0;
            }
            k += 8.0;
        }
    }

    fn battlements(&mut self, x: f64, y: f64, z: f64, w: f64, d: f64, color: &str) {
        self.box_(x, y, z, w, d, 3.0, color);
        let mut a = -w / 2.0 + 4.0;
        while a < w / 2.0 {
            for s in [-1.0, 1.0] {
                self.box_(x + a, y + s * (d / 2.0 - 3.0), z + 3.0, 7.0, 6.0, 7.0, color);
            }
            a += 12.0;
        }
        let mut a = -d / 2.0 + 10.0;
        while a < d / 2.0 - 5.0 {
            for s in [-1.0, 1.0] {
                self.box_(x + s * (w / 2.0 - 3.0), y + a, z + 3.0, 6.0, 7.0, 7.0, color);
            }
            a += 12.0;
        }
    }

    fn window(&mut self, x: f64, y: f64, z: f64, w: f64, h: f64, arched: bool) {
        let mut v = vec![[x - w / 2.0, y, z], [x + w / 2.0, y, z], [x + w / 2.0, y, z + h * 0.7]];
        if arched {
            v.push([x, y, z + h]);
        } else {
            v.push([x + w / 2.0, y, z + h]);
            v.push([x - w / 2.0, y, z + h]);
        }
        v.push([x - w / 2.0, y, z + h * 0.7]);
        self.face(&v, "#383e34", Some(1.0), false);
        self.stroke(&[[x - w / 2.0, y, z], [x + w / 2.0, y, z]], 1.3, shade(GOLD, 1.0));
    }

    fn beam(&mut self, a: P3, b: P3, width: f64, color: &str) {
        let axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let length = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
        let length = if length == 0.0 { 1.0 } else { length };
        let u = if (axis[2] / length).abs() > 0.9 {
            [width / 2.0, 0.0, 0.0]
        } else {
            let h = (axis[0] * axis[0] + axis[1] * axis[1]).sqrt();
            [(-axis[1] / h) * width / 2.0, (axis[0] / h) * width / 2.0, 0.0]
        };
        let v = [(-axis[2] * u[1]) / length, (axis[2] * u[0]) / length, (axis[0] * u[1] - axis[1] * u[0]) / length];
        let ends: Vec<Vec<P3>> = [a, b].iter().map(|p| [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].iter().map(|(s, t)| [p[0] + u[0] * s + v[0] * t, p[1] + u[1] * s + v[1] * t, p[2] + u[2] * s + v[2] * t]).collect()).collect();
        for i in 0..4 {
            let j = (i + 1) % 4;
            self.face(&[ends[0][i], ends[0][j], ends[1][j], ends[1][i]], color, None, false);
        }
        self.face(&ends[1], color, None, false);
    }

    fn cylinder(&mut self, x: f64, y: f64, z: f64, r: f64, h: f64, color: &str) {
        let n = 40;
        let ring = |at: f64| -> Vec<P3> { (0..n).map(|i| [x + (i as f64 * std::f64::consts::TAU / n as f64).cos() * r, y + (i as f64 * std::f64::consts::TAU / n as f64).sin() * r, at]).collect() };
        let (a, b) = (ring(z), ring(z + h));
        for i in 0..n {
            let j = (i + 1) % n;
            self.face(&[a[i], a[j], b[j], b[i]], color, None, false);
        }
        self.face(&b, color, None, false);
    }

    fn dome(&mut self, x: f64, y: f64, z: f64, r: f64, h: f64, color: &str) {
        let seg = 48;
        let rings: Vec<Vec<P3>> = (0..=16)
            .map(|j| {
                let a = j as f64 * std::f64::consts::PI / 32.0;
                (0..seg).map(|i| [x + (i as f64 * std::f64::consts::TAU / seg as f64).cos() * r * a.cos(), y + (i as f64 * std::f64::consts::TAU / seg as f64).sin() * r * a.cos(), z + a.sin() * h]).collect()
            })
            .collect();
        for j in 0..16 {
            for i in 0..seg {
                let k = (i + 1) % seg;
                self.face(&[rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]], color, None, false);
            }
        }
    }

    fn tower(&mut self, x: f64, y: f64, w: f64, d: f64, height: f64, stone: &str, islamic: bool) {
        self.masonry(x, y, 0.0, w, d, height, stone);
        self.window(x, y + d / 2.0 + 0.5, height * 0.43, 5.0, 14.0, islamic);
        self.battlements(x, y, height, w + 3.0, d + 3.0, stone);
        if islamic {
            self.cylinder(x, y, height + 4.0, w * 0.35, 5.0, PLASTER);
            self.dome(x, y, height + 9.0, w * 0.38, 9.0, "#6c9580");
        }
    }
}

fn key(b: &Building) -> String {
    format!("{}:{}:{}:{}:{}", b.gate_angle.unwrap_or(0.0), b.rotation.unwrap_or(0.0), b.closed != Some(false), b.bastion_gate == Some(true) || b.fortified || b.kind == cruciata_core::model::BKind::Bastiongate || b.gate_segments.as_ref().map(|s| s.iter().any(|p| p.fortified == Some(true))).unwrap_or(false), b.team)
}

/// Build the model of a gatehouse centred on the origin.
pub fn build(b: &Building) -> Model {
    let angle = b.gate_angle.unwrap_or(if b.rotation == Some(90.0) { std::f64::consts::FRAC_PI_2 } else { 0.0 });
    let rise = if b.progress < 1.0 { 0.2 + 0.8 * b.progress } else { 1.0 };
    let strong = b.kind == cruciata_core::model::BKind::Bastiongate || b.bastion_gate == Some(true) || b.gate_segments.as_ref().map(|s| s.iter().any(|p| p.fortified == Some(true))).unwrap_or(false);
    let islamic = match b.architecture.as_deref() {
        Some(a) => a == "islamic",
        None => crate::keys::is_muslim(b.team),
    };
    let stone = if b.fortified || strong { BASTION } else { STONE };
    let h = if strong { 62.0 } else { 43.0 };
    let mut q = M { m: Model::default(), ca: angle.cos(), sa: angle.sin(), rise };
    for s in [-1.0, 1.0] {
        q.tower(s * if strong { 35.0 } else { 27.0 }, 0.0, if strong { 30.0 } else { 22.0 }, (if strong { 54.0 } else { 38.0 }) / 0.72, h, stone, islamic);
    }
    q.masonry(0.0, 0.0, h - 14.0, if strong { 48.0 } else { 42.0 }, 24.0, 13.0, stone);
    q.battlements(0.0, 0.0, h, if strong { 48.0 } else { 42.0 }, 24.0, stone);
    if b.closed != Some(false) {
        q.box_(0.0, 5.0, 2.0, 26.0, 5.0, h - 18.0, WOOD);
        let mut x = -11.0;
        while x < 13.0 {
            q.beam([x, 8.0, 2.0], [x, 8.0, h - 16.0], 1.3, METAL);
            x += 5.0;
        }
        let mut z = 8.0;
        while z < h - 17.0 {
            q.beam([-13.0, 8.0, z], [13.0, 8.0, z], 1.8, METAL);
            z += 10.0;
        }
    } else {
        q.box_(0.0, 5.0, h - 23.0, 26.0, 5.0, 6.0, WOOD);
    }
    q.m.sort();
    q.m
}

#[derive(Default)]
pub struct GateCache {
    map: HashMap<String, Model>,
}

impl GateCache {
    pub fn get(&mut self, b: &Building) -> &Model {
        self.map.entry(key(b)).or_insert_with(|| build(b))
    }
}

pub fn _unused(_: &Face) {}
