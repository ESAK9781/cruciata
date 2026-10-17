use cruciata_core::commands::Command;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::sim::{Sim, STEP};

fn quick(seed: u64) -> Sim {
    let cfg = serde_json::json!({"seed": seed, "width": 12800, "height": 8800, "biome": 0, "units": 8, "difficulty": "normal"});
    let mut sim = Sim::start_level(0, Some(cfg), "normal", false);
    sim.settings.pvp = true;
    sim.state.paused = false;
    sim
}

#[test]
fn each_side_starts_at_a_seeded_height() {
    let mut seen = std::collections::BTreeSet::new();
    for seed in [1u64, 2, 3, 4, 5, 6] {
        let sim = quick(seed);
        let tc0 = sim.state.buildings.iter().find(|b| b.team == 0 && b.kind == BKind::Towncenter).unwrap();
        let tc1 = sim.state.buildings.iter().find(|b| b.team == 1 && b.kind == BKind::Towncenter).unwrap();
        assert!(tc0.y >= 900.0 && tc0.y <= 7900.0 && tc1.y >= 900.0 && tc1.y <= 7900.0);
        seen.insert((tc0.y as i64, tc1.y as i64));
    }
    assert!(seen.len() >= 5, "heights should vary with the seed: {seen:?}");
    assert_eq!(quick(9).state.buildings[0].y, quick(9).state.buildings[0].y);
}

#[test]
fn the_guest_can_scout_unexplored_ground() {
    let mut sim = quick(7);
    let ids: Vec<u32> = sim.state.units.iter().filter(|u| u.team == 1 && u.ty != UType::Worker).map(|u| u.id).collect();
    assert!(!ids.is_empty());
    let start: Vec<(f64, f64)> = sim.state.units.iter().filter(|u| ids.contains(&u.id)).map(|u| (u.x, u.y)).collect();
    sim.run_command(1, 1, &PlayerCommand::Game(Command::Scout { units: ids.clone() }));
    for _ in 0..(40.0 / STEP) as usize {
        sim.update(STEP);
        sim.events.clear();
    }
    let g = &sim.state.scouting_groups.as_ref().unwrap()[0];
    assert_ne!(g.status, "withdrawing", "the guest's own army must not count as the threat");
    let far = sim.state.units.iter().filter(|u| ids.contains(&u.id)).zip(&start).filter(|(u, s)| ((u.x - s.0).powi(2) + (u.y - s.1).powi(2)).sqrt() > 500.0).count();
    assert!(far > 0, "scouts should have marched out");
}
