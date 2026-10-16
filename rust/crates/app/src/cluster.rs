//! Soldiers are drawn as three people: boids that follow the unit's single
//! simulation body. Purely cosmetic (`updateCluster` in game.js).

use cruciata_core::model::{Unit, UType};
use std::collections::HashMap;

#[derive(Clone, Copy, Default)]
pub struct Fig {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
}

#[derive(Clone, Default)]
pub struct Cluster {
    pub ready: bool,
    pub figs: [Fig; 3],
}

#[derive(Default)]
pub struct Clusters {
    map: HashMap<u32, Cluster>,
}

pub fn clustered(t: UType) -> bool {
    matches!(t, UType::Sword | UType::Archer | UType::Knight)
}

fn seed(u: &Unit, k: usize) -> (f64, f64) {
    let heavy = if u.ty == UType::Knight { 1.5 } else { 1.0 };
    let a = (u.id as f64 * 2.399 + k as f64 * 2.094) % (std::f64::consts::PI * 2.0);
    let r = (6.0 + ((u.id as usize * 7 + k * 5) % 9) as f64) * heavy;
    (a.cos() * r, a.sin() * r)
}

impl Clusters {
    pub fn get(&self, id: u32) -> Option<&Cluster> {
        self.map.get(&id)
    }

    pub fn retain_live(&mut self, live: &std::collections::HashSet<u32>) {
        self.map.retain(|k, _| live.contains(k));
    }

    pub fn update(&mut self, u: &Unit, dt: f64) -> &Cluster {
        let c = self.map.entry(u.id).or_default();
        let heavy = if u.ty == UType::Knight { 1.5 } else { 1.0 };
        let (spacing, comfort, reach) = (8.0 * heavy, 16.0 * heavy, 34.0 * heavy);
        let (vx, vy) = if u.moving { (u.vx.unwrap_or(0.0), u.vy.unwrap_or(0.0)) } else { (0.0, 0.0) };
        if !c.ready || ((c.figs[0].x - u.x).powi(2) + (c.figs[0].y - u.y).powi(2)).sqrt() > 90.0 {
            for i in 0..3 {
                let (sx, sy) = seed(u, i);
                c.figs[i] = Fig { x: u.x + sx, y: u.y + sy, vx, vy };
            }
            c.ready = true;
            return c;
        }
        let step = dt.min(0.1);
        for i in 0..3 {
            let f = c.figs[i];
            let (dx0, dy0) = (u.x - f.x, u.y - f.y);
            let d0 = (dx0 * dx0 + dy0 * dy0).sqrt();
            let d0 = if d0 == 0.0 { 0.01 } else { d0 };
            let pull = if d0 < comfort { 0.8 } else { 0.8 + (d0 - comfort) * 1.4 };
            let mut ax = (dx0 / d0) * pull * d0 * 0.5;
            let mut ay = (dy0 / d0) * pull * d0 * 0.5;
            ax += (vx - f.vx) * 5.0;
            ay += (vy - f.vy) * 5.0;
            for j in 0..3 {
                if j == i {
                    continue;
                }
                let o = c.figs[j];
                let (dx, dy) = (f.x - o.x, f.y - o.y);
                let d = (dx * dx + dy * dy).sqrt();
                let d = if d == 0.0 { 0.01 } else { d };
                if d < spacing {
                    ax += (dx / d) * (spacing - d) * 30.0;
                    ay += (dy / d) * (spacing - d) * 30.0;
                }
            }
            let f = &mut c.figs[i];
            f.vx += ax * step;
            f.vy += ay * step;
            let damp = (1.0 - 3.0 * step).max(0.0);
            f.vx *= damp;
            f.vy *= damp;
            f.x += f.vx * step;
            f.y += f.vy * step;
            let (ox, oy) = (f.x - u.x, f.y - u.y);
            let od = (ox * ox + oy * oy).sqrt();
            if od > reach {
                f.x = u.x + (ox / od) * reach;
                f.y = u.y + (oy / od) * reach;
            }
        }
        c
    }
}
