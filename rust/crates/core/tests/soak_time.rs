use cruciata_core::sim::{Sim, STEP};
use std::time::Instant;

#[test]
#[ignore]
fn time_each() {
    for level in 0..1 {
        let mut sim = Sim::start_level(level, None, "hard", false);
        sim.state.paused = false;
        let t = Instant::now();
        for i in 0..(120.0 / STEP) as usize {
            sim.update(STEP);
            sim.events.clear();
            if i % 600 == 0 {
                eprintln!("L{level} step {i} {:.1}s wall", t.elapsed().as_secs_f32());
            }
        }
        eprintln!("L{level}: 120 sim-s in {:.1}s", t.elapsed().as_secs_f32());
        let mut v: Vec<_> = sim.phases.iter().collect();
        v.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap());
        for (k, x) in v.iter().take(5) { eprintln!("L{level}   {k}: {:.1}s", x); }
    }
}
