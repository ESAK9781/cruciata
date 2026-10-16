use cruciata_core::nav::{Area, Nav, Pt};
use serde_json::Value;

#[test]
fn routes_match_the_js_navigation() {
    let text = include_str!("../../../fixtures/nav.json");
    let f: Value = serde_json::from_str(text).unwrap();
    for scene in f["scenes"].as_array().unwrap() {
        let w = scene["W"].as_f64().unwrap();
        let h = scene["H"].as_f64().unwrap();
        let rects: Vec<(f64, f64, f64, f64)> = scene["rects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r["x"].as_f64().unwrap(), r["y"].as_f64().unwrap(), r["w"].as_f64().unwrap(), r["h"].as_f64().unwrap()))
            .collect();
        let free = move |x: f64, y: f64| -> bool {
            let margin = 6.0;
            if x < 24.0 + margin || y < 24.0 + margin || x > w - 24.0 - margin || y > h - 24.0 - margin {
                return false;
            }
            for &(bx, by, bw, bh) in &rects {
                if (x - bx).abs() < bw / 2.0 + margin && (y - by).abs() < bh / 2.0 + margin {
                    return false;
                }
            }
            true
        };
        let mut waypoints = Vec::new();
        for r in scene["rects"].as_array().unwrap() {
            let (bx, by, bw, bh) = (r["x"].as_f64().unwrap(), r["y"].as_f64().unwrap(), r["w"].as_f64().unwrap(), r["h"].as_f64().unwrap());
            for dx in [-bw / 2.0 - 6.25, bw / 2.0 + 6.25] {
                for dy in [-bh / 2.0 - 6.25, bh / 2.0 + 6.25] {
                    waypoints.push(Pt::new(bx + dx, by + dy));
                }
            }
        }
        let mut nav = Nav::new(w, h, 16.0);
        nav.rebuild(&free, &waypoints, None::<&[Area]>);
        assert_eq!(nav.cols as i64, scene["cols"].as_i64().unwrap());
        let blocked: u64 = nav.blocked.iter().map(|&b| b as u64).sum();
        assert_eq!(blocked, scene["blockedSum"].as_u64().unwrap(), "blocked cells");
        assert_eq!(nav.revision as i64, scene["revision"].as_i64().unwrap());
        for pair in scene["comp"].as_array().unwrap() {
            let i = pair[0].as_u64().unwrap() as usize;
            assert_eq!(nav.components[i] as i64, pair[1].as_i64().unwrap(), "component {i}");
        }
        let mut bad = 0;
        for (n, q) in scene["queries"].as_array().unwrap().iter().enumerate() {
            let a = Pt::new(q["a"]["x"].as_f64().unwrap(), q["a"]["y"].as_f64().unwrap());
            let b = Pt::new(q["b"]["x"].as_f64().unwrap(), q["b"]["y"].as_f64().unwrap());
            let route = nav.find(a, b, &free);
            let expect: Vec<(f64, f64)> =
                q["route"].as_array().unwrap().iter().map(|p| (p[0].as_f64().unwrap(), p[1].as_f64().unwrap())).collect();
            let got: Vec<(f64, f64)> = route.iter().map(|p| (p.x, p.y)).collect();
            if got != expect {
                bad += 1;
                if bad <= 3 {
                    eprintln!("query {n} differs: expected {} points, got {}", expect.len(), got.len());
                    eprintln!("  expected {:?}", &expect[..expect.len().min(4)]);
                    eprintln!("  got      {:?}", &got[..got.len().min(4)]);
                }
            }
        }
        assert_eq!(bad, 0, "scene {} routes differ", scene["seed"]);
    }
}
