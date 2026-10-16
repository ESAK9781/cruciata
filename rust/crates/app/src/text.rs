//! Interface text tables from `src/game.js`.

use cruciata_core::model::UType;

pub fn role(t: UType) -> Option<(&'static str, &'static str)> {
    Some(match t {
        UType::Worker => ("Gather & build", "Gather resources, build structures, and repair damage. Flee danger; cannot fight."),
        UType::Sword => ("Frontline infantry", "Holds the front and protects ranged troops. Prioritizes threatening cavalry; vulnerable to focused arrows."),
        UType::Archer => ("Ranged support", "Shoots from behind infantry and retreats from nearby melee attackers. Fragile in close combat."),
        UType::Knight => ("Fast flanking cavalry", "Fast, armored cavalry. Flanks archers, healers, and siege engines. Avoid getting surrounded by infantry."),
        UType::Chaplain => ("Rear-line healer", "Heals wounded allies, generates faith, and retreats from danger. Keep behind infantry; cannot attack."),
        UType::Standard => ("Company support", "Raises nearby allied damage by 12% within 180 paces. Keep the banner protected among your troops."),
        UType::Trebuchet => ("Area siege damage", "Deploys in 6 seconds; packs in 4. Range 180-690; devastating area damage can hurt allies."),
        UType::Pilgrim => ("Protected convoy", "Needs nearby soldiers to travel. Right-click with troops selected to escort."),
        UType::Ram => ("Armored siege assault", "Slow, durable engine that deals heavy siege damage to masonry. Escort it against enemy troops."),
        UType::Ballista => ("Direct-fire siege", "Mobile ranged engine that damages troops and fortifications. Fragile when surrounded."),
        _ => return None,
    })
}

fn variants(t: UType, enemy: bool) -> Option<[&'static str; 3]> {
    Some(match (t, enemy) {
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

/// `unitName(u)`.
pub fn unit_name(t: UType, team: i32, rank: f64) -> String {
    if let Some(v) = variants(t, team == 1) {
        return v[(rank as usize).min(2)].to_string();
    }
    cruciata_core::data::data().ty(t).name.to_string()
}

pub fn cap(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

pub fn cost_text(cost: &cruciata_core::model::Cost) -> String {
    cost.0.iter().map(|(r, n)| format!("{} {}", n, crate::keys::res_name(*r))).collect::<Vec<_>>().join(" \u{b7} ")
}

pub const HELP: &[(&str, &str)] = &[
    ("Villagers", "Select and right-click an orchard, forest, ore vein, or completed farm to gather. Open Build, choose a structure, and click a clear site. Right-click a damaged structure to repair it."),
    ("Construction", "Houses add population. Mills, lumber camps, and mining camps shorten deliveries. Barracks, stables, chapels, and siege workshops train different troops. Hold Shift when placing foundations to queue them for your selected builders. Drag to place cheap, continuous walls; hold Shift to add another connected waypoint. Diagonals and corners join automatically."),
    ("Armies", "Drag to select, or double-click a unit to select every one of its kind on screen; right-click to march in formation. A plain march is committed: troops keep moving even under fire and fight when they arrive. G scouts unknown lands as a group without engaging enemies. Alt-drag selects buildings even among troops. F then click advances while fighting. H holds. Z jumps to the latest attack alert. Space selects combat troops; E selects villagers; V selects an idle villager. Right-click a pilgrim with a selected company to guard it and follow its route automatically. Ctrl+0-9 assigns units or buildings; Ctrl+Shift+0-9 adds to a group; 0-9 recalls it. Shift+1-7 queues swordsmen, archers, knights, chaplains, villagers, standard bearers, and trebuchets."),
    ("Unit roles", "Infantry holds the front. Archers keep their distance. Cavalry flanks vulnerable troops, and a charge with a long run-up strikes far harder. Chaplains heal from the rear and seek safety."),
    ("Trebuchets", "Train them at a siege workshop. T sets them up in 6 seconds or packs them in 4. Deployed engines fire devastating area attacks, with a minimum range of 180. Keep allies out of the impact area. Moving a deployed engine automatically packs it."),
    ("Economy", "Select a military building to research its next unit variation. Existing units and future recruits upgrade together. Your soldiers consume food; shortages weaken their fighting strength."),
    ("Scouting & fog", "Unexplored land is hidden. Troops and structures reveal nearby terrain; cavalry scouts farther. Explored terrain remains visible in shadow, but enemy troops disappear when your scouts leave. Frontier settlements and distant mineral fields reward exploration."),
    ("Camera & saves", "WASD or arrow keys pan; the wheel zooms. Right-drag pans when no units or structures are selected. Click or drag the minimap to look, right-click to command. Q returns to your settlement. The game autosaves every 20 seconds; Save creates an immediate checkpoint."),
];
