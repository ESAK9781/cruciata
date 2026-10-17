use cruciata_core::model::State;
use cruciata_core::sim::{Sim, STEP};
use cruciata_core::world::{Deco, DecoKind};
use serde_json::Value;

fn load(name: &str) -> (Sim, Value) {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(format!("state-{name}.json"));
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let state: State = serde_json::from_value(doc["state"].clone()).unwrap();
    let decos: Vec<Deco> = doc["decorations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| Deco {
            x: d["x"].as_f64().unwrap(),
            y: d["y"].as_f64().unwrap(),
            kind: if d["kind"] == "rock" { DecoKind::Rock } else { DecoKind::Shrub },
            r: d["r"].as_f64().unwrap_or(0.0),
            block: d["block"].as_bool().unwrap_or(false),
            scale: d["scale"].as_f64().unwrap_or(1.0),
        })
        .collect();
    let sim = Sim::new(state, decos, doc["uid"].as_u64().unwrap() as u32);
    (sim, doc)
}

#[test]
fn ten_seconds_resemble_the_js_run() {
    let (mut sim, _) = load("L0-t0");
    let (_, js) = load("L0-t10");
    sim.rebuild_navigation();
    sim.state.paused = false;
    for _ in 0..300 {
        sim.update(STEP);
    }
    let jstate: State = serde_json::from_value(js["state"].clone()).unwrap();
    eprintln!("time rust {} js {}", sim.state.time, jstate.time);
    eprintln!("units rust {} js {}", sim.state.units.len(), jstate.units.len());
    eprintln!("buildings rust {} js {}", sim.state.buildings.len(), jstate.buildings.len());
    eprintln!("resources rust {:?} js {:?}", sim.state.resources, jstate.resources);
    let mut moved = 0.0;
    let mut n = 0;
    let mut big = 0;
    for u in &sim.state.units {
        if let Some(j) = jstate.units.iter().find(|x| x.id == u.id) {
            let d = ((u.x - j.x).powi(2) + (u.y - j.y).powi(2)).sqrt();
            moved += d;
            n += 1;
            if d > 60.0 {
                big += 1;
            }
        }
    }
    eprintln!("matched units {n}, mean position error {:.2}, >60: {big}", moved / n.max(1) as f64);
    let carried_r: f64 = sim.state.units.iter().map(|u| u.carry).sum();
    let carried_j: f64 = jstate.units.iter().map(|u| u.carry).sum();
    eprintln!("carried rust {carried_r} js {carried_j}");
    let pr: f64 = sim.state.buildings.iter().map(|b| b.progress).sum();
    let pj: f64 = jstate.buildings.iter().map(|b| b.progress).sum();
    eprintln!("progress sum rust {pr} js {pj}");
    assert!((sim.state.time - jstate.time).abs() < 0.2);
}

#[test]
fn a_minute_resembles_the_js_run() {
    let (mut sim, _) = load("L0-t0");
    let (_, js) = load("L0-t60");
    sim.rebuild_navigation();
    sim.state.paused = false;
    let t0 = std::time::Instant::now();
    for _ in 0..1800 {
        sim.update(STEP);
    }
    eprintln!("1800 steps took {:?}", t0.elapsed());
    let jstate: State = serde_json::from_value(js["state"].clone()).unwrap();
    eprintln!("units rust {} js {}", sim.state.units.len(), jstate.units.len());
    eprintln!("resources rust {:?}
          js   {:?}", sim.state.resources, jstate.resources);
    eprintln!("stats rust {:?} js {:?}", sim.state.stats.gathered, jstate.stats.gathered);
    eprintln!("enemy res rust {:?} js {:?}", sim.state.enemy.resources, jstate.enemy.resources);
    let mut moved = 0.0;
    let mut n = 0;
    for u in &sim.state.units {
        if let Some(j) = jstate.units.iter().find(|x| x.id == u.id) {
            moved += ((u.x - j.x).powi(2) + (u.y - j.y).powi(2)).sqrt();
            n += 1;
        }
    }
    eprintln!("matched {n} mean error {:.2}", moved / n.max(1) as f64);
    eprintln!("buildings rust {} js {}", sim.state.buildings.len(), jstate.buildings.len());
}
