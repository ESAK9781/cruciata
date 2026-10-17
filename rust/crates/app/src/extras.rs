//! Small world decorations that the web renderer draws alongside the main
//! scene: waving ground cover, banners, expedition sites, city labels,
//! enemy Colossus beacons and smoke from badly damaged structures.
//! Everything here is cosmetic and never touches the simulation.

use crate::paint::{col, with_alpha, Canvas};
use cruciata_core::js::{to_i32, Seeded};
use cruciata_core::model::*;
use cruciata_core::nav::Pt;
use cruciata_core::sim::Sim;
use cruciata_core::world::{river_x, segment_distance};
use eframe::egui::Color32;

pub struct Stem {
    pub x: f64,
    pub y: f64,
    pub height: f64,
    pub shade: u8,
    pub phase: f64,
}

pub struct Patch {
    pub x: f64,
    pub y: f64,
    pub rx: f64,
    pub ry: f64,
    /// 0 snow, 1 brush, 2 reeds, 3 golden.
    pub kind: u8,
    pub stems: Vec<Stem>,
}

/// Port of `ensureGroundCover`: patches of grass, reeds, brush or snow drift.
pub fn make_cover(sim: &Sim, biome: i32) -> Vec<Patch> {
    let (w, h) = (sim.geo.w, sim.geo.h);
    let mut rnd = Seeded(to_i32(sim.state.seed) ^ 0x47a51);
    let mut out = Vec::new();
    let Some(home) = sim.state.buildings.first() else { return out };
    let count = ((w * h) / 1_400_000.0).ceil().min(170.0) as usize;
    for i in 0..count {
        let kind: u8 = match biome {
            3 => 0,
            2 => 1,
            1 if i % 3 == 0 => 2,
            _ => 3,
        };
        let y = if i == 0 { home.y + 260.0 } else { 180.0 + rnd.next() * (h - 360.0) };
        let x = if i == 0 {
            home.x + 340.0
        } else if kind == 2 {
            river_x(&sim.state, w, y) + if i % 2 == 1 { 1.0 } else { -1.0 } * (85.0 + rnd.next() * 35.0)
        } else {
            350.0 + rnd.next() * (w - 700.0)
        };
        let rx = 90.0 + rnd.next() * 110.0;
        let ry = 60.0 + rnd.next() * 90.0;
        let mut stems = Vec::new();
        for j in 0..320 {
            let angle = rnd.next() * std::f64::consts::TAU;
            let r = rnd.next().sqrt();
            let (px, py) = (x + angle.cos() * rx * r, y + angle.sin() * ry * r);
            if !sim.ground_free(px, py, 6.0) {
                continue;
            }
            let p = Pt::new(px, py);
            let on_road = sim.state.roads.iter().any(|road| road.windows(2).any(|s| segment_distance(p, s[0], s[1]) < 23.0));
            if on_road {
                continue;
            }
            let height = 6.0 + rnd.next() * if kind == 2 { 20.0 } else { 13.0 };
            let phase = rnd.next() * 6.28;
            stems.push(Stem { x: px, y: py, height, shade: (j % 3) as u8, phase });
        }
        if stems.len() > 30 {
            out.push(Patch { x, y, rx, ry, kind, stems });
        }
    }
    out
}

/// Port of `Art.groundCover`. `actors` are moving units `(x, y, angle, id)`
/// near the patch that bend the stems.
pub fn draw_cover(cv: &Canvas, p: &Patch, actors: &[(f64, f64, f64, u32)], time: f64) {
    if p.kind == 0 {
        cv.ellipse(p.x, p.y, p.rx, p.ry, col("#d9e8e633"));
        for &(ux, uy, a, id) in actors {
            for i in 0..5 {
                let s = if i % 2 == 1 { 3.0 } else { -3.0 };
                let k = i as f64 * 8.0;
                cv.ellipse(ux - a.cos() * k + a.sin() * s, uy - a.sin() * k - a.cos() * s, 2.5, 4.0, col("#788e9770"));
            }
            cv.ellipse(ux + (time * 8.0 + id as f64).sin() * 7.0, uy + 7.0, 10.0, 4.0, col("#eff8f5aa"));
        }
        return;
    }
    if p.kind == 3 {
        // Radial wash: 0x55 at the centre, 0x28 at 70 percent, clear at the rim.
        let target = |f: f64| if f < 0.7 { 0.333 - (0.333 - 0.157) * f / 0.7 } else { 0.157 * (1.0 - f) / 0.3 };
        const N: usize = 16;
        let mut prev = 0.0f64;
        for k in 0..N {
            let f = 1.0 - k as f64 / N as f64;
            let want = target(f - 0.5 / N as f64).clamp(0.0, 0.99);
            let a = (1.0 - (1.0 - want) / (1.0 - prev)).clamp(0.0, 1.0);
            prev = want.max(prev);
            cv.ellipse(p.x, p.y, p.rx * f, p.ry * f, with_alpha(col("#baa14a"), a as f32));
        }
    }
    let colors = match p.kind {
        3 => ["#c6a84e", "#e3c46a", "#a38b43"],
        2 => ["#6c8e50", "#92a562", "#b4ac67"],
        _ => ["#a08a58", "#b9a06b", "#857650"],
    };
    let width = if p.kind == 3 { 1.2 } else { 1.0 };
    for shade in 0..3u8 {
        let c = col(colors[shade as usize]);
        for s in p.stems.iter().filter(|s| s.shade == shade) {
            let mut bend = (time * 1.2 + s.phase).sin() * 1.4;
            for &(ux, uy, a, _) in actors {
                let (dx, dy) = (ux - s.x, uy - s.y);
                if dx.abs() >= 36.0 || dy.abs() >= 36.0 {
                    continue;
                }
                let d = dx.hypot(dy);
                if d < 36.0 {
                    bend += (1.0 - d / 36.0) * ((s.x - ux) * 0.5 + a.cos() * 8.0);
                }
            }
            let top = (s.x + bend, s.y - s.height);
            cv.line(&[(s.x, s.y), (s.x + bend * 0.5, s.y - s.height * 0.6), top], width, c);
            if p.kind == 3 || p.kind == 2 {
                cv.line(&[(top.0 - 1.8, top.1 + 4.0), (top.0, top.1 - 2.0)], width, c);
            } else {
                cv.line(&[(s.x, s.y - 2.0), (s.x - 4.0 + bend, s.y - s.height * 0.6)], width, c);
            }
        }
    }
    if p.kind == 1 {
        for &(ux, uy, _, id) in actors {
            cv.ellipse(ux + (time * 5.0 + id as f64).sin() * 9.0, uy + 6.0, 12.0, 5.0, col("#d7b87935"));
        }
    }
}

/// Port of `Art.banner`: a pole with waving cloth in team colours.
pub fn banner(cv: &Canvas, x: f64, y: f64, team: i32, time: f64) {
    cv.line(&[(x, y - 10.0), (x, y + 25.0)], 1.6, col("#695d43"));
    cv.ellipse(x, y - 11.0, 1.8, 1.8, col("#b9a578"));
    let color = col(match team {
        3 => "#b18b3b",
        2 => "#9a917e",
        1 => "#197654",
        _ => "#b73527",
    });
    let gust = 0.7 + (time * 0.57).sin() * 0.18 + (time * 0.23).sin() * 0.12;
    let wave = |t: f64| ((time * 2.1 - t * 5.4).sin() * 2.8 + (time * 3.3 - t * 9.0).sin() * 0.8) * t * gust;
    for i in 0..10 {
        let (a, b) = (i as f64 / 10.0, (i + 1) as f64 / 10.0);
        let quad = [
            (x + 1.0 + a * 21.0, y - 8.0 + wave(a)),
            (x + 1.0 + b * 21.0, y - 8.0 + wave(b)),
            (x + 1.0 + b * 21.0, y + 9.0 + wave(b) - b * 2.0),
            (x + 1.0 + a * 21.0, y + 9.0 + wave(a) - a * 2.0),
        ];
        cv.polygon(&quad, color, eframe::egui::Stroke::NONE);
        let c = (time * 2.6 - a * 6.0).cos();
        let shade = if c > 0.0 { Color32::from_rgb(255, 239, 209) } else { Color32::BLACK };
        cv.polygon(&quad, with_alpha(shade, (c.abs() * 0.14) as f32), eframe::egui::Stroke::NONE);
    }
    let cy = y + wave(0.5);
    let cream = col("#f2e1b7");
    match team {
        0 => {
            cv.line(&[(x + 11.0, cy - 4.0), (x + 11.0, cy + 4.0)], 1.6, cream);
            cv.line(&[(x + 7.0, cy), (x + 15.0, cy)], 1.6, cream);
        }
        1 => {
            let pts: Vec<(f64, f64)> = (0..12).map(|k| {
                let a = 0.7 + (5.3 - 0.7) * k as f64 / 11.0;
                (x + 11.0 + a.cos() * 4.0, cy + a.sin() * 4.0)
            }).collect();
            cv.line(&pts, 1.3, cream);
        }
        _ => {}
    }
}

/// Dashed claim rings, banners and progress on expedition sites; named
/// rings and capture progress on independent cities.
pub fn sites_and_cities(cv: &Canvas, sim: &Sim, g: &crate::game::Game, time: f64, health: impl Fn(f64, f64, f64, f64)) {
    for s in &sim.state.sites {
        if !cv.view.on_screen(s.x, s.y, s.r + 60.0) {
            continue;
        }
        cv.dashed_circle(s.x, s.y, s.r, 2.0, col(if s.captured { "#e1c47b88" } else { "#b4976270" }), 10.0, 8.0, 0.0);
        let team = s.team.unwrap_or(if s.captured { 0 } else { 2 });
        banner(cv, s.x - 15.0, s.y - 45.0, team, time);
        let claim = s.claim_progress.unwrap_or(0.0);
        if s.team == Some(2) || claim > 0.0 {
            health(s.x, s.y + s.r + 10.0, claim, 70.0);
        }
    }
    let z = cv.view.zoom.clamp(0.7, 1.4) as f32;
    for c in &sim.state.cities {
        if !cv.view.on_screen(c.x, c.y, 1200.0) || !g.remembers(c.x, c.y) {
            continue;
        }
        cv.dashed_circle(c.x, c.y, 100.0, 2.0, col(if c.captured { "#e9cf8599" } else { "#d8ae5899" }), 8.0, 6.0, 0.0);
        cv.text(c.x, c.y - 75.0, &c.name, 13.0 * z, col("#f4e3b8"));
        cv.text(c.x, c.y + 90.0, if c.captured { "CITY CAPTURED" } else { "REACH THE CAPITAL TO CAPTURE THE CITY" }, 10.0 * z, col("#f4e3b8"));
        if c.capture > 0.0 && !c.captured {
            health(c.x, c.y + 108.0, c.capture / 12.0, 110.0);
        }
    }
}

/// A pulsing marker over a Colossus that belongs to the other side.
pub fn colossus_beacon(cv: &Canvas, b: &Building, time: f64) {
    let pulse = 0.5 + (time * 4.0).sin() * 0.5;
    let a = 0.5 + pulse * 0.4;
    cv.dashed_circle(b.x, b.y, b.r + 40.0 + pulse * 18.0, 3.0, with_alpha(col("#ff5a3c"), a as f32), 22.0, 12.0, 0.0);
    let label = if b.progress < 1.0 { format!("ENEMY COLOSSUS | {}% BUILT", (b.progress * 100.0).floor()) } else { "ENEMY COLOSSUS | OPERATIONAL".to_string() };
    cv.text(b.x, b.y - 270.0, &label, 15.0 * cv.view.zoom.clamp(0.7, 1.4) as f32, col("#ffd7c9"));
}

/// Smoke (and below 30 percent health, flames) rising from damaged buildings.
pub fn damage_fx(cv: &Canvas, b: &Building, top: f64, time: f64) {
    let id = b.id as f64;
    let top = top.min(60.0);
    for k in 0..5 {
        let ph = (time / 1.3 + k as f64 / 5.0 + (b.id % 7) as f64 * 0.137).rem_euclid(1.0);
        let px = b.x + ((id * 1.7 + k as f64 * 2.3).sin()) * b.w * 0.25;
        let py = b.y - top * (0.3 + 0.5 * ((id + k as f64 * 3.1).cos() * 0.5 + 0.5)) - ph * 34.0;
        let r = (9.0 + 6.0 * ((k as f64 * 1.9 + id).sin() * 0.5 + 0.5)) * (1.0 + ph * 1.5);
        cv.ellipse(px + ph * 6.0, py, r, r * 0.85, with_alpha(col("#3a3530"), (0.53 * (1.0 - ph)) as f32));
    }
    if b.hp < b.max_hp * 0.3 {
        for k in 0..3 {
            let ph = (time * 2.0 + k as f64 / 3.0 + id * 0.31).rem_euclid(1.0);
            let px = b.x + ((id * 2.9 + k as f64 * 4.1).sin()) * b.w * 0.2;
            let py = b.y - top * 0.4 - ph * 14.0;
            let r = (8.0 + 4.0 * (k as f64)) * (1.0 - ph * 0.6);
            cv.ellipse(px, py, r * 0.6, r, with_alpha(col("#f2994a"), (0.8 * (1.0 - ph)) as f32));
            cv.ellipse(px, py + 2.0, r * 0.3, r * 0.5, with_alpha(col("#ffe08a"), (0.8 * (1.0 - ph)) as f32));
        }
    }
}
