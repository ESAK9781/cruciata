//! Cosmetic particles, a port of the web version's particle system: the same
//! Kenney sprites (`assets/particles`), tints, lifetimes, growth and
//! emitters (blows, building work, gathering, marching dust, arrows landing,
//! boulder trails and impacts, collapses, deaths, launch plumes, smoke and
//! flame on damaged structures, thrown masonry). Effects are detected from
//! simulation state diffs and events; none of it is part of the simulation
//! or the state hash.

use crate::paint::{col, rgba, with_alpha, Canvas, Straight};
use crate::view::View;
use cruciata_core::model::*;
use cruciata_core::sim::{Obj, Sim};
use eframe::egui::{self, Color32, Mesh, Pos2, Rect, Shape, TextureHandle};
use std::collections::HashMap;

const MAX_PARTICLES: usize = 800;
const SPRITES: [(&str, &[u8]); 6] = [
    ("dirt", include_bytes!("../../../../assets/particles/dirt_01.png")),
    ("flame", include_bytes!("../../../../assets/particles/flame_01.png")),
    ("light", include_bytes!("../../../../assets/particles/light_02.png")),
    ("smoke1", include_bytes!("../../../../assets/particles/smoke_01.png")),
    ("smoke4", include_bytes!("../../../../assets/particles/smoke_04.png")),
    ("spark", include_bytes!("../../../../assets/particles/spark_01.png")),
];

#[derive(Clone, Copy, PartialEq)]
enum Spr {
    None,
    Dirt,
    Flame,
    Light,
    Smoke1,
    Smoke4,
    Spark,
}

impl Spr {
    fn index(self) -> usize {
        match self {
            Spr::Dirt => 0,
            Spr::Flame => 1,
            Spr::Light => 2,
            Spr::Smoke1 => 3,
            Spr::Smoke4 => 4,
            _ => 5,
        }
    }
}

struct P {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    t: f64,
    life: f64,
    spr: Spr,
    glow: bool,
    color: Color32,
    r: f64,
    growth: f64,
}

struct Debris {
    x: f64,
    y: f64,
    z: f64,
    vx: f64,
    vy: f64,
    vz: f64,
    r: f64,
    shade: f64,
    bounced: bool,
    done: bool,
}

/// A triangular piece of a building sprite that flew apart when it fell.
struct Shard {
    tex: egui::TextureId,
    uv: [Pos2; 3],
    v: [(f64, f64); 3],
    x: f64,
    y: f64,
    z: f64,
    vx: f64,
    vy: f64,
    vz: f64,
    rot: f64,
    vr: f64,
    delay: f64,
    age: f64,
    bounced: bool,
    land: f64,
}

struct Ring {
    x: f64,
    y: f64,
    t: f64,
    r: f64,
    color: Color32,
}

#[derive(Clone, Copy)]
struct UnitSeen {
    x: f64,
    y: f64,
    hp: f64,
    strike: f64,
    run_up: f64,
    work: f64,
    dust_at: f64,
}

/// What the effects need to know about the camera and fog.
pub struct Look<'a> {
    pub view: &'a View,
    pub sees: &'a dyn Fn(f64, f64) -> bool,
    pub gore: bool,
}

impl Look<'_> {
    /// Web `visualParticle`: motion is visible at this zoom and the spot is on screen.
    fn vis(&self, x: f64, y: f64, r: f64) -> bool {
        self.view.zoom >= crate::render::ANIM_SCALE && self.view.on_screen(x, y, r.max(32.0))
    }
}

#[derive(Default)]
pub struct Fx {
    parts: Vec<P>,
    debris: Vec<Debris>,
    shards: Vec<Shard>,
    fallen_ids: Vec<u32>,
    rings: Vec<Ring>,
    sprites: Vec<TextureHandle>,
    units: HashMap<u32, UnitSeen>,
    buildings: HashMap<u32, (f64, f64, BKind)>,
    arrows: HashMap<(u64, u64, i32), (f64, f64, f64, f64, Option<u32>, bool)>,
    fire_at: HashMap<u32, f64>,
    trail_acc: f64,
    seed: u32,
}

fn tone(hex: &str) -> Color32 {
    col(hex)
}

impl Fx {
    fn rnd(&mut self) -> f64 {
        self.seed = self.seed.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.seed >> 8) as f64 / 16777216.0
    }

    /// Decode the six particle sprites into white-with-alpha textures (web tints them with `source-in`).
    pub fn load(&mut self, ctx: &egui::Context) {
        if !self.sprites.is_empty() {
            return;
        }
        for (name, bytes) in SPRITES {
            let Ok(img) = image::load_from_memory(bytes) else { continue };
            let img = image::imageops::resize(&img.to_rgba8(), 128, 128, image::imageops::FilterType::Triangle);
            let pixels = img.pixels().map(|p| Color32::from_rgba_premultiplied(p[3], p[3], p[3], p[3])).collect();
            self.sprites.push(ctx.load_texture(format!("particle-{name}"), egui::ColorImage { size: [128, 128], pixels }, egui::TextureOptions::LINEAR));
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(&mut self, look: &Look, x: f64, y: f64, vx: f64, vy: f64, life: f64, spr: Spr, glow: bool, color: Color32, r: f64, growth: f64) {
        if look.vis(x, y, r * (1.0 + growth)) && self.parts.len() < MAX_PARTICLES {
            self.parts.push(P { x, y, vx, vy, t: 0.0, life, spr, glow, color, r, growth });
        }
    }

    fn debris_burst(&mut self, look: &Look, x: f64, y: f64, count: usize, speed: f64) {
        if !look.vis(x, y, 200.0) {
            return;
        }
        for _ in 0..count {
            if self.debris.len() >= 220 {
                break;
            }
            let a = self.rnd() * std::f64::consts::TAU;
            let v = (40.0 + self.rnd() * 170.0) * speed;
            let vz = 140.0 + self.rnd() * 260.0 * speed;
            let r = 1.5 + self.rnd() * 2.8;
            let shade = self.rnd();
            self.debris.push(Debris { x, y, z: 4.0, vx: a.cos() * v, vy: a.sin() * v * 0.7, vz, r, shade, bounced: false, done: false });
        }
    }

    /// `strikeEffect`: sparks where a blow lands, plus dust for rams, structures and charges.
    fn strike(&mut self, look: &Look, from: (f64, f64), target: (f64, f64), count: usize, dust: bool, charge: bool, ram: bool) {
        let a = (target.1 - from.1).atan2(target.0 - from.0);
        let (x, y) = (target.0 - a.cos() * 7.0, target.1 - a.sin() * 7.0);
        for i in 0..count {
            let s = a + std::f64::consts::PI + (self.rnd() - 0.5) * 2.4;
            let v = 55.0 + self.rnd() * 120.0;
            let (life, r) = (0.16 + self.rnd() * 0.24, 2.5 + self.rnd() * 3.0);
            let c = tone(if i % 2 == 1 { "#ffe6a8" } else { "#ffb85a" });
            self.emit(look, x, y, s.cos() * v, s.sin() * v - 18.0, life, Spr::Spark, true, c, r, 0.0);
        }
        if charge || dust || ram {
            self.emit(look, x, y, a.cos() * 10.0, a.sin() * 10.0 - 8.0, 0.7, Spr::Dirt, false, tone("#b9a784aa"), if charge { 14.0 } else { 9.0 }, 1.5);
        }
        if charge {
            self.rings.push(Ring { x: target.0, y: target.1, t: 0.0, r: 40.0, color: tone("#f6dca0") });
        }
    }

    fn blood(&mut self, look: &Look, x: f64, y: f64, count: usize) {
        for i in 0..count {
            let (vx, vy, life, r) = ((self.rnd() - 0.5) * 130.0, (self.rnd() - 0.5) * 130.0, 0.35 + self.rnd() * 0.35, 1.0 + self.rnd() * 2.0);
            self.emit(look, x, y, vx, vy, life, Spr::None, false, tone(if i % 3 != 0 { "#b3222d" } else { "#611119" }), r, 0.0);
        }
    }

    /// `launchEffect`: smoke and flame at a siege engine that just fired.
    pub fn launch(&mut self, sim: &Sim, look: &Look, x: f64, y: f64, heavy: bool) {
        let mut angle = -std::f64::consts::FRAC_PI_2;
        for u in &sim.state.units {
            if (u.x - x).abs() < 3.0 && (u.y - y).abs() < 3.0 && matches!(u.ty, UType::Trebuchet | UType::Ballista) {
                angle = u.angle;
            }
        }
        for b in &sim.state.buildings {
            if (b.x - x).abs() < 3.0 && (b.y - y).abs() < 3.0 {
                if let Some(a) = b.aim_angle {
                    angle = a;
                }
            }
        }
        if !look.vis(x, y, 60.0) {
            return;
        }
        let count = if heavy { 18 } else { 8 };
        for i in 0..count {
            let spread = angle + (self.rnd() - 0.5) * 1.3;
            let sp = 30.0 + self.rnd() * if heavy { 120.0 } else { 60.0 };
            let sq = 30.0 + self.rnd() * 60.0;
            let r = (if heavy { 12.0 } else { 7.0 }) + self.rnd() * if heavy { 12.0 } else { 6.0 };
            let (spr, c) = if i % 4 != 0 { (Spr::Smoke1, tone("#a8998088")) } else { (Spr::Flame, tone("#f2b458")) };
            self.emit(look, x + angle.cos() * 10.0, y + angle.sin() * 10.0 - 6.0, spread.cos() * sp, spread.sin() * sq - 20.0, if heavy { 1.6 } else { 0.9 }, spr, false, c, r, 1.7);
        }
    }

    /// A boulder landed: fire, dust, a flash, and for heavy shots a rolling smoke ring.
    pub fn impact(&mut self, look: &Look, x: f64, y: f64, heavy: bool) {
        self.debris_burst(look, x, y, if heavy { 34 } else { 16 }, if heavy { 1.3 } else { 1.0 });
        const TONES: [&str; 5] = ["#ffd778", "#ee8633", "#d0461d", "#594e42", "#88735a"];
        for i in 0..68 {
            let (vx, vy) = ((self.rnd() - 0.5) * 240.0, (self.rnd() - 0.5) * 240.0);
            let (life, r) = (0.6 + self.rnd() * 1.4, 6.0 + self.rnd() * 16.0);
            let (spr, growth) = if i % 3 != 0 { (Spr::Dirt, 1.4) } else { (Spr::Spark, 0.0) };
            self.emit(look, x, y, vx, vy, life, spr, false, tone(TONES[i % 5]), r, growth);
        }
        self.emit(look, x, y, 0.0, 0.0, 0.3, Spr::Light, true, tone("#ffe6b3"), if heavy { 120.0 } else { 65.0 }, 1.2);
        if heavy {
            for i in 0..40 {
                let k = i as f64;
                let (vx, vy) = ((k * 2.399).cos() * (80.0 + k * 5.0), (k * 2.399).sin() * (80.0 + k * 5.0));
                let (life, r) = (2.2 + self.rnd(), 12.0 + self.rnd() * 24.0);
                let (spr, c) = if i % 3 != 0 { (Spr::Smoke1, tone("#8a776588")) } else { (Spr::Flame, tone("#f2b458")) };
                self.emit(look, x, y, vx, vy, life, spr, false, c, r, 2.0);
            }
        }
    }

    /// Look for new blows, work, marching, arrows, boulders, collapses and
    /// deaths, then advance and retire the particles.
    pub fn update(&mut self, sim: &Sim, dt: f64, look: &Look) {
        let time = sim.state.time;
        if dt <= 0.0 {
            return;
        }
        let mut live: HashMap<u32, UnitSeen> = HashMap::with_capacity(self.units.len());
        for u in &sim.state.units {
            if u.hp <= 0.0 {
                continue;
            }
            let prev = self.units.get(&u.id).copied();
            let mut seen = UnitSeen { x: u.x, y: u.y, hp: u.hp, strike: u.strike, run_up: u.run_up.unwrap_or(0.0), work: u.work_phase.unwrap_or(0.0), dust_at: prev.map(|p| p.dust_at).unwrap_or(0.0) };
            let visible = look.vis(u.x, u.y, 40.0) && (look.sees)(u.x, u.y);
            if let (Some(p), true) = (prev, visible) {
                // Blows (web `strikeEffect`, called from `fire` for everything but archers and ballistas).
                if u.strike > p.strike + 0.15 && !matches!(u.ty, UType::Archer | UType::Ballista | UType::Trebuchet) {
                    if let Some(t) = u.target {
                        let hit = match sim.get_object(t) {
                            Some(Obj::Unit(i)) => Some((sim.state.units[i].x, sim.state.units[i].y, false)),
                            Some(Obj::Building(i)) => Some((sim.state.buildings[i].x, sim.state.buildings[i].y, true)),
                            _ => None,
                        };
                        if let Some((tx, ty, structure)) = hit {
                            if (look.sees)(tx, ty) {
                                let charge = u.ty == UType::Knight && !structure && p.run_up > 170.0 && seen.run_up < p.run_up - 100.0;
                                let ram = u.ty == UType::Ram;
                                let n = if ram || charge { 10 } else { 4 };
                                self.strike(look, (u.x, u.y), (tx, ty), n, structure, charge, ram);
                            }
                        }
                    }
                }
                // Hammer sparks and chips, once per completed work cycle.
                if u.working && seen.work < p.work {
                    let job = u.job.as_ref();
                    if job.map(|j| j.kind == "build").unwrap_or(false) {
                        for i in 0..4 {
                            let k = i as f64 * 2.0;
                            let c = tone(if i % 2 == 1 { "#c9ac77" } else { "#877452" });
                            self.emit(look, u.x + u.angle.cos() * 15.0, u.y + u.angle.sin() * 15.0, k.cos() * 24.0, k.sin() * 24.0, 0.55, Spr::Spark, false, c, 1.5, 0.0);
                        }
                    } else if let Some(j) = job.filter(|j| j.kind == "gather") {
                        if u.gather_source.as_deref() != Some("farm") {
                            let c = match j.resource {
                                Some(Res::Wood) => "#ca9b62",
                                Some(Res::Gold) => "#edc456",
                                _ => "#bdc8c8",
                            };
                            for i in 0..3 {
                                let k = i as f64 * 2.0;
                                self.emit(look, u.x + u.angle.cos() * 16.0, u.y + u.angle.sin() * 16.0, k.cos() * 20.0, k.sin() * 20.0, 0.45, Spr::None, false, tone(c), 1.3, 0.0);
                            }
                        }
                    }
                }
                // Blood where a body takes a real hit.
                if look.gore && p.hp - u.hp > 4.0 {
                    self.blood(look, u.x, u.y, 3);
                }
            }
            // Dust behind marching troops.
            if u.moving && visible && time >= seen.dust_at {
                seen.dust_at = time + 0.4 + (u.id % 5) as f64 * 0.05;
                let r = if u.ty == UType::Knight { 12.0 } else { 6.0 };
                self.emit(look, u.x - u.angle.cos() * 8.0, u.y - u.angle.sin() * 8.0, -u.angle.cos() * 12.0, -u.angle.sin() * 12.0, 0.8, Spr::Dirt, false, tone("#b5a48288"), r, 1.1);
            }
            live.insert(u.id, seen);
        }
        // Deaths: blood, or a little dust when gore is off.
        let gone: Vec<UnitSeen> = self.units.iter().filter(|(id, _)| !live.contains_key(id)).map(|(_, s)| *s).collect();
        for s in gone {
            if !((look.sees)(s.x, s.y) && look.vis(s.x, s.y, 40.0)) {
                continue;
            }
            if look.gore {
                self.blood(look, s.x, s.y, 35);
            } else {
                for _ in 0..8 {
                    let (vx, vy) = ((self.rnd() - 0.5) * 65.0, (self.rnd() - 0.5) * 65.0);
                    self.emit(look, s.x, s.y, vx, vy, 0.65, Spr::None, false, tone("#bdab82"), 2.0, 0.0);
                }
            }
        }
        self.units = live;

        // Structures: collapse dust, smoke and flame once badly hurt.
        let mut now: HashMap<u32, (f64, f64, BKind)> = HashMap::with_capacity(self.buildings.len());
        for b in &sim.state.buildings {
            if b.hp > 0.0 && b.progress >= 1.0 {
                now.insert(b.id, (b.x, b.y, b.kind));
            }
            if b.team != 2 && b.hp > 0.0 && b.progress >= 1.0 && b.max_hp > 0.0 && b.hp < b.max_hp * 0.45 && time >= self.fire_at.get(&b.id).copied().unwrap_or(0.0) && (look.sees)(b.x, b.y) && look.vis(b.x, b.y, 150.0) && self.parts.len() < 600 {
                self.fire_at.insert(b.id, time + 0.16 + (b.id % 4) as f64 * 0.03);
                let top = (crate::keys::visual_height(b) * 0.7).min(60.0);
                let fx = b.x + (self.rnd() - 0.5) * b.w * 0.5;
                let fy = b.y - top * (0.3 + self.rnd() * 0.5);
                let (vx, vy, r) = ((self.rnd() - 0.5) * 12.0, -24.0 - self.rnd() * 22.0, 9.0 + self.rnd() * 6.0);
                self.emit(look, fx, fy, vx, vy, 1.3, Spr::Smoke1, false, tone("#3a353088"), r, 2.0);
                if b.hp < b.max_hp * 0.3 {
                    let r = 8.0 + self.rnd() * 4.0;
                    self.emit(look, fx, fy + 4.0, 0.0, -16.0, 0.5, Spr::Flame, true, tone("#f2994a"), r, 0.0);
                }
            }
        }
        let fallen: Vec<(u32, (f64, f64, BKind))> = self.buildings.iter().filter(|(id, _)| !now.contains_key(id)).map(|(id, v)| (*id, *v)).collect();
        for (id, (x, y, _)) in fallen {
            self.fallen_ids.push(id);
            if !(look.sees)(x, y) {
                continue;
            }
            for i in 0..24 {
                let (vx, vy) = ((self.rnd() - 0.5) * 190.0, (self.rnd() - 0.5) * 190.0);
                self.emit(look, x, y, vx, vy, 1.0, Spr::Dirt, false, tone(if i % 2 == 1 { "#c3aa79" } else { "#6d5b42" }), 3.0, 1.2);
            }
        }
        self.fire_at.retain(|id, _| now.contains_key(id));
        self.buildings = now;

        // Arrows that landed this frame.
        let mut arrows: HashMap<(u64, u64, i32), (f64, f64, f64, f64, Option<u32>, bool)> = HashMap::with_capacity(self.arrows.len());
        for a in &sim.state.arrows {
            let building = a.target.map(|t| matches!(sim.get_object(t), Some(Obj::Building(_)))).unwrap_or(false);
            arrows.insert((a.sx.to_bits(), a.sy.to_bits(), a.team), (a.x, a.y, a.tx, a.ty, a.target, building));
        }
        let landed: Vec<(f64, f64, bool)> = self
            .arrows
            .iter()
            .filter(|(k, v)| !arrows.contains_key(k) && ((v.0 - v.2).powi(2) + (v.1 - v.3).powi(2)).sqrt() < 480.0 * dt.max(0.02) * 3.0)
            .map(|(_, v)| (v.2, v.3, v.5))
            .collect();
        for (x, y, building) in landed {
            if !(look.sees)(x, y) || self.parts.len() >= 600 {
                continue;
            }
            for _ in 0..if building { 3 } else { 2 } {
                let (vx, vy, life) = ((self.rnd() - 0.5) * 50.0, -10.0 - self.rnd() * 30.0, 0.3 + self.rnd() * 0.25);
                if building {
                    self.emit(look, x, y, vx, vy, life, Spr::Dirt, false, tone("#b9a784aa"), 5.0, 1.2);
                } else {
                    self.emit(look, x, y, vx, vy, life, Spr::Spark, true, tone("#ffe6a8"), 2.2, 0.0);
                }
            }
        }
        self.arrows = arrows;

        // Flaming trails behind boulders in flight (one per 1/60 s).
        self.trail_acc = (self.trail_acc + dt * 60.0).min(4.0);
        let n = self.trail_acc.floor() as usize;
        self.trail_acc -= n as f64;
        for _ in 0..n {
            for s in &sim.state.boulders {
                let flight = (s.t / s.duration).clamp(0.0, 1.0);
                let arc = if s.heavy { 340.0 } else { 150.0 };
                let px = s.sx + (s.tx - s.sx) * flight;
                let py = s.sy + (s.ty - s.sy) * flight - (flight * std::f64::consts::PI).sin() * arc - s.lift.unwrap_or(0.0) * (1.0 - flight);
                if !(look.sees)(s.x, s.y) && s.team != 0 && !look.view.on_screen(px, py, 60.0) {
                    continue;
                }
                let vx = (self.rnd() - 0.5) * 20.0;
                let pick = self.rnd();
                let r = (if s.heavy { 8.0 } else { 3.0 }) + self.rnd() * if s.heavy { 10.0 } else { 4.0 };
                self.emit(look, px, py, vx, -12.0, 0.45, if s.heavy { Spr::Smoke4 } else { Spr::Flame }, false, tone(if pick < 0.5 { "#f4a342" } else { "#4c433ecc" }), r, 1.6);
            }
        }

        // Advance everything.
        let steps = dt * 60.0;
        let drag = 0.9f64.powf(steps);
        for p in &mut self.parts {
            p.t += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= drag;
            p.vy *= drag;
        }
        self.parts.retain(|p| p.t < p.life);
        if self.parts.len() > MAX_PARTICLES {
            let cut = self.parts.len() - MAX_PARTICLES;
            self.parts.drain(0..cut);
        }
        for d in &mut self.debris {
            d.vz -= 620.0 * dt;
            d.z += d.vz * dt;
            d.x += d.vx * dt;
            d.y += d.vy * dt;
            if d.z <= 0.0 {
                d.z = 0.0;
                if d.bounced {
                    d.done = true;
                } else {
                    d.bounced = true;
                    d.vz *= -0.32;
                    d.vx *= 0.5;
                    d.vy *= 0.5;
                }
            }
        }
        self.debris.retain(|d| !d.done);
        for s in &mut self.shards {
            s.age += dt;
            if s.age < s.delay {
                continue;
            }
            if s.land < 0.0 {
                s.vz -= 720.0 * dt;
                s.z += s.vz * dt;
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.rot += s.vr * dt;
                if s.z <= 0.0 {
                    s.z = 0.0;
                    if s.bounced {
                        s.land = s.age;
                        s.vx = 0.0;
                        s.vy = 0.0;
                        s.vr = 0.0;
                    } else {
                        s.bounced = true;
                        s.vz *= -0.3;
                        s.vx *= 0.5;
                        s.vy *= 0.5;
                        s.vr *= 0.4;
                    }
                }
            }
        }
        self.shards.retain(|s| s.land < 0.0 || 1.0 - (s.age - s.land - 1.4) / 3.2 > 0.0);
        for r in &mut self.rings {
            r.t += dt;
        }
        self.rings.retain(|r| r.t < 1.0);
    }

    /// Debug (`--do fxdemo`): one of every effect around a point.
    pub fn demo(&mut self, sim: &Sim, look: &Look, x: f64, y: f64) {
        self.impact(look, x, y, true);
        self.impact(look, x + 220.0, y, false);
        self.strike(look, (x - 300.0, y), (x - 280.0, y), 4, true, false, false);
        self.strike(look, (x - 200.0, y), (x - 160.0, y), 10, true, true, false);
        self.launch(sim, look, x, y + 160.0, true);
        self.launch(sim, look, x + 200.0, y + 160.0, false);
        self.blood(look, x - 100.0, y + 160.0, 35);
        for i in 0..24 {
            let (vx, vy) = ((self.rnd() - 0.5) * 190.0, (self.rnd() - 0.5) * 190.0);
            self.emit(look, x - 250.0, y + 160.0, vx, vy, 1.0, Spr::Dirt, false, tone(if i % 2 == 1 { "#c3aa79" } else { "#6d5b42" }), 3.0, 1.2);
        }
        for i in 0..4 {
            let k = i as f64 * 2.0;
            self.emit(look, x + 400.0, y + 100.0, k.cos() * 24.0, k.sin() * 24.0, 0.55, Spr::Spark, false, tone(if i % 2 == 1 { "#c9ac77" } else { "#877452" }), 1.5, 0.0);
        }
        for i in 0..6 {
            self.emit(look, x + 420.0, y + 160.0, 0.0, -24.0, 1.3, Spr::Smoke1, false, tone("#3a353088"), 9.0 + i as f64, 2.0);
            self.emit(look, x + 420.0, y + 164.0, 0.0, -16.0, 0.5, Spr::Flame, true, tone("#f2994a"), 8.0, 0.0);
        }
    }

    pub fn clear(&mut self) {
        self.parts.clear();
        self.debris.clear();
        self.shards.clear();
        self.rings.clear();
        self.units.clear();
        self.buildings.clear();
        self.arrows.clear();
        self.fire_at.clear();
    }

    /// Ids of buildings that fell since the last call.
    pub fn take_fallen(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.fallen_ids)
    }

    /// Cut the frames a building was drawn with into jittered triangles that start
    /// exactly where their pixels were (web `buildShards`).
    pub fn shatter(&mut self, frames: &[crate::paint::Drawn], atlas: &mut crate::atlas::Atlas) {
        let mut alpha_pages: HashMap<u16, Vec<u8>> = HashMap::new();
        for d in frames {
            let Some((f, Some(tex))) = atlas.lookup(&d.key) else { continue };
            let Some(alpha) = (match alpha_pages.get(&f.page) {
                Some(a) => Some(a),
                None => {
                    if let Some(a) = atlas.page_alpha(f.page) {
                        alpha_pages.insert(f.page, a);
                    }
                    alpha_pages.get(&f.page)
                }
            }) else { continue };
            let page = crate::atlas::PAGE;
            let (res, scale) = (f.res as f64, d.scale);
            let (lx0, ly0) = ((f.dx as f64 - d.ox) * scale, (f.dy as f64 - d.oy) * scale);
            let (ww, wh) = (f.w as f64 / res * scale, f.h as f64 / res * scale);
            let cell_w = (((ww * wh) / 70.0).sqrt()).clamp(10.0, 60.0);
            let cell = cell_w * res / scale;
            let (bw, bh) = (f.w as f64, f.h as f64);
            let cols = ((bw / cell).ceil() as usize).max(1);
            let rows = ((bh / cell).ceil() as usize).max(1);
            let mut seed = (self.rnd() * 4294967295.0) as u32;
            let mut rnd = move || {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                (seed >> 8) as f64 / 16777216.0
            };
            let mut grid: Vec<Vec<(f64, f64)>> = Vec::new();
            for j in 0..=rows {
                let mut row = Vec::new();
                for i in 0..=cols {
                    let edge = i == 0 || j == 0 || i == cols || j == rows;
                    let jx = if edge { 0.0 } else { (rnd() - 0.5) * cell * 0.62 };
                    let jy = if edge { 0.0 } else { (rnd() - 0.5) * cell * 0.62 };
                    row.push((i as f64 * bw / cols as f64 + jx, j as f64 * bh / rows as f64 + jy));
                }
                grid.push(row);
            }
            let opaque = |x: f64, y: f64| -> bool {
                let (px, py) = ((f.x as f64 + x) as i64, (f.y as f64 + y) as i64);
                px >= 0 && py >= 0 && px < page as i64 && py < page as i64 && alpha[(py * page as i64 + px) as usize] > 20
            };
            for j in 0..rows {
                for i in 0..cols {
                    let (a, b, c, e) = (grid[j][i], grid[j][i + 1], grid[j + 1][i], grid[j + 1][i + 1]);
                    let tris = if (i + j) % 2 == 1 { [[a, b, c], [b, e, c]] } else { [[a, b, e], [a, e, c]] };
                    for tri in tris {
                        let (cx, cy) = ((tri[0].0 + tri[1].0 + tri[2].0) / 3.0, (tri[0].1 + tri[1].1 + tri[2].1) / 3.0);
                        if !(opaque(cx, cy) || tri.iter().any(|v| opaque((v.0 + cx) / 2.0, (v.1 + cy) / 2.0))) {
                            continue;
                        }
                        let (lx, ly) = (lx0 + cx / res * scale, ly0 + cy / res * scale);
                        let up = if ly < 0.0 { -ly } else { 0.0 };
                        let uv = |v: (f64, f64)| Pos2::new((f.x + v.0 as f32) / page, (f.y + v.1 as f32) / page);
                        let loc = |v: (f64, f64)| ((v.0 - cx) / res * scale, (v.1 - cy) / res * scale);
                        let (r1, r2, r3, r4, r5, r6) = (self.rnd(), self.rnd(), self.rnd(), self.rnd(), self.rnd(), self.rnd());
                        self.shards.push(Shard {
                            tex,
                            uv: [uv(tri[0]), uv(tri[1]), uv(tri[2])],
                            v: [loc(tri[0]), loc(tri[1]), loc(tri[2])],
                            x: d.wx + lx,
                            y: d.wy + if ly > 0.0 { ly } else { 0.0 },
                            z: up,
                            vx: (lx / (ww / 2.0 + 1.0)) * (50.0 + r1 * 130.0) + (r2 - 0.5) * 60.0,
                            vy: (r3 - 0.5) * 70.0 + if ly > 0.0 { ly * 0.8 } else { 0.0 },
                            vz: 60.0 + r4 * 200.0 + up * 0.7,
                            rot: 0.0,
                            vr: (r5 - 0.5) * 10.0,
                            delay: r6 * 0.18,
                            age: 0.0,
                            bounced: false,
                            land: -1.0,
                        });
                    }
                }
            }
        }
        if self.shards.len() > 1400 {
            let cut = self.shards.len() - 1400;
            self.shards.drain(0..cut);
        }
    }

    pub fn draw(&self, cv: &Canvas) {
        for s in &self.shards {
            if !cv.view.on_screen(s.x, s.y - s.z, 90.0) {
                continue;
            }
            let alpha = if s.land < 0.0 { 1.0 } else { (1.0 - (s.age - s.land - 1.4) / 3.2).clamp(0.0, 1.0) };
            let tint = rgba(255, 255, 255, (alpha * 255.0) as u8);
            let c = cv.p(s.x, s.y - s.z);
            let (sin, cos) = s.rot.sin_cos();
            let z = cv.view.zoom;
            let mut mesh = Mesh::with_texture(s.tex);
            for k in 0..3 {
                let (vx, vy) = s.v[k];
                let pos = Pos2::new(c.x + ((vx * cos - vy * sin) * z) as f32, c.y + ((vx * sin + vy * cos) * z) as f32);
                mesh.vertices.push(egui::epaint::Vertex { pos, uv: s.uv[k], color: tint });
            }
            mesh.add_triangle(0, 1, 2);
            cv.painter.add(Shape::mesh(mesh));
        }
        for p in &self.parts {
            let radius = p.r * (1.0 + p.growth * p.t / p.life);
            if !cv.view.on_screen(p.x, p.y, radius.max(20.0)) {
                continue;
            }
            let fade = (1.0 - p.t / p.life).clamp(0.0, 1.0) as f32;
            let [r, g, b, a] = p.color.straight();
            let alpha = a as f32 / 255.0 * fade;
            let tex = if p.spr == Spr::None { None } else { self.sprites.get(p.spr.index()) };
            let Some(tex) = tex else {
                cv.ellipse(p.x, p.y, p.r, p.r, with_alpha(p.color, fade));
                continue;
            };
            let tint = if p.glow {
                // Additive ("lighter"): premultiplied colour with zero alpha.
                let m = |v: u8| (v as f32 * alpha) as u8;
                Color32::from_rgba_premultiplied(m(r), m(g), m(b), 0)
            } else {
                rgba(r, g, b, (alpha * 255.0) as u8)
            };
            let c = cv.p(p.x, p.y);
            let h = (radius * cv.view.zoom) as f32;
            let mut mesh = Mesh::with_texture(tex.id());
            mesh.add_rect_with_uv(Rect::from_center_size(c, egui::vec2(h * 2.0, h * 2.0)), Rect::from_min_max(Pos2::new(0.0, 0.0), Pos2::new(1.0, 1.0)), tint);
            cv.painter.add(Shape::mesh(mesh));
        }
        for d in &self.debris {
            if !cv.view.on_screen(d.x, d.y, 60.0) {
                continue;
            }
            cv.ellipse(d.x, d.y, d.r * 0.9, d.r * 0.45, col("#25332355"));
            cv.ellipse(d.x, d.y - d.z, d.r, d.r * 0.85, col(if d.shade < 0.5 { "#6e6454" } else { "#9b8e75" }));
        }
    }

    /// Expanding rings (charge shock, plus the simulation's own rings).
    pub fn draw_rings(&self, cv: &Canvas, sim_rings: &[serde_json::Value]) {
        for r in &self.rings {
            ring(cv, r.x, r.y, r.r, r.t, r.color);
        }
        for r in sim_rings {
            let f = |k: &str| r.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
            let c = r.get("color").and_then(|v| v.as_str()).unwrap_or("#ece0b3");
            ring(cv, f("x"), f("y"), f("r"), f("t"), col(c));
        }
    }
}

fn ring(cv: &Canvas, x: f64, y: f64, r: f64, t: f64, c: Color32) {
    if cv.view.on_screen(x, y, r * 2.0) {
        cv.circle_stroke(x, y, r * (0.5 + t), 2.0, with_alpha(c, (1.0 - t).max(0.0) as f32));
    }
}
