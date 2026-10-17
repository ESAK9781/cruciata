#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
use crate::paint::Straight as _;
mod assets;
mod atlas;
mod cluster;
mod extras;
mod fx;
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
mod site;
mod terrain;
mod mapatlas;
mod menu;
mod emblem;
mod lobby_ui;
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
use image::ImageEncoder;

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

/// Render the game icon (assets/icons/favicon.svg) to PNG sizes, an .ico and a macOS iconset.
fn make_icons(out: &std::path::Path) {
    let svg = std::fs::read_to_string(assets::assets_dir().join("icons").join("favicon.svg")).expect("favicon.svg");
    let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).expect("svg");
    let render = |px: u32| -> Vec<u8> {
        let mut pm = resvg::tiny_skia::Pixmap::new(px, px).unwrap();
        let k = px as f32 / tree.size().width();
        resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(k, k), &mut pm.as_mut());
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(pm.data(), px, px, image::ExtendedColorType::Rgba8)
            .expect("png");
        png
    };
    std::fs::create_dir_all(out.join("iconset")).unwrap();
    let mut ico_entries: Vec<(u32, Vec<u8>)> = Vec::new();
    for px in [16u32, 32, 48, 64, 128, 256, 512, 1024] {
        let png = render(px);
        std::fs::write(out.join(format!("icon-{px}.png")), &png).unwrap();
        if px <= 256 {
            ico_entries.push((px, png));
        }
    }
    for (name, px) in [("icon_16x16", 16u32), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64), ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512), ("icon_512x512", 512), ("icon_512x512@2x", 1024)] {
        std::fs::write(out.join("iconset").join(format!("{name}.png")), render(px)).unwrap();
    }
    let mut ico: Vec<u8> = vec![0, 0, 1, 0];
    ico.extend_from_slice(&(ico_entries.len() as u16).to_le_bytes());
    let mut offset = 6 + 16 * ico_entries.len() as u32;
    for (px, png) in &ico_entries {
        let d = if *px >= 256 { 0u8 } else { *px as u8 };
        ico.extend_from_slice(&[d, d, 0, 0, 1, 0, 32, 0]);
        ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
        ico.extend_from_slice(&offset.to_le_bytes());
        offset += png.len() as u32;
    }
    for (_, png) in &ico_entries {
        ico.extend_from_slice(png);
    }
    std::fs::write(out.join("cruciata.ico"), ico).unwrap();
    println!("icons written to {}", out.display());
}

fn main() -> eframe::Result<()> {
    if let Some(i) = std::env::args().position(|a| a == "--make-icons") {
        let out = std::env::args().nth(i + 1).unwrap_or_else(|| "icons".into());
        make_icons(std::path::Path::new(&out));
        return Ok(());
    }
    if let Some(i) = std::env::args().position(|a| a == "--dump-ground") {
        let out = std::env::args().nth(i + 1).unwrap_or_else(|| "ground.png".into());
        let t = terrain::ground_tile(0);
        let raw: Vec<u8> = t.pixels.iter().flat_map(|p| p.straight()).collect();
        image::RgbaImage::from_raw(512, 512, raw).unwrap().save(out).unwrap();
        return Ok(());
    }
    if std::env::args().any(|a| a == "--audit-keys") {
        audit();
        return Ok(());
    }
    let args = parse_args();
    let size = args.size.unwrap_or((1360.0, 800.0));
    let icon = image::load_from_memory(include_bytes!("../../../packaging/icons/icon-256.png")).ok().map(|i| {
        let rgba = i.to_rgba8();
        egui::IconData { width: rgba.width(), height: rgba.height(), rgba: rgba.into_raw() }
    });
    let mut viewport = egui::ViewportBuilder::default().with_inner_size([size.0, size.1]).with_title("Cruciata");
    if let Some(icon) = icon {
        viewport = viewport.with_icon(icon);
    }
    let options = eframe::NativeOptions {
        viewport,
        // Debug: `CRUCIATA_NOVSYNC=1` uncaps the frame rate to measure real frame cost.
        vsync: std::env::var_os("CRUCIATA_NOVSYNC").is_none(),
        ..Default::default()
    };
    eframe::run_native("Cruciata", options, Box::new(move |cc| Ok(Box::new(render::App::new(cc, args.clone())))))
}
