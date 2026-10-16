//! Saved games: the same JSON document the web version writes
//! (`{version, world, camera, state, uid}`), so chronicles move between them.

use crate::data::data;
use crate::fog::Fog;
use crate::model::*;
use crate::sim::Sim;
use serde_json::{json, Value};
use std::collections::HashMap;

fn fog_json(f: &Fog) -> Value {
    json!({ "explored": f.explored, "known": f.known })
}

/// Fog saved either as a JSON array or as the object a JS typed array stringifies to.
fn explored_from(v: &Value, n: usize) -> Vec<u8> {
    let mut out = vec![0u8; n];
    match v {
        Value::Array(a) => {
            for (i, x) in a.iter().enumerate().take(n) {
                out[i] = x.as_u64().unwrap_or(0) as u8;
            }
        }
        Value::Object(m) => {
            for (k, x) in m {
                if let Ok(i) = k.parse::<usize>() {
                    if i < n {
                        out[i] = x.as_u64().unwrap_or(0) as u8;
                    }
                }
            }
        }
        _ => {}
    }
    out
}

fn restore_fog(fog: &mut Fog, v: Option<&Value>) {
    let Some(v) = v else { return };
    let n = (fog.cols * fog.rows) as usize;
    let explored = v.get("explored").map(|e| explored_from(e, n)).unwrap_or_else(|| vec![0; n]);
    let known: HashMap<u32, Building> = v
        .get("known")
        .and_then(|k| k.as_object())
        .map(|m| m.iter().filter_map(|(k, b)| Some((k.parse::<u32>().ok()?, serde_json::from_value::<Building>(b.clone()).ok()?))).collect())
        .unwrap_or_default();
    fog.restore(&explored, known);
}

impl Sim {
    pub fn save_json(&self, camera: (f64, f64, f64)) -> Value {
        let mut state = self.state.clone();
        for u in state.units.iter_mut() {
            u.path = Vec::new();
            u.path_goal = None;
            u.path_request = None;
            u.path_timer = 0.0;
        }
        let mut sv = serde_json::to_value(&state).unwrap();
        if let Some(m) = sv.as_object_mut() {
            m.remove("groundCover");
            m.insert("fog".into(), fog_json(&self.fog));
            m.insert("enemyFog".into(), fog_json(&self.enemy_fog));
            m.insert("militiaFog".into(), fog_json(&self.militia_fog));
        }
        json!({ "version": 3, "world": [self.geo.w, self.geo.h], "camera": { "x": camera.0, "y": camera.1, "zoom": camera.2 }, "state": sv, "uid": self.uid })
    }

    /// Rebuild a game from a save. Returns the sim and the saved camera.
    pub fn restore_json(v: &Value) -> Result<(Sim, (f64, f64, f64)), String> {
        if v["version"].as_f64() != Some(3.0) {
            return Err("unsupported save version".into());
        }
        let st = v.get("state").ok_or("missing state")?;
        let mut state: State = serde_json::from_value(st.clone()).map_err(|e| e.to_string())?;
        if state.level >= data().levels.len() || state.result.is_some() {
            return Err("save cannot be resumed".into());
        }
        let d = data();
        for b in state.buildings.iter_mut() {
            if b.team == 1 && b.architecture.is_none() {
                b.architecture = Some("islamic".into());
            }
            if matches!(b.kind, BKind::Greatengine | BKind::Colossus) {
                let s = d.bld(b.kind);
                b.w = s.w;
                b.h = s.h;
                b.r = s.w.max(s.h) / 2.0;
            }
            if b.kind == BKind::Wall || b.kind == BKind::Gate || b.gate == Some(true) {
                let reinforced = if b.kind == BKind::Wall { d.bld(BKind::Wall).hp } else { d.bld(BKind::Gate).hp };
                if b.max_hp < reinforced {
                    b.hp *= reinforced / b.max_hp;
                    b.max_hp = reinforced;
                }
            }
        }
        if state.resource_scale != 3.0 {
            for n in state.nodes.iter_mut() {
                n.remaining *= 3.0;
                n.max *= 3.0;
            }
            state.resource_scale = 3.0;
        }
        let w = v["world"][0].as_f64().ok_or("world")?;
        let h = v["world"][1].as_f64().ok_or("world")?;
        let uid = v["uid"].as_u64().unwrap_or(0) as u32;
        let cam = (v["camera"]["x"].as_f64().unwrap_or(state.buildings[0].x), v["camera"]["y"].as_f64().unwrap_or(state.buildings[0].y), v["camera"]["zoom"].as_f64().unwrap_or(1.0));
        let _ = (w, h);
        let mut sim = Sim::new(state, Vec::new(), uid);
        sim.make_world(false);
        restore_fog(&mut sim.fog, st.get("fog"));
        restore_fog(&mut sim.enemy_fog, st.get("enemyFog"));
        restore_fog(&mut sim.militia_fog, st.get("militiaFog"));
        sim.refresh_fog();
        sim.rebuild_navigation();
        sim.state.roads = sim.plan_roads();
        sim.state.paused = true;
        Ok((sim, cam))
    }
}
