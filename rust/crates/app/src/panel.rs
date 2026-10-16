//! The bottom command panel: selection summary, command buttons and cards.

use crate::hud::{paint_frame, portrait_building, portrait_unit, Frame};
use crate::keys::*;
use crate::paint::col;
use crate::text::{cap, cost_text, role, unit_name};
use crate::ui_state::*;
use cruciata_core::build::COLOSSUS_MIN_RANGE;
use cruciata_core::data::data;
use cruciata_core::model::*;
use crate::style::*;
use eframe::egui::{self, Align2, Color32, Id, Pos2, Rect, Sense, Stroke, Vec2};

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

// ---- layout of the whole panel (metrics from the web page) ------------------

#[derive(Clone, Copy, PartialEq)]
enum Act {
    Stance(&'static str),
    UpGate,
    UpTower,
    ToggleGate,
    Destroy,
    ClearPatch,
    Bless,
    Scout,
    Deploy,
    CancelTarget,
    Cancel,
}

struct CmdSpec {
    icon: &'static str,
    label: String,
    key: &'static str,
    enabled: bool,
    active: bool,
    tip: String,
    wide: bool,
    act: Act,
}

pub fn command_panel(ui: &mut egui::Ui, rect: Rect, f: &mut Frame) {
    let p = ui.painter().clone();
    let sel = describe(f);
    let x0 = rect.min.x + 10.0;
    let y0 = rect.min.y + 10.0;
    // Portrait.
    let icon = Rect::from_min_size(Pos2::new(x0, y0 + 4.0), Vec2::new(57.0, 66.0));
    p.rect_filled(icon, 0.0, col("#272b22"));
    ridge(&p, icon, 2.0, col("#7b6541"));
    selection_portrait(ui, f, icon.shrink(2.0));
    // Text column.
    let tx = x0 + 65.0;
    let tw = 140.0;
    let ctx = ui.ctx().clone();
    let mut y = y0 + 3.0;
    spaced(&p, Pos2::new(tx, y), &sel.label, sans(7.0), col("#bba279"), 1.4);
    y += 12.0;
    y += paragraph(&p, Pos2::new(tx, y), tw, &sel.title, fell(18.0), col(INK), 21.0) + 4.0;
    y += paragraph(&p, Pos2::new(tx, y), tw, &sel.detail, sans(9.0), col("#dec8a4"), 13.0) + 6.0;
    let role_h = paragraph_height(&ctx, tw, &sel.role, sans(10.0), 14.0).min(rect.max.y - 40.0 - y);
    {
        let clip = Rect::from_min_size(Pos2::new(tx, y), Vec2::new(tw, role_h.max(0.0)));
        let pc = p.with_clip_rect(clip);
        paragraph(&pc, Pos2::new(tx, y), tw, &sel.role, sans(10.0), col("#efd99c"), 14.0);
    }
    y += role_h + 8.0;
    let bar = Rect::from_min_size(Pos2::new(tx, y.min(rect.max.y - 30.0)), Vec2::new(tw, 4.0));
    p.rect_filled(bar, 0.0, col("#1c241c"));
    p.rect_filled(Rect::from_min_size(bar.min, Vec2::new(tw * sel.health.clamp(0.0, 1.0) as f32, 4.0)), 0.0, col("#7f965a"));
    paragraph(&p, Pos2::new(tx, bar.max.y + 4.0), tw, &sel.queue, sans(7.0), col("#b8a076"), 11.0);

    // Commands column.
    commands(ui, Rect::from_min_size(Pos2::new(rect.min.x + 225.0, y0 + 1.0), Vec2::new(105.0, rect.height() - 20.0)), f);
    // Muster column.
    muster(ui, Rect::from_min_max(Pos2::new(rect.min.x + 340.0, y0), Pos2::new(rect.max.x - 10.0, rect.max.y - 10.0)), f);
}

fn cmd_icon(p: &egui::Painter, kind: &str, c0: Pos2, color: Color32) {
    let s = Stroke::new(1.6, color);
    match kind {
        "cross" => {
            p.line_segment([c0 + Vec2::new(0.0, -6.0), c0 + Vec2::new(0.0, 6.0)], s);
            p.line_segment([c0 + Vec2::new(-4.0, -2.0), c0 + Vec2::new(4.0, -2.0)], s);
        }
        "x" => {
            p.line_segment([c0 + Vec2::new(-4.0, -4.0), c0 + Vec2::new(4.0, 4.0)], s);
            p.line_segment([c0 + Vec2::new(-4.0, 4.0), c0 + Vec2::new(4.0, -4.0)], s);
        }
        "scout" => {
            p.circle_stroke(c0, 4.5, Stroke::new(1.3, color));
            p.line_segment([c0 + Vec2::new(0.0, -7.0), c0 + Vec2::new(0.0, -2.5)], s);
            p.line_segment([c0 + Vec2::new(0.0, 2.5), c0 + Vec2::new(0.0, 7.0)], s);
            p.line_segment([c0 + Vec2::new(-7.0, 0.0), c0 + Vec2::new(-2.5, 0.0)], s);
            p.line_segment([c0 + Vec2::new(2.5, 0.0), c0 + Vec2::new(7.0, 0.0)], s);
        }
        "hammer" => {
            p.line_segment([c0 + Vec2::new(-3.0, 5.0), c0 + Vec2::new(3.0, -3.0)], s);
            p.rect_filled(Rect::from_center_size(c0 + Vec2::new(3.0, -4.0), Vec2::new(8.0, 4.0)), 1.0, color);
        }
        "swords" => {
            p.line_segment([c0 + Vec2::new(-5.0, 5.0), c0 + Vec2::new(5.0, -5.0)], s);
            p.line_segment([c0 + Vec2::new(5.0, 5.0), c0 + Vec2::new(-5.0, -5.0)], s);
        }
        "shield" => {
            p.add(egui::Shape::convex_polygon(vec![c0 + Vec2::new(-5.0, -5.0), c0 + Vec2::new(5.0, -5.0), c0 + Vec2::new(5.0, 1.0), c0 + Vec2::new(0.0, 6.0), c0 + Vec2::new(-5.0, 1.0)], Color32::TRANSPARENT, Stroke::new(1.4, color)));
        }
        "ban" => {
            p.circle_stroke(c0, 5.0, Stroke::new(1.4, color));
            p.line_segment([c0 + Vec2::new(-3.5, 3.5), c0 + Vec2::new(3.5, -3.5)], Stroke::new(1.4, color));
        }
        "gate" => {
            p.add(egui::Shape::line(vec![c0 + Vec2::new(-5.0, 6.0), c0 + Vec2::new(-5.0, -1.0), c0 + Vec2::new(0.0, -6.0), c0 + Vec2::new(5.0, -1.0), c0 + Vec2::new(5.0, 6.0)], Stroke::new(1.4, color)));
        }
        "tower" => {
            p.rect_stroke(Rect::from_center_size(c0 + Vec2::new(0.0, 1.0), Vec2::new(8.0, 11.0)), 0.0, Stroke::new(1.4, color));
            p.line_segment([c0 + Vec2::new(-5.0, -5.0), c0 + Vec2::new(5.0, -5.0)], s);
        }
        _ => {
            p.circle_stroke(c0, 4.0, Stroke::new(1.4, color));
        }
    }
}

fn commands(ui: &mut egui::Ui, rect: Rect, f: &mut Frame) {
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
    let walls = f.ui.selected_structures(g, &|b| b.kind == BKind::Wall);
    let gate_possible: Vec<usize> = walls.iter().copied().filter(|&i| g.sim.gate_partner(i, false).is_some()).collect();
    let tower_possible: Vec<usize> = walls.iter().copied().filter(|&i| g.sim.available_wall(i)).collect();
    let has_gate = !f.ui.selected_structures(g, &|b| b.kind == BKind::Gate && b.progress >= 1.0).is_empty();
    let result = st.result.is_some();
    let patch = f.ui.sel_node.filter(|id| st.nodes.iter().any(|n| n.id == *id));
    let mut specs: Vec<CmdSpec> = Vec::new();
    if stanced {
        specs.push(CmdSpec { icon: "swords", label: "Fight".into(), key: "", enabled: true, active: all_stance("fight"), tip: "Advance and engage enemies in range.".into(), wide: false, act: Act::Stance("fight") });
        specs.push(CmdSpec { icon: "shield", label: "Hold".into(), key: "", enabled: true, active: all_stance("hold"), tip: "Hold position; fight only what comes close.".into(), wide: false, act: Act::Stance("hold") });
        specs.push(CmdSpec { icon: "ban", label: "Stand down".into(), key: "", enabled: true, active: all_stance("stand-down"), tip: "Never attack; flee from danger.".into(), wide: false, act: Act::Stance("stand-down") });
    }
    if let Some(&first) = gate_possible.first() {
        let bast = g.sim.state.buildings[first].fortified || g.sim.gate_partner(first, false).map(|p| g.sim.state.buildings[p].fortified).unwrap_or(false);
        let cost = g.sim.wall_upgrade_cost(BKind::Gate, first);
        let tip = format!("Upgrade two straight wall sections to a gatehouse: {}. {}s. Cancel returns the upgrade resources.", cost_text(&cost), data().bld(if bast { BKind::Bastiongate } else { BKind::Gate }).time);
        specs.push(CmdSpec { icon: "gate", label: if bast { "Upgrade to bastion gate".into() } else { "Upgrade to gate".into() }, key: "", enabled: g.sim.afford(&cost, me) && !result, active: false, tip, wide: false, act: Act::UpGate });
    }
    if let Some(&first) = tower_possible.first() {
        let cost = g.sim.wall_upgrade_cost(BKind::Tower, first);
        let tip = format!("Upgrade a wall section to an armed guard tower: {}. {}s. Cancel returns the upgrade resources.", cost_text(&cost), data().bld(BKind::Tower).time);
        specs.push(CmdSpec { icon: "tower", label: "Upgrade to guard tower".into(), key: "", enabled: g.sim.afford(&cost, me) && !result, active: false, tip, wide: false, act: Act::UpTower });
    }
    if has_gate {
        specs.push(CmdSpec { icon: "gate", label: "Open / close gate".into(), key: "", enabled: true, active: false, tip: "Toggle the gate.".into(), wide: false, act: Act::ToggleGate });
    }
    if patch.is_some() {
        specs.push(CmdSpec { icon: "x", label: "Clear patch".into(), key: "", enabled: true, active: false, tip: "Villagers remove this patch without recovering resources.".into(), wide: false, act: Act::ClearPatch });
    }
    if non_city {
        specs.push(CmdSpec { icon: "x", label: "Destroy building".into(), key: "", enabled: true, active: false, tip: "Demolish the selected structure.".into(), wide: false, act: Act::Destroy });
    }
    if stanced {
        let can_bless = g.faith() >= 30.0 && units.iter().any(|&i| st.units[i].ty != UType::Worker);
        specs.push(CmdSpec { icon: "cross", label: "Bless".into(), key: "B", enabled: can_bless, active: false, tip: "Costs 30 faith: heal and strengthen the selected soldiers for 15 seconds.".into(), wide: false, act: Act::Bless });
        let scouting = units.iter().any(|&i| st.units[i].auto_scout.is_some());
        specs.push(CmdSpec { icon: "scout", label: "Scout".into(), key: "G", enabled: units.iter().any(|&i| st.units[i].ty != UType::Worker), active: scouting, tip: "Explore unknown lands as a company; avoid combat".into(), wide: false, act: Act::Scout });
    }
    if !siege_sel.is_empty() {
        let packing = siege_sel.iter().any(|&i| st.units[i].deployment == "deployed");
        specs.push(CmdSpec { icon: "hammer", label: if packing { "Pack up".into() } else { "Set up".into() }, key: "T", enabled: true, active: false, tip: String::new(), wide: false, act: Act::Deploy });
    }
    if !siege_sel.is_empty() || !great.is_empty() || !colossi.is_empty() {
        let any = siege_sel.iter().any(|&i| st.units[i].fire_target.is_some() || st.units[i].manual_target) || great.iter().chain(colossi.iter()).any(|&i| st.buildings[i].fire_target.is_some() || st.buildings[i].attack_target.is_some());
        specs.push(CmdSpec { icon: "scout", label: "Cancel target".into(), key: "", enabled: any, active: false, tip: String::new(), wide: false, act: Act::CancelTarget });
    }
    if f.ui.can_cancel(g) {
        specs.push(CmdSpec { icon: "x", label: "Cancel".into(), key: "X", enabled: true, active: false, tip: String::new(), wide: true, act: Act::Cancel });
    }
    let bs = ButtonStyle::standard(8.0);
    let (cw, ch, gap) = (50.0, 42.0, 4.0);
    let (mut cx, mut cy) = (0usize, 0.0f32);
    let mut clicked: Option<Act> = None;
    let mut idn = 0;
    for sp in &specs {
        if sp.wide {
            if cx != 0 {
                cx = 0;
                cy += ch + gap;
            }
        }
        let r = if sp.wide { Rect::from_min_size(rect.min + Vec2::new(0.0, cy), Vec2::new(cw * 2.0 + gap, 27.0)) } else { Rect::from_min_size(rect.min + Vec2::new(cx as f32 * (cw + gap), cy), Vec2::new(cw, ch)) };
        let resp = ui.interact(r, Id::new(("cmd", idn)), if sp.enabled { Sense::click() } else { Sense::hover() });
        idn += 1;
        let p = ui.painter().clone();
        paint_button(&p, r, "", &bs, sp.active, sp.enabled, resp.hovered());
        let fade = if sp.enabled { 1.0 } else { 0.42 };
        if sp.wide {
            cmd_icon(&p, sp.icon, Pos2::new(r.min.x + r.width() / 2.0 - 28.0, r.center().y), col("#c5a574").gamma_multiply(fade));
            p.text(Pos2::new(r.center().x - 8.0, r.center().y), Align2::LEFT_CENTER, &sp.label, sans(8.0), col(INK).gamma_multiply(fade));
        } else {
            cmd_icon(&p, sp.icon, Pos2::new(r.center().x, r.min.y + 13.0), col("#c5a574").gamma_multiply(fade));
            let mut ty = r.min.y + 24.0;
            let w = r.width() - 6.0;
            for line in wrap_words(ui.ctx(), &sp.label, sans(8.0), w) {
                p.text(Pos2::new(r.center().x, ty), Align2::CENTER_TOP, line, sans(8.0), col(INK).gamma_multiply(fade));
                ty += 9.5;
            }
        }
        if !sp.key.is_empty() {
            kbd(&p, Pos2::new(r.max.x - 3.0, r.min.y + 9.0), sp.key);
        }
        let resp = if sp.tip.is_empty() { resp } else { resp.on_hover_text(sp.tip.clone()) };
        if sp.enabled && resp.clicked() {
            clicked = Some(sp.act);
        }
        if sp.wide {
            cx = 0;
            cy += 27.0 + gap;
        } else {
            cx += 1;
            if cx == 2 {
                cx = 0;
                cy += ch + gap;
            }
        }
    }
    let ui_state = &mut *f.ui;
    let game = &mut *f.g;
    match clicked {
        Some(Act::Stance(s)) => ui_state.set_stance(game, s),
        Some(Act::UpGate) => ui_state.wall_upgrade(game, BKind::Gate),
        Some(Act::UpTower) => ui_state.wall_upgrade(game, BKind::Tower),
        Some(Act::ToggleGate) => ui_state.toggle_gate(game),
        Some(Act::Destroy) => ui_state.destroy(game),
        Some(Act::ClearPatch) => {
            if let Some(n) = ui_state.sel_node {
                let units: Vec<u32> = ui_state.selected.iter().copied().collect();
                game.issue(cruciata_core::lockstep::PlayerCommand::Game(cruciata_core::commands::Command::ClearPatch { units, node: n }));
            }
        }
        Some(Act::Bless) => ui_state.bless(game),
        Some(Act::Scout) => ui_state.scout(game),
        Some(Act::Deploy) => ui_state.deploy(game),
        Some(Act::CancelTarget) => ui_state.cancel_targeting(game),
        Some(Act::Cancel) => ui_state.cancel(game),
        None => {}
    }
}

/// Greedy word wrap into lines no wider than `width`.
fn wrap_words(ctx: &egui::Context, s: &str, font: egui::FontId, width: f32) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut cur = String::new();
    for word in s.split_whitespace() {
        let trial = if cur.is_empty() { word.to_string() } else { format!("{cur} {word}") };
        if !cur.is_empty() && text_width(ctx, &trial, font.clone()) > width {
            lines.push(std::mem::take(&mut cur));
            cur = word.to_string();
        } else {
            cur = trial;
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

fn muster(ui: &mut egui::Ui, rect: Rect, f: &mut Frame) {
    let p = ui.painter().clone();
    let ctx = ui.ctx().clone();
    let has_research = {
        let g = &*f.g;
        !f.ui.selected_structures(g, &|b| b.progress >= 1.0 && data().techs.iter().any(|t| t.producer == b.kind)).is_empty()
    };
    let tabs: Vec<(&str, Tab)> = [("Muster", Tab::Army), ("Build", Tab::Settlement)].into_iter().chain(if has_research { Some(("Unit upgrades", Tab::Research)) } else { None }).collect();
    if f.ui.tab == Tab::Research && !has_research {
        f.ui.tab = Tab::Army;
    }
    let mut x = rect.min.x;
    for (i, (label, tab)) in tabs.iter().enumerate() {
        let w = text_width(&ctx, label, fell(13.0)) + 20.0;
        let r = Rect::from_min_size(Pos2::new(x, rect.min.y), Vec2::new(w, 29.0));
        let resp = ui.interact(r, Id::new(("tab", i)), Sense::click());
        let sel = f.ui.tab == *tab;
        if sel {
            p.rect_filled(r, 0.0, col("#5d493033"));
            p.rect_filled(Rect::from_min_size(Pos2::new(r.min.x, r.max.y - 2.0), Vec2::new(w, 2.0)), 0.0, col("#c29858"));
        }
        p.text(r.center() - Vec2::new(0.0, 1.0), Align2::CENTER_CENTER, label, fell(13.0), if sel { col("#e4cda2") } else if resp.hovered() { col("#cdb88e") } else { col("#a9946b") });
        if resp.clicked() {
            f.ui.tab = *tab;
        }
        x += w + 4.0;
    }
    p.line_segment([Pos2::new(rect.min.x, rect.min.y + 29.0), Pos2::new(rect.max.x, rect.min.y + 29.0)], Stroke::new(1.0, col("#7c6240")));
    let body = Rect::from_min_max(Pos2::new(rect.min.x, rect.min.y + 36.0), rect.max);
    let mut child = ui.child_ui(body, egui::Layout::top_down(egui::Align::Min), None);
    child.set_clip_rect(body.intersect(ui.clip_rect()));
    egui::ScrollArea::vertical().id_salt("cards").auto_shrink([false, false]).show(&mut child, |ui| {
        ui.spacing_mut().item_spacing = Vec2::new(5.0, 5.0);
        match f.ui.tab {
            Tab::Army => recruit_cards(ui, f),
            Tab::Settlement => build_cards(ui, f),
            Tab::Research => research_cards(ui, f),
        }
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

fn card(ui: &mut egui::Ui, f: &mut Frame, c: &Card, size: Vec2, name_font: egui::FontId, art: &dyn Fn(&egui::Painter, &mut crate::atlas::Atlas, Rect)) -> bool {
    let (r, resp) = ui.allocate_exact_size(size, if c.enabled { Sense::click() } else { Sense::hover() });
    let p = ui.painter().clone();
    let (top, bottom, border) = if c.active { (col("#715335"), col("#715335"), col("#d0ad6b")) } else if c.done { (col("#394530"), col("#394530"), col("#78875b")) } else if resp.hovered() && c.enabled { (col("#675038"), col("#503c2a"), col("#a98550")) } else { (col("#534128"), col("#403123"), col("#796040")) };
    gradient_v(&p, r, top, bottom);
    p.rect_stroke(r, 2.0, Stroke::new(1.0, border));
    let a = if c.enabled || c.done { 1.0 } else { 0.5 };
    let art_rect = Rect::from_min_size(r.min + Vec2::new(0.0, 6.0), Vec2::new(r.width(), (size.y * 0.42).min(46.0)));
    let pp = p.with_clip_rect(r);
    art(&pp, f.atlas, art_rect);
    if a < 1.0 {
        p.rect_filled(r.shrink(1.0), 0.0, Color32::from_black_alpha(80));
    }
    let name_y = if size.y > 100.0 { r.min.y + 50.0 } else { art_rect.max.y + 6.0 };
    let lines = wrap_words(ui.ctx(), &c.name, name_font.clone(), r.width() - 6.0);
    let mut ny = if size.y < 100.0 { r.min.y + 30.0 } else { name_y };
    for line in lines {
        p.text(Pos2::new(r.center().x, ny), Align2::CENTER_TOP, line, name_font.clone(), col(INK).gamma_multiply(a));
        ny += name_font.size + 1.0;
    }
    if let Some(b) = &c.badge {
        p.text(r.right_top() + Vec2::new(-5.0, 9.0), Align2::RIGHT_CENTER, b, sans(10.0), col("#e8d08a"));
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
        ui.label(egui::RichText::new(name).font(fell(14.0)).color(col("#f3e5c0")));
        ui.label(egui::RichText::new(tip_text).font(sans(11.0)).color(col("#f3e5c0")));
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
            if card(ui, f, &c, Vec2::new(129.0, 125.0), fell(12.0), &|p, a, r| portrait_unit(p, a, ty, me, rank, r, 1.0)) {
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
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = Vec2::new(12.0, 8.0);
        for (label, kinds) in groups {
            ui.allocate_ui(Vec2::new(156.0, 0.0), |ui| {
                ui.set_width(156.0);
                ui.label(egui::RichText::new(label).font(fell(11.0)).color(col("#c8a467")));
                ui.add_space(-2.0);
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = Vec2::new(4.0, 4.0);
                    for k in kinds {
                        let kind = kind_by_name(k);
                        let spec = data().bld(kind);
                        let Some(cost) = spec.cost.clone() else { continue };
                        let locked = !f.g.sim.is_unlocked(kind, f.g.me);
                        let enabled = !locked && f.g.sim.afford(&cost, f.g.me) && f.g.sim.state.result.is_none() && !(kind == BKind::Colossus && f.g.sim.colossus_of(f.g.me).is_some());
                        let lock = if locked { Some(format!("Locked: research {} at a siege workshop.", if kind == BKind::Greatengine { "Great engines" } else { "Colossal engineering" })) } else { None };
                        let tip = format!("{}s per villager. {}", spec.time, spec.description.unwrap_or(""));
                        let c = Card { name: spec.name.to_string(), cost: Some(&cost), tip, enabled, active: f.ui.placement == Some(kind), done: false, badge: None, lock };
                        if card(ui, f, &c, Vec2::new(74.0, 54.0), fell(9.5), &|p, a, r| portrait_building(p, a, kind, Rect::from_min_size(r.min, Vec2::new(r.width(), 24.0)), (30.0, 20.0))) {
                            clicked = Some(kind);
                        }
                    }
                });
            });
        }
    });
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
            if card(ui, f, &c, Vec2::new(129.0, 93.0), fell(12.0), &|p, a, r| {
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

pub fn _unused() -> f64 {
    COLOSSUS_MIN_RANGE
}
