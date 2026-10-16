//! The bottom command panel: selection summary, command buttons and cards.

use crate::hud::*;
use crate::keys::*;
use crate::paint::col;
use crate::text::*;
use crate::ui_state::*;
use cruciata_core::build::COLOSSUS_MIN_RANGE;
use cruciata_core::data::data;
use cruciata_core::model::*;
use eframe::egui::{self, Color32, Pos2, Rect, RichText, Sense, Stroke, Vec2};

const RECRUIT: [UType; 9] = [UType::Worker, UType::Sword, UType::Archer, UType::Knight, UType::Chaplain, UType::Standard, UType::Trebuchet, UType::Ram, UType::Ballista];

fn kind_by_name(n: &str) -> BKind {
    match n {
        "towncenter" => BKind::Towncenter,
        "house" => BKind::House,
        "chapel" => BKind::Chapel,
        "farm" => BKind::Farm,
        "mill" => BKind::Mill,
        "lumbercamp" => BKind::Lumbercamp,
        "miningcamp" => BKind::Miningcamp,
        "barracks" => BKind::Barracks,
        "stable" => BKind::Stable,
        "siegeworkshop" => BKind::Siegeworkshop,
        "watchtower" => BKind::Watchtower,
        "tower" => BKind::Tower,
        "wall" => BKind::Wall,
        "bastionwall" => BKind::Bastionwall,
        "greatengine" => BKind::Greatengine,
        _ => BKind::Colossus,
    }
}

struct Selection {
    label: String,
    title: String,
    detail: String,
    role: String,
    health: f64,
    queue: String,
}

fn describe(f: &Frame) -> Selection {
    let g = &*f.g;
    let ui = &*f.ui;
    let st = &g.sim.state;
    let units = ui.selected_units(g);
    let b = ui.first_building().and_then(|id| st.buildings.iter().find(|b| b.id == id && b.hp > 0.0));
    let mut s = Selection { label: "CRUSADER HOST".into(), title: "The pilgrim company".into(), detail: "Select troops, villagers, or a structure.".into(), role: String::new(), health: 1.0, queue: String::new() };
    let single = units.first().map(|&i| &st.units[i]);
    if let Some(u) = single {
        s.role = if units.iter().all(|&i| st.units[i].ty == u.ty) { role(u.ty).map(|r| r.1.to_string()).unwrap_or_default() } else { "Mixed company: infantry forward, archers behind, chaplains protected at the rear.".into() };
    }
    if let Some(b) = b {
        let spec = data().bld(b.kind);
        s.title = if b.city_center == Some(true) {
            st.cities.iter().find(|c| Some(c.id) == b.city).map(|c| c.name.clone()).unwrap_or_else(|| "City center".into())
        } else if b.outpost == Some(true) {
            st.sites.iter().find(|x| Some(x.id) == b.site).map(|x| x.name.clone()).unwrap_or_else(|| "Outpost".into())
        } else if b.kind == BKind::Chapel && b.team == 1 {
            "Prayer house".into()
        } else if b.kind == BKind::Wall && b.fortified {
            data().bld(BKind::Bastionwall).name.into()
        } else if b.bastion_gate == Some(true) {
            data().bld(BKind::Bastiongate).name.into()
        } else {
            spec.name.into()
        };
        s.label = if b.team == g.me { "YOUR STRUCTURE" } else if b.team == 2 { if b.outpost == Some(true) { "NEUTRAL OUTPOST" } else { "CIVILIAN SETTLEMENT" } } else { "OPPOSING GARRISON" }.into();
        s.detail = if b.progress < 1.0 { format!("{}% constructed", (b.progress * 100.0).floor()) } else { format!("{} / {} health", b.hp.round(), b.max_hp) };
        s.health = b.hp / b.max_hp;
        let q = b.queue.first().cloned().or_else(|| b.upgrade_owner.and_then(|o| st.buildings.iter().find(|x| x.id == o)).and_then(|o| o.queue.first().cloned()));
        if let Some(q) = q {
            let name = if q.kind == "unit" {
                unit_name(q.ty.unwrap_or(UType::Sword), b.team, g.sim.rank_for(q.ty.unwrap_or(UType::Sword), b.team))
            } else if q.kind == "building-upgrade" {
                if q.extra.get("targetKind").and_then(|v| v.as_str()) == Some("gate") { "Gatehouse upgrade".into() } else { "Guard tower upgrade".into() }
            } else {
                q.tech.as_deref().and_then(|t| data().tech(t)).map(|t| t.name.to_string()).unwrap_or_default()
            };
            s.queue = format!("{} \u{b7} {}s \u{b7} {} queued", name, (q.duration - q.time).ceil(), if b.queue.is_empty() { 1 } else { b.queue.len() });
        }
    } else if let Some(u) = single {
        let workers_only = units.iter().all(|&i| st.units[i].ty == UType::Worker);
        s.label = if workers_only { "YOUR VILLAGERS" } else { "YOUR COMPANY" }.into();
        s.title = if units.len() == 1 { unit_name(u.ty, u.team, u.rank.unwrap_or(0.0)) } else { format!("{} people selected", units.len()) };
        s.health = units.iter().map(|&i| st.units[i].hp / st.units[i].max_hp).sum::<f64>() / units.len() as f64;
        let mut detail = format!("{}% company health", (s.health * 100.0).round());
        if units.len() == 1 {
            if u.ty == UType::Worker {
                detail = if u.flee_until > st.time {
                    "Seeking shelter".into()
                } else {
                    match u.job.as_ref().map(|j| j.kind.as_str()) {
                        Some("gather") => format!("{} \u{b7} carrying {}", u.job.as_ref().and_then(|j| j.resource).map(res_name).unwrap_or(""), u.carry.floor()),
                        Some("build") => "Constructing".into(),
                        Some("repair") => "Repairing".into(),
                        _ => "Idle villager".into(),
                    }
                };
            }
            if u.ty == UType::Trebuchet {
                detail = u.deployment.replace('-', " ") + &if u.deploy_timer > 0.0 { format!(" \u{b7} {}s", u.deploy_timer.ceil()) } else { String::new() };
            }
            if u.ty == UType::Chaplain {
                detail = "Rear guard \u{b7} healing & benediction".into();
            }
        }
        s.detail = detail;
    }
    if let Some(nid) = ui.sel_node {
        if let Some(n) = st.nodes.iter().find(|n| n.id == nid) {
            s.title = format!("{} patch", cap(res_name(n.kind)));
            s.label = "FINITE RESOURCE".into();
            s.detail = format!("{} / {} remaining", n.remaining.ceil(), n.max);
            s.role = "Right-click with villagers to gather. Clear patch removes it without recovering resources.".into();
            s.health = n.remaining / n.max;
        }
    }
    if ui.sel_buildings.len() > 1 {
        let bs: Vec<&Building> = st.buildings.iter().filter(|b| ui.sel_buildings.contains(&b.id) && b.hp > 0.0).collect();
        s.title = format!("{} selected structures", bs.len());
        s.detail = "Training queues one unit at every selected structure that can make it; building actions take turns.".into();
        s.queue = format!("{} total queued", bs.iter().map(|b| b.queue.len()).sum::<usize>());
    }
    if !units.is_empty() && !ui.sel_buildings.is_empty() {
        s.title = format!("{} units + {} structures", units.len(), ui.sel_buildings.len());
        s.detail = "Orders command the units; training and cancellation apply to selected buildings.".into();
    }
    if let Some(b) = b {
        let spec = data().bld(b.kind);
        s.role = if b.progress < 1.0 {
            "Foundation: assign villagers to build by right-clicking. This project provides no vision until completed.".into()
        } else if b.kind == BKind::Watchtower {
            spec.description.unwrap_or("").into()
        } else if b.outpost == Some(true) {
            "Capturable outpost: hold three soldiers inside its ring for 18 seconds. Its buildings and resident villagers transfer to the capturing army. Neutral outposts provide neither army with vision.".into()
        } else if let Some(d) = &spec.drop {
            format!("Depot: villagers deliver {} here. Right-click this depot with villagers to gather and deliver here. New builders automatically gather after completion.", d.iter().map(|r| res_name(*r)).collect::<Vec<_>>().join(", "))
        } else if b.kind == BKind::Farm {
            format!("Grain field: up to 5 villagers work inside. {} / {} grain remains. Villagers automatically replant exhausted fields. Right-click with villagers to assign.", b.remaining.unwrap_or(0.0).ceil(), b.max.unwrap_or(0.0))
        } else if b.kind == BKind::Gate {
            if b.closed == Some(true) { "Closed fortified gate: blocks both armies. Siege engines breach its reinforced masonry. Open it to permit passage.".into() } else { "Open gate: passage for both armies. Close it to block the gap.".into() }
        } else if b.team == 2 {
            "Protected neutral village: cannot be attacked. Bring at least three soldiers close to claim it. Captured houses add population; protect the civilians.".into()
        } else if data().types.iter().any(|(_, t)| t.producer == Some(b.kind)) {
            "Trains troops. Right-click terrain to set a rally point for new units.".into()
        } else if b.kind == BKind::House {
            "Housing adds 12 population. Cannot train troops or set a rally point.".into()
        } else {
            "Defensive structure. Cannot train troops or set a rally point.".into()
        };
        if b.kind == BKind::Colossus {
            s.role = if b.progress < 1.0 { format!("{}% built. One per side; the enemy knows where it stands.", (b.progress * 100.0).floor()) } else { format!("Reload {}s. Right-click to bombard; the circle shows where shots may land.", b.guard_cooldown.max(0.0).ceil()) };
        }
        if b.kind == BKind::Greatengine {
            s.role = format!("Permanent siege engine. Range 320-2200. Right-click ground to bombard it, or an enemy to lock bombardment. Hold fires only at ordered targets; Stand down ceases fire. Reload: {}s. Keep friendly troops outside the huge impact zone.", b.guard_cooldown.max(0.0).ceil());
        }
        if g.sim.is_capital(st.buildings.iter().position(|x| x.id == b.id).unwrap_or(0)) {
            s.role = "Capital and resource depot. Its destruction decides the battle immediately, regardless of other objectives. Trains villagers and accepts every resource.".into();
        }
    }
    if units.iter().any(|&i| st.units[i].auto_scout.is_some()) {
        s.role = "Scouting together: explores unknown ground, avoids battle and withdraws from attacks. A new order ends scouting.".into();
    }
    s
}

pub fn command_panel(ctx: &egui::Context, f: &mut Frame) {
    egui::TopBottomPanel::bottom("commands").exact_height(236.0).frame(egui::Frame::none().fill(col("#2a2d24")).inner_margin(egui::Margin::same(10.0))).show(ctx, |ui| {
        ui.horizontal_top(|ui| {
            let sel = describe(f);
            // ---- summary ----
            ui.allocate_ui(Vec2::new(280.0, 216.0), |ui| {
                ui.horizontal_top(|ui| {
                    let (r, _) = ui.allocate_exact_size(Vec2::splat(74.0), Sense::hover());
                    ui.painter().rect_filled(r, 2.0, col("#1d2019"));
                    ui.painter().rect_stroke(r, 2.0, Stroke::new(1.0, col("#655039")));
                    selection_portrait(ui, f, r);
                    ui.vertical(|ui| {
                        ui.set_width(190.0);
                        eyebrow(ui, &sel.label);
                        ui.label(RichText::new(&sel.title).size(15.0).strong().color(col("#e4cda2")));
                        ui.label(RichText::new(&sel.detail).size(11.0).color(col(INK)));
                        egui::ScrollArea::vertical().max_height(86.0).id_salt("role").show(ui, |ui| {
                            ui.label(RichText::new(&sel.role).size(9.5).color(col(MUTED)));
                        });
                        let (hr, _) = ui.allocate_exact_size(Vec2::new(190.0, 4.0), Sense::hover());
                        ui.painter().rect_filled(hr, 0.0, col("#1c241c"));
                        ui.painter().rect_filled(Rect::from_min_size(hr.min, Vec2::new(hr.width() * sel.health.clamp(0.0, 1.0) as f32, 4.0)), 0.0, col("#7f965a"));
                        ui.label(RichText::new(&sel.queue).size(9.0).color(col("#b8a076")));
                    });
                });
            });
            ui.separator();
            // ---- commands ----
            ui.allocate_ui(Vec2::new(196.0, 216.0), |ui| commands(ui, f));
            ui.separator();
            // ---- muster ----
            ui.vertical(|ui| muster(ui, f));
        });
    });
}

fn selection_portrait(ui: &mut egui::Ui, f: &mut Frame, r: Rect) {
    let painter = ui.painter_at(r);
    let st = &f.g.sim.state;
    let units = f.ui.selected_units(f.g);
    let b = f.ui.first_building().and_then(|id| st.buildings.iter().find(|b| b.id == id && b.hp > 0.0));
    let c = r.center();
    if let Some(n) = f.ui.sel_node.and_then(|id| st.nodes.iter().find(|n| n.id == id)) {
        paint_frame(&painter, f.atlas, &if n.kind == Res::Wood { tree_key(n.palm, n.snow) } else { resource_key(n) }, 55.0, 80.0, c + Vec2::new(0.0, 14.0), 0.7, Color32::WHITE);
    } else if let Some(b) = b {
        let h = visual_height(b);
        let s = (54.0 / (b.w + 12.0)).min(58.0 / (b.h + h + 20.0)) as f32;
        let (width, _hh, oy) = building_canvas(b);
        let mut bb = b.clone();
        bb.hp = bb.hp.max(1.0);
        if matches!(b.kind, BKind::Wall) {
            painter.rect_filled(Rect::from_center_size(c, Vec2::new(40.0, 18.0)), 2.0, col(if b.fortified { "#6d6a63" } else { "#a09a89" }));
        } else if b.kind == BKind::Greatengine {
            paint_frame(&painter, f.atlas, &great_engine_key(b, st.time), 150.0, 240.0, c + Vec2::new(0.0, 14.0), 0.16, Color32::WHITE);
        } else {
            paint_frame(&painter, f.atlas, &building_key(&bb), width / 2.0, oy, c + Vec2::new(0.0, (h as f32 * s * 0.45).min(30.0)), s, Color32::WHITE);
        }
    } else if let Some(&i) = units.first() {
        let u = &st.units[i];
        let (scale, dy) = match u.ty {
            UType::Ram | UType::Ballista | UType::Trebuchet => (0.5, 15.0),
            UType::Standard => (0.6, 0.0),
            UType::Pilgrim | UType::Merchant => (0.7, 7.0),
            UType::Knight => (0.85, 17.0),
            _ => (1.3, 12.0),
        };
        let mut v = u.clone();
        v.angle = -std::f64::consts::FRAC_PI_2;
        v.moving = false;
        v.working = false;
        v.strike = 0.0;
        let key = match u.ty {
            UType::Ram | UType::Ballista | UType::Trebuchet => siege_machine_key(&v, st.time, v.angle),
            UType::Pilgrim | UType::Merchant => caravan_frame(&v, 0.0, v.angle),
            _ => person_key(&v, v.angle),
        };
        let (ox, oy, s) = match u.ty {
            UType::Ram | UType::Ballista | UType::Trebuchet => (80.0, 120.0, scale as f32),
            UType::Pilgrim | UType::Merchant => (80.0, 120.0, (scale * 0.72) as f32),
            _ => (50.0, 95.0, (scale * 0.72) as f32),
        };
        paint_frame(&painter, f.atlas, &key, ox, oy, c + Vec2::new(0.0, dy as f32), s, Color32::WHITE);
    } else {
        let p = &painter;
        p.line_segment([c + Vec2::new(0.0, -15.0), c + Vec2::new(0.0, 15.0)], Stroke::new(4.0, col("#b69a6b")));
        p.line_segment([c + Vec2::new(-15.0, 0.0), c + Vec2::new(15.0, 0.0)], Stroke::new(4.0, col("#b69a6b")));
    }
}

fn cmd_button(ui: &mut egui::Ui, icon: &str, label: &str, key: &str, enabled: bool, active: bool, tip: &str) -> bool {
    let size = Vec2::new(92.0, 42.0);
    let (r, resp) = ui.allocate_exact_size(size, if enabled { Sense::click() } else { Sense::hover() });
    let fill = if active { col("#754a2d") } else if resp.hovered() && enabled { col("#695236") } else { col("#4a3b2a") };
    let p = ui.painter();
    p.rect_filled(r, 2.0, fill);
    p.rect_stroke(r, 2.0, Stroke::new(1.0, if active { col("#d3aa6b") } else if resp.hovered() && enabled { col("#b2915d") } else { col("#806647") }));
    let a = if enabled { 1.0 } else { 0.42 };
    p.text(r.center() + Vec2::new(0.0, -8.0), egui::Align2::CENTER_CENTER, icon, egui::FontId::proportional(16.0), col("#c5a574").gamma_multiply(a));
    p.text(r.center() + Vec2::new(0.0, 11.0), egui::Align2::CENTER_CENTER, label, egui::FontId::proportional(10.0), col(INK).gamma_multiply(a));
    if !key.is_empty() {
        p.text(r.right_top() + Vec2::new(-4.0, 6.0), egui::Align2::RIGHT_CENTER, key, egui::FontId::proportional(8.0), col(MUTED));
    }
    let resp = if tip.is_empty() { resp } else { resp.on_hover_text(tip) };
    enabled && resp.clicked()
}

fn commands(ui: &mut egui::Ui, f: &mut Frame) {
    let g = &*f.g;
    let st = &g.sim.state;
    let me = g.me;
    let stance_units = f.ui.selected_fighters(g);
    let engines = f.ui.selected_structures(g, &|b| b.kind == BKind::Greatengine && b.progress >= 1.0);
    let stanced = !stance_units.is_empty() || !engines.is_empty();
    let all_stance = |s: &str| stanced && stance_units.iter().all(|&i| st.units[i].stance == s) && engines.iter().all(|&i| g.sim.state.buildings[i].stance.as_deref().unwrap_or("fight") == s);
    let units = f.ui.selected_units(g);
    let siege_sel: Vec<usize> = units.iter().copied().filter(|&i| st.units[i].ty == UType::Trebuchet).collect();
    let great: Vec<usize> = f.ui.selected_structures(g, &|b| b.kind == BKind::Greatengine && b.progress >= 1.0);
    let colossi: Vec<usize> = f.ui.selected_structures(g, &|b| b.kind == BKind::Colossus && b.progress >= 1.0);
    let non_city = !f.ui.selected_structures(g, &|b| b.city_center != Some(true)).is_empty();
    let gate_possible: Vec<usize> = f.ui.selected_structures(g, &|b| b.kind == BKind::Wall).into_iter().filter(|&i| g.sim.gate_partner(i, false).is_some()).collect();
    let tower_possible: Vec<usize> = f.ui.selected_structures(g, &|b| b.kind == BKind::Wall).into_iter().filter(|&i| g.sim.available_wall(i)).collect();
    let has_gate = !f.ui.selected_structures(g, &|b| b.kind == BKind::Gate && b.progress >= 1.0).is_empty();
    let result = st.result.is_some();
    let mut do_stance: Option<&str> = None;
    let mut up_gate = false;
    let mut up_tower = false;
    let mut destroy = false;
    let mut gate = false;
    let (mut bless, mut deploy, mut scout, mut cancel_t, mut cancel) = (false, false, false, false, false);
    let gate_cost;
    let tower_cost;
    {
        let first_gate = gate_possible.first().copied();
        let bast = first_gate.map(|i| g.sim.state.buildings[i].fortified || g.sim.gate_partner(i, false).map(|p| g.sim.state.buildings[p].fortified).unwrap_or(false)).unwrap_or(false);
        gate_cost = first_gate.map(|i| g.sim.wall_upgrade_cost(BKind::Gate, i));
        tower_cost = tower_possible.first().map(|&i| g.sim.wall_upgrade_cost(BKind::Tower, i));
        egui::Grid::new("cmdgrid").num_columns(2).spacing([4.0, 4.0]).show(ui, |ui| {
            if stanced {
                if cmd_button(ui, "/", "Fight", "", true, all_stance("fight"), "Advance and engage enemies in range.") {
                    do_stance = Some("fight");
                }
                if cmd_button(ui, "=", "Hold", "", true, all_stance("hold"), "Hold position; fight only what comes close.") {
                    do_stance = Some("hold");
                }
                ui.end_row();
                if cmd_button(ui, "-", "Stand down", "", true, all_stance("stand-down"), "Never attack; flee from danger.") {
                    do_stance = Some("stand-down");
                }
            }
            if !gate_possible.is_empty() {
                let cost = gate_cost.clone().unwrap_or_default();
                let tip = format!("{}: {}. {}s.", "Upgrade two straight wall sections to a gatehouse", cost_text(&cost), data().bld(if bast { BKind::Bastiongate } else { BKind::Gate }).time);
                if cmd_button(ui, "#", if bast { "Bastion gate" } else { "Gate" }, "", g.sim.afford(&cost, me) && !result, false, &tip) {
                    up_gate = true;
                }
            }
            if !tower_possible.is_empty() {
                let cost = tower_cost.clone().unwrap_or_default();
                let tip = format!("Upgrade a wall section to an armed guard tower: {}. {}s.", cost_text(&cost), data().bld(BKind::Tower).time);
                if cmd_button(ui, "T", "Guard tower", "", g.sim.afford(&cost, me) && !result, false, &tip) {
                    up_tower = true;
                }
            }
            if has_gate && cmd_button(ui, "#", "Open / close", "", true, false, "Toggle the gate.") {
                gate = true;
            }
            if non_city && cmd_button(ui, "x", "Destroy", "", true, false, "Demolish the selected structure.") {
                destroy = true;
            }
            ui.end_row();
            if stanced {
                let can_bless = g.faith() >= 30.0 && units.iter().any(|&i| st.units[i].ty != UType::Worker);
                if cmd_button(ui, "+", "Bless", "B", can_bless, false, "Costs 30 faith: heal and strengthen the selected soldiers for 15 seconds.") {
                    bless = true;
                }
                let scouting = units.iter().any(|&i| st.units[i].auto_scout.is_some());
                if cmd_button(ui, "o", "Scout", "G", units.iter().any(|&i| st.units[i].ty != UType::Worker), scouting, "Explore unknown lands as a company; avoid combat") {
                    scout = true;
                }
                ui.end_row();
            }
            if !siege_sel.is_empty() {
                let packing = siege_sel.iter().any(|&i| st.units[i].deployment == "deployed");
                if cmd_button(ui, "*", if packing { "Pack up" } else { "Set up" }, "T", true, false, "") {
                    deploy = true;
                }
            }
            if !siege_sel.is_empty() || !great.is_empty() || !colossi.is_empty() {
                let any = siege_sel.iter().any(|&i| st.units[i].fire_target.is_some() || st.units[i].manual_target) || great.iter().chain(colossi.iter()).any(|&i| st.buildings[i].fire_target.is_some() || st.buildings[i].attack_target.is_some());
                if cmd_button(ui, "o", "Cancel target", "", any, false, "") {
                    cancel_t = true;
                }
            }
            ui.end_row();
        });
        if f.ui.can_cancel(g) && ui.add_sized([188.0, 26.0], egui::Button::new(RichText::new("\u{d7}  Cancel   [X]").size(11.0))).clicked() {
            cancel = true;
        }
    }
    let ui_state = &mut *f.ui;
    let game = &mut *f.g;
    if let Some(s) = do_stance {
        ui_state.set_stance(game, s);
    }
    if up_gate {
        ui_state.wall_upgrade(game, BKind::Gate);
    }
    if up_tower {
        ui_state.wall_upgrade(game, BKind::Tower);
    }
    if gate {
        ui_state.toggle_gate(game);
    }
    if destroy {
        ui_state.destroy(game);
    }
    if bless {
        ui_state.bless(game);
    }
    if scout {
        ui_state.scout(game);
    }
    if deploy {
        ui_state.deploy(game);
    }
    if cancel_t {
        ui_state.cancel_targeting(game);
    }
    if cancel {
        ui_state.cancel(game);
    }
}

fn tab_button(ui: &mut egui::Ui, text: &str, selected: bool) -> bool {
    let r = ui.add(egui::Button::new(RichText::new(text).size(13.0).color(if selected { col("#e4cda2") } else { col("#a9946b") })).fill(if selected { col("#5d493033") } else { Color32::TRANSPARENT }).frame(selected));
    r.clicked()
}

fn muster(ui: &mut egui::Ui, f: &mut Frame) {
    let has_research = {
        let g = &*f.g;
        !f.ui.selected_structures(g, &|b| b.progress >= 1.0 && data().techs.iter().any(|t| t.producer == b.kind)).is_empty()
    };
    ui.horizontal(|ui| {
        if tab_button(ui, "Muster", f.ui.tab == Tab::Army) {
            f.ui.tab = Tab::Army;
        }
        if tab_button(ui, "Build", f.ui.tab == Tab::Settlement) {
            f.ui.tab = Tab::Settlement;
        }
        if has_research && tab_button(ui, "Unit upgrades", f.ui.tab == Tab::Research) {
            f.ui.tab = Tab::Research;
        }
    });
    if f.ui.tab == Tab::Research && !has_research {
        f.ui.tab = Tab::Army;
    }
    ui.separator();
    egui::ScrollArea::vertical().id_salt("cards").auto_shrink([false, false]).show(ui, |ui| match f.ui.tab {
        Tab::Army => recruit_cards(ui, f),
        Tab::Settlement => build_cards(ui, f),
        Tab::Research => research_cards(ui, f),
    });
}

struct Card<'a> {
    name: String,
    cost: Option<&'a Cost>,
    tip: String,
    enabled: bool,
    active: bool,
    done: bool,
    badge: Option<String>,
    lock: Option<String>,
}

fn card(ui: &mut egui::Ui, f: &mut Frame, c: &Card, size: Vec2, art: &dyn Fn(&egui::Painter, &mut crate::atlas::Atlas, Rect)) -> bool {
    let (r, resp) = ui.allocate_exact_size(size, if c.enabled { Sense::click() } else { Sense::hover() });
    let p = ui.painter().clone();
    let fill = if c.active { col("#715335") } else if c.done { col("#394530") } else if resp.hovered() && c.enabled { col("#5d4932") } else { col("#473828") };
    p.rect_filled(r, 2.0, fill);
    p.rect_stroke(r, 2.0, Stroke::new(1.0, if c.active { col("#d0ad6b") } else if c.done { col("#78875b") } else { col("#79603c") }));
    let a = if c.enabled || c.done { 1.0 } else { 0.5 };
    let art_rect = Rect::from_min_size(r.min + Vec2::new(0.0, 2.0), Vec2::new(r.width(), size.y - 34.0));
    let pp = p.with_clip_rect(r);
    art(&pp, f.atlas, art_rect);
    if a < 1.0 {
        p.rect_filled(art_rect, 0.0, Color32::from_black_alpha(90));
    }
    p.text(Pos2::new(r.center().x, r.bottom() - 21.0), egui::Align2::CENTER_CENTER, &c.name, egui::FontId::proportional(11.5), col(INK).gamma_multiply(a));
    if let Some(cost) = c.cost {
        let short = |r: Res| f.g.stock().get(r) < cost.0.iter().find(|x| x.0 == r).map(|x| x.1).unwrap_or(0.0);
        let _ = short;
        p.text(Pos2::new(r.center().x, r.bottom() - 8.0), egui::Align2::CENTER_CENTER, cost_text(cost), egui::FontId::proportional(8.0), col("#bdab80").gamma_multiply(a));
    }
    if let Some(b) = &c.badge {
        p.text(r.right_top() + Vec2::new(-4.0, 8.0), egui::Align2::RIGHT_CENTER, b, egui::FontId::proportional(10.0), col("#e8d08a"));
    }
    let mut tip_text = String::new();
    if let Some(cost) = c.cost {
        let multi: f64 = c.badge.as_ref().and_then(|b| b.trim_start_matches('\u{d7}').parse::<f64>().ok()).unwrap_or(1.0);
        let parts: Vec<String> = cost.0.iter().map(|(rr, n)| format!("{}{} {}", if f.g.stock().get(*rr) < n * multi { "\u{26a0} " } else { "" }, n * multi, res_name(*rr))).collect();
        tip_text.push_str(&parts.join("  \u{b7}  "));
        if multi > 1.0 {
            tip_text.push_str(&format!("   ({} \u{d7} each)\nQueues one at each of the {} selected buildings that can train it.", multi, multi));
        }
        tip_text.push('\n');
    }
    if let Some(l) = &c.lock {
        tip_text.push_str(l);
        tip_text.push('\n');
    }
    tip_text.push_str(&c.tip);
    let name = c.name.clone();
    let resp = resp.on_hover_ui(move |ui| {
        ui.set_max_width(280.0);
        ui.label(RichText::new(name).strong().color(col("#e4cda2")));
        ui.label(RichText::new(tip_text).size(10.5).color(col(INK)));
    });
    c.enabled && resp.clicked()
}

fn recruit_cards(ui: &mut egui::Ui, f: &mut Frame) {
    let mut clicked: Option<UType> = None;
    let sel_structs = !f.ui.selected_structures(f.g, &|_| true).is_empty();
    ui.horizontal_wrapped(|ui| {
        for ty in RECRUIT {
            let spec = data().ty(ty);
            let visible = f.ui.selected_structures(f.g, &|b| Some(b.kind) == spec.producer && b.progress >= 1.0);
            if visible.is_empty() {
                continue;
            }
            let trainers = f.ui.trainers(f.g, ty);
            let pop = f.g.sim.population(f.g.me);
            let producer_ok = !trainers.is_empty();
            let cost = spec.cost.clone().unwrap_or_default();
            let enabled = producer_ok && f.g.sim.afford(&cost, f.g.me) && pop.used + pop.queued < pop.cap && !trainers.iter().all(|&i| f.g.sim.state.buildings[i].queue.len() >= 8) && f.g.sim.state.result.is_none();
            let crowd = if sel_structs { trainers.len() } else { 0 };
            let rank = f.g.rank_for(ty);
            let name = {
                let n = unit_name(ty, f.g.me, rank);
                if rank == 0.0 { spec.short.map(String::from).unwrap_or(n) } else { n }
            };
            let tip = format!("Trained at the {}. {}", spec.producer.map(|k| data().bld(k).name.to_lowercase()).unwrap_or_default(), role(ty).map(|r| format!("{}: {}", r.0, r.1)).unwrap_or_default());
            let me = f.g.me;
            let c = Card { name, cost: Some(&cost), tip, enabled, active: false, done: false, badge: if crowd > 1 { Some(format!("\u{d7}{}", crowd)) } else { None }, lock: None };
            if card(ui, f, &c, Vec2::new(86.0, 100.0), &|p, a, r| portrait_unit(p, a, ty, me, rank, r, 1.0)) {
                clicked = Some(ty);
            }
        }
    });
    if let Some(ty) = clicked {
        let (ui_state, g) = (&mut *f.ui, &mut *f.g);
        ui_state.recruit(g, ty);
    }
}

fn build_cards(ui: &mut egui::Ui, f: &mut Frame) {
    let groups: [(&str, &[&str]); 4] = [
        ("Settlement", &["towncenter", "house", "chapel"]),
        ("Economy", &["farm", "mill", "lumbercamp", "miningcamp"]),
        ("Military", &["barracks", "stable", "siegeworkshop"]),
        ("Fortification", &["watchtower", "tower", "wall", "bastionwall", "greatengine", "colossus"]),
    ];
    let mut clicked: Option<BKind> = None;
    for (label, kinds) in groups {
        ui.label(RichText::new(label).size(10.0).color(col(GOLD)));
        ui.horizontal_wrapped(|ui| {
            for k in kinds {
                let kind = kind_by_name(k);
                let spec = data().bld(kind);
                let Some(cost) = spec.cost.clone() else { continue };
                let locked = !f.g.sim.is_unlocked(kind, f.g.me);
                let enabled = !locked && f.g.sim.afford(&cost, f.g.me) && f.g.sim.state.result.is_none() && !(kind == BKind::Colossus && f.g.sim.colossus_of(f.g.me).is_some());
                let lock = if locked { Some(format!("Locked: research {} at a siege workshop.", if kind == BKind::Greatengine { "Great engines" } else { "Colossal engineering" })) } else { None };
                let tip = format!("{}s per villager. {}", spec.time, spec.description.unwrap_or(""));
                let c = Card { name: spec.name.to_string(), cost: Some(&cost), tip, enabled, active: f.ui.placement == Some(kind), done: false, badge: None, lock };
                if card(ui, f, &c, Vec2::new(86.0, 84.0), &|p, a, r| portrait_building(p, a, kind, r, (64.0, 44.0))) {
                    clicked = Some(kind);
                }
            }
        });
    }
    if let Some(k) = clicked {
        let (ui_state, g) = (&mut *f.ui, &*f.g);
        ui_state.begin_build(g, k);
    }
}

fn research_cards(ui: &mut egui::Ui, f: &mut Frame) {
    let mut clicked: Option<&'static str> = None;
    ui.horizontal_wrapped(|ui| {
        for t in data().techs.iter() {
            let has = f.g.has_tech(t.key);
            let producers = f.ui.selected_structures(f.g, &|b| b.kind == t.producer && b.progress >= 1.0);
            if producers.is_empty() || !f.g.sim.tech_available(t.key, f.g.me) && !has {
                continue;
            }
            let queued = f.g.sim.state.buildings.iter().any(|b| b.queue.iter().any(|q| q.tech.as_deref() == Some(t.key)));
            let room = f.ui.selected_structures(f.g, &|b| b.kind == t.producer && b.progress >= 1.0 && b.queue.len() < 8);
            let enabled = !has && !queued && !room.is_empty() && f.g.sim.afford(&t.cost, f.g.me) && f.g.sim.state.result.is_none();
            let (ty, unlock) = (t.ty, t.unlock);
            let me = f.g.me;
            let c = Card { name: t.name.to_string(), cost: Some(&t.cost), tip: t.desc.clone(), enabled, active: false, done: has, badge: None, lock: None };
            if card(ui, f, &c, Vec2::new(118.0, 100.0), &|p, a, r| {
                if let Some(k) = unlock {
                    portrait_building(p, a, k, r, (60.0, 40.0));
                } else if let Some(ty) = ty {
                    portrait_unit(p, a, ty, me, 0.0, r, 1.0);
                }
            }) {
                clicked = Some(t.key);
            }
        }
    });
    if let Some(k) = clicked {
        let (ui_state, g) = (&mut *f.ui, &mut *f.g);
        ui_state.research(g, k);
    }
}

pub fn _unused() -> f64 {
    COLOSSUS_MIN_RANGE
}
