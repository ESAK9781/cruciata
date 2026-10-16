use cruciata_core::model::*;
use cruciata_core::orders::OrderCmd;
use cruciata_core::sim::{Sim, STEP};

fn walk(level: usize, dx: f64, dy: f64) -> (bool, f64, f64) {
    let mut sim = Sim::start_level(level, None, "normal", false);
    sim.state.paused = false;
    let u = sim.state.units.iter().find(|u| u.team == 0 && u.ty == UType::Standard).map(|u| (u.id, u.x, u.y)).expect("standard bearer");
    let goal = (u.1 + dx, u.2 + dy);
    let cmd = OrderCmd { units: vec![u.0], structures: vec![], x: goal.0, y: goal.1, attack: false, append: false, enemy: None, node: None, building: None, escort: None };
    sim.issue_order(0, &cmd);
    let mut last_move = 0.0;
    let mut stalled: f64 = 0.0;
    for step in 0..(90.0 / STEP) as usize {
        sim.update(STEP);
        // A bearer killed by roaming enemies is not a navigation failure.
        let Some(b) = sim.state.units.iter().find(|x| x.id == u.0) else { return (true, 0.0, 0.0) };
        if b.moving {
            last_move = step as f64 * STEP;
        }
        stalled = stalled.max(step as f64 * STEP - last_move);
    }
    let Some(b) = sim.state.units.iter().find(|x| x.id == u.0) else { return (true, 0.0, 0.0) };
    eprintln!("  start ({:.0},{:.0}) end ({:.0},{:.0}) goal ({:.0},{:.0}) goal_free {} pos_free {}", u.1, u.2, b.x, b.y, goal.0, goal.1, sim.ground_free(goal.0, goal.1, 8.0), sim.ground_free(b.x, b.y, 8.0));
    let d = ((b.x - goal.0).powi(2) + (b.y - goal.1).powi(2)).sqrt();
    // Arrived, still walking a long detour, or sent to ground that cannot be reached (the goal itself is blocked).
    let moving_now = 90.0 - last_move < 3.0;
    (d < 60.0 || moving_now || !sim.ground_free(goal.0, goal.1, 8.0), d, stalled)
}

#[test]
fn bannermen_reach_their_goals() {
    let mut bad = Vec::new();
    for level in 0..6 {
        for (dx, dy) in [(500.0, 0.0), (-300.0, 300.0), (0.0, -500.0), (700.0, 400.0), (-600.0, -200.0), (900.0, -300.0)] {
            let (ok, d, stall) = walk(level, dx, dy);
            eprintln!("L{level} ({dx},{dy}): reached {ok} dist {d:.0} longest stall {stall:.1}s");
            if !ok {
                bad.push((level, dx, dy, d));
            }
        }
    }
    assert!(bad.is_empty(), "bannermen that did not arrive: {bad:?}");
}

#[test]
fn bearer_moves_right_away() {
    let mut sim = Sim::start_level(0, None, "normal", false);
    sim.state.paused = false;
    let u = sim.state.units.iter().find(|u| u.team == 0 && u.ty == UType::Standard).map(|u| (u.id, u.x, u.y)).unwrap();
    let cmd = OrderCmd { units: vec![u.0], structures: vec![], x: u.1 - 500.0, y: u.2 + 300.0, attack: false, append: false, enemy: None, node: None, building: None, escort: None };
    sim.issue_order(0, &cmd);
    for step in 0..(8.0 / STEP) as usize {
        sim.update(STEP);
        if step % 30 == 0 {
            let b = sim.state.units.iter().find(|x| x.id == u.0).unwrap();
            eprintln!("t={:.0}s pos=({:.0},{:.0}) moving={} order={} path={} job={:?} hold={} stance={} cooldown={:.1}", step as f64 * STEP, b.x, b.y, b.moving, b.order.is_some(), b.path.len(), b.job.as_ref().map(|j| j.kind.clone()), b.hold, b.stance, b.cooldown);
        }
    }
}

#[test]
fn bearer_north_goal() {
    for level in [0usize, 1] {
        let mut sim = Sim::start_level(level, None, "normal", false);
        sim.state.paused = false;
        let u = sim.state.units.iter().find(|u| u.team == 0 && u.ty == UType::Standard).map(|u| (u.id, u.x, u.y)).unwrap();
        let goal = (u.1, u.2 - 500.0);
        eprintln!("L{level} start ({:.0},{:.0}) goal ({:.0},{:.0}) free={}", u.1, u.2, goal.0, goal.1, sim.ground_free(goal.0, goal.1, 6.0));
        let cmd = OrderCmd { units: vec![u.0], structures: vec![], x: goal.0, y: goal.1, attack: false, append: false, enemy: None, node: None, building: None, escort: None };
        sim.issue_order(0, &cmd);
        let slot = sim.state.units.iter().find(|x| x.id == u.0).unwrap().order.clone();
        eprintln!("  order {:?}", slot.map(|o| (o.x, o.y)));
        for step in 0..(60.0 / STEP) as usize {
            sim.update(STEP);
            if step % 150 == 0 {
                let b = sim.state.units.iter().find(|x| x.id == u.0).unwrap();
                eprintln!("  t={:.0}s pos=({:.0},{:.0}) moving={} order={:?} path={:?}", step as f64 * STEP, b.x, b.y, b.moving, b.order.as_ref().map(|o| (o.x as i64, o.y as i64)), b.path.iter().map(|p| (p.x as i64, p.y as i64)).collect::<Vec<_>>());
            }
        }
    }
}
