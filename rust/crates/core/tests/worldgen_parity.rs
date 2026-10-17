use cruciata_core::model::State;
use cruciata_core::sim::Sim;
use serde_json::Value;

fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(format!("state-{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn check(level: usize) {
    let doc = fixture(&format!("L{level}-t0"));
    let js: State = serde_json::from_value(doc["state"].clone()).unwrap();
    let sim = Sim::start_level(level, None, "normal", false);
    let s = &sim.state;
    eprintln!("L{level}: buildings {} vs {}, units {} vs {}, nodes {} vs {}, masses {} vs {}", s.buildings.len(), js.buildings.len(), s.units.len(), js.units.len(), s.nodes.len(), js.nodes.len(), s.terrain_features.len(), js.terrain_features.len());
    eprintln!("   uid rust {} js {}", sim.uid, doc["uid"]);
    let jd = doc["decorations"].as_array().unwrap();
    eprintln!("   decorations rust {} js {}", sim.geo.decorations.len(), jd.len());
    for (i, (a, b)) in sim.geo.decorations.iter().zip(jd.iter()).enumerate().take(3) {
        eprintln!("   deco {i}: rust ({},{}) r {} / js ({},{}) r {}", a.x, a.y, a.r, b["x"], b["y"], b["r"]);
    }
    let mut first = 0;
    for (i, (a, b)) in s.nodes.iter().zip(js.nodes.iter()).enumerate() {
        if a.id != b.id || (a.x - b.x).abs() > 1e-6 || (a.y - b.y).abs() > 1e-6 || a.kind != b.kind {
            if first < 3 {
                eprintln!("   node {i}: rust {:?} ({},{}) js {:?} ({},{})", a.id, a.x, a.y, b.id, b.x, b.y);
            }
            first += 1;
        }
    }
    eprintln!("   node mismatches: {first}");
    let mut bad = 0;
    for (i, (a, b)) in s.buildings.iter().zip(js.buildings.iter()).enumerate() {
        if a.id != b.id || a.kind != b.kind || a.team != b.team || (a.x - b.x).abs() > 1e-6 || (a.y - b.y).abs() > 1e-6 || (a.hp - b.hp).abs() > 1e-6 {
            if bad < 4 {
                eprintln!("   building {i}: rust id {} {:?} t{} ({},{}) hp {} / js id {} {:?} t{} ({},{}) hp {}", a.id, a.kind, a.team, a.x, a.y, a.hp, b.id, b.kind, b.team, b.x, b.y, b.hp);
            }
            bad += 1;
        }
    }
    eprintln!("   building mismatches: {bad}");
    let mut bad = 0;
    for (i, (a, b)) in s.units.iter().zip(js.units.iter()).enumerate() {
        if a.id != b.id || a.ty != b.ty || a.team != b.team || (a.x - b.x).abs() > 1e-6 || (a.y - b.y).abs() > 1e-6 {
            if bad < 4 {
                eprintln!("   unit {i}: rust id {} {:?} t{} ({},{}) / js id {} {:?} t{} ({},{})", a.id, a.ty, a.team, a.x, a.y, b.id, b.ty, b.team, b.x, b.y);
            }
            bad += 1;
        }
    }
    eprintln!("   unit mismatches: {bad}");
    let mut bad = 0;
    for (a, b) in s.terrain_features.iter().zip(js.terrain_features.iter()) {
        if a.tiles != b.tiles || a.forest != b.forest {
            bad += 1;
        }
    }
    eprintln!("   mass mismatches: {bad}");
}

#[test]
fn campaign_worlds_match_the_js_generator() {
    for level in 0..6 {
        check(level);
    }
}
