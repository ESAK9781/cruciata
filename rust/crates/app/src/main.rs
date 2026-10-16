#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
mod assets;
mod atlas;
mod cluster;
mod keys;
mod paint;
mod render;
mod view;
mod style;
mod chrome;
mod mapui;
mod gate3d;
mod audio;
mod wall3d;
mod terrain;
mod menu;
mod store;
mod game;
mod hud;
mod input;
mod overlay;
mod panel;
mod pick;
mod text;
mod ui_state;

use eframe::egui;

#[derive(Default, Clone)]
pub struct Args {
    pub shot: Option<String>,
    pub level: usize,
    pub quick: Option<u64>,
    pub seconds: f64,
    pub zoom: Option<f64>,
    pub at: Option<(f64, f64)>,
    pub size: Option<(f32, f32)>,
    pub run: Vec<String>,
}

fn parse_args() -> Args {
    let mut a = Args::default();
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        let mut next = || it.next().unwrap_or_default();
        match k.as_str() {
            "--shot" => a.shot = Some(next()),
            "--level" => a.level = next().parse().unwrap_or(0),
            "--quick" => a.quick = next().parse().ok(),
            "--seconds" => a.seconds = next().parse().unwrap_or(0.0),
            "--zoom" => a.zoom = next().parse().ok(),
            "--at" => {
                let s = next();
                let mut p = s.split(',').filter_map(|x| x.parse::<f64>().ok());
                if let (Some(x), Some(y)) = (p.next(), p.next()) {
                    a.at = Some((x, y));
                }
            }
            "--do" => a.run = next().split(';').map(String::from).collect(),
            "--size" => {
                let s = next();
                let mut p = s.split('x').filter_map(|x| x.parse::<f32>().ok());
                if let (Some(w), Some(h)) = (p.next(), p.next()) {
                    a.size = Some((w, h));
                }
            }
            _ => {}
        }
    }
    a
}

fn audit() {
    use cruciata_core::model::*;
    let atlas = atlas::Atlas::load(assets::assets_dir()).expect("atlas");
    let mut missing: std::collections::BTreeMap<String, usize> = Default::default();
    let mut total = 0usize;
    for level in 0..6 {
        let mut sim = cruciata_core::sim::Sim::start_level(level, None, "normal", false);
        sim.state.paused = false;
        for _ in 0..(20 * 30) {
            sim.update(cruciata_core::sim::STEP);
        }
        let mut check = |k: String| {
            total += 1;
            if atlas.frame(&k).is_none() {
                *missing.entry(k).or_default() += 1;
            }
        };
        for u in &sim.state.units {
            let k = match u.ty {
                UType::Ram | UType::Ballista | UType::Trebuchet => keys::siege_machine_key(u, 0.0, u.angle),
                UType::Pilgrim | UType::Merchant => keys::caravan_frame(u, 0.0, u.angle),
                _ => keys::person_key(u, u.angle),
            };
            check(k);
        }
        for b in &sim.state.buildings {
            if matches!(b.kind, BKind::Wall | BKind::Bastionwall | BKind::Colossus) {
                continue;
            }
            if b.kind == BKind::Greatengine {
                check(keys::great_engine_key(b, 0.0));
            } else {
                check(keys::building_key(b));
            }
        }
    }
    println!("{} lookups, {} distinct missing", total, missing.len());
    for (k, n) in missing.iter().take(40) {
        println!("{n:4} {k}");
    }
}

fn main() -> eframe::Result<()> {
    if std::env::args().any(|a| a == "--audit-keys") {
        audit();
        return Ok(());
    }
    let args = parse_args();
    let size = args.size.unwrap_or((1360.0, 800.0));
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([size.0, size.1]).with_title("Cruciata"),
        ..Default::default()
    };
    eframe::run_native("Cruciata", options, Box::new(move |cc| Ok(Box::new(render::App::new(cc, args.clone())))))
}
