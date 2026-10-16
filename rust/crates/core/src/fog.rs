//! Persistent exploration and current vision (`src/fog.js`).

use crate::js::clamp;
use crate::model::{BKind, Building, Unit, UType};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug)]
pub struct Source {
    pub x: f64,
    pub y: f64,
    pub vision: f64,
    pub team: i32,
    /// Hit boulders no longer see.
    pub hit: bool,
}

#[derive(Clone)]
pub struct Fog {
    pub team: i32,
    pub cell: f64,
    pub cols: i32,
    pub rows: i32,
    pub explored: Vec<u8>,
    pub visible: Vec<u8>,
    pub known: HashMap<u32, Building>,
    /// Bumped whenever visibility or exploration changed (renderer cache key).
    pub revision: u64,
}

impl Fog {
    pub fn new(width: f64, height: f64, team: i32) -> Fog {
        let cell = 48.0;
        let cols = (width / cell).ceil() as i32;
        let rows = (height / cell).ceil() as i32;
        let n = (cols * rows) as usize;
        Fog { team, cell, cols, rows, explored: vec![0; n], visible: vec![0; n], known: HashMap::new(), revision: 0 }
    }

    pub fn restore(&mut self, explored: &[u8], known: HashMap<u32, Building>) {
        if explored.len() == self.explored.len() {
            self.explored.copy_from_slice(explored);
        }
        self.known = known;
        self.revision += 1;
    }

    pub fn index(&self, x: f64, y: f64) -> i32 {
        let gx = (x / self.cell).floor() as i32;
        let gy = (y / self.cell).floor() as i32;
        if gx < 0 || gy < 0 || gx >= self.cols || gy >= self.rows {
            -1
        } else {
            gy * self.cols + gx
        }
    }

    pub fn sees(&self, x: f64, y: f64) -> bool {
        let i = self.index(x, y);
        i >= 0 && self.visible[i as usize] != 0
    }

    pub fn remembers(&self, x: f64, y: f64) -> bool {
        let i = self.index(x, y);
        i >= 0 && self.explored[i as usize] != 0
    }

    pub fn update(&mut self, units: &[Unit], buildings: &[Building], projectiles: &[Source], reveals: &[Source]) {
        for v in self.visible.iter_mut() {
            *v = 0;
        }
        let mut sources: Vec<(f64, f64, f64)> = Vec::new();
        for u in units {
            if u.team == self.team && u.hp > 0.0 {
                let vision = match u.ty {
                    UType::Worker => 310.0,
                    UType::Knight => 520.0,
                    UType::Trebuchet => 760.0,
                    _ => 440.0,
                };
                sources.push((u.x, u.y, vision));
            }
        }
        for shot in projectiles {
            if shot.team == self.team && !shot.hit {
                sources.push((shot.x, shot.y, shot.vision));
            }
        }
        for r in reveals {
            sources.push((r.x, r.y, r.vision));
        }
        for b in buildings {
            if b.team == self.team && b.hp > 0.0 && b.progress >= 1.0 {
                let vision = match b.kind {
                    BKind::Watchtower => 1100.0,
                    BKind::Tower => 600.0,
                    BKind::Towncenter => 520.0,
                    BKind::Farm => 180.0,
                    _ => 300.0,
                };
                sources.push((b.x, b.y, vision));
            }
        }
        for (px, py, vision) in sources {
            let min_y = 0.max(((py - vision) / self.cell - 0.5).ceil() as i32);
            let max_y = (self.rows - 1).min(((py + vision) / self.cell - 0.5).floor() as i32);
            let mut y = min_y;
            while y <= max_y {
                let dy = (y as f64 + 0.5) * self.cell - py;
                let reach = (vision * vision - dy * dy).max(0.0).sqrt();
                let x0 = 0.max(((px - reach) / self.cell - 0.5).ceil() as i32);
                let x1 = (self.cols - 1).min(((px + reach) / self.cell - 0.5).floor() as i32);
                if x0 <= x1 {
                    let first = (y * self.cols + x0) as usize;
                    let last = (y * self.cols + x1 + 1) as usize;
                    for i in first..last {
                        self.visible[i] = 1;
                        self.explored[i] = 1;
                    }
                }
                y += 1;
            }
        }
        for b in buildings {
            if self.sees(b.x, b.y) {
                let stale = match self.known.get(&b.id) {
                    None => true,
                    Some(old) => {
                        old.hp != b.hp
                            || old.max_hp != b.max_hp
                            || old.team != b.team
                            || old.kind != b.kind
                            || old.progress != b.progress
                            || old.closed != b.closed
                            || old.links != b.links
                            || old.architecture != b.architecture
                            || old.x != b.x
                            || old.y != b.y
                    }
                };
                if stale {
                    let mut snap = b.clone();
                    snap.queue = Vec::new();
                    snap.rally = None;
                    self.known.insert(b.id, snap);
                }
            }
        }
        self.revision += 1;
        let _ = clamp;
    }
}
