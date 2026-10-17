//! Sprite keys: byte-for-byte the strings `src/isometric-art.js` and
//! `src/siege-art.js` use, so the baked atlas can be addressed directly.

use cruciata_core::js::{atan2, cos, round, sin};
use cruciata_core::model::*;
use std::f64::consts::PI;
use std::sync::atomic::{AtomicI32, Ordering};

/// Art slot of each team: 0 crusader, 1 muslim, 4-6 the crusader orders (`src/orders-art.js`).
/// Set when a match starts; every sprite key below names the slot, never the team index.
static SLOTS: [AtomicI32; 2] = [AtomicI32::new(0), AtomicI32::new(1)];

pub fn set_slots(host: i32, guest: i32) {
    SLOTS[0].store(host, Ordering::Relaxed);
    SLOTS[1].store(guest, Ordering::Relaxed);
}

pub fn slot(team: i32) -> i32 {
    match team {
        0 | 1 => SLOTS[team as usize].load(Ordering::Relaxed),
        t => t,
    }
}

pub fn is_muslim(team: i32) -> bool {
    slot(team) == 1
}

/// `String(number)` as JavaScript prints it.
pub fn jsn(v: f64) -> String {
    if v.is_nan() {
        return "NaN".into();
    }
    if v == 0.0 {
        return "0".into();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    let a = v.abs();
    if v.fract() == 0.0 && a < 1e21 {
        return format!("{}", v as i128);
    }
    if !(1e-6..1e21).contains(&a) {
        let s = format!("{:e}", v);
        // Rust: 1.5e-7 ; JS: 1.5e-7. Rust positive exponents have no sign.
        return if let Some((m, e)) = s.split_once('e') { if e.starts_with('-') { format!("{m}e{e}") } else { format!("{m}e+{e}") } } else { s };
    }
    format!("{}", v)
}

pub fn heading8(angle: f64) -> f64 {
    (round((atan2(sin(angle), cos(angle)) * 4.0) / PI) * PI) / 4.0
}

pub fn heading16(angle: f64) -> f64 {
    (round((atan2(sin(angle), cos(angle)) * 8.0) / PI) * PI) / 8.0
}

pub struct PersonKey {
    pub key: String,
}

fn type_name(t: UType) -> &'static str {
    match t {
        UType::Worker => "worker",
        UType::Civilian => "civilian",
        UType::Sword => "sword",
        UType::Archer => "archer",
        UType::Knight => "knight",
        UType::Chaplain => "chaplain",
        UType::Standard => "standard",
        UType::Trebuchet => "trebuchet",
        UType::Pilgrim => "pilgrim",
        UType::Ram => "ram",
        UType::Ballista => "ballista",
        UType::Merchant => "merchant",
    }
}

pub fn res_name(r: Res) -> &'static str {
    match r {
        Res::Food => "food",
        Res::Wood => "wood",
        Res::Gold => "gold",
        Res::Stone => "stone",
    }
}

pub fn utype_name(t: UType) -> &'static str {
    type_name(t)
}

/// `personKey(u, time, angle)`.
pub fn person_key(u: &Unit, angle: f64) -> String {
    let heading = heading8(angle);
    let rank = if matches!(u.ty, UType::Worker | UType::Civilian | UType::Chaplain) { 0.0 } else { u.rank.unwrap_or(0.0).min(1.0) };
    let action: String = if u.moving {
        "walk".into()
    } else if u.working {
        let job_res = u.job.as_ref().and_then(|j| j.resource);
        if job_res == Some(Res::Food) && u.gather_source.as_deref() == Some("food") {
            "berries".into()
        } else if let Some(r) = job_res {
            res_name(r).into()
        } else if u.job.as_ref().map(|j| j.kind == "clear").unwrap_or(false) && u.gather_source.is_some() {
            u.gather_source.clone().unwrap()
        } else {
            "build".into()
        }
    } else if u.strike > 0.0 {
        "attack".into()
    } else {
        "idle".into()
    };
    let clock = if u.moving {
        u.anim
    } else if u.working {
        u.work_phase.unwrap_or(0.0) * PI * 2.0
    } else {
        (1.0 - u.strike) * PI * 2.0
    };
    let frame = if action == "idle" { 0 } else { ((clock / (PI * 2.0)) * 12.0).floor() as i64 % 12 };
    let sprite_type = if is_muslim(u.team) && u.ty == UType::Knight {
        "knight6"
    } else if u.ty == UType::Knight {
        "knight5"
    } else if is_muslim(u.team) && u.ty == UType::Sword {
        "sword2"
    } else {
        type_name(u.ty)
    };
    format!("person:{}:{}:{}:{}:{}:{}:{}", sprite_type, slot(u.team), jsn(rank), jsn(heading), action, frame, u.carry > 0.0)
}

pub fn tree_key(palm: bool, snow: bool) -> String {
    format!("tree:{palm}:{snow}")
}

pub fn resource_key(n: &Node) -> String {
    format!("resource:{}:{}", res_name(n.kind), n.id % 3)
}

pub fn caravan_key(u: &Unit, angle: f64) -> String {
    let heading = heading16(angle);
    let frame = if u.moving { 0 } else { 0 };
    format!("caravan:{}:{}:{}:{}", slot(u.team), jsn(heading), u.moving, frame)
}

pub fn caravan_frame(u: &Unit, time: f64, angle: f64) -> String {
    let heading = heading16(angle);
    let frame = if u.moving { (time * 12.0).floor() as i64 % 12 } else { 0 };
    format!("caravan:{}:{}:{}:{}", slot(u.team), jsn(heading), u.moving, frame)
}

/// `siegeMachine` key (rams, ballistas, trebuchets).
pub fn siege_machine_key(u: &Unit, time: f64, angle: f64) -> String {
    let a = heading16(angle);
    let deploying = u.deployment == "setting-up" || u.deployment == "packing";
    let track = if deploying {
        u.deployment.as_str()
    } else if u.moving {
        "walk"
    } else if u.strike > 0.0 {
        "attack"
    } else if u.deployment == "deployed" {
        "deployed"
    } else {
        "idle"
    };
    let frame: i64 = if deploying {
        round(u.deploy_timer * 2.0) as i64
    } else if u.moving {
        (time * 24.0).floor() as i64 % 8
    } else if u.strike > 0.0 {
        round(u.strike * 8.0) as i64
    } else {
        0
    };
    format!("siege:machine:{}:{}:{}:{}:{}", type_name(u.ty), slot(u.team), jsn(round((a * 180.0) / PI)), track, frame)
}

pub fn visual_height(b: &Building) -> f64 {
    match b.kind {
        BKind::Colossus => 330.0,
        BKind::Greatengine => 160.0,
        BKind::Chapel => 105.0,
        BKind::Fort => 108.0,
        BKind::Towncenter => 95.0,
        BKind::Tower => 80.0,
        BKind::Watchtower => 78.0,
        BKind::Gate => 75.0,
        BKind::Wall => {
            if b.fortified {
                46.0
            } else {
                35.0
            }
        }
        _ => 65.0,
    }
}

pub fn bkind_name(k: BKind) -> &'static str {
    match k {
        BKind::Towncenter => "towncenter",
        BKind::House => "house",
        BKind::Farm => "farm",
        BKind::Mill => "mill",
        BKind::Lumbercamp => "lumbercamp",
        BKind::Miningcamp => "miningcamp",
        BKind::Barracks => "barracks",
        BKind::Stable => "stable",
        BKind::Chapel => "chapel",
        BKind::Tower => "tower",
        BKind::Siegeworkshop => "siegeworkshop",
        BKind::Fort => "fort",
        BKind::Watchtower => "watchtower",
        BKind::Wall => "wall",
        BKind::Gate => "gate",
        BKind::Bastionwall => "bastionwall",
        BKind::Bastiongate => "bastiongate",
        BKind::Greatengine => "greatengine",
        BKind::Colossus => "colossus",
    }
}

fn arch(b: &Building) -> String {
    b.architecture.clone().unwrap_or_else(|| if is_muslim(b.team) { "islamic".into() } else { "christian".into() })
}

fn link_text(b: &Building) -> String {
    b.links
        .as_ref()
        .map(|l| l.values().map(|p| format!("{},{}", jsn(p.x), jsn(p.y))).collect::<Vec<_>>().join(";"))
        .unwrap_or_default()
}

/// `building:` key for a standing (or ruined) structure.
pub fn building_key(b: &Building) -> String {
    let attached = if b.wall_attachment.is_some() { "attached6" } else { "false" };
    let parts = [
        bkind_name(b.kind).to_string(),
        jsn(b.w),
        jsn(b.h),
        slot(b.team).to_string(),
        arch(b),
        b.fortified.to_string(),
        b.bastion_gate.unwrap_or(false).to_string(),
        attached.to_string(),
        (b.closed != Some(false)).to_string(),
        jsn(b.gate_angle.unwrap_or(0.0)),
        jsn(b.rotation.unwrap_or(0.0)),
        link_text(b),
        jsn(b.wall_angle.unwrap_or(0.0)),
        (b.hp > 0.0).to_string(),
        "20".to_string(),
        jsn(if b.hp <= 0.0 { (b.id % 3) as f64 + if matches!(b.kind, BKind::Greatengine | BKind::Colossus) { 20.0 } else { 0.0 } } else { 0.0 }),
    ];
    format!("building:{}", parts.join(":"))
}

pub fn building_motion_key(b: &Building, frame: i64) -> String {
    let attached = if b.wall_attachment.is_some() { "attached6" } else { "false" };
    format!("buildingMotion:{}:{}:{}:{}:{}:{}:{}:{}", bkind_name(b.kind), jsn(b.w), jsn(b.h), slot(b.team), arch(b), attached, b.fortified, frame)
}

/// Sprite canvas for a building: (width, height, origin y).
pub fn building_canvas(b: &Building) -> (f64, f64, f64) {
    let vh = visual_height(b);
    let width = 200f64.max(b.w + 120.0);
    let height = 240f64.max(b.h + vh + 90.0);
    (width, height, b.h / 2.0 + vh + 55.0)
}

pub fn great_engine_key(b: &Building, time: f64) -> String {
    let big = b.kind == BKind::Colossus;
    let step = if big { 1.0 } else { 2.0 };
    let mut elapsed = match b.last_shot {
        Some(s) if s.is_finite() => (time - s).max(0.0),
        _ => 18.0,
    };
    elapsed = if elapsed < 1.0 {
        (elapsed * 12.0).floor() / 12.0
    } else if elapsed < 16.0 {
        (elapsed * step).floor() / step
    } else {
        18.0
    };
    let aim = (round((b.aim_angle.unwrap_or(-PI / 2.0) * 8.0) / PI) * PI) / 8.0;
    let pose = if elapsed < 1.0 {
        format!("fire-{}", (elapsed * 12.0).floor() as i64)
    } else if elapsed < 16.0 {
        format!("reload-{}", (elapsed * step).floor() as i64)
    } else {
        "ready".to_string()
    };
    format!("siege:{}{}:{}:{}", if big { "colossus:" } else { "" }, slot(b.team), jsn(round((aim * 180.0) / PI)), pose)
}

/// Key of the baked Colossus frame closest to the pose it is in. The native atlas keeps
/// a reduced set of poses (`scripts/bake-colossus.js`): fire 0/4/8, reload 1/4/8/12, ready.
pub fn colossus_key(b: &Building, time: f64) -> String {
    let full = great_engine_key(b, time);
    let Some(i) = full.rfind(':') else { return full };
    let (head, pose) = (&full[..i], &full[i + 1..]);
    let nearest = |n: i64, set: &[i64]| *set.iter().min_by_key(|s| (**s - n).abs()).unwrap_or(&0);
    let pose = if let Some(n) = pose.strip_prefix("fire-").and_then(|n| n.parse::<i64>().ok()) {
        format!("fire-{}", nearest(n, &[0, 4, 8]))
    } else if let Some(n) = pose.strip_prefix("reload-").and_then(|n| n.parse::<i64>().ok()) {
        format!("reload-{}", nearest(n, &[1, 4, 8, 12]))
    } else {
        pose.to_string()
    };
    format!("{head}:{pose}")
}

pub fn standard_key(u: &Unit, pose: i64, moving: bool) -> String {
    let heading = round((atan2(sin(u.angle), cos(u.angle)) * 4.0) / PI);
    format!("standard2:{}:{}:{}:{}", slot(u.team), jsn(heading), if moving { "move" } else { "rest" }, pose)
}
