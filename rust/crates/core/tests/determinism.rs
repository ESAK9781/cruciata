use cruciata_core::commands::Command;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::orders::OrderCmd;
use cruciata_core::sim::{Sim, STEP};

fn game() -> Sim {
    let cfg = serde_json::json!({"seed": 4242, "width": 6400, "height": 4400, "biome": 0, "difficulty": "normal"});
    let mut sim = Sim::start_level(0, Some(cfg), "normal", false);
    sim.settings.pvp = true;
    sim.state.paused = false;
    sim
}

fn script(sim: &mut Sim, step: u32) {
    // Both sides train, expand and march; commands come from a fixed script.
    if step == 10 {
        for team in [0, 1] {
            let tc: Vec<u32> = sim.state.buildings.iter().filter(|b| b.team == team && b.kind == BKind::Towncenter).map(|b| b.id).collect();
            sim.run_command(team, 0, &PlayerCommand::Game(Command::Recruit { ty: UType::Worker, producers: tc }));
        }
    }
    if step == 300 {
        for team in [0, 1] {
            let ids: Vec<u32> = sim.state.units.iter().filter(|u| u.team == team && u.hp > 0.0 && u.ty != UType::Worker).map(|u| u.id).collect();
            let target = sim.state.buildings.iter().find(|b| b.team == 1 - team && b.kind == BKind::Towncenter).map(|b| (b.x, b.y)).unwrap();
            sim.run_command(team, 0, &PlayerCommand::Order(OrderCmd { units: ids, structures: vec![], x: target.0, y: target.1, attack: true, append: false, enemy: None, node: None, building: None, escort: None }));
        }
    }
}

#[test]
fn two_instances_stay_identical() {
    let mut a = game();
    let mut b = game();
    assert_eq!(a.state_hash(), b.state_hash(), "start");
    for step in 0..3600u32 {
        script(&mut a, step);
        script(&mut b, step);
        a.update(STEP);
        b.update(STEP);
        if step % 300 == 0 {
            assert_eq!(a.state_hash(), b.state_hash(), "diverged at step {step}");
        }
    }
    assert_eq!(a.state_hash(), b.state_hash());
}
