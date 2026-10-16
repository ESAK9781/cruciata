//! The application shell and the world renderer.

use crate::assets::assets_dir;
use crate::atlas::Atlas;
use crate::cluster::{clustered, Clusters};
use crate::keys::*;
use crate::paint::{col, Batch, Canvas};
use crate::view::View;
use crate::Args;
use cruciata_core::model::*;
use cruciata_core::sim::{Sim, STEP};
use eframe::egui::{self, Color32, Rect, Stroke, TextureHandle};
use std::collections::{HashMap, HashSet};

const ANIM_SCALE: f64 = 0.5;
const CLUSTER_SCALE: f64 = 0.25;

pub struct App {
    pub sim: Sim,
    pub atlas: Atlas,
    pub view: View,
    pub args: Args,
    clusters: Clusters,
    visual_angle: HashMap<u32, f64>,
    standard_stop: HashMap<u32, (bool, f64)>,
    soft_shadow: TextureHandle,
    acc: f64,
    frames: u64,
    shot_state: ShotState,
    pub selected: HashSet<u32>,
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

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>, args: Args) -> App {
        let atlas = Atlas::load(assets_dir()).expect("sprite atlas");
        let mut sim = match args.quick {
            Some(seed) => Sim::start_level(0, Some(serde_json::json!({ "seed": seed, "width": 6400, "height": 4400, "biome": 0 })), "normal", false),
            None => Sim::start_level(args.level, None, "normal", false),
        };
        sim.state.paused = false;
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
        let shot_state = if args.shot.is_some() { ShotState::Waiting(0) } else { ShotState::Off };
        App {
            soft_shadow: make_shadow(&cc.egui_ctx),
            sim,
            atlas,
            view,
            args,
            clusters: Clusters::default(),
            visual_angle: HashMap::new(),
            standard_stop: HashMap::new(),
            acc: 0.0,
            frames: 0,
            shot_state,
            selected: HashSet::new(),
        }
    }

    fn step_sim(&mut self, dt: f64) {
        if self.args.shot.is_some() {
            return;
        }
        self.acc = (self.acc + dt).min(0.25);
        while self.acc >= STEP {
            self.sim.update(STEP);
            self.acc -= STEP;
        }
        self.sim.events.clear();
    }

    fn biome(&self) -> i32 {
        let s = &self.sim.state;
        if let Some(b) = s.config.as_ref().and_then(|c| c.get("biome")).and_then(|b| b.as_f64()) {
            return b as i32;
        }
        match cruciata_core::data::data().levels[s.level].terrain {
            2 => 3,
            t if t >= 3 => 2,
            t => t,
        }
    }

    fn draw_world(&mut self, ui: &mut egui::Ui, rect: Rect, dt: f64) {
        self.view.rect = rect;
        self.view.update();
        let view = self.view.clone();
        let painter = ui.painter_at(rect);
        let biome = self.biome();
        let ground = match biome {
            2 => "#cba766",
            3 => "#aabbb4",
            _ => "#628444",
        };
        painter.rect_filled(rect, 0.0, col(ground));
        let cv = Canvas { painter: &painter, view: &view };
        let time = self.sim.state.time;
        let motion = view.zoom >= ANIM_SCALE;
        let draw_time = if motion { time } else { 0.0 };
        let mut batch = Batch::new();
        let shadow_id = self.soft_shadow.id();
        let sim = &self.sim;
        let atlas = &mut self.atlas;

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
                    let r = Rect::from_min_size(tl, egui::vec2((48.0 * k * view.zoom) as f32, (28.0 * k * view.zoom) as f32));
                    batch.quad(shadow_id, r, Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), d.y, Color32::WHITE);
                    batch.frame(atlas, &view, &tree_key(biome == 2, biome == 3), 50.0, 110.0, d.x, d.y, k, d.y, Color32::WHITE);
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
                let hash = ((((t.x as i64 * 73856093) as i32) ^ ((t.y as i64 * 19349663) as i32)) as i32 as u32).wrapping_mul(2654435761);
                let mut tree = |x: f64, y: f64, k: f64, batch: &mut Batch, atlas: &mut Atlas| {
                    batch.frame(atlas, &view, &tree_key(palm, snow), 50.0, 110.0, x, y, k, y, Color32::WHITE);
                };
                if mid {
                    tree(px + cell / 2.0, py + cell / 2.0, 2.3, &mut batch, atlas);
                    continue;
                }
                for i in 0..4u32 {
                    let h = hash.wrapping_add(i.wrapping_mul(40503)).wrapping_mul(2246822519);
                    let jx = ((h & 255) as f64 / 255.0 - 0.5) * 14.0;
                    let jy = (((h >> 8) & 255) as f64 / 255.0 - 0.5) * 14.0;
                    let k = 1.4 + (((h >> 16) & 255) as f64 / 255.0) * 0.25;
                    tree(px + if i % 2 == 1 { 0.75 } else { 0.25 } * cell + jx, py + if i > 1 { 0.75 } else { 0.25 } * cell + jy, k, &mut batch, atlas);
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
                batch.quad(shadow_id, Rect::from_min_size(tl, egui::vec2((48.0 * k * view.zoom) as f32, (28.0 * k * view.zoom) as f32)), Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), n.y, Color32::WHITE);
                batch.frame(atlas, &view, &tree_key(n.palm, n.snow), 50.0, 110.0, n.x, n.y, k, n.y, Color32::WHITE);
            } else {
                let tl = view.to_screen(n.x + 7.0 - 28.0, n.y + 7.0 - 18.0);
                batch.quad(shadow_id, Rect::from_min_size(tl, egui::vec2((56.0 * view.zoom) as f32, (36.0 * view.zoom) as f32)), Rect::from_min_max(egui::pos2(0.0, 0.0), egui::pos2(1.0, 1.0)), n.y, Color32::WHITE);
                batch.frame(atlas, &view, &resource_key(n), 55.0, 80.0, n.x, n.y, 1.0, n.y, Color32::WHITE);
            }
        }
        // ---- structures ----
        let known: Vec<&Building> = sim.state.buildings.iter().map(|b| if b.team == 0 || sim.fog.sees(b.x, b.y) { Some(b) } else { sim.fog.known.get(&b.id) }).flatten().collect();
        for b in &known {
            if !view.on_screen(b.x, b.y, 120f64.max(visual_height(b) + b.h / 2.0)) {
                continue;
            }
            let depth = b.y + b.h * 0.3 + if b.wall_attachment.is_some() { 40.0 } else { 0.0 };
            match b.kind {
                BKind::Wall | BKind::Bastionwall => {
                    cv.rect(b.x - 16.0, b.y - 16.0, 32.0, 32.0, col(if b.fortified { "#6d6a63" } else { "#a09a89" }));
                }
                BKind::Greatengine => {
                    batch.frame(atlas, &view, &great_engine_key(b, time), 150.0, 240.0, b.x, b.y, 1.0, depth, Color32::WHITE);
                }
                BKind::Colossus => {
                    cv.ellipse(b.x, b.y, b.w / 2.0, b.h / 2.0, col("#4a3b2a"));
                }
                _ => {
                    let (width, _h, oy) = building_canvas(b);
                    let key = building_key(b);
                    if b.hp > 0.0 && b.progress < 1.0 {
                        batch.frame_partial(atlas, &view, &key, width / 2.0, oy, b.x, b.y, 1.0, depth, b.progress.max(0.08), Color32::from_white_alpha(230));
                    } else {
                        batch.frame(atlas, &view, &key, width / 2.0, oy, b.x, b.y, 1.0, depth, Color32::WHITE);
                        if b.hp > 0.0 && !matches!(b.kind, BKind::Wall | BKind::Farm | BKind::Gate | BKind::Bastiongate) {
                            let frame = (((draw_time * 0.7) / (std::f64::consts::PI * 2.0)) * 24.0).floor() as i64 % 24;
                            batch.frame(atlas, &view, &building_motion_key(b, frame), width / 2.0, oy, b.x, b.y, 1.0, depth + 0.001, Color32::WHITE);
                        }
                    }
                }
            }
        }
        // ---- units ----
        let mut visible: Vec<usize> = (0..sim.state.units.len()).filter(|&i| {
            let u = &sim.state.units[i];
            u.hp > 0.0 && view.on_screen(u.x, u.y, 130.0) && (u.team == 0 || sim.fog.sees(u.x, u.y))
        }).collect();
        visible.sort_by(|&a, &b| sim.state.units[a].y.partial_cmp(&sim.state.units[b].y).unwrap_or(std::cmp::Ordering::Equal));
        let crowd = visible.iter().filter(|&&i| clustered(sim.state.units[i].ty)).count();
        let per_unit = ((2400 / crowd.max(1)) as usize).clamp(1, 3);
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
            let tint = Color32::WHITE;
            match u.ty {
                UType::Ram | UType::Ballista | UType::Trebuchet => {
                    batch.frame(atlas, &view, &siege_machine_key(u, time, angle), 80.0, 120.0, u.x, u.y, 0.72, u.y, tint);
                }
                UType::Pilgrim | UType::Merchant => {
                    batch.frame(atlas, &view, &caravan_frame(u, time, angle), 80.0, 120.0, u.x, u.y, 0.72, u.y, tint);
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
                            v.moving = if motion { u.moving } else { false };
                            v.strike = if motion { (u.strike - k as f64 * 0.04).max(0.0) } else { 0.0 };
                            batch.frame(atlas, &view, &person_key(&v, angle), 50.0, 95.0, f.x, f.y, 0.72, f.y, tint);
                        }
                    } else {
                        let mut v = u.clone();
                        if !motion {
                            v.anim = 0.0;
                            v.work_phase = Some(0.0);
                            v.moving = false;
                            v.strike = 0.0;
                        }
                        batch.frame(atlas, &view, &person_key(&v, angle), 50.0, 95.0, u.x, u.y, 0.72, u.y, tint);
                        if u.ty == UType::Standard {
                            let st = self.standard_stop.entry(u.id).or_insert((u.moving, -10.0));
                            if st.0 && !u.moving {
                                st.1 = time;
                            }
                            st.0 = u.moving;
                            let pose = if u.moving { (time * 12.0).floor() as i64 % 12 } else { ((time - st.1).max(0.0) * 3.0).floor().min(24.0) as i64 };
                            batch.frame(atlas, &view, &standard_key(u, pose, u.moving), 130.0, 120.0, u.x, u.y, 0.72, u.y + 0.01, tint);
                        }
                    }
                }
            }
        }
        batch.flush(&painter);

        // ---- unit overlays ----
        for &i in &visible {
            let u = &sim.state.units[i];
            if self.selected.contains(&u.id) {
                cv.circle_stroke(u.x, u.y, if u.ty == UType::Knight { 18.0 } else { 12.0 }, 1.8, col("#ede1ae"));
            }
            if self.selected.contains(&u.id) || u.hp < u.max_hp {
                let w = if u.ty == UType::Trebuchet { 40.0 } else { 28.0 };
                health_bar(&cv, u.x, u.y - 32.0, u.hp / u.max_hp, w, u.team);
            }
        }
        for b in &known {
            if b.hp > 0.0 && view.on_screen(b.x, b.y, 200.0) {
                if b.hp < b.max_hp || b.team == 1 {
                    health_bar(&cv, b.x, b.y + b.h / 2.0 + 10.0, b.hp / b.max_hp, b.w.min(90.0), b.team);
                }
                if b.progress < 1.0 {
                    health_bar(&cv, b.x, b.y - b.h / 2.0 - 12.0, b.progress, 70.0, 0);
                }
            }
        }
    }
}

pub fn health_bar(cv: &Canvas, x: f64, y: f64, ratio: f64, w: f64, team: i32) {
    cv.rect(x - w / 2.0, y, w, 4.0, col("#38402c99"));
    cv.rect(x - w / 2.0, y, w * ratio.clamp(0.0, 1.0), 4.0, col(if team == 1 { "#a74734" } else { "#72934e" }));
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.frames += 1;
        let dt = ctx.input(|i| i.unstable_dt) as f64;
        self.atlas.begin_frame(ctx);
        self.step_sim(dt.min(0.1));
        egui::CentralPanel::default().frame(egui::Frame::none()).show(ctx, |ui| {
            let rect = ui.max_rect();
            self.draw_world(ui, rect, dt);
        });
        // Screenshot mode: wait for atlas pages, capture, quit.
        if let Some(path) = self.args.shot.clone() {
            match self.shot_state {
                ShotState::Waiting(n) => {
                    let idle = self.atlas.pending_pages() == 0;
                    self.shot_state = if (idle && n > 8) || n > 600 { ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot); ShotState::Requested } else { ShotState::Waiting(n + 1) };
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
        ctx.request_repaint();
        let _ = Stroke::NONE;
    }
}
