//! The application shell and the world renderer.

use crate::paint::Straight;
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

pub const ANIM_SCALE: f64 = 0.5;
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
    pending_intro: bool,
    terrain: Option<(u64, TextureHandle)>,
    /// Rock layer tiles keyed by (tile x, tile y, resolution level); None marks an empty tile.
    rock_tiles: HashMap<(i32, i32, u8), Option<TextureHandle>>,
    rock_boxes: Vec<(usize, [f64; 4])>,
    colossus_flags: Vec<TextureHandle>,
    cover: Vec<crate::extras::Patch>,
    fx: crate::fx::Fx,
    water: Option<TextureHandle>,
    tile: Option<TextureHandle>,
    walls: crate::wall3d::WallCache,
    audio: Option<crate::audio::Audio>,
    gates: crate::gate3d::GateCache,
    desync_warned: bool,
    demo_at: Option<u8>,
    fps_mark: Option<(std::time::Instant, u32)>,
    /// Per-phase milliseconds since the last report (`CRUCIATA_FPS`): sim, fx, fog, world, minimap.
    prof: [f64; 6],
    slow_frames: u32,
    sim_max: f64,
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
                px[y * w + x] = crate::paint::rgba(0x25, 0x33, 0x23, (0.19 * 255.0 * edge) as u8);
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
                "colossus" => {
                    // Debug: a finished Colossus beside the town centre for a closer look.
                    if let Some(tc) = game.sim.state.buildings.iter().find(|b| b.team == 0 && b.kind == BKind::Towncenter).map(|b| (b.x, b.y)) {
                        let team = v.parse::<i32>().unwrap_or(0);
                        let b = game.sim.make_building(BKind::Colossus, team, tc.0 + 700.0, tc.1, 1.0);
                        game.sim.state.buildings.push(b);
                        focus = Some((tc.0 + 700.0, tc.1 - 100.0));
                    }
                }
                "foundations" => {
                    // Debug: half-built structures beside the town centre (compare with the web).
                    if let Some(tc) = game.sim.state.buildings.iter().find(|b| b.team == 0 && b.kind == BKind::Towncenter).map(|b| (b.x, b.y)) {
                        let p: f64 = v.parse().unwrap_or(0.5);
                        for (kind, dx, dy) in [(BKind::Barracks, 520.0, -150.0), (BKind::House, 520.0, 150.0), (BKind::Farm, 760.0, 0.0), (BKind::Tower, 760.0, -300.0), (BKind::Stable, 520.0, 330.0)] {
                            let b = game.sim.make_building(kind, 0, tc.0 + dx, tc.1 + dy, p);
                            game.sim.state.buildings.push(b);
                        }
                        focus = Some((tc.0 + 640.0, tc.1 - 20.0));
                    }
                }
                "sites" => {
                    for s in game.sim.state.sites.iter().take(3) {
                        eprintln!("site {} ({:.0},{:.0}) r {} team {:?} captured {} claim {:?}", s.name, s.x, s.y, s.r, s.team, s.captured, s.claim_progress);
                    }
                }
                "cheat" => {
                    game.sim.cheat(v);
                }
                "rock" => {
                    if let Some((_, b)) = crate::terrain::rock_boxes(&game.sim.state).into_iter().nth(v.parse::<usize>().unwrap_or(0)) {
                        focus = Some(((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0));
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
                "wallrel" => {
                    // Debug: plan a wall relative to the town centre and finish it at once.
                    let n: Vec<f64> = v.split(',').filter_map(|x| x.parse().ok()).collect();
                    if let (4, Some(tc)) = (n.len(), game.sim.state.buildings.iter().find(|b| b.team == 0 && b.kind == BKind::Towncenter).map(|b| (b.x, b.y))) {
                        game.sim.state.resources.stone = 50000.0;
                        game.sim.state.resources.wood = 50000.0;
                        let snap = |v: f64| (v / 32.0).round() * 32.0;
                        let cmd = cruciata_core::commands::Command::PlaceWall { kind: BKind::Wall, ax: snap(tc.0 + n[0]), ay: snap(tc.1 + n[1]), bx: snap(tc.0 + n[2]), by: snap(tc.1 + n[3]), builders: vec![], append: false };
                        game.sim.run_command(0, 0, &cruciata_core::lockstep::PlayerCommand::Game(cmd));
                        for b in game.sim.state.buildings.iter_mut().filter(|b| b.team == 0 && b.kind == BKind::Wall) {
                            b.progress = 1.0;
                            b.hp = b.max_hp;
                        }
                        game.sim.rebuild_navigation();
                        if focus.is_none() { focus = Some((tc.0 + n[2], tc.1 + n[3])); }
                    }
                }
                "settings" => app_ui.show_settings = true,
                "debug" => app_ui.show_debug = true,
                "help" => app_ui.show_help = true,
                "menu" => app_ui.show_menu = true,
                "intro" => {
                    app_ui.intro = true;
                    game.sim.state.paused = true;
                }
                "pause" => game.sim.state.paused = true,
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
            pending_intro: false,
            terrain: None,
            rock_tiles: HashMap::new(),
            rock_boxes: Vec::new(),
            colossus_flags: Vec::new(),
            cover: Vec::new(),
            fx: Default::default(),
            water: None,
            tile: None,
            walls: Default::default(),
            audio: None,
            gates: Default::default(),
            desync_warned: false,
            demo_at: None,
            fps_mark: None,
            prof: [0.0; 6],
            slow_frames: 0,
            sim_max: 0.0,
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
        self.fx.clear();
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
        if std::mem::take(&mut self.pending_intro) && !self.game.is_lan() {
            self.ui.intro = true;
            self.game.sim.state.paused = true;
        }
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

    /// The web's chapter intro ("Begin the march") and pause ("Make camp.") cards.
    fn intro_and_pause(&mut self, ctx: &egui::Context, map: Rect) {
        let st = &self.game.sim.state;
        if self.ui.show_menu || st.result.is_some() || self.game.is_lan() || self.ui.show_debug {
            return;
        }
        if self.ui.intro {
            let quick = st.mode == "quickmatch";
            let l = &data().levels[st.level.min(data().levels.len() - 1)];
            let (label, title, body) = if quick {
                ("QUICKMATCH".to_string(), "Standards over the frontier".to_string(), format!("A {} by {} battlefield. {} enemy command. Both armies must build, gather and explore. Destroy the opposing town center to win.", self.game.sim.geo.w, self.game.sim.geo.h, st.difficulty))
            } else {
                (format!("CHAPTER {}", l.roman), l.name.to_string(), l.story.to_string())
            };
            if overlay::card(ctx, map, &label, &title, &body, "Begin the march", None).is_some() {
                self.ui.intro = false;
                self.game.sim.state.paused = false;
                self.ui.toast("Right-click resources with villagers to gather. Build farms and storehouses to sustain the host.");
            }
        } else if st.paused {
            if overlay::card(ctx, map, "A MOMENT OF RESPITE", "Make camp.", "The battle and the settlement are paused.", "Resume the march", None).is_some() {
                self.game.sim.state.paused = false;
            }
        }
    }

    fn start_campaign(&mut self, level: usize, diff: String) {
        self.slot = None;
        self.pending_intro = true;
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
                self.pending_intro = true;
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
                    let need = live_frames().unwrap_or(8);
                    self.shot_state = if (idle && n > need) || n > need + 600 {
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
        let coast = true;
        let (mut img, water) = crate::terrain::bake(s, self.game.sim.geo.w, self.game.sim.geo.h, self.biome(), coast, s.mode != "quickmatch");
        self.water = Some(ctx.load_texture("water", water, egui::TextureOptions::LINEAR));
        let repeat = egui::TextureOptions { wrap_mode: egui::TextureWrapMode::Repeat, ..egui::TextureOptions::LINEAR };
        self.tile = Some(ctx.load_texture("ground-tile", crate::terrain::ground_tile(self.biome()), repeat));
        if data().levels[s.level].kind == "survival" {
            for p in img.pixels.iter_mut() {
                let [r, g, b, _] = p.straight();
                let mix = |c: u8, t: u8| (c as f32 * (1.0 - 0.2) + t as f32 * 0.2) as u8;
                *p = Color32::from_rgb(mix(r, 0xdc), mix(g, 0xe2), mix(b, 0xcc));
            }
        }
        self.terrain = Some((key, ctx.load_texture("terrain", img, egui::TextureOptions::LINEAR)));
        self.rock_tiles.clear();
        self.rock_boxes = crate::terrain::rock_boxes(s);
        if self.colossus_flags.is_empty() {
            for team in 0..2 {
                let path = assets_dir().join("atlas").join(format!("colossus-flag-{team}.png"));
                if let Ok(img) = image::open(&path) {
                    let rgba = img.to_rgba8();
                    let size = [rgba.width() as usize, rgba.height() as usize];
                    self.colossus_flags.push(ctx.load_texture(format!("colossus-flag-{team}"), crate::paint::image_from_straight(size, rgba.as_raw()), egui::TextureOptions::LINEAR));
                }
            }
        }
        self.cover = crate::extras::make_cover(&self.game.sim, self.biome());
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

    /// Opponent left / desync notices for a running LAN match.
    fn lan_checks(&mut self) {
        let Some(ls) = self.game.lock.as_ref() else { return };
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
                    if let (Some(x), Some(y)) = (x, y) {
                        if (kind == "siege" || kind == "great-launch") && self.game.sees(x, y) {
                            let g = &self.game;
                            let sees = |x: f64, y: f64| g.sees(x, y);
                            let look = crate::fx::Look { view: &self.view, sees: &sees, gore: g.sim.settings.gore };
                            self.fx.launch(&g.sim, &look, x, y, kind == "great-launch");
                            if kind == "great-launch" {
                                self.ui.shake = self.ui.shake.max(3.0);
                            }
                        }
                    }
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
                    {
                        let g = &self.game;
                        let sees = |x: f64, y: f64| g.sees(x, y);
                        let look = crate::fx::Look { view: &self.view, sees: &sees, gore: g.sim.settings.gore };
                        self.fx.impact(&look, x, y, heavy);
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
                seg(pts, 0.7 + phase / 150.0, crate::paint::rgba(220, 244, 226, a));
            }
            let mut yy = (y0 / 75.0).floor() * 75.0;
            while yy < y1 {
                let mut xx = (view.x.max(0.0) / 100.0).floor() * 100.0;
                while xx < (view.x + view.w).min(coast_x(yy) - 50.0) {
                    let dy = (xx * 0.03 + time).sin() * 3.0;
                    seg(vec![view.to_screen(xx, yy + dy), view.to_screen(xx + 20.0, yy + dy)], 0.8, crate::paint::rgba(0x72, 0xb8, 0xbc, 0x44));
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
                        crate::paint::rgba(0xd3, 0xed, 0xe5, 0x44),
                    );
                    y += 90.0;
                }
            }
            for side in [-1.0f64, 1.0] {
                let mut pts: Vec<egui::Pos2> = Vec::new();
                let bank = crate::paint::rgba(0xd8, 0xdf, 0xba, 0xaa);
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
            // Quickmatch (no clipped sea) lets the ground pattern lie over the water, as on the web.
            let under_tile = self.game.sim.state.mode == "quickmatch";
            if under_tile {
                if let Some(wt) = &self.water {
                    painter.image(wt.id(), Rect::from_min_max(tl, br), Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
                }
            }
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
            // Roads are drawn live, crisp at every zoom (web: 38/33 wide strokes plus ruts).
            for road in &self.game.sim.state.roads {
                if road.len() < 2 || !road.iter().any(|p| view.on_screen(p.x, p.y, 400.0)) {
                    continue;
                }
                let line = |off: f64, width: f64, c: Color32| {
                    let pts: Vec<egui::Pos2> = road.iter().map(|p| view.to_screen(p.x + off, p.y)).collect();
                    painter.add(egui::Shape::line(pts, egui::Stroke::new((width * view.zoom).max(0.5) as f32, c)));
                };
                // Round caps and joins, like the canvas stroke.
                let dots = |width: f64, c: Color32| {
                    for p in road.iter() {
                        painter.circle_filled(view.to_screen(p.x, p.y), (width * 0.5 * view.zoom) as f32, c);
                    }
                };
                line(0.0, 38.0, crate::paint::col("#827761"));
                dots(38.0, crate::paint::col("#827761"));
                line(0.0, 33.0, crate::paint::col("#a89b7e"));
                dots(33.0, crate::paint::col("#a89b7e"));
                line(-7.0, 0.8, crate::paint::col("#8d78493d"));
                line(7.0, 0.8, crate::paint::col("#8d78493d"));
            }
            // Rock masses, drawn from tiles baked at the camera's resolution.
            {
                const TILE: f64 = 512.0;
                let level: u8 = if view.zoom >= 1.1 { 3 } else if view.zoom >= 0.55 { 2 } else if view.zoom >= 0.28 { 1 } else { 0 };
                let ppu = [0.2, 0.4, 0.9, 1.6][level as usize];
                let (tx0, ty0) = (((view.x - 60.0) / TILE).floor() as i32, ((view.y - 60.0) / TILE).floor() as i32);
                let (tx1, ty1) = (((view.x + view.w + 60.0) / TILE).floor() as i32, ((view.y + view.h + 60.0) / TILE).floor() as i32);
                let mut baked = 0;
                let full = Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0));
                for ty in ty0.max(0)..=ty1 {
                    for tx in tx0.max(0)..=tx1 {
                        let key = (tx, ty, level);
                        if !self.rock_tiles.contains_key(&key) {
                            if baked >= 2 {
                                continue;
                            }
                            baked += 1;
                            let img = crate::terrain::bake_rock_tile(&self.game.sim.state, &self.rock_boxes, tx as f64 * TILE, ty as f64 * TILE, TILE, ppu);
                            let tex = img.map(|i| ui.ctx().load_texture(format!("rocks-{tx}-{ty}-{level}"), i, egui::TextureOptions::LINEAR));
                            self.rock_tiles.insert(key, tex);
                        }
                        if let Some(Some(tex)) = self.rock_tiles.get(&key) {
                            let a = view.to_screen(tx as f64 * TILE, ty as f64 * TILE);
                            let b = view.to_screen((tx + 1) as f64 * TILE, (ty + 1) as f64 * TILE);
                            painter.image(tex.id(), Rect::from_min_max(a, b), full, Color32::WHITE);
                        }
                    }
                }
                if self.rock_tiles.len() > 160 {
                    // Keep only the tiles around the camera, at any resolution.
                    self.rock_tiles.retain(|k, _| k.0 >= tx0 - 2 && k.0 <= tx1 + 2 && k.1 >= ty0 - 2 && k.1 <= ty1 + 2);
                }
            }
            if !under_tile {
                if let Some(wt) = &self.water {
                    painter.image(wt.id(), Rect::from_min_max(tl, br), Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), Color32::WHITE);
                }
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
        // ---- ground cover ----
        if view.zoom >= 0.3 {
            let movers: Vec<(f64, f64, f64, u32)> = sim.state.units.iter().filter(|u| u.hp > 0.0 && u.moving && view.on_screen(u.x, u.y, 240.0) && (u.team == me || g.sees(u.x, u.y))).map(|u| (u.x, u.y, u.angle, u.id)).collect();
            for p in &self.cover {
                if !view.on_screen(p.x, p.y, 220.0) {
                    continue;
                }
                let near: Vec<(f64, f64, f64, u32)> = movers.iter().copied().filter(|m| (m.0 - p.x).abs() < p.rx + 35.0 && (m.1 - p.y).abs() < p.ry + 35.0).collect();
                crate::extras::draw_cover(&cv, p, &near, draw_time);
            }
        }
        // ---- decorations ----
        for d in &sim.geo.decorations {
            if !view.on_screen(d.x, d.y, 120.0) {
                continue;
            }
            match d.kind {
                cruciata_core::world::DecoKind::Rock => {
                    // The web draws a seven-sided stone prism (`Art.boulder`); the atlas holds it at
                    // radii 8..40 in steps of four, so scale the nearest one.
                    let ra = ((d.r / 4.0).round() * 4.0).clamp(8.0, 40.0);
                    let k = d.r / ra;
                    cv.ellipse(d.x + 7.0, d.y + 7.0, d.r, d.r * 0.65, col("#25332330"));
                    if !batch.frame(atlas, &view, &format!("boulder:{}", ra as i64), ra * 1.5 + 10.0, ra * 2.0 + 15.0, d.x, d.y, k, d.y, white) {
                        cv.ellipse(d.x, d.y - d.r * 0.2, d.r * 1.1, d.r * 0.8, col("#8d8777"));
                    }
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
                    if b.hp > 0.0 && b.progress < 1.0 {
                        draw_site(&mut batch, atlas, &view, b, draw_time, depth, None, white);
                    }
                }
                BKind::Greatengine => {
                    let key = great_engine_key(b, time);
                    if b.hp > 0.0 && b.progress < 1.0 {
                        draw_site(&mut batch, atlas, &view, b, draw_time, depth, Some((key, 150.0, 240.0, 1.0)), white);
                    } else {
                        batch.frame(atlas, &view, &key, 150.0, 240.0, b.x, b.y, 1.0, depth, white);
                    }
                }
                BKind::Colossus => {
                    let baked_key = colossus_key(b, time);
                    if atlas.has(&baked_key) {
                        // The real Colossus art (reduced pose set baked by `scripts/bake-colossus.js`).
                        if b.progress < 1.0 {
                            draw_site(&mut batch, atlas, &view, b, draw_time, depth, Some((baked_key.clone(), 210.0, 500.0, 1.0)), white);
                        } else {
                            batch.frame(atlas, &view, &baked_key, 210.0, 500.0, b.x, b.y, 1.0, depth, white);
                            if let Some(tex) = self.colossus_flags.get(b.team.clamp(0, 1) as usize) {
                                // Four banners on the buttresses wave live (web `waveFlag`).
                                let aim = ((b.aim_angle.unwrap_or(-std::f64::consts::FRAC_PI_2) * 8.0) / std::f64::consts::PI).round() * std::f64::consts::PI / 8.0;
                                let (ca, sa) = ((aim + std::f64::consts::FRAC_PI_2).cos(), (aim + std::f64::consts::FRAC_PI_2).sin());
                                let gust = 0.75 + (draw_time * 0.57).sin() * 0.18 + (draw_time * 0.23).sin() * 0.1;
                                for i in [0, 3, 6, 9] {
                                    let ang = i as f64 * std::f64::consts::PI / 6.0 + std::f64::consts::PI / 12.0;
                                    let (px, py) = (ang.cos() * 103.0, ang.sin() * 103.0);
                                    let (fx, fy) = (b.x + (px * ca - py * sa) * 1.4, b.y + ((px * sa + py * ca) * 0.72 - 124.0) * 1.4);
                                    let (fw, fh) = (52.0, 36.0);
                                    for s in 0..16 {
                                        let t = s as f64 / 16.0;
                                        let wave = ((draw_time * 2.1 - t * 5.4).sin() * 3.0 + (draw_time * 3.3 - t * 9.0).sin() * 0.9) * t * gust;
                                        let (x0, y0, w, h) = (fx + t * fw, fy + wave, fw / 16.0 + 0.7, fh - t * 3.0);
                                        let rect = Rect::from_min_max(view.to_screen(x0, y0), view.to_screen(x0 + w, y0 + h));
                                        let uv = Rect::from_min_max(egui::pos2(s as f32 / 16.0, 0.0), egui::pos2((s + 1) as f32 / 16.0, 1.0));
                                        batch.quad(tex.id(), rect, uv, depth + 0.5, white);
                                        let light = (draw_time * 2.6 - t * 6.0).cos();
                                        let shade = if light > 0.0 { crate::paint::rgba(255, 239, 209, (light * 0.14 * 255.0) as u8) } else { crate::paint::rgba(0, 0, 0, (-light * 0.14 * 255.0) as u8) };
                                        batch.shape(depth + 0.6, egui::Shape::rect_filled(rect, 0.0, shade));
                                    }
                                }
                            }
                        }
                    } else {
                        // Stand-in: the great engine's baked frames at twice the size, darkened.
                        let mut g2 = (*b).clone();
                        g2.kind = BKind::Greatengine;
                        let key = great_engine_key(&g2, time);
                        let tint = Color32::from_rgb(190, 175, 160);
                        if b.progress < 1.0 {
                            draw_site(&mut batch, atlas, &view, b, draw_time, depth, Some((key, 150.0, 240.0, 2.0)), tint);
                        } else {
                            batch.frame(atlas, &view, &key, 150.0, 240.0, b.x, b.y, 2.0, depth, tint);
                        }
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
                        draw_site(&mut batch, atlas, &view, b, draw_time, depth, Some((key.clone(), width / 2.0, oy, 1.0)), white);
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
        self.fx.draw(&cv);
        crate::extras::sites_and_cities(&cv, sim, g, draw_time, |x, y, r, w| health_bar(&cv, x, y, r, w, 0));
        for b in sim.state.buildings.iter().filter(|b| b.kind == BKind::Colossus && b.hp > 0.0 && b.team != me && b.team != 2 && view.on_screen(b.x, b.y, 400.0)) {
            crate::extras::colossus_beacon(&cv, b, time);
        }
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
        // ---- shock rings (charges, landing shots) ----
        self.fx.draw_rings(&cv, &sim.state.rings);
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

/// Footprint options for a construction site (web `constructionSite` `o`).
fn site_opts(b: &Building) -> crate::site::Opts {
    use crate::site::Opts;
    match b.kind {
        BKind::Colossus => Opts { half_w: b.w * 0.5, half_d: b.h * 0.5, h: 300.0, round: true, light: false },
        BKind::Greatengine => Opts { half_w: b.w * 0.5, half_d: b.h * 0.5, h: 150.0, round: true, light: false },
        BKind::Wall | BKind::Bastionwall => Opts { half_w: 26.0, half_d: if b.fortified || b.kind == BKind::Bastionwall { 24.0 } else { 15.0 }, h: if b.fortified || b.kind == BKind::Bastionwall { 62.0 } else { 50.0 }, round: false, light: true },
        _ => {
            let turned = b.rotation == Some(90.0) || b.gate_angle == Some(std::f64::consts::FRAC_PI_2);
            let (w, h) = if turned { (b.h, b.w) } else { (b.w, b.h) };
            Opts { half_w: w * 0.5, half_d: h * 0.5, h: visual_height(b) + 14.0, round: false, light: false }
        }
    }
}

/// Everything around an unfinished structure except the finished sprite itself:
/// ground, footing, the sprite rising from the ground (`finished` = key, origin x/y, scale),
/// mortar course, scaffold, piles, hoist and dust. `depth` is the structure's sort depth.
#[allow(clippy::too_many_arguments)]
fn draw_site(batch: &mut Batch, atlas: &mut Atlas, view: &View, b: &Building, time: f64, depth: f64, finished: Option<(String, f64, f64, f64)>, tint: Color32) {
    use crate::site;
    let o = site_opts(b);
    let p = b.progress;
    let id = b.id as f64;
    let rise = site::site_rise(p);
    let (cut_y, zc) = site::cut_and_zc(&o, p);
    let hw = o.half_w + 7.0;
    let at = |x: f64, y: f64| view.to_screen(b.x + x, b.y + y);
    let line = |pts: &[(f64, f64)], w: f64, c: Color32| egui::Shape::line(pts.iter().map(|&(x, y)| at(x, y)).collect(), Stroke::new((w * view.zoom).max(0.5) as f32, c));
    let quad = |pts: [(f64, f64); 4], fill: Color32, stroke: Color32| egui::Shape::convex_polygon(pts.iter().map(|&(x, y)| at(x, y)).collect(), fill, Stroke::new(1.0, stroke));
    if !o.light {
        let mut ground: Vec<egui::Shape> = vec![
            crate::paint::ellipse_shape(view, b.x, b.y + 3.0, o.half_w * 1.22 + 12.0, o.half_d * 1.28 + 10.0, col("#7a6742"), Stroke::new(1.0, col("#58492c"))),
            crate::paint::ellipse_shape(view, b.x, b.y + 2.0, o.half_w * 1.02 + 6.0, o.half_d * 1.06 + 6.0, col("#8d7a50"), Stroke::NONE),
        ];
        if p < 0.2 {
            let stakes = [(-o.half_w - 6.0, -o.half_d - 4.0), (o.half_w + 6.0, -o.half_d - 4.0), (o.half_w + 6.0, o.half_d + 4.0), (-o.half_w - 6.0, o.half_d + 4.0)];
            for i in 0..4 {
                ground.push(line(&[stakes[i], stakes[(i + 1) % 4]], 1.2, col("#e4d7ae")));
            }
            for (x, y) in stakes {
                ground.push(line(&[(x, y), (x, y - 12.0)], 2.6, col("#7b5a34")));
            }
        }
        batch.shape(depth - 0.4, egui::Shape::Vec(ground));
        if p > 0.015 {
            wall_shape(batch, view, &site::footing(&o, p), b.x, b.y, depth - 0.35, 1.0);
        }
    }
    if rise > 0.0 {
        if let Some((key, ox, oy, scale)) = finished {
            if let Some(f) = atlas.frame(&key) {
                // Keep only the part of the sprite below the cut line.
                let top = (f.dy as f64 - oy) * scale;
                let height = f.h as f64 / f.res as f64 * scale;
                let fraction = ((top + height - cut_y) / height).clamp(0.0, 1.0);
                if fraction >= 0.999 {
                    batch.frame(atlas, view, &key, ox, oy, b.x, b.y, scale, depth, tint);
                } else if fraction > 0.0 {
                    batch.frame_partial(atlas, view, &key, ox, oy, b.x, b.y, scale, depth, fraction, tint);
                }
            } else {
                batch.frame(atlas, view, &key, ox, oy, b.x, b.y, scale, depth, tint);
            }
        }
        if !o.round && !o.light && rise < 0.8 {
            let (x0, x1) = (-o.half_w * 0.86, o.half_w * 0.86);
            let mut course = vec![quad([(x0, cut_y - 3.0), (x1, cut_y - 3.0), (x1 + 3.0, cut_y + 3.0), (x0 - 3.0, cut_y + 3.0)], col("#d6c9a4"), col("#6f6347"))];
            let mut x = x0 + 8.0;
            while x < x1 {
                course.push(line(&[(x, cut_y - 3.0), (x - 1.0, cut_y + 3.0)], 1.0, col("#8a7d5d")));
                x += 14.0;
            }
            batch.shape(depth + 0.05, egui::Shape::Vec(course));
        }
    }
    if !o.light && p > 0.04 && p < 0.995 {
        let fade = if p > 0.9 { 1.0 - ((p - 0.9) / 0.1) * 0.75 } else { 1.0 };
        wall_shape(batch, view, &site::scaffold(&o, zc, fade), b.x, b.y, depth + 0.1, 1.0);
    }
    if !o.light && p < 0.97 {
        let left = ((1.0 - p) * 5.0).ceil() as i64;
        wall_shape(batch, view, &site::piles(true, left), b.x - hw - 6.0, b.y + o.half_d + 4.0, depth + 0.15, 1.0);
        wall_shape(batch, view, &site::piles(false, left), b.x + hw + 4.0, b.y + o.half_d + 8.0, depth + 0.15, 1.0);
    }
    if o.light {
        let blocks = vec![
            quad([(-18.0, 10.0), (-9.0, 10.0), (-9.0, 16.0), (-18.0, 16.0)], col("#c4b690"), col("#6f6347")),
            quad([(10.0, 12.0), (22.0, 12.0), (22.0, 17.0), (10.0, 17.0)], col("#b9ab86"), col("#6f6347")),
        ];
        batch.shape(depth + 0.15, egui::Shape::Vec(blocks));
    }
    // Hoist on the front-right corner: a block rises and falls on a rope.
    if !o.light && p > 0.07 && p < 0.9 {
        let post = (hw - 8.0).min(hw * 0.85);
        let y_top = o.half_d - (zc + 20.0) * 0.72;
        let t = (1.0 - (time * 1.2 + id).cos()) / 2.0;
        let ground = o.half_d + 6.0;
        let by = ground + (y_top + 16.0 - ground) * t;
        let hoist = vec![
            line(&[(post, y_top), (post + 24.0, y_top + 3.0)], 3.0, col("#6a4d2d")),
            line(&[(post + 24.0, y_top + 3.0), (post + 24.0, by)], 1.0, col("#e9ddb8")),
            quad([(post + 17.0, by), (post + 31.0, by), (post + 31.0, by + 9.0), (post + 17.0, by + 9.0)], col("#c4b690"), col("#5f553d")),
        ];
        batch.shape(depth + 0.2, egui::Shape::Vec(hoist));
    }
    if p > 0.03 && p < 0.985 {
        let mut dust: Vec<egui::Shape> = Vec::new();
        for i in 0..6 {
            let c = (time * 0.7 + i as f64 / 6.0 + (b.id % 7) as f64 * 0.13).rem_euclid(1.0);
            let x = (i as f64 * 2.7 + id).sin() * o.half_w * 0.8 + c * 6.0;
            let y = cut_y - c * 26.0 + 3.0;
            dust.push(crate::paint::ellipse_shape(view, b.x + x, b.y + y, 3.0 + c * 6.0, 2.0 + c * 3.5, site::dust_color(0.4 * (1.0 - c)), Stroke::NONE));
        }
        batch.shape(depth + 0.3, egui::Shape::Vec(dust));
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
            self.game.sim.profile_units = true;
            let now = std::time::Instant::now();
            let e = self.fps_mark.get_or_insert((now, 0u32));
            e.1 += 1;
            if now.duration_since(e.0).as_secs_f32() >= 2.0 {
                let n = e.1.max(1) as f64;
                let p = self.prof;
                eprintln!("worst frame {:.1} ms, {} over 25 ms, atlas pages {} resident / {} pending, misses {}", p[5], self.slow_frames, self.atlas.resident_pages(), self.atlas.pending_pages(), self.atlas.misses);
                self.slow_frames = 0;
                let mut ph: Vec<(&&str, &f64)> = self.game.sim.phases.iter().collect();
                ph.sort_by(|a, b| b.1.partial_cmp(a.1).unwrap_or(std::cmp::Ordering::Equal));
                let line: Vec<String> = ph.iter().take(12).map(|(k, v)| format!("{k} {:.2}", **v * 1000.0 / n)).collect();
                eprintln!("sim phases ms/frame: {}", line.join(", "));
                self.game.sim.phases.clear();
                eprintln!("worst sim advance {:.1} ms", self.sim_max);
                self.sim_max = 0.0;
                eprintln!("{:.1} fps | per frame ms: sim {:.2} fx {:.2} fog {:.2} world {:.2} map {:.2} | units {} bld {}", e.1 as f32 / 2.0, p[0] / n, p[1] / n, p[2] / n, p[3] / n, p[4] / n, self.game.sim.state.units.len(), self.game.sim.state.buildings.len());
                self.prof = [0.0; 6];
                *e = (now, 0);
            }
        }
        {
            let ms = ctx.input(|i| i.unstable_dt) as f64 * 1000.0;
            self.prof[5] = self.prof[5].max(ms);
            if ms > 25.0 {
                self.slow_frames += 1;
            }
        }
        if let (Some(frames), true) = (live_frames(), std::env::var_os("CRUCIATA_PAN").is_some()) {
            // Debug: sweep the camera across the map to exercise page streaming.
            let t = self.frames as f64 / frames.max(1) as f64;
            self.view.cx = self.view.world_w * (0.1 + 0.8 * (t * 3.0).fract());
            self.view.cy = self.view.world_h * (0.2 + 0.6 * (t * 5.0).fract());
        }
        let dt = if live_frames().is_some() { 1.0 / 60.0 } else { (ctx.input(|i| i.unstable_dt) as f64).min(0.1) };
        self.ui.clock += dt;
        self.atlas.begin_frame(ctx);
        let shot_mode = self.args.shot.is_some();
        if self.audio.is_none() && !shot_mode && (self.frames == 3 || self.frames % 240 == 0) {
            self.audio = crate::audio::Audio::new(assets_dir());
            self.last_volumes = (-1.0, -1.0, false);
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
            // A LAN match never pauses: keep trading turns so the opponent is not held up.
            if self.game.is_lan() && !shot_mode {
                self.game.advance(dt);
                self.lan_checks();
                self.handle_events();
            }
            self.menu.poll_lan();
            let in_game = !matches!(self.menu.screen, Screen::Loading(_)) && self.game.sim.state.result.is_none() && self.game.sim.state.time > 0.0 && !self.game.left;
            let can_resume = store::read_save(None).is_some();
            self.menu.active_level = if self.game.sim.state.mode != "quickmatch" && self.game.sim.state.result.is_none() && in_game { Some(self.game.sim.state.level) } else { None };
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
        let t0 = std::time::Instant::now();
        if (!shot_mode || live_frames().is_some()) && !self.ui.show_menu && !self.ui.show_debug {
            self.game.advance(dt);
        }
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        self.prof[0] += ms;
        self.sim_max = self.sim_max.max(ms);
        self.lan_checks();
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
                        let lvl = self.game.sim.state.level;
                        self.progress.complete(lvl);
                        self.menu.transit = Some(lvl);
                        self.menu.last_victory = Some((lvl, data().levels[lvl.min(5)].win.to_string()));
                    }
                }
            }
        }
        for r in self.ui.rings.iter_mut() {
            r.t += dt;
        }
        self.ui.rings.retain(|r| r.t < 1.0);
        self.ui.impacts.retain(|i| self.ui.clock - i.2 < 1.3);
        let t0 = std::time::Instant::now();
        {
            let g = &self.game;
            let sees = |x: f64, y: f64| g.sees(x, y);
            let look = crate::fx::Look { view: &self.view, sees: &sees, gore: g.sim.settings.gore };
            self.fx.load(ctx);
            if self.args.run.iter().any(|c| c == "fxdemo") {
                let n = self.demo_at.unwrap_or(0);
                self.demo_at = Some(n.saturating_add(1));
                if n == 4 {
                    let (cx, cy) = (self.view.cx, self.view.cy);
                    self.fx.demo(&g.sim, &look, cx, cy);
                }
            }
            self.fx.update(&g.sim, if g.paused() || self.ui.show_menu && !g.is_lan() || self.ui.show_debug { 0.0 } else { dt }, &look);
        }
        self.prof[1] += t0.elapsed().as_secs_f64() * 1000.0;
        self.ui.shake = (self.ui.shake - dt * 16.0).max(0.0);
        self.ui.prune(&self.game);
        let t0 = std::time::Instant::now();
        self.fog_tex.update(ctx, &self.game);
        self.prof[2] += t0.elapsed().as_secs_f64() * 1000.0;
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
            let t0 = std::time::Instant::now();
            self.draw_world(ui, map_rect, dt);
            self.prof[3] += t0.elapsed().as_secs_f64() * 1000.0;
            let t0 = std::time::Instant::now();
            let tex = self.terrain.as_ref().map(|t| t.1.id());
            let out = mapui::draw(ui, map_rect, &self.game, &mut self.ui, &mut self.view, &self.fog_tex, tex, self.water.as_ref().map(|t| t.id()), &self.icons);
            self.prof[4] += t0.elapsed().as_secs_f64() * 1000.0;
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
        self.intro_and_pause(ctx, map_rect);
        match overlay::result_dialog(ctx, map_rect, &self.game) {
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
        // Repaint at once and let vsync pace the loop: a timer started after the frame ends
        // lands just past the next vblank and makes motion judder.
        ctx.request_repaint();
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

/// Debug: `CRUCIATA_LIVE=<frames>` lets screenshot runs advance the live simulation for that many frames.
fn live_frames() -> Option<u32> {
    std::env::var("CRUCIATA_LIVE").ok().and_then(|v| v.parse().ok())
}
