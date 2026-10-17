use cruciata_core::model::State;
use serde_json::Value;

fn norm(v: &Value) -> Value {
    match v {
        Value::Object(m) => {
            let mut out = serde_json::Map::new();
            for (k, x) in m {
                if x.is_null() || k == "wid" {
                    continue;
                }
                out.insert(k.clone(), norm(x));
            }
            Value::Object(out)
        }
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        other => other.clone(),
    }
}

fn diff(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
    if out.len() > 25 {
        return;
    }
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for (k, v) in x {
                match y.get(k) {
                    Some(w) => diff(v, w, &format!("{path}.{k}"), out),
                    None => out.push(format!("{path}.{k} missing after roundtrip")),
                }
            }
            for k in y.keys() {
                if !x.contains_key(k) {
                    out.push(format!("{path}.{k} added by roundtrip"));
                }
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path} length {} vs {}", x.len(), y.len()));
                return;
            }
            for (i, (v, w)) in x.iter().zip(y.iter()).enumerate() {
                diff(v, w, &format!("{path}[{i}]"), out);
            }
        }
        (Value::Number(x), Value::Number(y)) => {
            if x.as_f64() != y.as_f64() {
                out.push(format!("{path}: {x} vs {y}"));
            }
        }
        _ => {
            if a != b {
                out.push(format!("{path}: {a} vs {b}"));
            }
        }
    }
}

fn extras(v: &Value, path: &str, out: &mut Vec<String>) {
    // Untyped fields end up in "extra": detect them by re-parsing into State and
    // listing keys that exist only because of flatten.
    let _ = (v, path, out);
}

#[test]
fn snapshots_survive_a_state_roundtrip() {
    for name in ["L0-t0", "L0-t10", "L0-t60", "L1-t0", "L2-t0", "L3-t0", "L4-t0", "L5-t0"] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(format!("state-{name}.json"));
        let text = std::fs::read_to_string(&path).unwrap();
        let doc: Value = serde_json::from_str(&text).unwrap();
        let original = &doc["state"];
        let state: State = serde_json::from_value(original.clone()).unwrap();
        let back = serde_json::to_value(&state).unwrap();
        let mut problems = Vec::new();
        diff(&norm(original), &norm(&back), "state", &mut problems);
        let mut untyped = Vec::new();
        extras(original, "state", &mut untyped);
        // Report fields that only survived through the catch-all maps.
        let mut leftovers: Vec<String> = Vec::new();
        collect_extra("state", &serde_json::to_value(&state.extra).unwrap(), &mut leftovers);
        for (i, u) in state.units.iter().enumerate().take(5000) {
            if !u.extra.is_empty() && leftovers.len() < 40 {
                leftovers.push(format!("unit[{i}] extra keys {:?}", u.extra.keys().collect::<Vec<_>>()));
            }
        }
        for (i, b) in state.buildings.iter().enumerate() {
            if !b.extra.is_empty() && leftovers.len() < 40 {
                leftovers.push(format!("building[{i}] extra keys {:?}", b.extra.keys().collect::<Vec<_>>()));
            }
        }
        for (i, n) in state.nodes.iter().enumerate() {
            if !n.extra.is_empty() && leftovers.len() < 40 {
                leftovers.push(format!("node[{i}] extra keys {:?}", n.extra.keys().collect::<Vec<_>>()));
            }
        }
        assert!(problems.is_empty(), "{name}: {problems:#?}");
        assert!(leftovers.is_empty(), "{name}: untyped fields {leftovers:#?}");
    }
}

fn collect_extra(path: &str, v: &Value, out: &mut Vec<String>) {
    if let Value::Object(m) = v {
        if !m.is_empty() {
            out.push(format!("{path} extra keys {:?}", m.keys().collect::<Vec<_>>()));
        }
    }
}
