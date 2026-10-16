use cruciata_core::commands::Command;
use cruciata_core::model::*;
use cruciata_core::nav::Pt;
use cruciata_core::sim::Sim;
use cruciata_core::world::{Deco, DecoKind};
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn load() -> Sim {
    let doc = fixture("state-L0-t0.json");
    let state: State = serde_json::from_value(doc["state"].clone()).unwrap();
    let decos: Vec<Deco> = doc["decorations"].as_array().unwrap().iter().map(|d| Deco { x: d["x"].as_f64().unwrap(), y: d["y"].as_f64().unwrap(), kind: if d["kind"] == "rock" { DecoKind::Rock } else { DecoKind::Shrub }, r: d["r"].as_f64().unwrap_or(0.0), block: d["block"].as_bool().unwrap_or(false), scale: d["scale"].as_f64().unwrap_or(1.0) }).collect();
    let mut sim = Sim::new(state, decos, doc["uid"].as_u64().unwrap() as u32);
    sim.rebuild_navigation();
    sim.refresh_fog();
    sim.state.paused = false;
    sim
}

fn res_eq(sim: &Sim, v: &Value, what: &str) {
    for (k, r) in [("food", Res::Food), ("wood", Res::Wood), ("stone", Res::Stone), ("gold", Res::Gold)] {
        assert_eq!(sim.state.resources.get(r), v[k].as_f64().unwrap(), "{what} {k}");
    }
}

#[test]
fn walls_upgrades_demolish_scout_research_match_js() {
    let fx = fixture("commands2-L0.json");
    let steps = fx["steps"].as_array().unwrap();
    let mut sim = load();
    // 1. wall line
    let s = &steps[0];
    let worker = s["worker"].as_u64().unwrap() as u32;
    let (a, b) = (&s["a"], &s["b"]);
    let ok = sim.apply(0, &Command::PlaceWall { kind: BKind::Wall, ax: a["x"].as_f64().unwrap(), ay: a["y"].as_f64().unwrap(), bx: b["x"].as_f64().unwrap(), by: b["y"].as_f64().unwrap(), builders: vec![worker], append: false });
    assert!(ok);
    res_eq(&sim, &s["after"], "wall line");
    let n = s["walls"].as_array().unwrap().len();
    let tail = &sim.state.buildings[sim.state.buildings.len() - n..];
    for (r, j) in tail.iter().zip(s["walls"].as_array().unwrap()) {
        assert_eq!(r.id as u64, j["id"].as_u64().unwrap());
        assert_eq!(r.x, j["x"].as_f64().unwrap());
        assert_eq!(r.wall_angle.unwrap(), j["wallAngle"].as_f64().unwrap());
        assert_eq!(r.hp, j["hp"].as_f64().unwrap());
    }
    let ids: Vec<u32> = tail.iter().map(|w| w.id).collect();
    let u = sim.state.units.iter().find(|u| u.id == worker).unwrap();
    assert_eq!(u.job.as_ref().map(|j| j.kind.as_str()), s["job"]["kind"].as_str());
    assert_eq!(u.job.as_ref().and_then(|j| j.target).map(|t| t as u64), s["job"]["target"].as_u64());
    // finish the walls like the scenario hook, then upgrades
    for w in sim.state.buildings.iter_mut().filter(|b| ids.contains(&b.id)) {
        w.progress = 1.0;
        w.hp = w.max_hp;
    }
    sim.rebuild_navigation();
    let g = &steps[1];
    res_eq(&sim, &g["before"], "gate before");
    assert!(sim.apply(0, &Command::WallUpgrade { kind: BKind::Gate, first: g["first"].as_u64().unwrap() as u32 }));
    res_eq(&sim, &g["after"], "gate after");
    let first = sim.state.buildings.iter().find(|b| b.id as u64 == g["first"].as_u64().unwrap()).unwrap();
    let q = &first.queue[0];
    assert_eq!(q.extra.get("partnerId").and_then(|v| v.as_u64()), g["queue"][0]["partnerId"].as_u64());
    assert_eq!(q.duration, g["queue"][0]["duration"].as_f64().unwrap());
    let t = &steps[2];
    assert!(sim.apply(0, &Command::WallUpgrade { kind: BKind::Tower, first: t["first"].as_u64().unwrap() as u32 }));
    res_eq(&sim, &t["after"], "tower after");
    // demolish
    let d = &steps[3];
    assert!(sim.apply(0, &Command::Destroy { id: d["id"].as_u64().unwrap() as u32 }));
    assert_eq!(sim.state.buildings.iter().find(|b| b.id as u64 == d["id"].as_u64().unwrap()).map(|b| b.hp).unwrap_or(0.0), 0.0);
    // scout
    let sc = &steps[4];
    let units: Vec<u32> = sc["ids"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u32).collect();
    assert!(sim.apply(0, &Command::Scout { units }));
    let groups = sim.state.scouting_groups.as_ref().unwrap();
    assert_eq!(groups.last().unwrap().id as u64, sc["groups"][0]["id"].as_u64().unwrap());
    assert_eq!(groups.last().unwrap().members.len(), sc["groups"][0]["members"].as_array().unwrap().len());
    // research
    let r = &steps[5];
    res_eq(&sim, &r["before"], "research before");
    let b = r["barracks"].as_u64().unwrap() as u32;
    assert!(sim.apply(0, &Command::Research { key: "sword1".into(), producer: b }));
    res_eq(&sim, &r["after"], "research after");
    let _ = Pt::new(0.0, 0.0);
}
