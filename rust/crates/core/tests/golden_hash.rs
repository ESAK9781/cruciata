//! The same match must hash identically on every platform, or LAN lockstep
//! between different operating systems would desynchronise.
use cruciata_core::sim::{Sim, STEP};

#[test]
fn golden_state_hash() {
    let cfg = serde_json::json!({"seed": 31337, "width": 6400, "height": 4400, "biome": 1, "difficulty": "normal"});
    let mut sim = Sim::start_level(0, Some(cfg), "normal", false);
    sim.settings.pvp = true;
    sim.state.paused = false;
    for _ in 0..1800 {
        sim.update(STEP);
    }
    let h = sim.state_hash();
    eprintln!("golden hash {h:#x}");
    assert_eq!(h, GOLDEN, "simulation hash changed (or differs on this platform): {h:#x}");
}

const GOLDEN: u64 = 0x5d6ef0d14a4a1e1c;
