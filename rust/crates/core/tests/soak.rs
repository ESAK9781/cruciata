//! Long unattended runs of every chapter and several quickmatch seeds: nothing may panic.
use cruciata_core::sim::{Sim, STEP};

fn run(mut sim: Sim, seconds: f64) {
    sim.state.paused = false;
    for _ in 0..(seconds / STEP) as usize {
        sim.update(STEP);
        sim.events.clear();
    }
}

#[test]
#[ignore]
fn chapters_run_ten_minutes() {
    for level in 0..6 {
        run(Sim::start_level(level, None, "hard", false), 600.0);
    }
}

#[test]
#[ignore]
fn quickmatch_seeds_run_ten_minutes() {
    for (seed, biome) in [(1, 0), (2, 1), (3, 2), (4, 3)] {
        let cfg = serde_json::json!({"seed": seed, "width": 12800, "height": 8800, "biome": biome, "units": 20, "structures": "developed"});
        run(Sim::start_level(0, Some(cfg), "hard", false), 600.0);
    }
}
