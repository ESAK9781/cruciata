#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
mod assets;
mod atlas;
mod cluster;
mod keys;
mod paint;
mod render;
mod view;
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

fn main() -> eframe::Result<()> {
    let args = parse_args();
    let size = args.size.unwrap_or((1360.0, 800.0));
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([size.0, size.1]).with_title("Cruciata"),
        ..Default::default()
    };
    eframe::run_native("Cruciata", options, Box::new(move |cc| Ok(Box::new(render::App::new(cc, args.clone())))))
}
