//! The application shell and the world renderer.

use crate::assets::assets_dir;
use crate::atlas::Atlas;
use crate::cluster::{clustered, Clusters};
use crate::game::Game;
use crate::hud::{self, Action, Frame};
use crate::{chrome, mapui};
use crate::style::Icons;
use crate::input::{self, InputState};
use crate::keys::*;
use crate::overlay::{self, FogTex, Settings};
use crate::paint::{col, with_alpha, Batch, Canvas};
use crate::panel;
use crate::ui_state::*;
use crate::view::View;
use crate::menu::{Menu, Out, Screen};
use crate::store::{self, Progress};
use crate::Args;
use std::sync::mpsc::{channel, Receiver};
use cruciata_core::build::COLOSSUS_MIN_RANGE;
use cruciata_core::data::data;
use cruciata_core::model::*;
use cruciata_core::nav::Pt;
use cruciata_core::sim::{Event, Sim, STEP};
use eframe::egui::{self, Color32, Rect, Sense, Stroke, TextureHandle};
use std::collections::{HashMap, HashSet};

const ANIM_SCALE: f64 = 0.5;
const CLUSTER_SCALE: f64 = 0.25;

pub struct App {
    pub game: Game,
    pub atlas: Atlas,
    pub view: View,
    pub args: Args,
    pub ui: UiState,
    input: InputState,
    fog_tex: FogTex,
    pub settings: Settings,
    clusters: Clusters,
    visual_angle: HashMap<u32, f64>,
    standard_stop: HashMap<u32, (bool, f64)>,
    soft_shadow: TextureHandle,
    frames: u64,
    shot_state: ShotState,
    last_time: f64,
    menu: Menu,
    progress: Progress,
    /// Slot of the running quickmatch (None for the campaign).
    slot: Option<usize>,
    loader: Option<Receiver<Result<Game, String>>>,
    save_clock: f64,
    result_handled: bool,
    terrain: Option<(u64, TextureHandle)>,
    rocks: Option<TextureHandle>,
    water: Option<TextureHandle>,
    tile: Option<TextureHandle>,
    walls: crate::wall3d::WallCache,
    audio: Option<crate::audio::Audio>,
    gates: crate::gate3d::GateCache,
    desync_warned: bool,
    fps_mark: Option<(std::time::Instant, u32)>,
    icons: Icons,
    last_volumes: (f32, f32, bool),
}

#[derive(PartialEq)]
enum ShotState {
    Off,
    Waiting(u32),
    Requested,
    Done,
}

fn make_shadow(ctx: &egui::Context) -> TextureHandle {
    let (w, h) = (64usize, 40usize);
    let mut px = vec![Color32::TRANSPARENT; w * h];
    for y in 0..h {
        for x in 0..w {
            let dx = (x as f32 + 0.5 - 32.0) / 30.0;
            let dy = (y as f32 + 0.5 - 20.0) / 17.0;
            let d = dx * dx + dy * dy;
            if d <= 1.0 {
                let edge = ((1.0 - d.sqrt()) * 4.0).clamp(0.0, 1.0);
                px[y * w + x] = Color32::from_rgba_unmultiplied(0x25, 0x33, 0x23, (0.19 * 255.0 * edge) as u8);
            }
        }
    }
    ctx.load_texture("soft-shadow", egui::ColorImage { size: [w, h], pixels: px }, egui::TextureOptions::LINEAR)
}

fn start_sim(args: &Args) -> Sim {
    let mut sim = match args.quick {
        Some(seed) => Sim::start_level(0, Some(serde_json::json!({ "seed": seed, "width": 6400, "height": 4400, "biome": 0 })), "normal", false),
        None => Sim::start_level(args.level, None, "normal", false),
    };
    sim.state.paused = false;
    sim
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>, args: Args) -> App {
        hud::apply_theme(&cc.egui_ctx);
        crate::style::install_fonts(&cc.egui_ctx);
        let atlas = Atlas::load(assets_dir()).expect("sprite atlas");
        let mut sim = start_sim(&args);
        let (w, h) = (sim.geo.w, sim.geo.h);
        let mut view = View::new(w, h);
        if let Some(b) = sim.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == 0) {
            view.cx = b.x + 150.0;
            view.cy = b.y - 100.0;
        }
        if let Some(z) = args.zoom {
            view.zoom = z;
        }
        if let Some((x, y)) = args.at {
            view.cx = x;
            view.cy = y;
        }
        for _ in 0..(args.seconds / STEP) as usize {
            sim.update(STEP);
        }
        let mut app_ui = UiState::new();
        let mut focus: Option<(f64, f64)> = None;
        let mut follow = false;
        let mut screen_req: Option<String> = None;
        let mut game = Game::solo(sim);
        for cmd in args.run.clone() {
            let (k, v) = cmd.split_once(':').unwrap_or((cmd.as_str(), ""));
            match k {
                "focus" => {
                    let kind = match v { "gate" => BKind::Gate, "tower" => BKind::Tower, _ => BKind::Wall };
                    if let Some(b) = game.sim.state.buildings.iter().find(|b| b.kind == kind && b.hp > 0.0 && b.team == 1) {
                        focus = Some((b.x, b.y));
                    }
                }
                "standard" => {
                    if let Some(u) = game.sim.state.units.iter().find(|u| u.team == 0 && u.ty == UType::Standard) {
                        app_ui.selected = HashSet::from([u.id]);
                        follow = true;
                    }
                }
                "orderrel" => {
                    let mut p = v.split(',').filter_map(|x| x.parse::<f64>().ok());
                    if let (Some(dx), Some(dy), Some(u)) = (p.next(), p.next(), game.sim.state.units.iter().find(|u| u.team == 0 && u.ty == UType::Standard).map(|u| (u.x, u.y))) {
                        let g = Pt::new(u.0 + dx, u.1 + dy);
                        let t = input::resolve_targets(&game, g);
                        app_ui.issue_order(&mut game, g, false, false, t.enemy, t.node, t.building, t.escort);
                    }
                }
                "settings" => app_ui.show_settings = true,
                "debug" => app_ui.show_debug = true,
                "help" => app_ui.show_help = true,
                "menu" => app_ui.show_menu = true,
                "screen" => screen_req = Some(v.to_string()),
                "reveal" => {
                    for v in game.sim.fog.explored.iter_mut() {
                        *v = 1;
                    }
                    for v in game.sim.fog.visible.iter_mut() {
                        *v = 1;
                    }
                    game.sim.fog.revision += 1;
                }
                "army" => app_ui.select_army(&game),
                "workers" => app_ui.select_workers(&game),
                "tab" => app_ui.tab = match v { "build" => Tab::Settlement, "research" => Tab::Research, _ => Tab::Army },
                "b" => {
                    if let Some(b) = game.sim.state.buildings.iter().find(|b| b.team == 0 && crate::keys::bkind_name(b.kind) == v) {
                        app_ui.sel_buildings = vec![b.id];
                    }
                }
                "order" => {
                    let mut p = v.split(',').filter_map(|x| x.parse::<f64>().ok());
                    if let (Some(x), Some(y)) = (p.next(), p.next()) {
                        let t = input::resolve_targets(&game, Pt::new(x, y));
                        app_ui.issue_order(&mut game, Pt::new(x, y), false, false, t.enemy, t.node, t.building, t.escort);
                    }
                }
                "wait" => {
                    for _ in 0..(v.parse::<f64>().unwrap_or(1.0) / STEP) as usize {
                        game.sim.update(STEP);
                    }
                }
                _ => {}
            }
        }
        app_ui.show_menu = app_ui.show_menu || args.shot.is_none() && args.run.is_empty() && args.quick.is_none() && args.level == 0 && args.at.is_none();
        if follow {
            if let Some(u) = game.sim.state.units.iter().find(|u| u.team == 0 && u.ty == UType::Standard) {
                focus = Some((u.x, u.y));
            }
        }
        if let Some((x, y)) = focus {
            view.cx = x;
            view.cy = y;
        }
        let mut menu0 = Menu::new();
        match screen_req.as_deref() {
            Some("campaign") => menu0.screen = Screen::Campaign,
            Some("slots") => menu0.screen = Screen::Slots,
            Some("creation") => menu0.screen = Screen::Creation(0),
            Some("lan") => menu0.open_lan_hub(),
            _ => {}
        }
        let shot_state = if args.shot.is_some() { ShotState::Waiting(0) } else { ShotState::Off };
        App {
            soft_shadow: make_shadow(&cc.egui_ctx),
            game,
            atlas,
            view,
            args,
            ui: {
                let mut u = app_ui;
                u.orders_collapsed = Progress::load().orders_collapsed;
                u
            },
            input: InputState::default(),
            fog_tex: FogTex::new(),
            settings: { let p = Progress::load(); Settings { music: p.music, effects: p.effects, battle_sounds: p.battle_sounds, gore: p.gore } },
            clusters: Clusters::default(),
            visual_angle: HashMap::new(),
            standard_stop: HashMap::new(),
            frames: 0,
            shot_state,
            last_time: 0.0,
            menu: menu0,
            progress: Progress::load(),
            slot: None,
            loader: None,
            save_clock: 0.0,
            result_handled: false,
            terrain: None,
            rocks: None,
            water: None,
            tile: None,
            walls: Default::default(),
            audio: None,
            gates: Default::default(),
            desync_warned: false,
            fps_mark: None,
            icons: Icons::load(&cc.egui_ctx, &assets_dir()),
            last_volumes: (-1.0, -1.0, true),
        }
    }

    fn begin_load(&mut self, label: &str, job: impl FnOnce() -> Result<Game, String> + Send + 'static) {
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            let _ = tx.send(job());
        });
        self.loader = Some(rx);
        self.menu.screen = Screen::Loading(label.to_string());
        self.ui.show_menu = true;
    }

    fn install(&mut self, g: Game) {
        let rect = self.view.rect;
        self.view = View::new(g.sim.geo.w, g.sim.geo.h);
        self.view.rect = rect;
        let me = g.me;
        if let Some(b) = g.sim.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == me) {
            self.view.cx = b.x + 150.0;
            self.view.cy = b.y - 100.0;
        }
        self.view.zoom = 0.8;
        self.view.update();
        let (cx, cy) = (self.view.cx, self.view.cy);
        self.view.center_tight(cx, cy);
        self.game = g;
        self.ui = UiState::new();
        self.ui.orders_collapsed = self.progress.orders_collapsed;
        self.clusters = Clusters::default();
        self.visual_angle.clear();
        self.fog_tex = FogTex::new();
        self.result_handled = false;
        self.desync_warned = false;
        self.save_clock = 0.0;
        self.menu.screen = Screen::Main;
        self.menu.close_lan();
    }

    fn save_now(&mut self) {
        if self.game.is_lan() || self.game.sim.state.result.is_some() {
            return;
        }
        let doc = self.game.sim.save_json((self.view.cx, self.view.cy, self.view.zoom));
        store::write_save(self.slot, &doc);
        self.ui.toast("Your settlement and company have been recorded.");
    }

    fn start_campaign(&mut self, level: usize, diff: String) {
        self.slot = None;
        self.begin_load("Raising the standards...", move || {
            let mut sim = Sim::start_level(level, None, &diff, false);
            sim.state.paused = false;
            Ok(Game::solo(sim))
        });
    }

    fn handle_menu(&mut self, out: Out) {
        match out {
            Out::None => {}
            Out::Campaign(l, d) => self.start_campaign(l, d),
            Out::ResumeCampaign => self.resume(None),
            Out::Quick(cfg, slot) => {
                self.slot = Some(slot);
                self.begin_load("Raising the standards...", move || {
                    let diff = cfg["difficulty"].as_str().unwrap_or("normal").to_string();
                    let mut sim = Sim::start_level(0, Some(cfg), &diff, false);
                    sim.state.paused = false;
                    Ok(Game::solo(sim))
                });
            }
            Out::ResumeQuick(i) => self.resume(Some(i)),
            Out::HostLan => {
                let cfg = self.menu.lan_form.config();
                let label = self.menu.lan_form.label();
                match cruciata_net::session::Host::start(self.player_name(), label, cfg) {
                    Ok(h) => {
                        self.menu.lan.browser = None;
                        self.menu.lan.host = Some(h);
                        self.menu.screen = Screen::LanHost;
                    }
                    Err(e) => self.menu.lan.error = Some(format!("Could not start hosting: {e}")),
                }
            }
            Out::JoinLan(addr) => {
                let name = self.player_name();
                self.menu.lan.browser = None;
                self.begin_load("Joining the game...", move || {
                    let s = cruciata_net::session::join(addr, &name)?;
                    lan_game(s)
                });
            }
            Out::Settings => self.ui.show_settings = true,
            Out::Resume => {
                self.ui.show_menu = false;
                if !self.game.is_lan() {
                    self.game.sim.state.paused = false;
                }
            }
            Out::Leave => {
                if let Some(ls) = self.game.lock.as_mut() {
                    ls.leave();
                }
                self.game.lock = None;
                self.game.left = true;
                self.game.sim.state.paused = true;
            }
            Out::Quit => std::process::exit(0),
        }
    }

    fn player_name(&self) -> String {
        if self.progress.player_name.is_empty() {
            cruciata_net::session::computer_name()
        } else {
            self.progress.player_name.clone()
        }
    }

    fn resume(&mut self, slot: Option<usize>) {
        let Some(doc) = store::read_save(slot) else {
            self.ui.toast("No saved game found.");
            return;
        };
        match Sim::restore_json(&doc) {
            Ok((mut sim, cam)) => {
                sim.state.paused = false;
                self.slot = slot;
                self.install(Game::solo(sim));
                self.view.cx = cam.0;
                self.view.cy = cam.1;
                self.view.zoom = cam.2;
                self.view.update();
                self.ui.show_menu = false;
            }
            Err(e) => self.menu.lan.error = Some(format!("Could not load that save: {e}")),
        }
    }

    fn shot_step(&mut self, ctx: &egui::Context) {
        if let Some(path) = self.args.shot.clone() {
            match self.shot_state {
                ShotState::Waiting(n) => {
                    let idle = self.atlas.pending_pages() == 0;
                    self.shot_state = if (idle && n > 8) || n > 600 {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot);
                        ShotState::Requested
                    } else {
                        ShotState::Waiting(n + 1)
                    };
                }
                ShotState::Requested => {
                    let img = ctx.input(|i| i.events.iter().find_map(|e| if let egui::Event::Screenshot { image, .. } = e { Some(image.clone()) } else { None }));
                    if let Some(img) = img {
                        let [w, h] = img.size;
                        let mut rgba = Vec::with_capacity(w * h * 4);
                        for p in &img.pixels {
                            rgba.extend_from_slice(&p.to_array());
                        }
                        let _ = image::save_buffer(&path, &rgba, w as u32, h as u32, image::ColorType::Rgba8);
                        self.shot_state = ShotState::Done;
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
                _ => {}
            }
        }
    }

    fn ensure_terrain(&mut self, ctx: &egui::Context) {
        let s = &self.game.sim.state;
        let key = (s.seed as u64) ^ ((self.game.sim.geo.w as u64) << 20) ^ ((self.game.sim.geo.h as u64) << 36) ^ ((self.biome() as u64) << 58) ^ ((s.level as u64) << 52) ^ if s.mode == "quickmatch" { 1 } else { 0 };
        if matches!(&self.terrain, Some((k, _)) if *k == key) {
            return;
        }
        let coast = s.mode != "quickmatch";
        let (mut img, water) = crate::terrain::bake(s, self.game.sim.geo.w, self.game.sim.geo.h, self.biome(), coast);
        self.water = Some(ctx.load_texture("water", water, egui::TextureOptions::LINEAR));
        let repeat = egui::TextureOptions { wrap_mode: egui::TextureWrapMode::Repeat, ..egui::TextureOptions::LINEAR };
        self.tile = Some(ctx.load_texture("ground-tile", crate::terrain::ground_tile(self.biome()), repeat));
        if data().levels[s.level].kind == "survival" {
            for p in img.pixels.iter_mut() {
                let [r, g, b, _] = p.to_srgba_unmultiplied();
                let mix = |c: u8, t: u8| (c as f32 * (1.0 - 0.2) + t as f32 * 0.2) as u8;
                *p = Color32::from_rgb(mix(r, 0xdc), mix(g, 0xe2), mix(b, 0xcc));
            }
        }
        self.terrain = Some((key, ctx.load_texture("terrain", img, egui::TextureOptions::LINEAR)));
        let rocks = crate::terrain::bake_rocks(s, self.game.sim.geo.w, self.game.sim.geo.h);
        self.rocks = Some(ctx.load_texture("rocks", rocks, egui::TextureOptions::LINEAR));
    }

    fn biome(&self) -> i32 {
        let s = &self.game.sim.state;
        if let Some(b) = s.config.as_ref().and_then(|c| c.get("biome")).and_then(|b| b.as_f64()) {
            return b as i32;
        }
        match data().levels[s.level].terrain {
            2 => 3,
            t if t >= 3 => 2,
            t => t,
        }
    }

    fn ground_color(&self) -> Color32 {
        match self.biome() {
            2 => col("#cba766"),
            3 => col("#aabbb4"),
            _ => col("#628444"),
        }
    }

    fn sync_audio(&mut self) {
        if !self.game.is_lan() {
            self.game.sim.settings.gore = self.settings.gore;
        }
        let want = (self.settings.effects, self.settings.music, self.settings.battle_sounds);
        if let Some(a) = self.audio.as_mut() {
            if want != self.last_volumes {
                a.enabled = want.2;
                a.set_volumes(want.0, want.1);
                self.last_volumes = want;
                self.progress.music = want.1;
                self.progress.effects = want.0;
                self.progress.battle_sounds = want.2;
                self.progress.gore = self.settings.gore;
                self.progress.save();
            }
            a.update();
        }
        if self.ui.sound_select {
            self.ui.sound_select = false;
            if let Some(a) = self.audio.as_mut() {
                a.play("select", 1.0);
            }
        }
    }

    fn handle_events(&mut self) {
        let events = std::mem::take(&mut self.game.events);
        for e in events {
            match e {
                Event::Toast(t) => self.ui.toast(t),
                Event::Alert { x, y, team, .. } => {
                    if team == self.game.me {
                        self.ui.alert = Some((x, y, self.ui.clock));
                        if let Some(a) = self.ui.alerts.iter_mut().find(|a| ((a.0 - x).powi(2) + (a.1 - y).powi(2)).sqrt() < 500.0) {
                            *a = (x, y, self.ui.clock);
                        } else {
                            self.ui.alerts.push((x, y, self.ui.clock));
                        }
                    }
                }
                Event::Sound { kind, x, y, team } => {
                    let Some(a) = self.audio.as_mut() else { continue };
                    let mut volume = 1.0f32;
                    if let (Some(x), Some(y)) = (x, y) {
                        if team.map(|t| t != self.game.me).unwrap_or(false) && !self.game.sees(x, y) {
                            continue;
                        }
                        let reach = if kind.starts_with("great-") || kind == "explosion" { 3600.0 } else { 1000.0 };
                        let d = ((x - self.view.cx).powi(2) + (y - self.view.cy).powi(2)).sqrt();
                        volume = (1.0 - d / reach).clamp(0.0, 1.0) as f32;
                    }
                    a.play(&kind, volume);
                }
                Event::Impact { x, y, heavy } => {
                    self.ui.impacts.push((x, y, self.ui.clock, heavy));
                    if self.ui.impacts.len() > 60 {
                        self.ui.impacts.remove(0);
                    }
                    let d = ((x - self.view.cx).powi(2) + (y - self.view.cy).powi(2)).sqrt();
                    let power = if heavy { 14.0 } else { 5.0 } * (1.0 - d / 3600.0).clamp(0.0, 1.0);
                    self.ui.shake = self.ui.shake.max(power);
                }
                Event::Finished(_) => {}
                _ => {}
            }
        }
    }

    /// Animated sea lapping/ripples and river flow lines (web `terrainDetails`).
    fn draw_water_motion(&self, painter: &egui::Painter, view: &crate::view::View) {
        use cruciata_core::world::{bridge_y, coast_x, is_river_map, river_x};
        let sim = &self.game.sim;
        let time = sim.state.time;
        let (w, h) = (sim.geo.w, sim.geo.h);
        let z = view.zoom as f32;
        let seg = |pts: Vec<egui::Pos2>, width: f64, c: Color32| {
            if pts.len() > 1 {
                painter.add(egui::Shape::line(pts, egui::Stroke::new((width as f32 * z).max(0.5), c)));
            }
        };
        let (y0, y1) = (view.y.max(0.0), (view.y + view.h).min(h));
        if y1 <= y0 {
            return;
        }
        if sim.state.mode != "quickmatch" && data().levels[sim.state.level].terrain == 0 {
            for band in 0..5 {
                let phase = (time * 9.0 + band as f64 * 38.0) % 190.0;
                let mut pts = Vec::new();
                let mut y = (y0 / 12.0).floor() * 12.0;
                while y < y1 + 12.0 {
                    let cx = coast_x(y);
                    let off = -190.0 + phase + (y / 54.0 + time * 0.65 + band as f64).sin() * 4.0;
                    pts.push(view.to_screen((cx + off).clamp(0.0, cx - 8.0), y));
                    y += 12.0;
                }
                let a = ((phase / 190.0 * std::f64::consts::PI).sin() * 0.28 * 255.0) as u8;
                seg(pts, 0.7 + phase / 150.0, Color32::from_rgba_unmultiplied(220, 244, 226, a));
            }
            let mut yy = (y0 / 75.0).floor() * 75.0;
            while yy < y1 {
                let mut xx = (view.x.max(0.0) / 100.0).floor() * 100.0;
                while xx < (view.x + view.w).min(coast_x(yy) - 50.0) {
                    let dy = (xx * 0.03 + time).sin() * 3.0;
                    seg(vec![view.to_screen(xx, yy + dy), view.to_screen(xx + 20.0, yy + dy)], 0.8, Color32::from_rgba_unmultiplied(0x72, 0xb8, 0xbc, 0x44));
                    xx += 100.0;
                }
                yy += 75.0;
            }
        }
        if is_river_map(&sim.state) {
            let by = bridge_y(&sim.state, h);
            let rx = |y: f64| river_x(&sim.state, w, y);
            for band in 0..5 {
                let mut y = (y0 / 90.0).floor() * 90.0 - 90.0;
                while y < y1 + 90.0 {
                    let yy = y + ((time * 22.0 + band as f64 * 17.0) % 90.0);
                    let x = rx(yy) + (band as f64 - 2.0) * 13.0;
                    seg(
                        vec![
                            view.to_screen(x, yy),
                            view.to_screen(x + (yy * 0.04 + time).sin() * 3.0, yy + 17.0),
                            view.to_screen(x + 3.0, yy + 25.0),
                        ],
                        1.0,
                        Color32::from_rgba_unmultiplied(0xd3, 0xed, 0xe5, 0x44),
                    );
                    y += 90.0;
                }
            }
            for side in [-1.0f64, 1.0] {
                let mut pts: Vec<egui::Pos2> = Vec::new();
                let bank = Color32::from_rgba_unmultiplied(0xd8, 0xdf, 0xba, 0xaa);
                let mut y = (y0 / 12.0).floor() * 12.0;
                while y < y1 + 12.0 {
                    if (y - by).abs() < 53.0 {
                        seg(std::mem::take(&mut pts), 2.0, bank);
                    } else {
                        pts.push(view.to_screen(rx(y) + side * 49.0 + (y * 0.04 + time * 1.2).sin() * 1.8, y));
                    }
                    y += 12.0;
                }
                seg(pts, 2.0, bank);
            }
        }
    }

    fn draw_world(&mut self, ui: &mut egui::Ui, rect: Rect, dt: f64) {
        self.view.rect = rect;
        self.view.update();
        let mut view = self.view.clone();
        if self.ui.shake > 0.0 {
            view.x += (self.game.sim.state.time * 83.0).sin() * self.ui.shake / view.zoom;
            view.y += (self.game.sim.state.time * 97.0).cos() * self.ui.shake * 0.7 / view.zoom;
        }
        let painter = ui.painter_at(rect);
        let ground = self.ground_color();
        let biome = self.biome();
        painter.rect_filled(rect, 0.0, Color32::BLACK);
        let _ = ground;
        if let Some((_, t)) = &self.terrain {
            let tl = view.to_screen(0.0, 0.0);
            let br = view.to_screen(self.game.sim.geo.w, self.game.sim.geo.h);
            painter.image(t.id(), Rect::from_min_max(tl, br), Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
            // Ground pattern over the land (repeats every 512 world units).
            if let Some(tile) = &self.tile {
                let (x0, y0) = (view.x.max(0.0), view.y.max(0.0));
                let (x1, y1) = ((view.x + view.w).min(self.game.sim.geo.w), (view.y + view.h).min(self.game.sim.geo.h));
                if x1 > x0 && y1 > y0 {
                    let a = view.to_screen(x0, y0);
                    let b = view.to_screen(x1, y1);
                    let uv = Rect::from_min_max(egui::pos2((x0 / 512.0) as f32, (y0 / 512.0) as f32), egui::pos2((x1 / 512.0) as f32, (y1 / 512.0) as f32));
                    painter.image(tile.id(), Rect::from_min_max(a, b), uv, Color32::WHITE);
                }
            }
            if let Some(rk) = &self.rocks {
                painter.image(rk.id(), Rect::from_min_max(tl, br), Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
            }
            if let Some(wt) = &self.water {
                painter.image(wt.id(), Rect::from_min_max(tl, br), Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
            }
            if view.zoom >= ANIM_SCALE {
                self.draw_water_motion(&painter, &view);
            }
        }
        let cv = Canvas { painter: &painter, view: &view };
        let g = &self.game;
        let sim = &g.sim;
        let me = g.me;
        let time = sim.state.time;
        let time_clock = self.ui.clock;
        let motion = view.zoom >= ANIM_SCALE;
        let draw_time = if motion { time } else { 0.0 };
        let mut batch = Batch::new();
        let mut batch2: Vec<(f64, egui::Shape)> = Vec::new();
        let shadow_id = self.soft_shadow.id();
        let atlas = &mut self.atlas;
        let walls = &mut self.walls;
        let gates = &mut self.gates;
        let white = Color32::WHITE;
        let full_uv = Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0));

        if cruciata_core::world::is_river_map(&sim.state) {
            let by = cruciata_core::world::bridge_y(&sim.state, sim.geo.h);
            let bx = cruciata_core::world::river_x(&sim.state, sim.geo.w, by);
            if view.on_screen(bx, by, 200.0) {
                batch.frame(atlas, &view, "bridge", 105.0, 80.0, bx, by, 1.0, -1.0e9, white);
            }
        }
        if sim.state.mode != "quickmatch" && data().levels[sim.state.level].terrain == 0 {
            for (i, y) in [1580.0f64, 1780.0, 2000.0].iter().enumerate() {
                if !view.on_screen(cruciata_core::world::coast_x(*y), *y, 300.0) {
                    continue;
                }
                let v = i as f64;
                let t = draw_time;
                let x = cruciata_core::world::coast_x(*y) - 95.0 + (t * 0.35 + v).sin() * 1.5;
                let yy = y + (t * 0.7 + v).sin() * 2.0;
                let frame = ((((t + v) % std::f64::consts::TAU) / std::f64::consts::TAU) * 16.0).floor() as i64;
                batch.frame(atlas, &view, &format!("ship:{frame}"), 75.0, 160.0, x, yy, 1.0, y - 1.0e6, white);
            }
        }
        // ---- decorations ----
        for d in &sim.geo.decorations {
            if !view.on_screen(d.x, d.y, 120.0) {
                continue;
            }
            match d.kind {
                cruciata_core::world::DecoKind::Rock => {
                    cv.ellipse(d.x, d.y - d.r * 0.2, d.r * 1.1, d.r * 0.8, col("#8d8777"));
                }
                _ => {
                    let k = d.scale;
                    let tl = view.to_screen(d.x + 7.0 * k - 24.0 * k, d.y + 7.0 * k - 14.0 * k);
                    batch.quad(shadow_id, Rect::from_min_size(tl, egui::vec2((48.0 * k * view.zoom) as f32, (28.0 * k * view.zoom) as f32)), full_uv, d.y, white);
                    batch.frame(atlas, &view, &tree_key(biome == 2, biome == 3), 50.0, 110.0, d.x, d.y, k, d.y, white);
                }
            }
        }
        // ---- forests ----
        for f in sim.state.terrain_features.iter().filter(|f| f.kind == "rockmass" && f.forest == Some(true)) {
            let cell = f.cell;
            let far = view.zoom < 0.22;
            let mid = view.zoom < 0.45;
            for t in &f.tiles {
                let (px, py) = (t.x as f64 * cell, t.y as f64 * cell);
                if px + cell < view.x - 40.0 || px > view.x + view.w + 40.0 || py + cell < view.y - 40.0 || py > view.y + view.h + 40.0 {
                    continue;
                }
                let palm = f.palm == Some(true);
                let snow = f.snow == Some(true);
                if far {
                    cv.rect(px, py, cell + 1.0, cell + 1.0, col(if snow { "#8da58f" } else if palm { "#4f7d3c" } else { "#2f5e32" }));
                    continue;
                }
                let hash = ((((t.x as i64 * 73856093) as i32) ^ ((t.y as i64 * 19349663) as i32)) as u32).wrapping_mul(2654435761);
                if mid {
                    batch.frame(atlas, &view, &tree_key(palm, snow), 50.0, 110.0, px + cell / 2.0, py + cell / 2.0, 2.3, py + cell / 2.0, white);
                    continue;
                }
                for i in 0..4u32 {
                    let h = hash.wrapping_add(i.wrapping_mul(40503)).wrapping_mul(2246822519);
                    let jx = ((h & 255) as f64 / 255.0 - 0.5) * 14.0;
                    let jy = (((h >> 8) & 255) as f64 / 255.0 - 0.5) * 14.0;
                    let k = 1.4 + (((h >> 16) & 255) as f64 / 255.0) * 0.25;
                    let (x, y) = (px + if i % 2 == 1 { 0.75 } else { 0.25 } * cell + jx, py + if i > 1 { 0.75 } else { 0.25 } * cell + jy);
                    batch.frame(atlas, &view, &tree_key(palm, snow), 50.0, 110.0, x, y, k, y, white);
                }
            }
        }
        // ---- resources ----
        for n in &sim.state.nodes {
            if n.remaining <= 0.0 || !view.on_screen(n.x, n.y, 120.0) {
                continue;
            }
            if n.kind == Res::Wood {
                let k = 1.3;
                let tl = view.to_screen(n.x + 7.0 * k - 24.0 * k, n.y + 7.0 * k - 14.0 * k);
                batch.quad(shadow_id, Rect::from_min_size(tl, egui::vec2((48.0 * k * view.zoom) as f32, (28.0 * k * view.zoom) as f32)), full_uv, n.y, white);
                batch.frame(atlas, &view, &tree_key(n.palm, n.snow), 50.0, 110.0, n.x, n.y, k, n.y, white);
            } else {
                let tl = view.to_screen(n.x + 7.0 - 28.0, n.y + 7.0 - 18.0);
                batch.quad(shadow_id, Rect::from_min_size(tl, egui::vec2((56.0 * view.zoom) as f32, (36.0 * view.zoom) as f32)), full_uv, n.y, white);
                batch.frame(atlas, &view, &resource_key(n), 55.0, 80.0, n.x, n.y, 1.0, n.y, white);
            }
        }
        // ---- scorch, gore and the fallen ----
        for m in &sim.state.marks {
            let (x, y) = (m["x"].as_f64().unwrap_or(0.0), m["y"].as_f64().unwrap_or(0.0));
            if !view.on_screen(x, y, 60.0) {
                continue;
            }
            let (r, t) = (m["r"].as_f64().unwrap_or(10.0), m["t"].as_f64().unwrap_or(0.0));
            if m["kind"].as_str() == Some("scorch") {
                let grow = 0.5 + (t * 3.0).min(1.0) * 0.5;
                cv.ellipse(x, y, r * grow, r * 0.72 * grow, with_alpha(col("#2c2722"), 0.34));
                cv.ellipse(x, y, r * 0.55 * grow, r * 0.4 * grow, with_alpha(col("#14110f"), 0.28));
            } else if self.settings.gore {
                let grow = 0.4 + t.min(1.0) * 0.6;
                cv.ellipse(x, y, r * grow, r * 0.7 * grow, with_alpha(col("#68151c"), 0.7));
            }
        }
        if self.settings.gore {
            for c in &sim.state.corpses {
                let (x, y) = (c["x"].as_f64().unwrap_or(0.0), c["y"].as_f64().unwrap_or(0.0));
                if !view.on_screen(x, y, 60.0) {
                    continue;
                }
                let ty = c["type"].as_str().unwrap_or("sword");
                let team = c["team"].as_i64().unwrap_or(0);
                let angle = c["angle"].as_f64().unwrap_or(0.0) + std::f64::consts::FRAC_PI_2;
                batch.frame_rot(atlas, &view, &format!("corpse:{ty}:{team}"), 50.0, 50.0, x, y, 0.72, y - 40.0, angle, white);
            }
        }
        // ---- structures ----
        let known: Vec<&Building> = sim.state.buildings.iter().filter_map(|b| if b.team == me || g.sees(b.x, b.y) { Some(b) } else { g.fog().known.get(&b.id) }).collect();
        for b in &known {
            if !view.on_screen(b.x, b.y, 120f64.max(visual_height(b) + b.h / 2.0)) {
                continue;
            }
            let depth = b.y + b.h * 0.3 + if b.wall_attachment.is_some() { 40.0 } else { 0.0 };
            match b.kind {
                BKind::Wall | BKind::Bastionwall => {
                    let mut wb = (*b).clone();
                    if b.kind == BKind::Bastionwall {
                        wb.fortified = true;
                    }
                    let alpha = if b.hp > 0.0 && b.progress < 1.0 { 0.55 + 0.45 * b.progress } else { 1.0 };
                    wall_shape(&mut batch, &view, walls.get(&wb), b.x, b.y, depth, alpha as f32);
                }
                BKind::Greatengine => {
                    batch.frame(atlas, &view, &great_engine_key(b, time), 150.0, 240.0, b.x, b.y, 1.0, depth, white);
                }
                BKind::Colossus => {
                    // Stand-in: the great engine's baked frames at twice the size, darkened.
                    let mut g2 = (*b).clone();
                    g2.kind = BKind::Greatengine;
                    let key = great_engine_key(&g2, time);
                    let tint = Color32::from_rgb(190, 175, 160);
                    if b.progress < 1.0 {
                        batch.frame_partial(atlas, &view, &key, 150.0, 240.0, b.x, b.y, 2.0, depth, b.progress.max(0.08), Color32::from_white_alpha(220));
                    } else {
                        batch.frame(atlas, &view, &key, 150.0, 240.0, b.x, b.y, 2.0, depth, tint);
                    }
                }
                _ => {
                    if let (Some(att), true) = (&b.wall_attachment, b.hp > 0.0) {
                        let mut wb = (*b).clone();
                        wb.kind = BKind::Wall;
                        wb.x = att.x;
                        wb.y = att.y;
                        wb.w = att.w;
                        wb.h = att.h;
                        wb.wall_angle = att.wall_angle;
                        wb.links = att.links.clone();
                        wb.fortified = b.fortified || att.fortified == Some(true);
                        wall_shape(&mut batch, &view, walls.get(&wb), att.x, att.y, depth - 0.01, 1.0);
                    }
                    let (width, _h, oy) = building_canvas(b);
                    let key = building_key(b);
                    if matches!(b.kind, BKind::Gate | BKind::Bastiongate) && b.hp > 0.0 && atlas.frame(&key).is_none() {
                        wall_shape(&mut batch, &view, gates.get(b), b.x, b.y, depth, 1.0);
                        continue;
                    }
                    if b.hp > 0.0 && b.progress < 1.0 {
                        batch.frame_partial(atlas, &view, &key, width / 2.0, oy, b.x, b.y, 1.0, depth, b.progress.max(0.08), Color32::from_white_alpha(230));
                    } else {
                        batch.frame(atlas, &view, &key, width / 2.0, oy, b.x, b.y, 1.0, depth, white);
                        if b.hp > 0.0 && !matches!(b.kind, BKind::Wall | BKind::Farm | BKind::Gate | BKind::Bastiongate) {
                            let frame = (((draw_time * 0.7) / (std::f64::consts::PI * 2.0)) * 24.0).floor() as i64 % 24;
                            batch.frame(atlas, &view, &building_motion_key(b, frame), width / 2.0, oy, b.x, b.y, 1.0, depth + 0.001, white);
                        }
                    }
                }
            }
        }
        // ---- scaffolds on unfinished structures ----
        for b in &known {
            if b.hp > 0.0 && b.progress < 1.0 && !matches!(b.kind, BKind::Wall | BKind::Bastionwall) && view.on_screen(b.x, b.y, 200.0) {
                let h = visual_height(b) * 0.8 + 10.0;
                let top = h * b.progress.clamp(0.05, 1.0);
                let (hx, hy) = (b.w / 2.0 + 4.0, b.h / 2.0 + 4.0);
                let depth = b.y + b.h * 0.3 + 0.5;
                let mut shapes: Vec<egui::Shape> = Vec::new();
                let wood = col("#8a6a3c");
                let dirt = Color32::from_rgba_unmultiplied(120, 100, 70, 90);
                shapes.push(crate::paint::ellipse_shape(&view, b.x, b.y, hx + 6.0, (hy + 6.0) * 0.72, dirt, Stroke::NONE));
                for (cx, cy) in [(-hx, -hy), (hx, -hy), (-hx, hy), (hx, hy)] {
                    let base = view.to_screen(b.x + cx, b.y + cy * 0.72);
                    let tip = view.to_screen(b.x + cx, b.y + cy * 0.72 - top);
                    shapes.push(egui::Shape::line_segment([base, tip], Stroke::new((2.2 * view.zoom) as f32, wood)));
                }
                let mut z = 12.0;
                while z < top {
                    for (a, c) in [((-hx, hy), (hx, hy)), ((-hx, -hy), (hx, -hy)), ((-hx, -hy), (-hx, hy)), ((hx, -hy), (hx, hy))] {
                        let p = view.to_screen(b.x + a.0, b.y + a.1 * 0.72 - z);
                        let q = view.to_screen(b.x + c.0, b.y + c.1 * 0.72 - z);
                        shapes.push(egui::Shape::line_segment([p, q], Stroke::new((1.2 * view.zoom) as f32, wood.gamma_multiply(0.85))));
                    }
                    z += 14.0;
                }
                batch2.push((depth, egui::Shape::Vec(shapes)));
            }
        }
        for (d, s) in batch2.drain(..) {
            batch.shape(d, s);
        }
        // ---- units ----
        let mut visible: Vec<usize> = (0..sim.state.units.len())
            .filter(|&i| {
                let u = &sim.state.units[i];
                u.hp > 0.0 && view.on_screen(u.x, u.y, 130.0) && (u.team == me || g.sees(u.x, u.y))
            })
            .collect();
        visible.sort_by(|&a, &b| sim.state.units[a].y.partial_cmp(&sim.state.units[b].y).unwrap_or(std::cmp::Ordering::Equal));
        let crowd = visible.iter().filter(|&&i| clustered(sim.state.units[i].ty)).count();
        let per_unit = (2400 / crowd.max(1)).clamp(1, 3);
        let live: HashSet<u32> = sim.state.units.iter().map(|u| u.id).collect();
        self.visual_angle.retain(|k, _| live.contains(k));
        self.clusters.retain_live(&live);
        for &i in &visible {
            let u = &sim.state.units[i];
            let desired = if u.ty == UType::Archer && (u.strike > 0.0 || u.target.is_some()) && u.aim_angle.map(|a| a.is_finite()).unwrap_or(false) { u.aim_angle.unwrap() } else { u.angle };
            let va = self.visual_angle.entry(u.id).or_insert(desired);
            let turn = (desired - *va).sin().atan2((desired - *va).cos());
            *va += turn.clamp(-0.16, 0.16);
        }
        for &i in &visible {
            let u = &sim.state.units[i];
            let angle = *self.visual_angle.get(&u.id).unwrap_or(&u.angle);
            let want_cluster = clustered(u.ty) && view.zoom >= CLUSTER_SCALE && per_unit > 1;
            match u.ty {
                UType::Ram | UType::Ballista | UType::Trebuchet => {
                    batch.frame(atlas, &view, &siege_machine_key(u, time, angle), 80.0, 120.0, u.x, u.y, 0.72, u.y, white);
                }
                UType::Pilgrim | UType::Merchant => {
                    batch.frame(atlas, &view, &caravan_frame(u, time, angle), 80.0, 120.0, u.x, u.y, 0.72, u.y, white);
                }
                _ => {
                    if want_cluster {
                        let c = self.clusters.update(u, dt).clone();
                        for k in 0..per_unit {
                            let f = c.figs[k];
                            let mut v = u.clone();
                            v.x = f.x;
                            v.y = f.y;
                            v.anim = if motion { u.anim + k as f64 * 2.1 } else { 0.0 };
                            v.work_phase = Some(if motion { u.work_phase.unwrap_or(0.0) + k as f64 * 0.31 } else { 0.0 });
                            v.moving = motion && u.moving;
                            v.strike = if motion { (u.strike - k as f64 * 0.04).max(0.0) } else { 0.0 };
                            batch.frame(atlas, &view, &person_key(&v, angle), 50.0, 95.0, f.x, f.y, 0.72, f.y, white);
                        }
                    } else {
                        let mut v = u.clone();
                        if !motion {
                            v.anim = 0.0;
                            v.work_phase = Some(0.0);
                            v.moving = false;
                            v.strike = 0.0;
                        }
                        batch.frame(atlas, &view, &person_key(&v, angle), 50.0, 95.0, u.x, u.y, 0.72, u.y, white);
                        if u.ty == UType::Standard {
                            let st = self.standard_stop.entry(u.id).or_insert((u.moving, -10.0));
                            if st.0 && !u.moving {
                                st.1 = time;
                            }
                            st.0 = u.moving;
                            let pose = if u.moving { (time * 12.0).floor() as i64 % 12 } else { ((time - st.1).max(0.0) * 3.0).floor().min(24.0) as i64 };
                            batch.frame(atlas, &view, &standard_key(u, pose, u.moving), 130.0, 120.0, u.x, u.y, 0.72, u.y + 0.01, white);
                        }
                    }
                }
            }
        }
        batch.flush(&painter);

        // ---- markers: rally points, order lines, attack reticles ----
        for b in &known {
            if let Some(r) = b.rally {
                if b.hp > 0.0 && b.team == me && self.ui.building_selected(b.id) {
                    cv.dashed_line((b.x, b.y), (r.x, r.y), 1.2, col("#edc57888"), 6.0, 8.0, 0.0);
                    cv.circle_stroke(r.x, r.y, 6.0, 1.6, col("#edc578"));
                }
            }
        }
        if !self.ui.selected.is_empty() && self.ui.selected.len() <= 400 {
            let mut lanes: HashMap<u32, (f64, f64, f64, Pt, bool)> = HashMap::new();
            for u in &sim.state.units {
                if u.team != me || u.hp <= 0.0 || u.ty == UType::Worker || !self.ui.selected.contains(&u.id) {
                    continue;
                }
                let Some(o) = &u.order else { continue };
                let key = o.formation.unwrap_or(u.id);
                let l = lanes.entry(key).or_insert((0.0, 0.0, 0.0, Pt::new(o.x, o.y), false));
                l.0 += 1.0;
                l.1 += u.x;
                l.2 += u.y;
                l.4 |= o.attack == Some(true);
                cv.rect(o.x - 1.5, o.y - 1.5, 3.0, 3.0, with_alpha(col(if o.attack == Some(true) { "#d9604a" } else { "#efe2b0" }), 0.75));
            }
            for (_, l) in lanes {
                cv.dashed_line((l.1 / l.0, l.2 / l.0), (l.3.x, l.3.y), 1.4, with_alpha(col(if l.4 { "#d9604a" } else { "#efe2b0" }), 0.5), 5.0, 7.0, ((time as f32) * 18.0).rem_euclid(12.0));
            }
        }
        let mut targets: HashSet<u32> = HashSet::new();
        for u in &sim.state.units {
            if u.team == me && u.hp > 0.0 && self.ui.selected.contains(&u.id) && u.manual_target {
                if let Some(t) = u.target {
                    targets.insert(t);
                }
            }
        }
        for id in targets {
            if let Some(o) = sim.get_object(id) {
                let (p, r0, hp) = match o {
                    cruciata_core::sim::Obj::Unit(i) => (Pt::new(sim.state.units[i].x, sim.state.units[i].y), 18.0, sim.state.units[i].hp),
                    cruciata_core::sim::Obj::Building(i) => (Pt::new(sim.state.buildings[i].x, sim.state.buildings[i].y), sim.state.buildings[i].r, sim.state.buildings[i].hp),
                    _ => continue,
                };
                if hp <= 0.0 || !g.sees(p.x, p.y) {
                    continue;
                }
                let r = r0 + 12.0 + (time * 8.0).sin() * 3.0;
                cv.circle_stroke(p.x, p.y, r, 3.0, col("#ff5544"));
                for s in [-1.0, 1.0] {
                    cv.line(&[(p.x + s * (r + 10.0), p.y), (p.x + s * (r - 5.0), p.y)], 3.0, col("#ff5544"));
                    cv.line(&[(p.x, p.y + s * (r + 10.0)), (p.x, p.y + s * (r - 5.0))], 3.0, col("#ff5544"));
                }
            }
        }
        // ---- projectiles ----
        for a in &sim.state.arrows {
            if !view.on_screen(a.x, a.y, 120.0) {
                continue;
            }
            let angle = (a.ty - a.y).atan2(a.tx - a.x);
            let total = ((a.tx - a.sx).powi(2) + (a.ty - a.sy).powi(2)).sqrt();
            let progress = if total > 0.0 { (1.0 - ((a.tx - a.x).powi(2) + (a.ty - a.y).powi(2)).sqrt() / total).clamp(0.0, 1.0) } else { 0.0 };
            let arc = (progress * std::f64::consts::PI).sin() * (65f64).min(total * 0.22);
            let (c, s) = (angle.cos(), angle.sin());
            let tilt = (progress * std::f64::consts::PI).cos() * 0.45;
            let len = if a.siege { 22.0 } else { 15.0 };
            let (hx, hy) = (a.x, a.y - arc);
            let (tx, ty) = (hx - c * len, hy - s * len + tilt * len * 0.4);
            cv.ellipse(a.x, a.y, 2.4, 1.2, col("#25332340"));
            cv.line(&[(tx, ty), (hx, hy)], if a.siege { 2.4 } else { 1.3 }, col("#6b5636"));
            cv.line(&[(hx - c * 3.0, hy - s * 3.0), (hx + c * 2.0, hy + s * 2.0)], if a.siege { 3.0 } else { 2.0 }, col("#cfd3cf"));
        }
        for b in &sim.state.boulders {
            let t = b.t / b.duration;
            let (x, y) = (b.sx + (b.tx - b.sx) * t, b.sy + (b.ty - b.sy) * t);
            let height = (t * std::f64::consts::PI).sin() * (if b.heavy { 340.0 } else { 150.0 }) + b.lift.unwrap_or(0.0) * (1.0 - t.min(1.0));
            let fy = y - height;
            if view.on_screen(b.tx, b.ty, b.r) {
                cv.circle_stroke(b.tx, b.ty, b.r, 1.5, col("#b99a6477"));
            }
            if !view.on_screen(x, fy, 55.0) {
                continue;
            }
            let k = 1.0 + (t * std::f64::consts::PI).sin() * 0.3;
            cv.ellipse(x, y, 7.0, 6.0, col("#44513955"));
            if b.heavy {
                cv.ellipse(x, fy, 17.0 * k, 15.0 * k, col("#2b2623"));
                cv.ellipse(x - 3.0 * k, fy - 4.0 * k, 14.0 * k, 12.0 * k, col("#837b66"));
            } else {
                cv.ellipse(x, fy, 6.0 * k, 6.0 * k, col("#c8451c"));
                cv.ellipse(x - 1.0, fy - 1.0, 4.5 * k, 4.5 * k, col("#f5a23b"));
            }
        }
        // ---- impact smoke and dust ----
        for &(x, y, t0, heavy) in &self.ui.impacts {
            let t = time_clock - t0;
            if !(0.0..1.2).contains(&t) || !view.on_screen(x, y, 200.0) {
                continue;
            }
            let k = t / 1.2;
            let scale = if heavy { 90.0 } else { 38.0 };
            cv.ellipse(x, y, scale * (0.4 + k), scale * 0.7 * (0.4 + k), with_alpha(col("#6b5d49"), 0.5 * (1.0 - k) as f32));
            for i in 0..7 {
                let a = i as f64 * 0.9 + x * 0.01;
                let r = scale * 0.7 * k;
                cv.ellipse(x + a.cos() * r, y + a.sin() * r * 0.6 - k * 25.0, scale * 0.22 * (1.0 + k), scale * 0.2 * (1.0 + k), with_alpha(col("#4a4036"), 0.55 * (1.0 - k) as f32));
            }
            if t < 0.25 {
                cv.ellipse(x, y - 6.0, scale * 0.5 * (1.0 - t * 2.0), scale * 0.4 * (1.0 - t * 2.0), with_alpha(col("#ffd27a"), 0.9 * (1.0 - t * 4.0) as f32));
            }
        }
        // ---- fog ----
        if !g.revealed() {
            self.fog_tex.paint(&painter, &view, sim.geo.w, sim.geo.h);
        }
        // ---- unit overlays ----
        for &i in &visible {
            let u = &sim.state.units[i];
            if self.ui.selected.contains(&u.id) {
                let r = if clustered(u.ty) && view.zoom >= CLUSTER_SCALE { if u.ty == UType::Knight { 24.0 } else { 16.0 } } else if u.ty == UType::Trebuchet { 24.0 } else if u.ty == UType::Knight { 18.0 } else { 12.0 };
                cv.circle_stroke(u.x, u.y, r, 1.8, col("#ede1ae"));
            }
            if u.blessed > 0.0 {
                cv.circle_stroke(u.x, u.y, 22.0, 1.5, col("#ebcb78aa"));
            }
            if self.ui.selected.contains(&u.id) || u.hp < u.max_hp {
                health_bar(&cv, u.x, u.y - 32.0, u.hp / u.max_hp, if u.ty == UType::Trebuchet { 40.0 } else { 28.0 }, u.team);
            }
            if u.ty == UType::Trebuchet && (u.deployment == "setting-up" || u.deployment == "packing") {
                health_bar(&cv, u.x, u.y + 35.0, 1.0 - u.deploy_timer / if u.deployment == "setting-up" { 6.0 } else { 4.0 }, 42.0, 0);
            }
        }
        for b in &known {
            if b.hp > 0.0 && view.on_screen(b.x, b.y, 200.0) {
                if self.ui.building_selected(b.id) {
                    cv.rect_stroke(b.x - b.w / 2.0 - 6.0, b.y - b.h / 2.0 - 6.0, b.w + 12.0, b.h + 12.0, 2.0, col("#eed5a0"));
                }
                if b.hp < b.max_hp || b.team != me && b.team != 2 || self.ui.building_selected(b.id) {
                    health_bar(&cv, b.x, b.y + b.h / 2.0 + 10.0, b.hp / b.max_hp, b.w.min(90.0), b.team);
                }
                if b.progress < 1.0 {
                    health_bar(&cv, b.x, b.y - b.h / 2.0 - 12.0, b.progress, 70.0, 0);
                }
            }
        }
        // ---- siege ranges (above fog) ----
        for b in sim.state.buildings.iter().filter(|b| b.team == me && b.hp > 0.0 && b.progress >= 1.0 && self.ui.building_selected(b.id)) {
            if b.kind == BKind::Greatengine {
                cv.circle_stroke(b.x, b.y, 2200.0, 2.0, col("#e8b64bcc"));
                cv.circle_stroke(b.x, b.y, 320.0, 2.0, col("#d96b4f99"));
                cv.text(b.x + 140.0, b.y - 100.0, "GREAT ENGINE | 320-2200", 13.0, col("#f5d497"));
            }
            if b.kind == BKind::Colossus {
                cv.dashed_circle(b.x, b.y, COLOSSUS_MIN_RANGE, 2.0, col("#ffb08a99"), 6.0, 12.0, 0.0);
                let aims: Vec<(Pt, bool)> = {
                    let mut v = vec![];
                    if self.ui.pointer_on_map && self.ui.placement.is_none() {
                        v.push((self.ui.mouse, true));
                    }
                    if let Some(t) = b.attack_target.and_then(|id| sim.get_object(id)).map(|o| sim.obj_pos(o)).or(b.fire_target) {
                        v.push((t, false));
                    }
                    v
                };
                for (p, hover) in aims {
                    let d = ((b.x - p.x).powi(2) + (b.y - p.y).powi(2)).sqrt();
                    let r = 20.0 + 0.045 * d;
                    let close = d < COLOSSUS_MIN_RANGE;
                    cv.dashed_circle(p.x, p.y, r, 2.0, col(if hover { "#f2c669" } else { "#e2674a" }), 16.0, 10.0, 0.0);
                    cv.text(p.x + 14.0, p.y - r - 8.0, &if close { format!("Too close (minimum {})", COLOSSUS_MIN_RANGE) } else { format!("Shot lands within {} units", r.round()) }, 13.0, col("#fff1c9"));
                }
            }
            if let Some(t) = b.fire_target {
                cv.line(&[(t.x - 14.0, t.y), (t.x + 14.0, t.y)], 2.0, col("#f2aa4e"));
                cv.line(&[(t.x, t.y - 14.0), (t.x, t.y + 14.0)], 2.0, col("#f2aa4e"));
            }
        }
        for u in sim.state.units.iter().filter(|u| u.team == me && u.ty == UType::Trebuchet && u.hp > 0.0 && self.ui.selected.contains(&u.id)) {
            cv.circle_stroke(u.x, u.y, 690.0, 1.5, col("#f1cd82aa"));
            cv.circle_stroke(u.x, u.y, 180.0, 1.5, col("#f1cd82aa"));
            if let Some(t) = u.fire_target {
                cv.line(&[(t.x - 12.0, t.y), (t.x + 12.0, t.y)], 2.0, col("#f2aa4e"));
                cv.line(&[(t.x, t.y - 12.0), (t.x, t.y + 12.0)], 2.0, col("#f2aa4e"));
            }
        }
        // ---- rings from orders ----
        for r in &self.ui.rings {
            let a = (1.0 - r.t).max(0.0) as f32;
            cv.circle_stroke(r.x, r.y, 24.0 * (0.5 + r.t), 2.0, with_alpha(col(r.color), a));
        }
        // ---- drag box ----
        if let Some(d) = &self.ui.drag {
            if ((d.start.x - d.end.x).powi(2) + (d.start.y - d.end.y).powi(2)).sqrt() * view.zoom > 4.0 {
                let r = Rect::from_two_pos(view.to_screen(d.start.x, d.start.y), view.to_screen(d.end.x, d.end.y));
                painter.rect_filled(r, 0.0, col("#eed7a122"));
                painter.rect_stroke(r, 0.0, Stroke::new(1.5, col("#efdaa7")));
            }
        }
        // ---- placement preview ----
        let wall_preview = self.ui.wall_drag.or_else(|| if matches!(self.ui.placement, Some(BKind::Wall | BKind::Bastionwall)) { self.ui.wall_anchor.map(|a| (a, self.ui.mouse)) } else { None });
        if let Some((a, b)) = wall_preview {
            let kind = self.ui.placement.unwrap_or(BKind::Wall);
            let cost = data().bld(kind).cost.clone().unwrap_or_default();
            let mut count = 0;
            for p in sim.wall_line(a, b) {
                if sim.state.buildings.iter().any(|x| x.team == me && x.kind == BKind::Wall && x.hp > 0.0 && ((x.x - p.x).powi(2) + (x.y - p.y).powi(2)).sqrt() < 12.0) {
                    continue;
                }
                let valid = sim.valid_site(BKind::Wall, p, me, 0.0, None);
                if valid {
                    count += 1;
                }
                cv.rect(p.x - 16.0, p.y - 16.0, 32.0, 32.0, col(if valid { "#dac39299" } else { "#b3333388" }));
                cv.rect_stroke(p.x - 16.0, p.y - 16.0, 32.0, 32.0, 1.0, col(if valid { "#fff1bd" } else { "#ff786b" }));
            }
            let m = self.ui.mouse;
            cv.text(m.x + 80.0, m.y - 24.0, &format!("{} sections / {} stone / {} wood", count, count as f64 * cost.0.iter().find(|x| x.0 == Res::Stone).map(|x| x.1).unwrap_or(0.0), count as f64 * cost.0.iter().find(|x| x.0 == Res::Wood).map(|x| x.1).unwrap_or(0.0)), 14.0, col("#fff1c9"));
        } else if let (Some(kind), true) = (self.ui.placement, self.ui.pointer_on_map) {
            let m = self.ui.mouse;
            let spec = data().bld(kind);
            let turned = kind == BKind::Gate && self.ui.rotation == 90.0;
            let (w, h) = if turned { (spec.h, spec.w) } else { (spec.w, spec.h) };
            let valid = sim.valid_site(kind, m, me, self.ui.rotation, None);
            let ghost = Building { kind: if kind == BKind::Bastionwall { BKind::Wall } else { kind }, fortified: kind == BKind::Bastionwall, team: me, x: m.x, y: m.y, w: spec.w, h: spec.h, hp: spec.hp, max_hp: spec.hp, progress: 1.0, rotation: Some(self.ui.rotation), ..Default::default() };
            let mut gb = Batch::new();
            if matches!(kind, BKind::Greatengine) {
                gb.frame(&mut self.atlas, &view, &great_engine_key(&Building { aim_angle: Some(-std::f64::consts::FRAC_PI_2), ..ghost.clone() }, 0.0), 150.0, 240.0, m.x, m.y, 1.0, m.y, Color32::from_white_alpha(150));
            } else if !matches!(kind, BKind::Colossus | BKind::Wall | BKind::Bastionwall) {
                let (width, _hh, oy) = building_canvas(&ghost);
                gb.frame(&mut self.atlas, &view, &building_key(&ghost), width / 2.0, oy, m.x, m.y, 1.0, m.y, Color32::from_white_alpha(150));
            }
            gb.flush(&painter);
            cv.rect(m.x - w / 2.0, m.y - h / 2.0, w, h, col(if valid { "#a4cc6422" } else { "#d63a3555" }));
            cv.rect_stroke(m.x - w / 2.0 - 5.0, m.y - h / 2.0 - 5.0, w + 10.0, h + 10.0, 2.0, col(if valid { "#d8e5a2" } else { "#ae3229" }));
            if kind == BKind::Greatengine {
                cv.circle_stroke(m.x, m.y, 2200.0, 2.0, col(if valid { "#e8b64bcc" } else { "#d96b4faa" }));
                cv.circle_stroke(m.x, m.y, 320.0, 2.0, col("#d96b4fcc"));
                cv.text(m.x, m.y + 338.0, "Range 320-2200", 12.0, col("#f5d497"));
            }
            if kind == BKind::Colossus {
                cv.circle_stroke(m.x, m.y, COLOSSUS_MIN_RANGE, 2.0, col("#d96b4fcc"));
                for d in [1500.0, 3000.0, 4500.0] {
                    cv.circle_stroke(m.x, m.y, d, 1.2, col("#e8b64b66"));
                    cv.text(m.x, m.y - d - 6.0, &format!("{}: scatter {}", d, (20.0 + 0.045 * d).round()), 12.0, col("#f5d497"));
                }
            }
        }
    }
}

fn wall_shape(batch: &mut Batch, view: &View, m: &crate::wall3d::Model, x: f64, y: f64, depth: f64, alpha: f32) {
    let mut shapes = Vec::with_capacity(m.faces.len());
    for f in &m.faces {
        let pts: Vec<egui::Pos2> = f.pts.iter().map(|p| view.to_screen(x + p[0] as f64, y + p[1] as f64)).collect();
        let c = if alpha < 1.0 { f.color.gamma_multiply(alpha) } else { f.color };
        match f.width {
            Some(w) => shapes.push(egui::Shape::line(pts, Stroke::new((w as f64 * view.zoom) as f32, c))),
            None => {
                let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
                for p in &pts {
                    x0 = x0.min(p.x);
                    y0 = y0.min(p.y);
                    x1 = x1.max(p.x);
                    y1 = y1.max(p.y);
                }
                let area: f32 = pts.iter().enumerate().map(|(i, p)| { let q = pts[(i + 1) % pts.len()]; p.x * q.y - q.x * p.y }).sum::<f32>() * 0.5;
                if area.abs() < 0.2 {
                    continue;
                }
                let stroke = if (x1 - x0).min(y1 - y0) > 2.5 { Stroke::new(0.5, c) } else { Stroke::NONE };
                shapes.push(egui::Shape::convex_polygon(pts, c, stroke));
            }
        }
    }
    batch.shape(depth, egui::Shape::Vec(shapes));
}

pub fn health_bar(cv: &Canvas, x: f64, y: f64, ratio: f64, w: f64, team: i32) {
    cv.rect(x - w / 2.0, y, w, 4.0, col("#38402c99"));
    cv.rect(x - w / 2.0, y, w * ratio.clamp(0.0, 1.0), 4.0, col(if team == 1 { "#a74734" } else { "#72934e" }));
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.frames += 1;
        if std::env::var_os("CRUCIATA_FPS").is_some() {
            let now = std::time::Instant::now();
            let e = self.fps_mark.get_or_insert((now, 0u32));
            e.1 += 1;
            if now.duration_since(e.0).as_secs_f32() >= 2.0 {
                eprintln!("{:.1} fps, sim {:.1} ms/step", e.1 as f32 / 2.0, self.game.sim.state.time);
                *e = (now, 0);
            }
        }
        let dt = (ctx.input(|i| i.unstable_dt) as f64).min(0.1);
        self.ui.clock += dt;
        self.atlas.begin_frame(ctx);
        let shot_mode = self.args.shot.is_some();
        if self.audio.is_none() && !shot_mode && self.frames == 3 {
            self.audio = crate::audio::Audio::new(assets_dir());
        }
        self.sync_audio();
        if let Some(rx) = &self.loader {
            if let Ok(res) = rx.try_recv() {
                self.loader = None;
                match res {
                    Ok(g) => {
                        self.install(g);
                        self.ui.show_menu = false;
                    }
                    Err(e) => self.menu.screen = Screen::LanMessage(e),
                }
            }
        }
        let guest = self.menu.lan.host.as_mut().and_then(|h| h.poll());
        if let Some(s) = guest {
            self.menu.lan.host = None;
            self.begin_load("A friend has joined...", move || lan_game(s));
        }
        if self.ui.show_menu {
            self.menu.poll_lan();
            let in_game = !matches!(self.menu.screen, Screen::Loading(_)) && self.game.sim.state.result.is_none() && self.game.sim.state.time > 0.0 && !self.game.left;
            let can_resume = store::read_save(None).is_some();
            let out = self.menu.show(ctx, &self.progress, in_game, self.game.is_lan(), can_resume, &self.icons, self.icons.map.get("banner").map(|t| t.id()));
            self.handle_menu(out);
            let np = self.audio.as_ref().and_then(|a| a.current).map(|t| format!("Now playing: {t} (shuffled playlist)")).unwrap_or_else(|| "Background music: shuffled playlist".to_string());
            if overlay::settings_dialog(ctx, &mut self.ui.show_settings, &mut self.settings, &np) {
                if let Some(a) = self.audio.as_mut() {
                    a.next_track();
                }
            }
            self.shot_step(ctx);
            ctx.request_repaint_after(std::time::Duration::from_millis(16));
            return;
        }
        if !shot_mode && !self.ui.show_menu && !self.ui.show_debug {
            self.game.advance(dt);
        }
        if let Some(ls) = self.game.lock.as_ref() {
            if ls.disconnected && self.game.sim.state.result.is_none() {
                let me0 = self.game.me == 0;
                self.game.sim.finish(me0);
                self.ui.toast("Your opponent has left the match.");
            }
            if let Some(t) = ls.desync {
                if !self.desync_warned {
                    self.desync_warned = true;
                    self.ui.toast(format!("The two games have fallen out of step (turn {t}). Please restart the match."));
                }
            }
        }
        self.handle_events();
        self.save_clock += dt;
        if self.save_clock > 20.0 && !shot_mode {
            self.save_clock = 0.0;
            if !self.game.is_lan() && self.game.sim.state.result.is_none() && self.game.sim.state.time > 1.0 {
                let doc = self.game.sim.save_json((self.view.cx, self.view.cy, self.view.zoom));
                store::write_save(self.slot, &doc);
            }
        }
        if let Some(won) = self.game.outcome() {
            if !self.result_handled {
                self.result_handled = true;
                if !self.game.is_lan() {
                    store::delete_save(self.slot);
                    if won && self.game.sim.state.mode != "quickmatch" {
                        self.progress.complete(self.game.sim.state.level);
                    }
                }
            }
        }
        for r in self.ui.rings.iter_mut() {
            r.t += dt;
        }
        self.ui.rings.retain(|r| r.t < 1.0);
        self.ui.impacts.retain(|i| self.ui.clock - i.2 < 1.3);
        self.ui.shake = (self.ui.shake - dt * 16.0).max(0.0);
        self.ui.prune(&self.game);
        self.fog_tex.update(ctx, &self.game);
        self.ensure_terrain(ctx);
        let mut actions: Vec<Action> = Vec::new();
        let mut look: Option<(f64, f64)> = input::keys(ctx, &mut self.view, &mut self.ui, &mut self.game, dt);
        let screen = ctx.screen_rect();
        let lay = chrome::layout(screen);
        let map_rect = lay.map.shrink(3.0);
        let status = "LOCAL CHRONICLE";
        let mut minimap_order: Option<(f64, f64, bool)> = None;
        egui::CentralPanel::default().frame(egui::Frame::none()).show(ctx, |ui| {
            chrome::draw(ui, &lay, &self.game, &mut self.ui, &self.icons, &mut actions, status);
            {
                let mut f = Frame { g: &mut self.game, ui: &mut self.ui, atlas: &mut self.atlas };
                panel::command_panel(ui, lay.panel, &mut f);
            }
            self.view.rect = map_rect;
            let resp = ui.interact(map_rect, egui::Id::new("battlefield"), Sense::click_and_drag());
            input::map_input(ctx, &resp, &mut self.view, &mut self.ui, &mut self.game, &mut self.input);
            self.draw_world(ui, map_rect, dt);
            let tex = self.terrain.as_ref().map(|t| t.1.id());
            let out = mapui::draw(ui, map_rect, &self.game, &mut self.ui, &mut self.view, &self.fog_tex, tex, self.water.as_ref().map(|t| t.id()), &self.icons);
            if out.look.is_some() {
                look = out.look;
            }
            minimap_order = out.minimap_order;
            if out.orders_toggled {
                self.progress.orders_collapsed = self.ui.orders_collapsed;
                self.progress.save();
            }
            mapui::toasts(ui, map_rect, &mut self.ui);
        });
        if let Some((x, y, attack)) = minimap_order {
            let t = input::resolve_targets(&self.game, Pt::new(x, y));
            self.ui.issue_order(&mut self.game, Pt::new(x, y), attack, false, t.enemy, t.node, t.building, t.escort);
        }
        if let Some(l) = overlay::colossus_banner(ctx, map_rect, &self.game) {
            look = Some(l);
        }
        for a in actions {
            match a {
                Action::Help => self.ui.show_help = true,
                Action::Debug => self.ui.show_debug = !self.ui.show_debug,
                Action::Settings => self.ui.show_settings = true,
                Action::Pause => self.game.sim.state.paused = !self.game.sim.state.paused,
                Action::Menu => {
                    self.ui.show_menu = true;
                    self.menu.screen = Screen::Main;
                    if !self.game.is_lan() {
                        self.game.sim.state.paused = true;
                    }
                }
                Action::Save => self.save_now(),
                Action::Restart => {
                    let lvl = self.game.sim.state.level;
                    let d = self.game.sim.state.difficulty.clone();
                    if self.game.sim.state.mode != "quickmatch" {
                        self.start_campaign(lvl, d);
                    }
                }
                Action::Level(i) => {
                    let d = self.game.sim.state.difficulty.clone();
                    if i <= self.progress.unlocked {
                        self.start_campaign(i, d);
                    }
                }
                Action::Home => {
                    if let Some(b) = self.game.sim.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == self.game.me) {
                        look = Some((b.x + 150.0, b.y - 100.0));
                    }
                }
                Action::Look(x, y) => look = Some((x, y)),
                _ => {}
            }
        }
        if let Some((x, y)) = look {
            self.view.center_tight(x, y);
        }
        if self.frames == 2 {
            let (cx, cy) = (self.view.cx, self.view.cy);
            self.view.center_tight(cx, cy);
        }
        match overlay::result_dialog(ctx, &self.game) {
            Some(overlay::ResultChoice::Menu) => {
                self.ui.show_menu = true;
                self.menu.screen = Screen::Main;
            }
            Some(overlay::ResultChoice::Next) => {
                let (l, d) = (self.game.sim.state.level + 1, self.game.sim.state.difficulty.clone());
                self.start_campaign(l, d);
            }
            Some(overlay::ResultChoice::Again) => {
                let (l, d) = (self.game.sim.state.level, self.game.sim.state.difficulty.clone());
                self.start_campaign(l, d);
            }
            None => {}
        }
        if !self.game.is_lan() {
            if let Some(c) = overlay::debug_dialog(ctx, &mut self.ui.show_debug, &self.game) {
                if c == "victory" {
                    self.ui.show_debug = false;
                }
                self.game.sim.cheat(c);
            }
        } else {
            self.ui.show_debug = false;
        }
        overlay::help_dialog(ctx, &mut self.ui.show_help);
        let np = self.audio.as_ref().and_then(|a| a.current).map(|t| format!("Now playing: {t} (shuffled playlist)")).unwrap_or_else(|| "Background music: shuffled playlist".to_string());
        if overlay::settings_dialog(ctx, &mut self.ui.show_settings, &mut self.settings, &np) {
                if let Some(a) = self.audio.as_mut() {
                    a.next_track();
                }
            }
        let _ = (map_rect, self.last_time);
        self.shot_step(ctx);
        ctx.request_repaint_after(std::time::Duration::from_millis(16));
    }
}

/// Build the simulation for a LAN match and wait for the other side.
fn lan_game(s: cruciata_net::session::Session) -> Result<Game, String> {
    let cfg = s.config.clone();
    let peer = s.peer_name.clone();
    let diff = cfg["difficulty"].as_str().unwrap_or("normal").to_string();
    let mut sim = Sim::start_level(0, Some(cfg), &diff, false);
    sim.settings.pvp = true;
    sim.state.paused = false;
    let lock = s.ready(std::time::Duration::from_secs(60))?;
    Ok(Game::lan(sim, lock, peer))
}
