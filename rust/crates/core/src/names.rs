//! Display names for ranked units (`VARIANTS`, `ENEMY_VARIANTS`, `unitName`).

use crate::data::data;
use crate::model::{UType, Unit};

pub fn variants(ty: UType, enemy: bool) -> Option<[&'static str; 3]> {
    Some(match (ty, enemy) {
        (UType::Sword, false) => ["Swordsman", "Templar", "Veteran Templar"],
        (UType::Archer, false) => ["Archer", "Crossbowman", "Royal Arbalester"],
        (UType::Knight, false) => ["Knight", "Order Cavalier", "Marshal's Guard"],
        (UType::Chaplain, false) => ["Chaplain", "Hospitaller", "Prior"],
        (UType::Standard, false) => ["Standard bearer", "Gonfalonier", "Sacred Standard"],
        (UType::Trebuchet, _) => ["Trebuchet", "Counterweight Engine", "Grand Trebuchet"],
        (UType::Sword, true) => ["Infantry", "Citadel Guard", "Veteran Guard"],
        (UType::Archer, true) => ["Archer", "Crossbowman", "Veteran Crossbowman"],
        (UType::Knight, true) => ["Rider", "Heavy Cavalry", "Veteran Cavalry"],
        (UType::Chaplain, true) => ["Physician", "Scholar", "Court Physician"],
        (UType::Standard, true) => ["Standard Bearer", "Company Standard", "Royal Standard"],
        _ => return None,
    })
}

pub fn unit_name(u: &Unit) -> String {
    let rank = u.rank.unwrap_or(0.0) as usize;
    variants(u.ty, u.team == 1).and_then(|v| v.get(rank).copied()).map(|s| s.to_string()).unwrap_or_else(|| data().ty(u.ty).name.to_string())
}
