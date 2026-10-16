//! Construction sites, a port of `constructionSite` / `siteScaffold` / `sitePiles`
//! from `src/isometric-art.js`: dirt and stakes, a footing, the finished sprite
//! rising from the ground, a mortar course, a timber scaffold with deck and
//! ladder, shrinking timber and stone piles, a hoist and drifting dust.

use crate::wall3d::{shade, Face, Model};
use eframe::egui::Color32;

type P3 = [f64; 3];

const SITE_WOOD: &str = "#8d6a3e";
const RISE: f64 = 0.72;

/// Footprint half sizes and art height of a site (`o` in the JS).
#[derive(Clone, Copy)]
pub struct Opts {
    pub half_w: f64,
    pub half_d: f64,
    pub h: f64,
    pub round: bool,
    pub light: bool,
}

pub fn site_rise(p: f64) -> f64 {
    ((p - 0.05) / 0.88).clamp(0.0, 1.0)
}

/// Cut line (local y) below which the finished sprite shows, and the scaffold height `zc`.
pub fn cut_and_zc(o: &Opts, p: f64) -> (f64, f64) {
    let rise = site_rise(p);
    let front = o.half_d + 6.0;
    let top = -(o.half_d + o.h);
    let cut_y = front - (front - top) * rise;
    let zc = (o.h * 0.8 * ((o.half_d - cut_y) / (front - top)).clamp(0.0, 1.0)) / RISE;
    (cut_y, zc)
}

// ---- tiny projected-model builder (camera angle 0, rise 0.72) ----------------

struct Cam {
    m: Model,
}

impl Cam {
    fn new() -> Cam {
        Cam { m: Model::default() }
    }

    fn face(&mut self, v: &[P3], color: &str, cull: bool) {
        let w: Vec<P3> = v.iter().map(|p| [p[0], p[1], p[2] * RISE]).collect();
        let a = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]];
        let b = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]];
        let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        if cull && n[1] + 0.72 * n[2] <= 0.0 {
            return;
        }
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        let len = if len == 0.0 { 1.0 } else { len };
        let light = 0.78 + 0.25 * (n[2] / len).abs() - (0.13 * n[0]) / len - (0.1 * n[1]) / len;
        let depth = w.iter().map(|p| p[1] + p[2] * 0.72).sum::<f64>() / w.len() as f64;
        let pts = w.iter().map(|p| [p[0] as f32, (p[1] * 0.72 - p[2]) as f32]).collect();
        self.m.faces.push(Face { pts, color: shade(color, light), width: None, depth: depth as f32 });
    }

    fn bx(&mut self, x: f64, y: f64, z: f64, w: f64, d: f64, h: f64, color: &str) {
        let v = [[x - w / 2.0, y - d / 2.0, z], [x + w / 2.0, y - d / 2.0, z], [x + w / 2.0, y + d / 2.0, z], [x - w / 2.0, y + d / 2.0, z]];
        let top: Vec<P3> = v.iter().map(|p| [p[0], p[1], z + h]).collect();
        for i in 0..4 {
            let j = (i + 1) % 4;
            self.face(&[v[i], v[j], top[j], top[i]], color, true);
        }
        self.face(&top, color, true);
    }

    fn beam(&mut self, a: P3, b: P3, width: f64, color: &str) {
        let axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let length = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
        let length = if length == 0.0 { 1.0 } else { length };
        let flat = axis[0].hypot(axis[1]);
        let u = if (axis[2] / length).abs() > 0.9 {
            [width / 2.0, 0.0, 0.0]
        } else {
            [(-axis[1] / flat) * width / 2.0, (axis[0] / flat) * width / 2.0, 0.0]
        };
        let v = [(-axis[2] * u[1]) / length, (axis[2] * u[0]) / length, (axis[0] * u[1] - axis[1] * u[0]) / length];
        let corner = |p: P3, s: f64, t: f64| [p[0] + u[0] * s + v[0] * t, p[1] + u[1] * s + v[1] * t, p[2] + u[2] * s + v[2] * t];
        let order = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)];
        let e0: Vec<P3> = order.iter().map(|&(s, t)| corner(a, s, t)).collect();
        let e1: Vec<P3> = order.iter().map(|&(s, t)| corner(b, s, t)).collect();
        for i in 0..4 {
            let j = (i + 1) % 4;
            self.face(&[e0[i], e0[j], e1[j], e1[i]], color, false);
        }
        self.face(&e1, color, false);
    }

    fn finish(mut self) -> Model {
        self.m.sort();
        self.m
    }
}

/// `sitePiles`: timber stack (`left`) or cut-stone heap, shrinking with `bucket`.
pub fn piles(left: bool, bucket: i64) -> Model {
    let mut c = Cam::new();
    if left {
        let rows = 1 + 3.min((bucket as f64 / 2.0).ceil() as i64);
        for r in 0..rows {
            for i in 0..(rows + 1 - r) {
                let x = -26.0 + r as f64 * 5.0 + i as f64 * 10.0;
                let z = 4.0 + r as f64 * 7.0;
                c.beam([x, -11.0, z], [x, 11.0, z], 6.5, if r % 2 == 1 { "#a8824e" } else { "#8d6a3e" });
            }
        }
        c.bx(14.0, 0.0, 0.0, 14.0, 20.0, 3.0 + (bucket % 3) as f64, "#b79a68");
    } else {
        let n = 1 + bucket;
        for i in 0..n {
            c.bx(-22.0 + (i % 3) as f64 * 15.0, -6.0 + (i / 3) as f64 * 12.0, (i / 6) as f64 * 8.0, 13.0, 10.0, 8.0, "#bcae8b");
        }
        c.bx(24.0, 6.0, 0.0, 12.0, 10.0, 8.0, "#cdbf99");
    }
    c.finish()
}

/// `siteFooting`: the low stone slab that grows during the first five percent.
pub fn footing(o: &Opts, p: f64) -> Model {
    let k = ((p / 0.05).min(1.0) * 4.0).round();
    let f = if o.round { 0.86 } else { 0.94 };
    let t = 0.4 + 0.15 * k;
    let mut c = Cam::new();
    c.bx(0.0, 0.0, 0.0, o.half_w * 2.0 * f * t, ((o.half_d * 2.0) / RISE) * f * t, 4.0, "#a79a78");
    c.finish()
}

/// `siteScaffold`: posts, rails, braces, working deck and ladder.
pub fn scaffold(o: &Opts, zc: f64, fade: f64) -> Model {
    let lift = if o.h > 200.0 { 38.0 } else { 24.0 };
    let hw = o.half_w + 7.0;
    let hd = o.half_d / RISE + 6.0;
    let top = 18f64.max((zc + 20.0) * fade);
    let mut c = Cam::new();
    let mut posts: Vec<[f64; 2]> = Vec::new();
    if o.round {
        for i in 0..10 {
            let a = i as f64 * std::f64::consts::TAU / 10.0;
            posts.push([a.cos() * hw * 0.95, a.sin() * hd * 0.95]);
        }
    } else {
        let nx = ((hw / 46.0).round() as i64).max(1);
        for i in 0..=nx {
            let x = -hw + 2.0 * hw * i as f64 / nx as f64;
            posts.push([x, hd]);
            posts.push([x, -hd]);
        }
        let ny = ((hd / 40.0).round() as i64).max(1);
        for i in 1..ny {
            let y = -hd + 2.0 * hd * i as f64 / ny as f64;
            posts.push([-hw, y]);
            posts.push([hw, y]);
        }
    }
    for p in &posts {
        c.beam([p[0], p[1], 0.0], [p[0], p[1], top], 3.4, SITE_WOOD);
    }
    let rect = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    let ring: &[[f64; 2]] = if o.round { &posts } else { &rect };
    let mut z = 22.0;
    while z <= top - 2.0 {
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            c.beam([a[0], a[1], z], [b[0], b[1], z], 2.4, "#a88251");
        }
        z += lift;
    }
    if !o.round {
        let rows = ((top - 4.0) / lift).floor() as i64;
        for r in 0..rows {
            let z = 22.0 + r as f64 * lift;
            let flip = if r % 2 == 1 { -1.0 } else { 1.0 };
            c.beam([-hw * flip, hd, z], [hw * flip, hd, z + lift], 1.8, "#c19b63");
            c.beam([hw, -hd * flip, z], [hw, hd * flip, z + lift], 1.8, "#c19b63");
        }
    }
    let deck = 10f64.max(((zc - 6.0) / lift).floor() * lift + 22.0);
    if deck <= top - 2.0 {
        let rim = if o.round { hw * 0.98 } else { hw };
        for i in 0..7 {
            let x = -rim + 2.0 * rim * (i as f64 + 0.5) / 7.0;
            let y = if o.round { hd * (1.0 - (x / rim).powi(2)).max(0.0).sqrt() } else { hd };
            c.bx(x, y - 3.0, deck, 2.0 * rim / 7.0 - 1.5, 9.0, 2.2, SITE_WOOD);
        }
        c.bx(-hw * 0.4, hd - 4.0, deck + 2.2, 16.0, 5.0, 3.0, "#c9b48a");
    }
    let lx = (hw - 6.0).min(hw * 0.8);
    let reach = deck.max(24.0);
    for dx in [-3.5, 3.5] {
        c.beam([lx + dx, hd + 9.0, 0.0], [lx + dx, hd + 2.0, reach], 1.8, "#c9a46a");
    }
    let mut z = 6.0;
    while z < reach {
        c.beam([lx - 3.5, hd + 8.0 - z * 0.06, z], [lx + 3.5, hd + 8.0 - z * 0.06, z], 1.4, "#d9b97d");
        z += 8.0;
    }
    c.finish()
}

pub fn dust_color(alpha: f64) -> Color32 {
    crate::paint::rgba(226, 212, 172, (alpha * 255.0) as u8)
}
