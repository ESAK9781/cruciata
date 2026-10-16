//! Picking against measured silhouette boxes (`Art.hitUnit` and friends).

use crate::keys::visual_height;
use cruciata_core::model::*;
use cruciata_core::movement::{surface_distance, Target};
use cruciata_core::nav::Pt;
use cruciata_core::sim::Sim;

type BoxT = [f64; 4];

fn unit_box(t: UType) -> Option<BoxT> {
    Some(match t {
        UType::Knight => [-26.0, 26.0, -52.0, 8.0],
        UType::Standard => [-40.0, 16.0, -52.0, 8.0],
        UType::Ram => [-46.0, 46.0, -58.0, 16.0],
        UType::Ballista => [-42.0, 42.0, -62.0, 14.0],
        UType::Trebuchet => [-64.0, 64.0, -108.0, 22.0],
        UType::Pilgrim | UType::Merchant => [-38.0, 38.0, -46.0, 16.0],
        _ => return None,
    })
}

pub fn pick_box(u: &Unit) -> BoxT {
    let base = unit_box(u.ty).unwrap_or([-15.0, 15.0, -38.0, 6.0]);
    if matches!(u.ty, UType::Ram | UType::Ballista | UType::Trebuchet | UType::Pilgrim | UType::Merchant) {
        return base;
    }
    [base[0] - 17.0, base[1] + 17.0, base[2] - 10.0, base[3] + 10.0]
}

pub fn hit_unit(u: &Unit, p: Pt, radius: f64) -> bool {
    let (x, y) = (p.x - u.x, p.y - u.y);
    let b = pick_box(u);
    if x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3] {
        return true;
    }
    radius > 0.0 && x * x + y * y < radius * radius
}

fn building_box(k: BKind) -> Option<BoxT> {
    Some(match k {
        BKind::Towncenter => [-60.0, 60.0, -90.0, 52.0],
        BKind::Fort => [-74.0, 74.0, -104.0, 70.0],
        BKind::Barracks => [-48.0, 48.0, -70.0, 42.0],
        BKind::House => [-30.0, 30.0, -58.0, 28.0],
        BKind::Tower => [-26.0, 26.0, -75.0, 25.0],
        BKind::Watchtower => [-22.0, 22.0, -62.0, 22.0],
        BKind::Chapel => [-39.0, 39.0, -94.0, 50.0],
        BKind::Gate | BKind::Bastiongate => [-58.0, 58.0, -120.0, 46.0],
        BKind::Stable => [-47.0, 47.0, -62.0, 42.0],
        BKind::Siegeworkshop => [-54.0, 54.0, -68.0, 43.0],
        BKind::Farm => [-48.0, 48.0, -46.0, 41.0],
        BKind::Mill => [-36.0, 43.0, -60.0, 34.0],
        BKind::Miningcamp | BKind::Lumbercamp => [-42.0, 42.0, -56.0, 38.0],
        BKind::Colossus => [-175.0, 175.0, -420.0, 150.0],
        BKind::Greatengine => [-90.0, 90.0, -215.0, 76.0],
        _ => return None,
    })
}

pub fn hit_structure(b: &Building, p: Pt, margin: f64) -> bool {
    let (x, y) = (p.x - b.x, p.y - b.y);
    if x.abs() < b.w / 2.0 + margin && y.abs() < b.h / 2.0 + margin {
        return true;
    }
    if b.kind == BKind::Wall {
        return false;
    }
    let bx = if b.wall_attachment.is_some() && b.kind == BKind::Tower { Some([-38.0, 38.0, -108.0, 27.0]) } else { building_box(b.kind) };
    if let Some(bx) = bx {
        return x >= bx[0] - margin && x <= bx[2 - 1] + margin && y >= bx[2] - margin && y <= bx[3] + margin;
    }
    !(x.abs() > b.w / 2.0 + 60.0 || y > b.h / 2.0 + 20.0 || y < -b.h / 2.0 - visual_height(b) - 30.0)
}

pub fn hit_resource(n: &Node, p: Pt) -> bool {
    let (x, y) = (p.x - n.x, p.y - n.y);
    let r = (if n.r != 0.0 { n.r } else { 24.0 }) + 15.0;
    if x * x + y * y < r * r {
        return true;
    }
    let b: BoxT = if n.kind == Res::Wood {
        if n.palm { [-46.0, 46.0, -96.0, 10.0] } else { [-40.0, 40.0, -108.0, 10.0] }
    } else {
        [-42.0, 42.0, -48.0, 14.0]
    };
    x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3]
}

fn dist(a: Pt, b: Pt) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

/// The unit whose drawn body is under `p` among `pool` (indices), by visual centre.
pub fn unit_at(sim: &Sim, p: Pt, pool: &[usize]) -> Option<usize> {
    let mut best = None;
    let mut score = f64::INFINITY;
    for &i in pool {
        let u = &sim.state.units[i];
        if !hit_unit(u, p, 27.0) {
            continue;
        }
        let b = pick_box(u);
        let (dx, dy) = (p.x - u.x, p.y - (u.y + (b[2] + b[3]) * 0.5));
        let v = dx * dx + dy * dy;
        if v < score {
            score = v;
            best = Some(i);
        }
    }
    best
}

/// The structure under `p` (`structureAt`). `own` restricts to `team`.
pub fn structure_at(sim: &Sim, p: Pt, margin: f64, own: bool, team: i32, sees: &dyn Fn(f64, f64) -> bool) -> Option<usize> {
    let mut best = None;
    let mut score = f64::INFINITY;
    for (i, b) in sim.state.buildings.iter().enumerate() {
        if b.hp <= 0.0 || (if own { b.team != team } else { b.team != team && !sees(b.x, b.y) }) {
            continue;
        }
        let wallish = b.kind == BKind::Wall && b.wall_angle.map(|a| a.is_finite()).unwrap_or(false);
        let t = Target::from_building(b);
        let lift: Option<f64> = if wallish {
            [0.0, 12.0, if b.fortified { 24.0 } else { 15.0 }, if b.fortified { 36.0 } else { 25.0 }].into_iter().find(|z| surface_distance(Pt::new(p.x, p.y + z), &t) <= margin + 5.0)
        } else {
            None
        };
        if lift.is_none() && !hit_structure(b, p, margin) {
            continue;
        }
        let v = (if wallish { surface_distance(p, &t) } else { dist(Pt::new(b.x, b.y), p) * 0.5 * (60.0 / 60f64.max(b.w / 2.0)).min(1.0) }) + if b.progress < 1.0 { -40.0 } else { 0.0 };
        if v < score {
            score = v;
            best = Some(i);
        }
    }
    best
}

/// `resourceAt`: a remembered node under `p`, else an own finished farm.
pub fn resource_at(sim: &Sim, p: Pt, remembers: &dyn Fn(f64, f64) -> bool, team: i32) -> Option<u32> {
    let mut nodes: Vec<&Node> = sim.state.nodes.iter().filter(|n| n.remaining > 0.0 && remembers(n.x, n.y) && hit_resource(n, p)).collect();
    nodes.sort_by(|a, b| dist(Pt::new(a.x, a.y), p).partial_cmp(&dist(Pt::new(b.x, b.y), p)).unwrap_or(std::cmp::Ordering::Equal));
    if let Some(n) = nodes.first() {
        return Some(n.id);
    }
    sim.state.buildings.iter().find(|b| b.kind == BKind::Farm && b.team == team && b.progress >= 1.0 && b.hp > 0.0 && (b.x - p.x).abs() < b.w / 2.0 && (b.y - p.y).abs() < b.h / 2.0).map(|b| b.id)
}
