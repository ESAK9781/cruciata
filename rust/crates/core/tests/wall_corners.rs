use cruciata_core::commands::Command;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::nav::Pt;
use cruciata_core::sim::{Sim, STEP};

/// Villagers must finish a walled loop with right-angle and diagonal corners.
fn build_loop(points: &[(f64, f64)], seconds: f64) -> (usize, usize) {
    let mut sim = Sim::start_level(0, None, "normal", false);
    sim.state.paused = false;
    sim.state.resources.stone = 20000.0;
    sim.state.resources.wood = 20000.0;
    let tc = sim.state.buildings.iter().find(|b| b.team == 0 && b.kind == BKind::Towncenter).map(|b| (b.x, b.y)).unwrap();
    let workers: Vec<u32> = sim.state.units.iter().filter(|u| u.team == 0 && u.ty == UType::Worker).map(|u| u.id).collect();
    let center = std::env::var("WC").ok().and_then(|v| { let mut it = v.split(',').filter_map(|x| x.parse::<f64>().ok()); Some((it.next()?, it.next()?)) }).unwrap_or((900.0, 0.0));
    let pts: Vec<(f64, f64)> = points.iter().map(|p| (((tc.0 + center.0 + p.0) / 32.0).round() * 32.0, ((tc.1 + center.1 + p.1) / 32.0).round() * 32.0)).collect();
    eprintln!("tc {:?} first {:?} valid {} stone {}", tc, pts[0], sim.valid_site(BKind::Wall, Pt::new(pts[0].0, pts[0].1), 0, 0.0, None), sim.state.resources.stone);
    for (i, pair) in pts.windows(2).enumerate() {
        sim.run_command(
            0,
            0,
            &PlayerCommand::Game(Command::PlaceWall { kind: BKind::Wall, ax: pair[0].0, ay: pair[0].1, bx: pair[1].0, by: pair[1].1, builders: workers.clone(), append: i > 0 }),
        );
    }
    let _ = Pt::new(0.0, 0.0);
    for _ in 0..(seconds / STEP) as usize {
        sim.update(STEP);
        sim.events.clear();
    }
    let walls: Vec<&Building> = sim.state.buildings.iter().filter(|b| b.team == 0 && b.kind == BKind::Wall && b.hp > 0.0).collect();
    let done = walls.iter().filter(|b| b.progress >= 1.0).count();
    (done, walls.len())
}

#[test]
fn square_loop_with_corners_is_finished() {
    let (done, all) = build_loop(&[(-320.0, -320.0), (320.0, -320.0), (320.0, 320.0), (-320.0, 320.0), (-320.0, -320.0)], 300.0);
    assert!(all > 8, "walls planned: {all}");
    eprintln!("walls {done}/{all}");
    assert_eq!(done, all, "{} of {} walls finished", done, all);
}

#[test]
fn diagonal_corners_are_finished() {
    let (done, all) = build_loop(&[(-300.0, 0.0), (0.0, -300.0), (300.0, 0.0), (0.0, 300.0), (-300.0, 0.0)], 300.0);
    assert!(all > 8, "walls planned: {all}");
    eprintln!("walls {done}/{all}");
    assert_eq!(done, all, "{} of {} walls finished", done, all);
}
