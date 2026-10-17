use cruciata_core::orders::OrderCmd;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::sim::{Sim, STEP};
use std::time::Instant;

/// `cargo test --release -p cruciata-core --test stress_time -- --ignored --nocapture`
#[test]
#[ignore]
fn armies_cross_the_map() {
    let cfg = serde_json::json!({"seed": 11, "width": 12800, "height": 8800, "biome": 1, "units": 60, "difficulty": "hard"});
    let mut sim = Sim::start_level(0, Some(cfg), "hard", false);
    sim.settings.pvp = true;
    sim.state.paused = false;
    let tc1 = sim.state.buildings.iter().find(|b| b.team == 1 && b.kind == BKind::Towncenter).map(|b| (b.x, b.y)).unwrap();
    for team in [0, 1] {
        let ids: Vec<u32> = sim.state.units.iter().filter(|u| u.team == team && u.ty != UType::Worker).map(|u| u.id).collect();
        let dest = if team == 0 { tc1 } else { (sim.state.buildings[0].x, sim.state.buildings[0].y) };
        sim.run_command(team, team, &PlayerCommand::Order(OrderCmd { units: ids, structures: vec![], x: dest.0, y: dest.1, attack: true, append: false, enemy: None, node: None, building: None, escort: None }));
    }
    let (mut worst, mut total) = (0f64, 0f64);
    for _ in 0..(180.0 / STEP) as usize {
        let t = Instant::now();
        sim.update(STEP);
        sim.events.clear();
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        worst = worst.max(ms);
        total += ms;
    }
    eprintln!("180 sim-s: total {:.0} ms, avg step {:.2} ms, worst step {:.1} ms", total, total / 10800.0, worst);
    let mut v: Vec<_> = sim.phases.iter().collect();
    v.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());
    for (k, x) in v.iter().take(6) {
        eprintln!("  {k}: {:.2}s", x);
    }
}
