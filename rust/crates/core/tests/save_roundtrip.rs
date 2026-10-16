use cruciata_core::sim::{Sim, STEP};

#[test]
fn save_and_restore_continue_playing() {
    let mut a = Sim::start_level(1, None, "normal", false);
    a.state.paused = false;
    for _ in 0..900 {
        a.update(STEP);
    }
    let doc = a.save_json((1000.0, 900.0, 0.8));
    let text = serde_json::to_string(&doc).unwrap();
    let (mut b, cam) = Sim::restore_json(&serde_json::from_str(&text).unwrap()).unwrap();
    assert_eq!(cam.0, 1000.0);
    assert_eq!(a.state.units.len(), b.state.units.len());
    assert_eq!(a.state.buildings.len(), b.state.buildings.len());
    assert_eq!(a.state.resources, b.state.resources);
    assert_eq!(a.fog.explored, b.fog.explored);
    b.state.paused = false;
    for _ in 0..600 {
        b.update(STEP);
    }
    assert!(b.state.time > a.state.time);
}
