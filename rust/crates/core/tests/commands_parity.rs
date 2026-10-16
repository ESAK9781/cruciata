use cruciata_core::commands::Command;
use cruciata_core::model::*;
use cruciata_core::orders::OrderCmd;
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
    let mut sim = Sim::new(state, decos, doc["uid"].as_u64().unwrap() as u32);
    sim.rebuild_navigation();
    sim.refresh_fog();
    sim.state.paused = false;
    sim
}

fn norm(v: &Value) -> Value {
    match v {
        Value::Null => Value::Null,
        Value::Number(n) => serde_json::json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(m) => Value::Object(m.iter().filter(|(_, x)| !x.is_null()).map(|(k, x)| (k.clone(), norm(x))).collect()),
        o => o.clone(),
    }
}

fn ids(v: &Value) -> Vec<u32> {
    v.as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u32).collect()
}

fn check_orders(sim: &Sim, step: &Value, exact_ids: bool) {
    for j in step["units"].as_array().unwrap() {
        let id = j["id"].as_u64().unwrap() as u32;
        let u = sim.state.units.iter().find(|u| u.id == id).unwrap();
        let o = u.order.as_ref().unwrap_or_else(|| panic!("unit {id} has no order"));
        let jo = &j["order"];
        if o.x != jo["x"].as_f64().unwrap() { eprintln!("unit {id} ty {:?} rust {:.3},{:.3} js {:.3},{:.3} at {:.1},{:.1}", u.ty, o.x, o.y, jo["x"].as_f64().unwrap(), jo["y"].as_f64().unwrap(), u.x, u.y); }
        assert_eq!(o.x, jo["x"].as_f64().unwrap(), "unit {id} goal x");
        assert_eq!(o.y, jo["y"].as_f64().unwrap(), "unit {id} goal y");
        assert_eq!(o.attack.unwrap_or(false), jo["attack"].as_bool().unwrap_or(false));
        assert_eq!(o.swarm.unwrap_or(false), jo["swarm"].as_bool().unwrap_or(false));
        if exact_ids {
            assert_eq!(o.formation.map(|f| f as u64), jo["formation"].as_u64(), "unit {id} company");
        }
        assert_eq!(u.manual_target, j["manualTarget"].as_bool().unwrap());
        assert_eq!(u.stance, j["stance"].as_str().unwrap());
        if let Some(mo) = u.march_offset {
            assert_eq!(mo.x, j["marchOffset"]["x"].as_f64().unwrap());
            assert_eq!(mo.y, j["marchOffset"]["y"].as_f64().unwrap());
        }
    }
}

#[test]
fn orders_match_js() {
    let fx = fixture("commands-L0.json");
    let steps = fx["steps"].as_array().unwrap();
    let mut sim = load();
    // Step 1: formation move from the initial state: everything is exact.
    let s = &steps[0];
    sim.issue_order(0, &OrderCmd { units: ids(&s["ids"]), structures: vec![], x: s["x"].as_f64().unwrap(), y: s["y"].as_f64().unwrap(), attack: false, append: false, enemy: None, node: None, building: None, escort: None });
    check_orders(&sim, s, true);
    assert_eq!(sim.uid as u64, s["uid"].as_u64().unwrap(), "ids allocated");
    let jf = s["formations"].as_array().unwrap();
    let rf = &sim.state.formations[sim.state.formations.len() - jf.len()..];
    for (r, j) in rf.iter().zip(jf) {
        assert_eq!(r.id as u64, j["id"].as_u64().unwrap());
        assert_eq!(ids(&j["members"]), r.members);
        assert_eq!(r.destination.x, j["destination"]["x"].as_f64().unwrap());
        assert_eq!(r.destination.y, j["destination"]["y"].as_f64().unwrap());
        assert_eq!(r.anchor.x, j["anchor"]["x"].as_f64().unwrap());
    }
    // Steps 2 and 3 start from the positions the JS run had reached.
    let after = &steps[1];
    for j in after["units"].as_array().unwrap() {
        let id = j["id"].as_u64().unwrap() as u32;
        let u = sim.state.units.iter_mut().find(|u| u.id == id).unwrap();
        u.x = j["x"].as_f64().unwrap();
        u.y = j["y"].as_f64().unwrap();
    }
    for si in [2usize, 3] {
        let s = &steps[si];
        for j in s["units"].as_array().unwrap() {
            let id = j["id"].as_u64().unwrap() as u32;
            let u = sim.state.units.iter_mut().find(|u| u.id == id).unwrap();
            u.x = j["x"].as_f64().unwrap();
            u.y = j["y"].as_f64().unwrap();
        }
        sim.issue_order(0, &OrderCmd { units: ids(&s["ids"]), structures: vec![], x: s["x"].as_f64().unwrap(), y: s["y"].as_f64().unwrap(), attack: s["attack"].as_bool().unwrap(), append: false, enemy: None, node: None, building: None, escort: None });
        check_orders(&sim, s, false);
    }
}

fn set_res(sim: &mut Sim, v: &Value) {
    for (k, r) in [("food", Res::Food), ("wood", Res::Wood), ("stone", Res::Stone), ("gold", Res::Gold)] {
        *sim.state.resources.get_mut(r) = v[k].as_f64().unwrap();
    }
}

fn res_eq(sim: &Sim, v: &Value) {
    for (k, r) in [("food", Res::Food), ("wood", Res::Wood), ("stone", Res::Stone), ("gold", Res::Gold)] {
        assert_eq!(sim.state.resources.get(r), v[k].as_f64().unwrap(), "{k}");
    }
}

#[test]
fn economy_commands_match_js() {
    let fx = fixture("commands-L0.json");
    let steps = fx["steps"].as_array().unwrap();
    let mut sim = load();
    for e in steps[4]["eco"].as_array().unwrap() {
        set_res(&mut sim, &e["before"]);
        let ty: UType = serde_json::from_value(e["type"].clone()).unwrap();
        let ok = sim.apply(0, &Command::Recruit { ty, producers: vec![e["building"].as_u64().unwrap() as u32] });
        assert_eq!(ok, e["ok"].as_bool().unwrap(), "recruit {ty:?}");
        res_eq(&sim, &e["after"]);
        let b = sim.state.buildings.iter().find(|b| b.id as u64 == e["building"].as_u64().unwrap()).unwrap();
        assert_eq!(norm(&serde_json::to_value(&b.queue).unwrap()), norm(&e["queue"]), "queue");
    }
    let p = &steps[5];
    let worker = p["worker"].as_u64().unwrap() as u32;
    for q in p["placed"].as_array().unwrap() {
        set_res(&mut sim, &q["before"]);
        let (x, y) = (q["x"].as_f64().unwrap(), q["y"].as_f64().unwrap());
        assert_eq!(sim.valid_site(BKind::House, cruciata_core::nav::Pt::new(x, y), 0, 0.0, None), q["valid"].as_bool().unwrap(), "valid {x},{y}");
        let before = sim.state.buildings.len();
        let ok = sim.apply(0, &Command::PlaceBuild { kind: BKind::House, x, y, rotation: 0.0, builders: vec![worker], append: false });
        assert_eq!(ok, q["ok"].as_bool().unwrap(), "place {x},{y}");
        assert_eq!((sim.state.buildings.len() - before) as u64, q["count"].as_u64().unwrap());
        res_eq(&sim, &q["after"]);
    }
}
