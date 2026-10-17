use cruciata_core::model::State;
use cruciata_core::nav::Pt;
use cruciata_core::sim::Sim;
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
fn ground_free_matches_js() {
    for name in ["L0-t0", "L1-t0", "L2-t0", "L3-t0", "L4-t0", "L5-t0", "L0-t60"] {
        let (mut sim, doc) = load(name);
        // Indexed lookups require the obstacle index, as in the JS game after start.
        sim.rebuild_navigation();
        let mut bad = 0;
        for s in doc["samples"].as_array().unwrap() {
            let x = s[0].as_f64().unwrap();
            let y = s[1].as_f64().unwrap();
            let m = s[2].as_f64().unwrap();
            let expect = s[3].as_bool().unwrap();
            if sim.ground_free(x, y, m) != expect {
                bad += 1;
                if bad < 4 {
                    eprintln!("{name}: groundFree({x},{y},{m}) expected {expect}");
                }
            }
        }
        assert_eq!(bad, 0, "{name}: groundFree mismatches");
    }
}

#[test]
fn wall_links_match_js() {
    for name in ["L0-t0", "L4-t0", "L5-t0"] {
        let (mut sim, doc) = load(name);
        let js: Vec<Value> = doc["state"]["buildings"].as_array().unwrap().clone();
        sim.rebuild_navigation();
        let mut bad = 0;
        for (i, b) in sim.state.buildings.iter().enumerate() {
            let expect = serde_json::to_value(&js[i]["links"]).unwrap();
            let got = serde_json::to_value(&b.links).unwrap();
            let strip = |v: &Value| -> String {
                serde_json::to_string(v).unwrap().replace(",\"terrain\":null", "").replace("\"terrain\":null,", "").replace(".0", "")
            };
            {
                let a = strip(&expect);
                let c = strip(&got);
                if a != c {
                    bad += 1;
                    if bad < 4 {
                        eprintln!("{name} building {i} ({:?}): links {a} vs {c}", b.kind);
                    }
                }
            }
        }
        assert_eq!(bad, 0, "{name}: link mismatches");
    }
}

#[test]
fn navigation_matches_js() {
    for name in ["L0-t0", "L2-t0", "L5-t0"] {
        let (mut sim, doc) = load(name);
        sim.rebuild_navigation();
        let nav = &doc["nav"];
        let blocked: u64 = sim.nav.blocked.iter().map(|&b| b as u64).sum();
        assert_eq!(blocked, nav["blockedSum"].as_u64().unwrap(), "{name} blocked cells");
        assert_eq!(sim.nav.leaf_total, nav["leafTotal"].as_i64().unwrap(), "{name} leaves");
        for pair in nav["comps"].as_array().unwrap() {
            let i = pair[0].as_u64().unwrap() as usize;
            assert_eq!(sim.nav.components[i] as i64, pair[1].as_i64().unwrap(), "{name} component {i}");
        }
        let mut bad = 0;
        for r in nav["routes"].as_array().unwrap() {
            let a = Pt::new(r["a"]["x"].as_f64().unwrap(), r["a"]["y"].as_f64().unwrap());
            let b = Pt::new(r["b"]["x"].as_f64().unwrap(), r["b"]["y"].as_f64().unwrap());
            let state = &sim.state;
            let geo = &sim.geo;
            let route = sim.nav.find(a, b, &|x, y| cruciata_core::world::ground_free(state, geo, x, y, 6.0, None, cruciata_core::world::Adj::No));
            let expect: Vec<(f64, f64)> = r["route"].as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())).collect();
            let got: Vec<(f64, f64)> = route.iter().map(|p| (p.x, p.y)).collect();
            // Equal-cost alternatives may be chosen differently (JS keeps chunk-link
            // order from its incremental history), so compare reachability, end
            // points and total length instead of exact waypoints.
            let len = |v: &Vec<(f64, f64)>, from: Pt| -> f64 {
                let mut prev = (from.x, from.y);
                let mut sum = 0.0;
                for p in v {
                    sum += ((p.0 - prev.0).powi(2) + (p.1 - prev.1).powi(2)).sqrt();
                    prev = *p;
                }
                sum
            };
            let same_ends = got.last() == expect.last() && got.is_empty() == expect.is_empty();
            let (la, lb) = (len(&got, a), len(&expect, a));
            if !same_ends || (la - lb).abs() > 0.03 * lb.max(50.0) {
                bad += 1;
                if bad < 3 {
                    eprintln!("{name}: route {:?}->{:?} lengths {la} vs {lb}", a, b);
                }
            }
        }
        assert_eq!(bad, 0, "{name}: route mismatches");
    }
}
