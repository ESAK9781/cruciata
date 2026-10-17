use cruciata_core::sim::{Sim, STEP};
use cruciata_core::world::{ground_free, Adj};
use std::time::Instant;

#[test]
#[ignore]
fn ground_free_cost() {
    let mut sim = Sim::start_level(0, None, "hard", false);
    sim.state.paused = false;
    for _ in 0..(100.0 / STEP) as usize {
        sim.update(STEP);
        sim.events.clear();
    }
    sim.rebuild_navigation();
    let pts: Vec<(f64, f64)> = (0..100000).map(|i| (300.0 + (i as f64 * 37.7) % 6000.0, 300.0 + (i as f64 * 91.3) % 4000.0)).collect();
    let t = Instant::now();
    let mut n = 0;
    for &(x, y) in &pts {
        if ground_free(&sim.state, &sim.geo, x, y, 6.0, None, Adj::No) {
            n += 1;
        }
    }
    eprintln!("100k ground_free: {:.1} ms ({} free), buildings {}, features {}, decos {}", t.elapsed().as_secs_f64() * 1000.0, n, sim.state.buildings.len(), sim.state.terrain_features.len(), sim.geo.decorations.len());
    let t = Instant::now();
    let mut n2 = 0;
    for &(x, y) in &pts {
        if cruciata_core::world::land_free(&sim.state, sim.geo.w, sim.geo.h, x, y, 6.0, true) {
            n2 += 1;
        }
    }
    eprintln!("100k land_free only: {:.1} ms ({} free)", t.elapsed().as_secs_f64() * 1000.0, n2);
    let t = Instant::now();
    let mut c = 0;
    for &(x, y) in pts.iter().take(2000) {
        if sim.nav.clear_line(cruciata_core::nav::Pt::new(x, y), cruciata_core::nav::Pt::new(x + 400.0, y + 150.0), &|px, py| ground_free(&sim.state, &sim.geo, px, py, 6.0, None, Adj::No)) {
            c += 1;
        }
    }
    eprintln!("2k clear_line: {:.1} ms ({} clear)", t.elapsed().as_secs_f64() * 1000.0, c);
}
