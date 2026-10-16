//! Cosmetic battle particles: sparks and dust where blows land, and
//! tumbling masonry plus dust where a structure falls. Purely client-side;
//! none of it is part of the simulation or the state hash.

use crate::paint::{col, with_alpha, Canvas};
use cruciata_core::model::*;
use cruciata_core::sim::{Obj, Sim};
use std::collections::{HashMap, HashSet};

const MAX_PARTICLES: usize = 600;

#[derive(Clone, Copy)]
enum Kind {
    Spark,
    Dust,
    Chunk,
}

struct P {
    x: f64,
    y: f64,
    z: f64,
    vx: f64,
    vy: f64,
    vz: f64,
    t: f64,
    life: f64,
    r: f64,
    kind: Kind,
    tone: u8,
}

#[derive(Default)]
pub struct Fx {
    parts: Vec<P>,
    strikes: HashMap<u32, f64>,
    buildings: HashMap<u32, (f64, f64, f64, f64, BKind)>,
    seed: u32,
}

impl Fx {
    fn rnd(&mut self) -> f64 {
        self.seed = self.seed.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.seed >> 8) as f64 / 16777216.0
    }

    fn push(&mut self, p: P) {
        if self.parts.len() < MAX_PARTICLES {
            self.parts.push(p);
        }
    }

    fn sparks(&mut self, x: f64, y: f64, away: f64, n: usize) {
        for i in 0..n {
            let a = away + (self.rnd() - 0.5) * 2.4;
            let v = 55.0 + self.rnd() * 120.0;
            let (life, r) = (0.16 + self.rnd() * 0.24, 1.2 + self.rnd() * 1.6);
            let vz = 40.0 + self.rnd() * 50.0;
            self.push(P { x, y, z: 8.0, vx: a.cos() * v, vy: a.sin() * v * 0.6, vz, t: 0.0, life, r, kind: Kind::Spark, tone: (i % 2) as u8 });
        }
    }

    fn dust(&mut self, x: f64, y: f64, n: usize, size: f64) {
        for _ in 0..n {
            let a = self.rnd() * std::f64::consts::TAU;
            let v = 8.0 + self.rnd() * 30.0;
            let life = 0.7 + self.rnd() * 0.7;
            let (vz, rr) = (14.0 + self.rnd() * 18.0, size * (0.6 + self.rnd() * 0.6));
            self.push(P { x, y, z: 4.0, vx: a.cos() * v, vy: a.sin() * v * 0.5, vz, t: 0.0, life, r: rr, kind: Kind::Dust, tone: 0 });
        }
    }

    fn chunks(&mut self, x: f64, y: f64, w: f64, h: f64, n: usize, wood: bool) {
        for _ in 0..n {
            let (dx, dy) = ((self.rnd() - 0.5) * w * 0.7, (self.rnd() - 0.5) * h * 0.5);
            let a = self.rnd() * std::f64::consts::TAU;
            let v = 20.0 + self.rnd() * 60.0;
            let life = 0.9 + self.rnd() * 0.7;
            let r = 2.5 + self.rnd() * 3.5;
            let (z, vz) = (10.0 + self.rnd() * 20.0, 60.0 + self.rnd() * 90.0);
            self.push(P { x: x + dx, y: y + dy, z, vx: a.cos() * v, vy: a.sin() * v * 0.5, vz, t: 0.0, life, r, kind: Kind::Chunk, tone: if wood { 1 } else { 0 } });
        }
    }

    /// Look for new melee blows and fallen structures among what the player
    /// can see, then advance and retire particles.
    pub fn update(&mut self, sim: &Sim, dt: f64, sees: impl Fn(f64, f64) -> bool, zoomed_in: bool) {
        let mut live: HashSet<u32> = HashSet::new();
        for u in &sim.state.units {
            if u.hp <= 0.0 {
                continue;
            }
            live.insert(u.id);
            let before = self.strikes.insert(u.id, u.strike).unwrap_or(0.0);
            if !zoomed_in || u.strike <= before + 0.15 || u.ty == UType::Archer || u.ty == UType::Trebuchet || u.ty == UType::Ballista {
                continue;
            }
            let Some(t) = u.target else { continue };
            let (tx, ty, structure) = match sim.get_object(t) {
                Some(Obj::Unit(i)) => (sim.state.units[i].x, sim.state.units[i].y, false),
                Some(Obj::Building(i)) => (sim.state.buildings[i].x, sim.state.buildings[i].y, true),
                _ => continue,
            };
            if !sees(tx, ty) {
                continue;
            }
            let a = (ty - u.y).atan2(tx - u.x);
            let (x, y) = (tx - a.cos() * 7.0, ty - a.sin() * 7.0);
            let n = if u.ty == UType::Ram { 10 } else { 4 };
            self.sparks(x, y, a + std::f64::consts::PI, n);
            if structure || u.ty == UType::Ram {
                self.dust(x, y, 2, 7.0);
            }
        }
        self.strikes.retain(|id, _| live.contains(id));

        let mut now: HashMap<u32, (f64, f64, f64, f64, BKind)> = HashMap::new();
        for b in &sim.state.buildings {
            if b.hp > 0.0 && b.progress >= 1.0 {
                now.insert(b.id, (b.x, b.y, b.w, b.h, b.kind));
            }
        }
        let gone: Vec<(f64, f64, f64, f64, BKind)> = self.buildings.iter().filter(|(id, _)| !now.contains_key(id)).map(|(_, v)| *v).collect();
        for (x, y, w, h, kind) in gone {
            if zoomed_in && sees(x, y) {
                let big = (w * h).sqrt();
                let wood = matches!(kind, BKind::House | BKind::Farm | BKind::Lumbercamp | BKind::Mill);
                self.chunks(x, y, w, h, ((big / 6.0) as usize).clamp(6, 26), wood);
                self.dust(x, y, ((big / 8.0) as usize).clamp(5, 18), big * 0.28);
            }
        }
        self.buildings = now;

        for p in &mut self.parts {
            p.t += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            match p.kind {
                Kind::Dust => {
                    p.vz *= 0.97;
                    p.vx *= 0.96;
                    p.vy *= 0.96;
                }
                _ => {
                    p.vz -= 260.0 * dt;
                    if p.z < 0.0 {
                        p.z = 0.0;
                        p.vz = -p.vz * 0.35;
                        p.vx *= 0.6;
                        p.vy *= 0.6;
                    }
                }
            }
        }
        self.parts.retain(|p| p.t < p.life);
    }

    pub fn clear(&mut self) {
        self.parts.clear();
        self.strikes.clear();
        self.buildings.clear();
    }

    pub fn draw(&self, cv: &Canvas) {
        for p in &self.parts {
            if !cv.view.on_screen(p.x, p.y, 80.0) {
                continue;
            }
            let k = (p.t / p.life).clamp(0.0, 1.0);
            let (sx, sy) = (p.x, p.y - p.z);
            match p.kind {
                Kind::Spark => {
                    let c = col(if p.tone == 0 { "#ffb85a" } else { "#ffe6a8" });
                    cv.ellipse(sx, sy, p.r * 1.6, p.r * 1.6, with_alpha(c, 0.35 * (1.0 - k) as f32));
                    cv.ellipse(sx, sy, p.r * 0.7, p.r * 0.7, with_alpha(c, (1.0 - k) as f32));
                }
                Kind::Dust => {
                    let r = p.r * (1.0 + k * 1.6);
                    cv.ellipse(sx, sy, r, r * 0.8, with_alpha(col("#8b7d66"), 0.45 * (1.0 - k) as f32));
                }
                Kind::Chunk => {
                    cv.ellipse(p.x, p.y, p.r * 0.9, p.r * 0.4, with_alpha(col("#14110f"), 0.3 * (1.0 - k) as f32));
                    let c = if p.tone == 1 { "#6b5436" } else { "#a79c82" };
                    cv.ellipse(sx, sy, p.r, p.r * 0.8, with_alpha(col(c), (1.0 - k * k) as f32));
                }
            }
        }
    }
}
