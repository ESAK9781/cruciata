//! World generation and level setup: `makeWorld`, rock escarpments, forests,
//! resource clusters, villages, siege cities and the campaign preparations
//! (`startLevel` and everything it calls).

use crate::build::Plot;
use crate::data::{data, Level};
use crate::js::{clamp, cos, hypot, round, sin, Seeded};
use crate::model::*;
use crate::movement::dist;
use crate::nav::{Nav, Pt};
use crate::sim::{world_height, world_width, Sim};
use crate::world::*;
use indexmap::{IndexMap, IndexSet};
use serde_json::{json, Value};

type Tiles = IndexMap<(i32, i32), ()>;

fn fill_rock_holes(tiles: &mut Tiles, valid: &dyn Fn(i32, i32) -> bool) -> i32 {
    let mut added = 0;
    if tiles.is_empty() {
        return 0;
    }
    let x0 = tiles.keys().map(|k| k.0).min().unwrap() - 1;
    let x1 = tiles.keys().map(|k| k.0).max().unwrap() + 1;
    let y0 = tiles.keys().map(|k| k.1).min().unwrap() - 1;
    let y1 = tiles.keys().map(|k| k.1).max().unwrap() + 1;
    let mut exterior: IndexSet<(i32, i32)> = IndexSet::new();
    let mut queue: Vec<(i32, i32)> = vec![(x0, y0)];
    exterior.insert((x0, y0));
    let mut i = 0;
    while i < queue.len() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let x = queue[i].0 + dx;
            let y = queue[i].1 + dy;
            if x < x0 || x > x1 || y < y0 || y > y1 || tiles.contains_key(&(x, y)) || exterior.contains(&(x, y)) {
                continue;
            }
            exterior.insert((x, y));
            queue.push((x, y));
        }
        i += 1;
    }
    for y in (y0 + 1)..y1 {
        for x in (x0 + 1)..x1 {
            if !tiles.contains_key(&(x, y)) && !exterior.contains(&(x, y)) && valid(x, y) {
                tiles.insert((x, y), ());
                added += 1;
            }
        }
    }
    added
}

pub fn trace_rock_contours(tiles: &Tiles, cell: f64) -> Vec<Vec<Pt>> {
    #[derive(Clone)]
    struct Edge {
        start: Pt,
        end: Pt,
        used: bool,
    }
    let mut edges: Vec<Edge> = Vec::new();
    for &(x, y) in tiles.keys() {
        let (xf, yf) = (x as f64, y as f64);
        let a = Pt::new(xf * cell, yf * cell);
        let b = Pt::new((xf + 1.0) * cell, yf * cell);
        let c = Pt::new((xf + 1.0) * cell, (yf + 1.0) * cell);
        let d = Pt::new(xf * cell, (yf + 1.0) * cell);
        for (dx, dy, start, end) in [(0, -1, a, b), (1, 0, b, c), (0, 1, c, d), (-1, 0, d, a)] {
            if !tiles.contains_key(&(x + dx, y + dy)) {
                edges.push(Edge { start, end, used: false });
            }
        }
    }
    let key = |p: Pt| (p.x.to_bits(), p.y.to_bits());
    let mut starts: IndexMap<(u64, u64), Vec<usize>> = IndexMap::new();
    for (i, e) in edges.iter().enumerate() {
        starts.entry(key(e.start)).or_default().push(i);
    }
    let mut contours: Vec<Vec<Pt>> = Vec::new();
    for ei in 0..edges.len() {
        if edges[ei].used {
            continue;
        }
        let mut contour: Vec<Pt> = Vec::new();
        let first = edges[ei].start;
        let mut next: Option<usize> = Some(ei);
        while let Some(n) = next {
            if edges[n].used {
                break;
            }
            edges[n].used = true;
            contour.push(edges[n].start);
            let end = edges[n].end;
            if end.x == first.x && end.y == first.y {
                break;
            }
            next = starts.get(&key(end)).and_then(|v| v.iter().copied().find(|&i| !edges[i].used));
        }
        if contour.len() > 3 {
            let n = contour.len();
            let filtered: Vec<Pt> = contour
                .iter()
                .enumerate()
                .filter(|(i, p)| {
                    let a = contour[(i + n - 1) % n];
                    let b = contour[(i + 1) % n];
                    (p.x - a.x) * (b.y - p.y) != (p.y - a.y) * (b.x - p.x)
                })
                .map(|(_, p)| *p)
                .collect();
            contours.push(filtered);
        }
    }
    contours
}

pub struct QuickConfig {
    pub width: f64,
    pub height: f64,
    pub seed: f64,
    pub difficulty: String,
    pub biome: f64,
    pub frequency: f64,
    pub units: f64,
    pub workers: f64,
    pub resources: f64,
    pub composition: String,
    pub structures: String,
}

impl QuickConfig {
    pub fn parse(v: &Value) -> QuickConfig {
        let f = |k: &str, d: f64| v.get(k).and_then(|x| x.as_f64()).unwrap_or(d);
        let s = |k: &str, d: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or(d).to_string();
        QuickConfig {
            width: f("width", 12800.0),
            height: f("height", 8800.0),
            seed: f("seed", 1888.0),
            difficulty: s("difficulty", "normal"),
            biome: f("biome", 0.0),
            frequency: f("frequency", 0.55),
            units: f("units", 0.0),
            workers: f("workers", 6.0),
            resources: f("resources", 1000.0),
            composition: s("composition", "balanced"),
            structures: s("structures", "basic"),
        }
    }
}

fn biome_terrain_art(state: &State) -> f64 {
    if let Some(b) = config_biome(state) {
        b
    } else {
        let t = level_terrain(state);
        match t {
            0 => 0.0,
            1 => 1.0,
            2 => 3.0,
            _ => 2.0,
        }
    }
}

/// Quick matches and LAN games put each side at its own seeded height along its edge of the
/// map (mirrors `quickHeights` in `src/game.js`): returns (player y, enemy y).
pub fn quick_heights(seed: f64, height: f64) -> (f64, f64) {
    let mix = |salt: i32| -> f64 {
        let mut h = ((seed as i64 as i32) ^ salt).wrapping_mul(0x85ebca6bu32 as i32);
        h ^= ((h as u32) >> 13) as i32;
        h = h.wrapping_mul(0xc2b2ae35u32 as i32);
        h ^= ((h as u32) >> 16) as i32;
        (h as u32) as f64 / 4294967296.0
    };
    let span = height - 2000.0;
    ((1000.0 + mix(0x9e3779b9u32 as i32) * span).floor(), (1000.0 + mix(0x7f4a7c15u32 as i32) * span).floor())
}

/// The level record, with the player's camp moved to its seeded height in quick matches.
fn level_for(index: usize, config: Option<&QuickConfig>, height: f64) -> Level {
    let mut l = data().levels[index].clone();
    if let Some(q) = config {
        l.camp.1 = quick_heights(q.seed, height).0;
    }
    l
}

impl Sim {
    /// Build a new game (`startLevel`). `config` is a quick-match configuration.
    pub fn start_level(index: usize, config: Option<Value>, difficulty: &str, paused: bool) -> Sim {
        let d = data();
        let quick = config.as_ref().map(QuickConfig::parse);
        let l = level_for(index, quick.as_ref(), quick.as_ref().map(|q| q.height).unwrap_or(0.0));
        let mut state = State::default();
        state.version = 3.0;
        state.mode = if quick.is_some() { "quickmatch".into() } else { "campaign".into() };
        state.config = config.clone();
        state.seed = quick.as_ref().map(|q| q.seed).unwrap_or(1888.0 + index as f64 * 331.0);
        state.resource_scale = 3.0;
        let idx = index as f64;
        let start = Resources { food: 420.0 + idx * 35.0, wood: 420.0 + idx * 35.0, gold: 380.0 + idx * 55.0, stone: 280.0 + idx * 25.0 };
        state.enemy = Enemy { faith: 25.0, resources: start, ..Default::default() };
        state.difficulty = quick.as_ref().map(|q| q.difficulty.clone()).unwrap_or_else(|| difficulty.to_string());
        state.level = index;
        state.paused = paused;
        state.resources = start;
        state.faith = 25.0;
        state.wave_timer = l.wave;
        state.save_timer = 20.0;
        state.campaign_rules = if quick.is_some() { None } else { Some(campaign_rules(index, &state.difficulty)) };
        state.control_groups = json!({});
        state.regions = Value::Null;
        state.city_economies = Value::Null;
        let w = world_width(&state);
        let h = world_height(&state);
        let mut sim = Sim::new(state, Vec::new(), 0);
        sim.uid = 0;
        let tc = sim.make_building(BKind::Towncenter, 0, l.camp.0, l.camp.1, 1.0);
        sim.state.buildings.push(tc);
        let mut fort = sim.make_building(BKind::Fort, 1, l.fort.0, l.fort.1, 1.0);
        fort.hp = l.hp;
        fort.max_hp = l.hp;
        sim.state.buildings.push(fort);
        let b = sim.make_building(BKind::Barracks, 0, l.camp.0 - 155.0, l.camp.1 + 80.0, 1.0);
        sim.state.buildings.push(b);
        let b = sim.make_building(BKind::House, 0, l.camp.0 - 130.0, l.camp.1 - 155.0, 1.0);
        sim.state.buildings.push(b);
        let b = sim.make_building(BKind::House, 0, l.camp.0 + 85.0, l.camp.1 - 165.0, 1.0);
        sim.state.buildings.push(b);
        if quick.is_none() {
            let b = sim.make_building(BKind::Tower, 0, l.camp.0 + 230.0, l.camp.1 - 35.0, 1.0);
            sim.state.buildings.push(b);
            let b = sim.make_building(BKind::Tower, 0, l.camp.0 - 40.0, l.camp.1 - 300.0, 1.0);
            sim.state.buildings.push(b);
        }
        let mut troop_types = vec![UType::Sword, UType::Sword, UType::Sword, UType::Sword, UType::Archer, UType::Archer, UType::Chaplain, UType::Standard];
        if index >= 2 {
            troop_types.extend([UType::Sword, UType::Archer, UType::Knight]);
        }
        for (i, ty) in troop_types.iter().enumerate() {
            let u = sim.make_unit(*ty, 0, l.camp.0 + 140.0 + (i % 4) as f64 * 30.0, l.camp.1 - 115.0 - (i as f64 / 4.0).floor() * 32.0);
            sim.state.units.push(u);
        }
        for i in 0..6 {
            let u = sim.make_unit(UType::Worker, 0, l.camp.0 + 110.0 + (i % 3) as f64 * 26.0, l.camp.1 + 90.0 + (i as f64 / 3.0).floor() * 28.0);
            sim.state.units.push(u);
        }
        let mut garrison: Vec<u32> = Vec::new();
        for i in 0..(8 + index * 2) {
            let ty = if i % 5 == 0 { UType::Archer } else if i % 7 == 0 { UType::Knight } else { UType::Sword };
            let mut u = sim.make_unit(ty, 1, l.fort.0 - 210.0 + (i % 4) as f64 * 38.0, l.fort.1 + 150.0 + (i as f64 / 4.0).floor() * 35.0);
            u.squad = Some("garrison".into());
            u.home = Some(Pt::new(l.fort.0 - 120.0, l.fort.1 + 160.0));
            garrison.push(u.id);
            sim.state.units.push(u);
        }
        sim.state.squads.push(Squad { id: "garrison".into(), role: "guard".into(), members: garrison, origin: Pt::new(l.fort.0, l.fort.1), phase: "guard".into(), timer: 0.0, extra: Default::default() });
        if l.kind == "escort" {
            let rx = river_x(&sim.state, w, 1150.0);
            let b = sim.make_building(BKind::Tower, 1, rx + 170.0, 1000.0, 1.0);
            sim.state.buildings.push(b);
            for i in 0..3 {
                let mut u = sim.make_unit(UType::Pilgrim, 0, l.camp.0 + 230.0 + i as f64 * 45.0, l.camp.1 + 150.0);
                u.route = Some(vec![Pt::new(1100.0, 1420.0), Pt::new(rx - 110.0, 1150.0), Pt::new(rx + 160.0, 1150.0), Pt::new(2290.0, 840.0), Pt::new(2930.0, 420.0)]);
                u.route_index = Some(0);
                sim.state.units.push(u);
            }
            let id = sim.next_uid();
            sim.state.sites.push(Site { id, x: 2930.0, y: 420.0, r: 90.0, name: "Pilgrim refuge".into(), captured: true, progress: 1.0, ..Default::default() });
        }
        if l.kind == "liberation" {
            sim.add_village(1370.0, 680.0, false);
            sim.add_village(2350.0, 1500.0, false);
        } else if l.kind == "occupation" {
            sim.add_village(2180.0, 620.0, true);
            sim.add_village(2780.0, 1380.0, true);
        } else {
            sim.add_village(1910.0, 1000.0, false);
        }
        if l.kind == "siege" {
            for p in [(2270.0, 790.0), (2680.0, 1080.0), (2420.0, 1420.0)] {
                let mut b = sim.make_building(BKind::Fort, 1, p.0, p.1, 1.0);
                b.gate = Some(true);
                b.hp = 4200.0;
                b.max_hp = 4200.0;
                b.w = 135.0;
                b.h = 115.0;
                b.r = 70.0;
                sim.state.buildings.push(b);
            }
            for i in 0..19 {
                if i < 8 || i > 10 {
                    let b = sim.make_building(BKind::Wall, 1, 2400.0 + i as f64 * 32.0, 1210.0, 1.0);
                    sim.state.buildings.push(b);
                }
            }
            let mut g = sim.make_building(BKind::Gate, 1, 2688.0, 1210.0, 1.0);
            g.closed = Some(true);
            sim.state.buildings.push(g);
            sim.state.resources.wood += 220.0;
            sim.state.resources.stone += 180.0;
        }
        if l.terrain >= 4 {
            for i in 0..17 {
                let b = sim.make_building(BKind::House, 2, 2700.0 + (i % 4) as f64 * 95.0, 1520.0 + (i as f64 / 4.0).floor() * 93.0, 1.0);
                sim.state.buildings.push(b);
            }
        }
        for p in [(3650.0, 2480.0), (4090.0, 760.0)] {
            let id = sim.add_village(p.0, p.1, false);
            let s = sim.state.sites.iter_mut().find(|s| s.id == id).unwrap();
            s.optional = Some(true);
            s.name = "Frontier settlement".into();
        }
        if let Some(q) = &quick {
            let count = q.units as usize;
            sim.state.units.clear();
            sim.state.squads.clear();
            for i in 0..(q.workers as usize) {
                let u = sim.make_unit(UType::Worker, 0, l.camp.0 + 110.0 + (i % 5) as f64 * 22.0, l.camp.1 + 90.0 + (i as f64 / 5.0).floor() * 24.0);
                sim.state.units.push(u);
            }
            sim.state.sites.clear();
            sim.state.buildings.truncate(5);
            let enemy_y = quick_heights(q.seed, h).1;
            let house = sim.make_building(BKind::House, 1, w - 850.0, enemy_y, 1.0);
            sim.state.buildings[1] = house;
            sim.state.buildings[1].x = w - 850.0;
            sim.state.buildings[1].y = enemy_y;
            let r = q.resources;
            sim.state.resources = Resources { food: r, wood: r, gold: r, stone: r };
            sim.state.enemy.resources = sim.state.resources;
            for team in [0, 1] {
                for i in 0..count {
                    let home = if team == 0 { Pt::new(l.camp.0, l.camp.1) } else { Pt::new(sim.state.buildings[1].x, sim.state.buildings[1].y) };
                    let ty = match q.composition.as_str() {
                        "vanguard" => UType::Sword,
                        "cavalry" => {
                            if i % 3 != 0 {
                                UType::Knight
                            } else {
                                UType::Archer
                            }
                        }
                        "siege" => {
                            if i % 8 == 0 {
                                UType::Trebuchet
                            } else if i % 3 != 0 {
                                UType::Sword
                            } else {
                                UType::Archer
                            }
                        }
                        _ => {
                            if i % 3 == 0 {
                                UType::Archer
                            } else {
                                UType::Sword
                            }
                        }
                    };
                    let u = sim.make_unit(ty, team, home.x + 140.0 + (i % 6) as f64 * 22.0, home.y - 115.0 - (i as f64 / 6.0).floor() * 24.0);
                    sim.state.units.push(u);
                }
            }
            if q.structures == "developed" {
                for team in [0, 1] {
                    let home = if team == 0 { Pt::new(l.camp.0, l.camp.1) } else { Pt::new(sim.state.buildings[1].x, sim.state.buildings[1].y) };
                    for (i, kind) in [BKind::Stable, BKind::Chapel, BKind::Siegeworkshop, BKind::Farm, BKind::Farm].iter().enumerate() {
                        let b = sim.make_building(*kind, team, home.x - 200.0 + (i % 3) as f64 * 150.0, home.y + 260.0 + (i as f64 / 3.0).floor() * 145.0, 1.0);
                        sim.state.buildings.push(b);
                    }
                }
            }
        }
        let enemy_home: Pt = if quick.is_some() {
            Pt::new(sim.state.buildings[1].x, sim.state.buildings[1].y)
        } else {
            Pt::new(w - 2000.0, (h * if index >= 4 { 0.46 } else { 0.34 }).floor())
        };
        if quick.is_none() {
            // Forward capturable posts have no owner, troops or faction vision.
            let n = sim.state.buildings.len();
            for bi in 0..n {
                let is_first = bi == 1 && l.kind == "settlement";
                let is_tower = sim.state.buildings[bi].kind == BKind::Tower && sim.state.buildings[bi].team == 1;
                if is_first || is_tower {
                    let (bx, by, kind) = (sim.state.buildings[bi].x, sim.state.buildings[bi].y, sim.state.buildings[bi].kind);
                    let id = sim.next_uid();
                    sim.state.sites.push(Site {
                        id,
                        x: bx,
                        y: by,
                        r: 145.0,
                        progress: 0.0,
                        captured: false,
                        team: Some(2),
                        name: if kind == BKind::Tower { "Bridge outpost".into() } else { "Coastal outpost".into() },
                        optional: Some(l.kind != "settlement"),
                        extra: {
                            let mut m = Extra::new();
                            m.insert("outpost".into(), json!(true));
                            m
                        },
                        ..Default::default()
                    });
                    sim.state.buildings[bi].team = 2;
                    sim.state.buildings[bi].site = Some(id);
                    for i in 0..4 {
                        let mut u = sim.make_unit(UType::Civilian, 2, bx - 70.0 + i as f64 * 36.0, by + 135.0);
                        u.site = Some(id);
                        u.home = Some(Pt::new(bx, by + 135.0));
                        u.wander = Some(6.0 + i as f64);
                        sim.state.units.push(u);
                    }
                    sim.state.buildings[bi].outpost = Some(true);
                }
            }
            let dx = enemy_home.x - l.fort.0;
            let dy = enemy_home.y - l.fort.1;
            for b in sim.state.buildings.iter_mut() {
                if b.team == 1 {
                    b.x += dx;
                    b.y += dy;
                }
            }
            for u in sim.state.units.iter_mut() {
                if u.team == 1 {
                    u.x += dx;
                    u.y += dy;
                    if let Some(h) = u.home.as_mut() {
                        h.x += dx;
                        h.y += dy;
                    }
                }
            }
            for s in sim.state.squads.iter_mut() {
                s.origin.x += dx;
                s.origin.y += dy;
            }
        }
        for (kind, dx, dy) in [(BKind::Towncenter, 240.0, 20.0), (BKind::Barracks, 240.0, 200.0), (BKind::House, 90.0, 300.0)] {
            let b = sim.make_building(kind, 1, enemy_home.x + dx, enemy_home.y + dy, 1.0);
            sim.state.buildings.push(b);
        }
        if quick.is_none() {
            let ci = sim.state.buildings.iter().position(|b| b.kind == BKind::Towncenter && b.team == 1).unwrap();
            if index >= 4 {
                let c = &mut sim.state.buildings[ci];
                c.fortress_shape = Some(json!({"x": if index == 5 { 1.7 } else { 1.45 }, "y": if index == 5 { 2.9 } else { 2.5 }, "layers": 3}));
                c.w = 320.0;
                c.h = 280.0;
                c.r = 220.0;
                c.hp = if index == 5 { 16000.0 } else { 11000.0 };
                c.max_hp = c.hp;
                c.castle = Some(true);
            }
            let (cid, cx, cy, shape) = {
                let c = &sim.state.buildings[ci];
                (c.id, c.x, c.y, c.fortress_shape.clone())
            };
            let plots = sim.defensive_plots(cid, cx, cy, shape.as_ref(), 896.0, false);
            for p in &plots {
                let mut b = sim.make_from_plot(p, 1, 1.0);
                b.defence = Some(true);
                sim.state.buildings.push(b);
            }
            for i in 0..12 {
                let kind = if i < 8 {
                    BKind::House
                } else if i == 8 {
                    BKind::Stable
                } else if i == 9 {
                    BKind::Siegeworkshop
                } else if i == 10 {
                    BKind::Chapel
                } else {
                    BKind::Barracks
                };
                let b = sim.make_building(kind, 1, cx - 480.0 + (i % 4) as f64 * 220.0, cy - 420.0 + (i as f64 / 4.0).floor() * 190.0, 1.0);
                sim.state.buildings.push(b);
            }
        }
        if quick.is_none() && index >= 4 {
            let ci = sim.state.buildings.iter().position(|b| b.kind == BKind::Towncenter && b.team == 1).unwrap();
            let (cid, cx, cy) = (sim.state.buildings[ci].id, sim.state.buildings[ci].x, sim.state.buildings[ci].y);
            for i in 0..60 {
                let angle = i as f64 * 2.399;
                let r = 600.0 + (i % 4) as f64 * 270.0;
                let kind = if i < 42 { BKind::House } else { [BKind::Barracks, BKind::Stable, BKind::Siegeworkshop, BKind::Chapel, BKind::Farm, BKind::Mill][i % 6] };
                let b = sim.make_building(kind, 1, cx + cos(angle) * r * 0.8, cy + sin(angle) * r * 1.6, 1.0);
                sim.state.buildings.push(b);
            }
            for i in 0..3 {
                let mut b = sim.make_building(BKind::Towncenter, 1, cx - 420.0 + (i % 2) as f64 * 850.0, cy - 1300.0 + i as f64 * 1250.0, 1.0);
                b.hp = 7000.0;
                b.max_hp = 7000.0;
                b.district = Some(true);
                sim.state.buildings.push(b);
            }
            for i in 0..60 {
                let angle = i as f64 * 2.399;
                let r = 650.0 + (i % 3) as f64 * 300.0;
                let ty = if i < 12 { UType::Trebuchet } else if i % 4 == 0 { UType::Knight } else if i % 3 == 0 { UType::Archer } else { UType::Sword };
                let (px, py) = (cx + cos(angle) * r * 0.8, cy + sin(angle) * r * 1.6);
                let mut u = sim.make_unit(ty, 1, px, py);
                u.deployment = if i < 12 { "deployed".into() } else { "packed".into() };
                u.fixed_defense = Some(i < 12);
                u.garrison_base = Some(cid);
                u.home = Some(Pt::new(px, py));
                u.rank = Some(2.0);
                u.castle_guard = Some(true);
                sim.state.units.push(u);
            }
        }
        let nworkers = quick.as_ref().map(|q| q.workers as usize).unwrap_or(6);
        for i in 0..nworkers {
            let u = sim.make_unit(UType::Worker, 1, enemy_home.x + 360.0 + (i % 3) as f64 * 24.0, enemy_home.y + 80.0 + (i as f64 / 3.0).floor() * 26.0);
            sim.state.units.push(u);
        }
        if let Some(q) = &quick {
            if q.units + q.workers > 56.0 {
                for team in [0, 1] {
                    let home = if team == 0 { Pt::new(l.camp.0, l.camp.1) } else { enemy_home };
                    let count = ((q.units + q.workers - 56.0) / 12.0).ceil() as usize;
                    for i in 0..count {
                        let b = sim.make_building(BKind::House, team, home.x - 250.0 + (i % 3) as f64 * 100.0, home.y + 430.0 + (i as f64 / 3.0).floor() * 100.0, 1.0);
                        sim.state.buildings.push(b);
                    }
                }
            }
        }
        if quick.is_none() {
            for i in 0..3 {
                let id = sim.add_village(w * (0.34 + i as f64 * 0.19), h * (0.39 + i as f64 * 0.13), false);
                sim.state.sites.iter_mut().find(|s| s.id == id).unwrap().optional = Some(true);
            }
        }
        sim.add_siege_city(w * 0.35, h * 0.26, "Castellum Petrae");
        sim.add_siege_city(w * 0.6, h * 0.66, "Civitas Fontis");
        let enemy_capital = sim.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == 1).unwrap().id;
        sim.state.capitals = Capitals { player: Some(sim.state.buildings[0].id), enemy: Some(enemy_capital) };
        sim.arrange_starting_buildings();
        sim.make_world(true);
        // The northern curtain meets solid terrain; masonry buried in rock is redundant.
        if let Some(c0) = sim.state.cities.first().cloned() {
            let masses: Vec<TerrainFeature> = sim.state.terrain_features.clone();
            let geo = &mut sim.geo;
            geo.warm(&masses);
            let keep: Vec<Building> = sim
                .state
                .buildings
                .iter()
                .filter(|b| {
                    !(b.city == Some(c0.id)
                        && b.kind == BKind::Wall
                        && b.y < c0.y - 250.0
                        && masses.iter().enumerate().any(|(i, d)| rock_blocks_cached(geo, i, d, b.x, b.y, 8.0)))
                })
                .cloned()
                .collect();
            sim.state.buildings = keep;
        }
        sim.rebuild_navigation();
        if quick.is_none() {
            sim.prepare_campaign();
        }
        sim.muster_starting_units();
        sim.station_curtain_archers();
        sim.state.roads = sim.plan_roads();
        let nu = sim.state.units.len();
        for i in 0..nu {
            let (ux, uy, team) = (sim.state.units[i].x, sim.state.units[i].y, sim.state.units[i].team);
            if !sim.ground_free(ux, uy, 6.0) {
                let p = sim.find_free(Pt::new(ux, uy));
                sim.state.units[i].x = p.x;
                sim.state.units[i].y = p.y;
            } else if team == 0 && !sim.ground_free(ux, uy, 8.0) {
                if let Some(p) = sim.roomy_ground(i) {
                    let u = &mut sim.state.units[i];
                    u.x = p.x;
                    u.y = p.y;
                    if u.home.is_some() {
                        u.home = Some(Pt::new(p.x, p.y));
                    }
                }
            }
        }
        sim.fog = crate::fog::Fog::new(w, h, 0);
        sim.enemy_fog = crate::fog::Fog::new(w, h, 1);
        sim.militia_fog = crate::fog::Fog::new(w, h, 3);
        let shots = sim.siege_shots();
        let r0 = sim.colossus_reveals(0);
        let r1 = sim.colossus_reveals(1);
        sim.fog.update(&sim.state.units, &sim.state.buildings, &shots, &r0);
        sim.enemy_fog.update(&sim.state.units, &sim.state.buildings, &shots, &r1);
        sim.militia_fog.update(&sim.state.units, &sim.state.buildings, &shots, &[]);
        for team in [0, 1] {
            let ws = sim.workers(team);
            for (i, &u) in ws.iter().enumerate() {
                let res = [Res::Food, Res::Wood, Res::Wood, Res::Gold, Res::Stone, Res::Food][i % 6];
                sim.assign_gather(u, res, None, None, None);
            }
        }
        sim.vision_timer = 0.0;
        sim
    }

    pub fn add_village(&mut self, x: f64, y: f64, site: bool) -> u32 {
        let id = self.next_uid();
        self.state.sites.push(Site { id, x, y, r: 145.0, progress: 0.0, captured: false, name: if site { "Holy site".into() } else { "Road village".into() }, ..Default::default() });
        for i in 0..3 {
            let kind = if site && i == 0 { BKind::Chapel } else { BKind::House };
            let mut b = self.make_building(kind, 2, x + (i as f64 - 1.0) * 96.0, y + (i % 2) as f64 * 82.0, 1.0);
            b.site = Some(id);
            self.state.buildings.push(b);
        }
        for i in 0..5 {
            let mut u = self.make_unit(UType::Civilian, 2, x - 120.0 + i as f64 * 42.0, y + 125.0);
            u.home = Some(Pt::new(x, y + 130.0));
            u.wander = Some((self.uid % 8) as f64);
            u.site = Some(id);
            self.state.units.push(u);
        }
        id
    }

    pub fn near_bridge(&self, p: Pt, pad: f64) -> bool {
        let river = is_river_map(&self.state);
        river && (p.y - bridge_y(&self.state, self.geo.h)).abs() < pad && (p.x - river_x(&self.state, self.geo.w, p.y)).abs() < pad + 60.0
    }

    pub fn add_siege_city(&mut self, x: f64, y: f64, name: &str) {
        let x = round(x / 32.0) * 32.0;
        let y = round(y / 32.0) * 32.0;
        let id = self.next_uid();
        let mut city = City {
            id,
            x,
            y,
            name: name.into(),
            radius: 1100.0,
            capture: 0.0,
            captured: false,
            reward: Some(Resources { food: 1800.0, wood: 2400.0, stone: 1800.0, gold: 2200.0 }),
            ..Default::default()
        };
        let mut center = self.make_building(BKind::Towncenter, 3, x, y, 1.0);
        center.city = Some(id);
        center.city_center = Some(true);
        center.w = 280.0;
        center.h = 240.0;
        center.r = 185.0;
        center.hp = 16000.0;
        center.max_hp = 16000.0;
        city.center = Some(center.id);
        self.state.cities.push(city.clone());
        self.state.buildings.push(center);
        for i in 0..32 {
            let angle = i as f64 * 2.399;
            let r = 300.0 + (i as f64 / 8.0).floor() * 120.0;
            let kind = if i < 20 { BKind::House } else { [BKind::Barracks, BKind::Stable, BKind::Chapel, BKind::Siegeworkshop, BKind::Farm, BKind::Mill][i % 6] };
            let spot = Pt::new(x + cos(angle) * r, y + sin(angle) * r);
            if self.near_bridge(spot, 260.0) {
                continue;
            }
            let mut b = self.make_building(kind, 3, spot.x, spot.y, 1.0);
            b.city = Some(id);
            self.state.buildings.push(b);
        }
        let plots = self.defensive_plots(city.id, city.x, city.y, None, 960.0, false);
        let sel: Vec<Plot> = plots.into_iter().filter(|p| !self.near_bridge(Pt::new(p.b.x, p.b.y), 200.0)).collect();
        for p in &sel {
            let mut b = self.make_from_plot(p, 3, 1.0);
            b.city = Some(id);
            b.closed = Some(true);
            self.state.buildings.push(b);
        }
        for i in 0..16 {
            let mut u = self.make_unit(UType::Civilian, 3, x - 190.0 + (i % 8) as f64 * 48.0, y + 210.0 + (i as f64 / 8.0).floor() * 40.0);
            u.city = Some(id);
            u.home = Some(Pt::new(x, y + 220.0));
            u.wander = Some(6.0 + i as f64);
            self.state.units.push(u);
        }
        let extra = if self.state.mode == "campaign" { self.state.level as usize * 8 } else { 0 };
        for i in 0..(72 + extra) {
            let ty = if i % 11 == 0 {
                UType::Knight
            } else if i % 3 == 0 {
                UType::Archer
            } else if i == 70 {
                UType::Chaplain
            } else if i == 71 {
                UType::Standard
            } else {
                UType::Sword
            };
            let angle = i as f64 * 2.399;
            let r = if i < 20 { 200.0 } else if i < 44 { 480.0 } else { 810.0 };
            let p = Pt::new(x + cos(angle) * r, y + sin(angle) * r);
            let mut u = self.make_unit(ty, 3, p.x, p.y);
            u.city = Some(id);
            u.city_defender = Some(true);
            u.home = Some(p);
            u.hold = ty == UType::Archer;
            u.rank = Some(1.0);
            self.state.units.push(u);
        }
    }

    pub fn arrange_starting_buildings(&mut self) {
        self.geo.index = None;
        self.geo.decorations.clear();
        self.decor_gen += 1;
        let mut placed: Vec<(f64, f64, f64, f64)> = Vec::new();
        let (w, h) = (self.geo.w, self.geo.h);
        let priority = |s: &Sim, bi: usize| -> i32 {
            if s.is_capital(bi) {
                0
            } else if matches!(s.state.buildings[bi].kind, BKind::Wall | BKind::Gate) {
                1
            } else {
                2
            }
        };
        let mut order: Vec<usize> = (0..self.state.buildings.len()).collect();
        order.sort_by_key(|&i| priority(self, i));
        for bi in order {
            let (bw, bh, bid) = (self.state.buildings[bi].w, self.state.buildings[bi].h, self.state.buildings[bi].id);
            let valid = |s: &Sim, p: Pt, placed: &Vec<(f64, f64, f64, f64)>| -> bool {
                if p.x - bw / 2.0 < 32.0 || p.y - bh / 2.0 < 32.0 || p.x + bw / 2.0 > w - 32.0 || p.y + bh / 2.0 > h - 32.0 {
                    return false;
                }
                for dx in [-bw / 2.0, 0.0, bw / 2.0] {
                    for dy in [-bh / 2.0, 0.0, bh / 2.0] {
                        if !s.ground_free_adj(p.x + dx, p.y + dy, 6.0, None, Adj::All) {
                            return false;
                        }
                    }
                }
                !placed.iter().any(|o| (o.0 - p.x).abs() < (o.2 + bw) / 2.0 && (o.1 - p.y).abs() < (o.3 + bh) / 2.0)
            };
            let origin = Pt::new(self.state.buildings[bi].x, self.state.buildings[bi].y);
            if self.state.buildings[bi].wall_attachment.is_some() {
                placed.push((origin.x, origin.y, bw, bh));
                continue;
            }
            if !valid(self, origin, &placed) {
                let mut found = false;
                let mut radius = 24.0;
                while radius <= 1800.0 && !found {
                    let count = ((radius * std::f64::consts::PI * 2.0) / 24.0).ceil() as i32;
                    for i in 0..count {
                        let angle = (i as f64 * 24.0) / radius;
                        let p = Pt::new(origin.x + cos(angle) * radius, origin.y + sin(angle) * radius);
                        if valid(self, p, &placed) {
                            self.state.buildings[bi].x = p.x;
                            self.state.buildings[bi].y = p.y;
                            found = true;
                            break;
                        }
                    }
                    radius += 24.0;
                }
            }
            let (nx, ny) = (self.state.buildings[bi].x, self.state.buildings[bi].y);
            placed.push((nx, ny, bw, bh));
            if self.state.buildings[bi].outpost == Some(true) {
                let sid = self.state.buildings[bi].site;
                if let Some(site) = self.state.sites.iter_mut().find(|s| Some(s.id) == sid) {
                    site.x = nx;
                    site.y = ny;
                }
            }
            let _ = bid;
        }
    }

    pub fn muster_starting_units(&mut self) {
        let mut occupied: Vec<Pt> = Vec::new();
        for team in 0..4 {
            let cap_id = if team == 0 { self.state.capitals.player } else { self.state.capitals.enemy };
            let capital = self.state.buildings.iter().find(|b| Some(b.id) == cap_id).map(|b| Pt::new(b.x, b.y));
            let base: Vec<usize> = if team >= 2 {
                Vec::new()
            } else {
                let cp = capital.unwrap();
                (0..self.state.buildings.len()).filter(|&i| self.state.buildings[i].team == team && dist(Pt::new(self.state.buildings[i].x, self.state.buildings[i].y), cp) < 850.0).collect()
            };
            let front = if team == 0 {
                base.iter().map(|&i| self.state.buildings[i].x + self.state.buildings[i].w / 2.0).fold(f64::NEG_INFINITY, f64::max) + 80.0
            } else {
                base.iter().map(|&i| self.state.buildings[i].x - self.state.buildings[i].w / 2.0).fold(f64::INFINITY, f64::min) - 80.0
            };
            let soldiers: Vec<u32> = self.state.units.iter().filter(|u| u.team == team && !matches!(u.ty, UType::Worker | UType::Civilian)).map(|u| u.id).collect();
            let team_units: Vec<usize> = (0..self.state.units.len()).filter(|&i| self.state.units[i].team == team).collect();
            for ui in team_units {
                let (uid, ux, uy, ty, post, guard) = {
                    let u = &self.state.units[ui];
                    (u.id, u.x, u.y, u.ty, u.campaign_post.is_some(), u.castle_guard == Some(true))
                };
                let index = soldiers.iter().position(|&s| s == uid);
                let origin = if index.is_some() && team < 2 && !post && !guard && !matches!(ty, UType::Pilgrim | UType::Merchant) {
                    let idx = index.unwrap() as f64;
                    let cp = capital.unwrap();
                    Pt::new(front + (if team == 0 { 1.0 } else { -1.0 }) * (idx / 10.0).floor() * 30.0, cp.y + ((idx % 10.0) - 9f64.min(soldiers.len() as f64 - 1.0) / 2.0) * 30.0)
                } else {
                    Pt::new(ux, uy)
                };
                let valid = |s: &Sim, p: Pt, occupied: &Vec<Pt>| -> bool {
                    s.ground_free(p.x, p.y, 10.0)
                        && !s.state.buildings.iter().any(|b| (b.x - p.x).abs() < b.w / 2.0 + 18.0 && (b.y - p.y).abs() < b.h / 2.0 + 18.0)
                        && !occupied.iter().any(|u| dist(*u, p) < 24.0)
                };
                let mut p = origin;
                if !valid(self, p, &occupied) {
                    let mut found = false;
                    let mut radius = 18.0;
                    while radius <= 1200.0 && !found {
                        let count = ((radius * std::f64::consts::PI * 2.0) / 18.0).ceil() as i32;
                        for i in 0..count {
                            let angle = (i as f64 * 18.0) / radius;
                            let cand = Pt::new(origin.x + cos(angle) * radius, origin.y + sin(angle) * radius);
                            if valid(self, cand, &occupied) {
                                p = cand;
                                found = true;
                                break;
                            }
                        }
                        radius += 18.0;
                    }
                }
                let u = &mut self.state.units[ui];
                u.x = p.x;
                u.y = p.y;
                occupied.push(p);
                if team == 1 && u.home.is_some() {
                    u.home = Some(p);
                }
            }
        }
    }

    pub fn station_curtain_archers(&mut self) {
        struct Group {
            team: i32,
            city: Option<u32>,
            center: Pt,
        }
        let mut groups: Vec<Group> = self.state.cities.iter().map(|c| Group { team: 3, city: Some(c.id), center: Pt::new(c.x, c.y) }).collect();
        let ec = self.state.buildings.iter().find(|b| Some(b.id) == self.state.capitals.enemy).map(|b| Pt::new(b.x, b.y));
        groups.push(Group { team: 1, city: None, center: ec.unwrap_or(Pt::new(0.0, 0.0)) });
        if data().levels[self.state.level].kind == "survival" && self.state.mode == "campaign" {
            groups.push(Group { team: 0, city: None, center: Pt::new(self.state.buildings[0].x, self.state.buildings[0].y) });
        }
        for g in groups {
            let mut walls: Vec<usize> = (0..self.state.buildings.len())
                .filter(|&i| {
                    let b = &self.state.buildings[i];
                    b.team == g.team && b.kind == BKind::Wall && b.defence_layer == Some(0.0) && (if g.city.is_some() { b.city == g.city } else { b.city.is_none() })
                })
                .collect();
            walls.sort_by(|&a, &b| {
                let aa = crate::js::atan2(self.state.buildings[a].y - g.center.y, self.state.buildings[a].x - g.center.x);
                let ab = crate::js::atan2(self.state.buildings[b].y - g.center.y, self.state.buildings[b].x - g.center.x);
                aa.partial_cmp(&ab).unwrap_or(std::cmp::Ordering::Equal)
            });
            let archers: Vec<usize> = (0..self.state.units.len())
                .filter(|&i| {
                    let u = &self.state.units[i];
                    u.team == g.team && u.ty == UType::Archer && (if g.city.is_some() { u.city == g.city } else { u.city.is_none() && u.campaign_post.is_none() })
                })
                .collect();
            let n = archers.len();
            for (i, &ui) in archers.iter().enumerate() {
                if walls.is_empty() {
                    continue;
                }
                let wi = (i * walls.len()) / n;
                let Some(&wall) = walls.get(wi) else { continue };
                let (wx, wy) = (self.state.buildings[wall].x, self.state.buildings[wall].y);
                let a = crate::js::atan2(g.center.y - wy, g.center.x - wx);
                let p = self.find_free(Pt::new(wx + cos(a) * 55.0, wy + sin(a) * 55.0));
                let u = &mut self.state.units[ui];
                u.x = p.x;
                u.y = p.y;
                u.home = Some(p);
                u.curtain_guard = Some(true);
                u.hold = true;
                u.stance = "hold".into();
            }
        }
    }

    pub fn plan_roads(&mut self) -> Vec<Vec<Pt>> {
        let (w, h) = (self.geo.w, self.geo.h);
        let mut road_nav = Nav::new(w, h, 32.0);
        {
            let (state, geo) = (&self.state, &self.geo);
            road_nav.rebuild(&|x, y| ground_free(state, geo, x, y, 22.0, None, Adj::No), &[], None);
        }
        let mut hubs_src: Vec<Pt> = vec![Pt::new(self.state.buildings[0].x, self.state.buildings[0].y), Pt::new(self.state.buildings[1].x, self.state.buildings[1].y)];
        for b in &self.state.buildings {
            if b.team == 1 && b.kind == BKind::Towncenter {
                hubs_src.push(Pt::new(b.x, b.y));
            }
        }
        for s in &self.state.sites {
            hubs_src.push(Pt::new(s.x, s.y));
        }
        let mut hubs: Vec<Pt> = hubs_src
            .into_iter()
            .filter_map(|p| road_nav.nearest(p.x, p.y, None).map(|c| Pt::new((c.0 as f64 + 0.5) * road_nav.cell, (c.1 as f64 + 0.5) * road_nav.cell)))
            .collect();
        if hubs.is_empty() {
            return Vec::new();
        }
        let mut reached = vec![hubs.remove(0)];
        let mut roads: Vec<Vec<Pt>> = Vec::new();
        while !hubs.is_empty() {
            let mut best_d = f64::INFINITY;
            let mut best: Option<(usize, Pt)> = None;
            for i in 0..hubs.len() {
                for a in &reached {
                    let d = dist(*a, hubs[i]);
                    if d < best_d {
                        best_d = d;
                        best = Some((i, *a));
                    }
                }
            }
            let (i, a) = best.unwrap();
            let b = hubs.remove(i);
            let route = {
                let (state, geo) = (&self.state, &self.geo);
                road_nav.find(a, b, &|x, y| ground_free(state, geo, x, y, 22.0, None, Adj::No))
            };
            if !route.is_empty() {
                let mut r = vec![a];
                r.extend(route);
                roads.push(r);
            }
            reached.push(b);
        }
        roads
    }
}

pub fn campaign_rules(level: usize, difficulty: &str) -> CampaignRules {
    let scale = if difficulty == "hard" { 1.3 } else if difficulty == "easy" { 0.8 } else { 1.0 };
    let pick = |easy: f64, normal: f64, hard: f64| -> f64 {
        match difficulty {
            "easy" => easy,
            "hard" => hard,
            _ => normal,
        }
    };
    CampaignRules {
        version: 2.0,
        farms: 4.0,
        food: 1000.0,
        survival: pick(600.0, 720.0, 900.0),
        hold: if level == 5 { pick(240.0, 300.0, 360.0) } else { pick(180.0, 240.0, 300.0) },
        gates: 3.0,
        deliveries: if level == 3 { 2.0 } else { 0.0 },
        strength: scale,
        interval: round((95.0 - level as f64 * 7.0) / scale),
        grace: if level == 0 { 110.0 } else { 75.0 },
        attacks: 0.0,
        posts: Vec::new(),
        ..Default::default()
    }
}

// ---- terrain generation ---------------------------------------------------------

impl Sim {
    fn terrain_biome(&self) -> f64 {
        biome_terrain_art(&self.state)
    }

    pub fn make_world(&mut self, generate: bool) {
        let d = data();
        let (w, h) = (self.geo.w, self.geo.h);
        self.geo.index = None;
        self.object_index.clear();
        let quick = if self.state.mode == "quickmatch" { self.state.config.as_ref().map(QuickConfig::parse) } else { None };
        let l = level_for(self.state.level, quick.as_ref(), h);
        let mut random = Seeded::new(self.state.seed);
        self.geo.decorations.clear();
        self.decor_gen += 1;
        // Art.terrain consumes the stream: 40,200 draws for coastal maps, else 38,400.
        let skip = if self.terrain_biome() == 0.0 { 40200 } else { 38400 };
        for _ in 0..skip {
            random.next();
        }
        let road: Vec<Pt> = vec![
            Pt::new(l.camp.0, l.camp.1),
            Pt::new(1050.0, 1440.0),
            Pt::new(river_x(&self.state, w, 1150.0), 1150.0),
            Pt::new(2010.0, 1030.0),
            Pt::new(l.fort.0, l.fort.1),
        ];
        for _cluster in 0..22 {
            let cx = 350.0 + random.next() * (w - 700.0);
            let cy = 200.0 + random.next() * (h - 400.0);
            if self.state.buildings.iter().any(|b| dist(Pt::new(b.x, b.y), Pt::new(cx, cy)) < 450.0) {
                continue;
            }
            // The JS loop condition draws a fresh random number on every check.
            let mut i = 0i32;
            loop {
                if !((i as f64) < 4.0 + (random.next() * 6.0).floor()) {
                    break;
                }
                let a = i as f64 * 2.399;
                let r = 25.0 + (i as f64).sqrt() * 35.0;
                let dd = Deco { x: cx + cos(a) * r, y: cy + sin(a) * r, kind: DecoKind::Rock, r: 17.0 + random.next() * 12.0, block: true, scale: 1.0 };
                if self.land_free(dd.x, dd.y, dd.r + 12.0, false) && self.ground_free(dd.x, dd.y, 12.0) && !road.iter().any(|p| dist(Pt::new(dd.x, dd.y), *p) < 180.0) {
                    self.geo.decorations.push(dd);
                }
                i += 1;
            }
        }
        for _ in 0..45 {
            let dd = Deco { x: 250.0 + random.next() * (w - 500.0), y: 100.0 + random.next() * (h - 200.0), kind: DecoKind::Shrub, r: 0.0, block: false, scale: 0.4 + random.next() * 0.4 };
            if self.land_free(dd.x, dd.y, 16.0, false) && self.ground_free(dd.x, dd.y, 0.0) {
                self.geo.decorations.push(dd);
            }
        }
        if !generate {
            // Saved rock masses keep their tiles; closing holes is a load-time repair.
            let masses = self.state.terrain_features.clone();
            self.geo.warm(&masses);
            return;
        }
        self.make_rock_clusters(&mut random);
        self.state.nodes.clear();
        let freq = self.state.config.as_ref().and_then(|c| c.get("frequency")).and_then(|v| v.as_f64()).filter(|v| *v != 0.0).unwrap_or(0.55);
        struct Cluster {
            kind: Res,
            x: f64,
            y: f64,
            count: f64,
            camp: bool,
        }
        let cl = |kind, x, y, count, camp| Cluster { kind, x, y, count, camp };
        let mut clusters: Vec<Cluster> = vec![
            cl(Res::Wood, l.camp.0 + 270.0, l.camp.1 - 220.0, 20.0, true),
            cl(Res::Wood, l.camp.0 - 220.0, l.camp.1 - 280.0, 16.0, true),
            cl(Res::Food, l.camp.0 + 270.0, l.camp.1 + 170.0, 7.0, false),
            cl(Res::Gold, l.camp.0 + 500.0, l.camp.1 + 60.0, 5.0, false),
            cl(Res::Stone, l.camp.0 + 400.0, l.camp.1 - 450.0, 6.0, false),
            cl(Res::Wood, 2080.0, 1300.0, 24.0, false),
            cl(Res::Gold, 2150.0, 700.0, 6.0, false),
            cl(Res::Stone, 1180.0, 680.0, 8.0, false),
            cl(Res::Food, 1780.0, 870.0, 9.0, false),
            cl(Res::Wood, 700.0, 580.0, 26.0, false),
            cl(Res::Wood, 3340.0, 2370.0, 34.0, false),
            cl(Res::Wood, 3900.0, 470.0, 32.0, false),
            cl(Res::Gold, 3820.0, 2650.0, 10.0, false),
            cl(Res::Stone, 4350.0, 1100.0, 12.0, false),
            cl(Res::Food, 3620.0, 2720.0, 12.0, false),
            cl(Res::Food, 4240.0, 560.0, 10.0, false),
            cl(Res::Wood, 2450.0, 2900.0, 30.0, false),
            cl(Res::Gold, 2820.0, 2750.0, 9.0, false),
        ];
        let eh = self.state.buildings.iter().find(|b| b.kind == BKind::Towncenter && b.team == 1).map(|b| Pt::new(b.x, b.y)).unwrap();
        for (i, kind) in [Res::Food, Res::Wood, Res::Gold, Res::Stone].iter().enumerate() {
            clusters.push(cl(*kind, eh.x + if i % 2 == 1 { 270.0 } else { -230.0 }, eh.y + if i < 2 { -250.0 } else { 360.0 }, if *kind == Res::Wood { 18.0 } else { 5.0 }, *kind == Res::Wood));
        }
        let total = clusters.len();
        for c in clusters.iter_mut().skip(5).take(total - 5 - 4) {
            c.x = 450.0 + random.next() * (w - 900.0);
            c.y = 350.0 + random.next() * (h - 700.0);
        }
        let extra = ((w * h) / 1200000.0 * freq).floor() as usize;
        for i in 0..extra {
            let kind = [Res::Wood, Res::Food, Res::Gold, Res::Stone][i % 4];
            let x = 450.0 + random.next() * (w - 900.0);
            let y = 350.0 + random.next() * (h - 700.0);
            clusters.push(cl(kind, x, y, if i % 4 == 0 { 15.0 } else { 4.0 }, false));
        }
        let woods: Vec<usize> = (0..clusters.len()).filter(|&i| clusters[i].kind == Res::Wood).collect();
        for (idx, &ci) in woods.iter().enumerate() {
            let c = &clusters[ci];
            self.make_forest(c.x, c.y, c.camp, &mut random, idx);
        }
        let forests: Vec<usize> = (0..self.state.terrain_features.len()).filter(|&i| self.state.terrain_features[i].forest == Some(true)).collect();
        for fi in forests {
            self.forest_rim_nodes(fi, &mut random);
        }
        let biome_palm = if let Some(b) = config_biome(&self.state) { b == 2.0 } else { l.terrain >= 3 };
        let biome_snow = if let Some(b) = config_biome(&self.state) { b == 3.0 } else { l.terrain == 2 };
        let river_biome = is_river_map(&self.state);
        for c in &clusters {
            let floor_min: f64 = if c.kind == Res::Wood { 0.0 } else { 3.0 };
            let n = floor_min.max((c.count * freq).floor()) as i32;
            for i in 0..n {
                let a = i as f64 * 2.4;
                let r = 30.0 + (i as f64).sqrt() * 34.0;
                let id = self.next_uid();
                let remaining = match c.kind {
                    Res::Wood => 660.0,
                    Res::Food => 1500.0,
                    _ => 3900.0,
                };
                let nd = Node {
                    id,
                    kind: c.kind,
                    x: clamp(c.x + cos(a) * r, 270.0, w - 180.0),
                    y: clamp(c.y + sin(a) * r, 130.0, h - 150.0),
                    r: if c.kind == Res::Wood { 23.0 } else { 28.0 },
                    remaining,
                    max: remaining,
                    palm: biome_palm,
                    snow: biome_snow,
                    scale: 0.9 + random.next() * 0.3,
                    extra: Default::default(),
                };
                if river_biome && (nd.x - river_x(&self.state, w, nd.y)).abs() < 150.0 {
                    continue;
                }
                if self.state.buildings.iter().any(|b| dist(Pt::new(b.x, b.y), Pt::new(nd.x, nd.y)) < b.r + 45.0) {
                    continue;
                }
                if !self.land_free(nd.x, nd.y, if nd.kind == Res::Wood { 52.0 } else { 35.0 }, false) || !self.ground_free(nd.x, nd.y, 28.0) {
                    continue;
                }
                if nd.kind == Res::Wood && self.state.units.iter().any(|u| u.team != 2 && dist(Pt::new(u.x, u.y), Pt::new(nd.x, nd.y)) < 50.0) {
                    continue;
                }
                self.state.nodes.push(nd);
            }
        }
    }

    fn mass_biome(&self) -> f64 {
        config_biome(&self.state).unwrap_or(match level_terrain(&self.state) {
            2 => 3.0,
            t if t >= 3 => 2.0,
            t => t as f64,
        })
    }

    fn finish_mass(&mut self, tiles: &Tiles, cell: f64, forest: bool, seed: f64, flags: Option<(bool, bool)>) {
        let contours = trace_rock_contours(tiles, cell);
        let points: Vec<Pt> = contours.iter().flatten().copied().collect();
        let min_x = points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
        let max_x = points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
        let min_y = points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
        let max_y = points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
        let mass = TerrainFeature {
            kind: "rockmass".into(),
            forest: if forest { Some(true) } else { None },
            x: (min_x + max_x) / 2.0,
            y: (min_y + max_y) / 2.0,
            rx: (max_x - min_x) / 2.0 + 24.0,
            ry: (max_y - min_y) / 2.0 + 24.0,
            r: 0.0,
            block: true,
            contours,
            cell,
            tiles: tiles.keys().map(|&(x, y)| Tile { x, y }).collect(),
            palm: flags.map(|f| f.0),
            snow: flags.map(|f| f.1),
            biome: self.mass_biome(),
            seed,
            extra: Default::default(),
        };
        self.state.terrain_features.push(mass);
        let masses = self.state.terrain_features.clone();
        self.geo.warm(&masses);
    }

    fn make_rock_clusters(&mut self, random: &mut Seeded) {
        let (w, h) = (self.geo.w, self.geo.h);
        let cell = 64.0;
        let count = 24f64.min(((w * h) / 10000000.0).ceil()) as i32;
        self.state.terrain_features = Vec::new();
        self.geo.warm(&[]);
        for cluster in 0..count {
            let flank: Option<City> = if cluster == 0 { self.state.cities.first().cloned() } else { None };
            let cx = ((if let Some(f) = &flank { f.x - 600.0 } else { 550.0 + random.next() * (w - 1100.0) }) / cell).floor() as i32;
            let cy = ((if let Some(f) = &flank { f.y - 384.0 } else { 450.0 + random.next() * (h - 900.0) }) / cell).floor() as i32;
            let mut tiles: Tiles = IndexMap::new();
            let flank_ref = flank.clone();
            let valid = |s: &Sim, x: i32, y: i32| -> bool {
                let px = (x as f64 + 0.5) * cell;
                let py = (y as f64 + 0.5) * cell;
                if s.state.nodes.iter().any(|n| n.remaining > 0.0 && (n.x - px).abs() < cell / 2.0 + n.r + 24.0 && (n.y - py).abs() < cell / 2.0 + n.r + 24.0) {
                    return false;
                }
                if s.state.buildings.iter().any(|b| {
                    !(flank_ref.as_ref().map(|f| b.city == Some(f.id) && b.kind == BKind::Wall && b.y < f.y - 250.0).unwrap_or(false))
                        && (b.x - px).abs() < b.w / 2.0 + cell
                        && (b.y - py).abs() < b.h / 2.0 + cell
                }) {
                    return false;
                }
                for dx in [-cell / 2.0, 0.0, cell / 2.0] {
                    for dy in [-cell / 2.0, 0.0, cell / 2.0] {
                        if !s.land_free(px + dx, py + dy, 20.0, false) {
                            return false;
                        }
                    }
                }
                !s.state.terrain_features.iter().any(|d| (d.x - px).abs() < d.rx + cell && (d.y - py).abs() < d.ry + cell)
            };
            if !valid(self, cx, cy) {
                continue;
            }
            tiles.insert((cx, cy), ());
            let heading = if flank.is_some() { 0.0 } else { random.next() * std::f64::consts::PI * 2.0 };
            let length = if flank.is_some() { 20 } else { 24 + (random.next() * 23.0).floor() as i32 };
            let bend = if flank.is_some() { 0.0 } else { (random.next() - 0.5) * 1.1 };
            let width = if flank.is_some() { 1.7 } else { 1.5 + random.next() * 1.7 };
            let mut spine_x = cx as f64;
            let mut spine_y = cy as f64;
            let mut angle = heading;
            for step in 0..length {
                angle += (if flank.is_some() { 0.0 } else { sin(step as f64 * 0.27 + cluster as f64) * 0.035 }) + bend / length as f64;
                let center_x = round(spine_x) as i32;
                let center_y = round(spine_y) as i32;
                let shoulder = width + sin(step as f64 * 0.43 + cluster as f64) * 0.9;
                for dy in -4..=4 {
                    for dx in -4..=4 {
                        let x = center_x + dx;
                        let y = center_y + dy;
                        if hypot(dx as f64, dy as f64) <= shoulder && valid(self, x, y) {
                            tiles.insert((x, y), ());
                        }
                    }
                }
                spine_x += cos(angle);
                spine_y += sin(angle);
            }
            {
                let sref: &Sim = self;
                let vf = |x: i32, y: i32| valid(sref, x, y);
                // fillRockHoles needs a closure; tiles is a separate local.
                fill_rock_holes(&mut tiles, &vf);
            }
            if tiles.len() < 12 {
                continue;
            }
            let seed = self.state.seed + cluster as f64 * 91.0;
            self.finish_mass(&tiles, cell, false, seed, None);
        }
    }

    fn make_forest(&mut self, cx0: f64, cy0: f64, camp: bool, random: &mut Seeded, index: usize) {
        let cell = 64.0;
        let mut tiles: Tiles = IndexMap::new();
        let valid = |s: &Sim, x: i32, y: i32| -> bool {
            let px = (x as f64 + 0.5) * cell;
            let py = (y as f64 + 0.5) * cell;
            if s.state.buildings.iter().any(|b| (b.x - px).abs() < b.w / 2.0 + cell + 30.0 && (b.y - py).abs() < b.h / 2.0 + cell + 30.0)
                || s.state.units.iter().any(|u| u.hp > 0.0 && (u.x - px).abs() < cell + 20.0 && (u.y - py).abs() < cell + 20.0)
                || s.state.buildings.iter().any(|b| b.kind == BKind::Towncenter && hypot(b.x - px, b.y - py) < 470.0)
            {
                return false;
            }
            for dx in [-cell / 2.0, 0.0, cell / 2.0] {
                for dy in [-cell / 2.0, 0.0, cell / 2.0] {
                    if !s.land_free(px + dx, py + dy, 30.0, false) {
                        return false;
                    }
                }
            }
            let masses = &s.state.terrain_features;
            !masses.iter().enumerate().any(|(i, d)| (d.x - px).abs() < d.rx + cell && (d.y - py).abs() < d.ry + cell && rock_blocks_cached(&s.geo, i, d, px, py, cell * 0.75))
        };
        let mut cx = (cx0 / cell).floor() as i32;
        let mut cy = (cy0 / cell).floor() as i32;
        let mut found = valid(self, cx, cy);
        let mut ring = 1;
        while ring <= 8 && !found {
            let mut k = 0;
            while k < 10 && !found {
                let a = random.next() * std::f64::consts::PI * 2.0;
                let x = (cx0 / cell + cos(a) * ring as f64).floor() as i32;
                let y = (cy0 / cell + sin(a) * ring as f64).floor() as i32;
                if valid(self, x, y) {
                    cx = x;
                    cy = y;
                    found = true;
                }
                k += 1;
            }
            ring += 1;
        }
        if !found {
            return;
        }
        tiles.insert((cx, cy), ());
        let heading = random.next() * std::f64::consts::PI * 2.0;
        let length = if camp { 8 + (random.next() * 5.0).floor() as i32 } else { 16 + (random.next() * 20.0).floor() as i32 };
        let bend = (random.next() - 0.5) * 1.3;
        let width = if camp { 1.8 + random.next() * 0.7 } else { 2.3 + random.next() * 1.6 };
        let mut spine_x = cx as f64;
        let mut spine_y = cy as f64;
        let mut angle = heading;
        for step in 0..length {
            angle += sin(step as f64 * 0.25 + index as f64) * 0.05 + bend / length as f64;
            let center_x = round(spine_x) as i32;
            let center_y = round(spine_y) as i32;
            let shoulder = width + sin(step as f64 * 0.43 + index as f64) * 0.8;
            for dy in -5..=5 {
                for dx in -5..=5 {
                    let x = center_x + dx;
                    let y = center_y + dy;
                    if hypot(dx as f64, dy as f64) <= shoulder && valid(self, x, y) {
                        tiles.insert((x, y), ());
                    }
                }
            }
            spine_x += cos(angle);
            spine_y += sin(angle);
        }
        {
            let sref: &Sim = self;
            let vf = |x: i32, y: i32| valid(sref, x, y);
            fill_rock_holes(&mut tiles, &vf);
        }
        if tiles.len() < if camp { 8 } else { 20 } {
            return;
        }
        // Drop single-tile spurs.
        let snapshot: Vec<(i32, i32)> = tiles.keys().copied().collect();
        for (x, y) in snapshot {
            let n = [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().filter(|(dx, dy)| tiles.contains_key(&(x + dx, y + dy))).count();
            if n < 2 {
                tiles.shift_remove(&(x, y));
            }
        }
        let palm = config_biome(&self.state).map(|b| b == 2.0).unwrap_or(level_terrain(&self.state) >= 3);
        let snow = config_biome(&self.state).map(|b| b == 3.0).unwrap_or(level_terrain(&self.state) == 2);
        let seed = self.state.seed + index as f64 * 53.0;
        self.finish_mass(&tiles, cell, true, seed, Some((palm, snow)));
    }

    fn grove_hash(x: i32, y: i32, k: i32) -> f64 {
        let h = (x.wrapping_mul(73856093) ^ y.wrapping_mul(19349663) ^ k.wrapping_mul(83492791)) as u32;
        h.wrapping_mul(2654435761u32) as f64 / 4294967296.0
    }

    fn rim_tree(&mut self, fi: usize, tx: i32, ty: i32, dx: i32, dy: i32, jitter: f64, scale: f64) -> Node {
        let (cell, palm, snow) = {
            let m = &self.state.terrain_features[fi];
            (m.cell, m.palm.unwrap_or(false), m.snow.unwrap_or(false))
        };
        let id = self.next_uid();
        let mut extra: crate::model::Extra = Default::default();
        extra.insert("tile".into(), serde_json::json!([tx, ty]));
        extra.insert("grove".into(), serde_json::json!(fi));
        Node {
            id,
            kind: Res::Wood,
            x: (tx as f64 + 0.5) * cell + dx as f64 * (cell / 2.0 + 22.0) + if dy != 0 { jitter } else { 0.0 },
            y: (ty as f64 + 0.5) * cell + dy as f64 * (cell / 2.0 + 22.0) + if dx != 0 { jitter } else { 0.0 },
            r: 23.0,
            remaining: 660.0,
            max: 660.0,
            palm,
            snow,
            scale,
            extra,
        }
    }

    fn forest_rim_nodes(&mut self, fi: usize, random: &mut Seeded) {
        let tiles: Vec<(i32, i32)> = self.state.terrain_features[fi].tiles.iter().map(|t| (t.x, t.y)).collect();
        let has: std::collections::HashSet<(i32, i32)> = tiles.iter().copied().collect();
        let mut out: Vec<Node> = Vec::new();
        for &(tx, ty) in &tiles {
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                if has.contains(&(tx + dx, ty + dy)) {
                    continue;
                }
                let jitter = (random.next() - 0.5) * 24.0;
                let scale = 0.9 + random.next() * 0.3;
                let n = self.rim_tree(fi, tx, ty, dx, dy, jitter, scale);
                if !self.land_free(n.x, n.y, 52.0, false) || !self.ground_free(n.x, n.y, 4.0) {
                    continue;
                }
                if self.state.buildings.iter().any(|b| dist(Pt::new(b.x, b.y), Pt::new(n.x, n.y)) < b.r + 45.0) {
                    continue;
                }
                if self.state.units.iter().any(|u| u.team != 2 && dist(Pt::new(u.x, u.y), Pt::new(n.x, n.y)) < 50.0) {
                    continue;
                }
                out.push(n);
            }
        }
        let tile_of = |n: &Node| -> (i64, i64) {
            let t = n.extra.get("tile").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            (t.first().and_then(|v| v.as_i64()).unwrap_or(0), t.get(1).and_then(|v| v.as_i64()).unwrap_or(0))
        };
        let mut covered: std::collections::HashSet<(i64, i64)> = std::collections::HashSet::new();
        for n in &out {
            if !self.state.nodes.iter().any(|m| dist(Pt::new(m.x, m.y), Pt::new(n.x, n.y)) < 40.0) {
                self.state.nodes.push(n.clone());
                covered.insert(tile_of(n));
            }
        }
        // Every exposed tile keeps at least one tree, so none is unreachable.
        for n in out {
            let t = tile_of(&n);
            if !covered.contains(&t) {
                covered.insert(t);
                self.state.nodes.push(n);
            }
        }
    }

    /// The last tree of a forest tile is gone: remove the tile and expose its neighbours.
    pub fn erode_grove(&mut self, ni: usize) {
        let (fi, tx, ty) = {
            let n = &self.state.nodes[ni];
            let (Some(g), Some(t)) = (n.extra.get("grove").and_then(|v| v.as_u64()), n.extra.get("tile").and_then(|v| v.as_array())) else { return };
            (g as usize, t.first().and_then(|v| v.as_i64()).unwrap_or(0) as i32, t.get(1).and_then(|v| v.as_i64()).unwrap_or(0) as i32)
        };
        if fi >= self.state.terrain_features.len() {
            return;
        }
        let on_tile = |m: &Node, x: i32, y: i32| -> bool {
            m.extra.get("grove").and_then(|v| v.as_u64()) == Some(fi as u64)
                && m.extra.get("tile").and_then(|v| v.as_array()).map(|t| t.first().and_then(|v| v.as_i64()) == Some(x as i64) && t.get(1).and_then(|v| v.as_i64()) == Some(y as i64)).unwrap_or(false)
        };
        if self.state.nodes.iter().enumerate().any(|(i, m)| i != ni && on_tile(m, tx, ty) && m.remaining > 0.0) {
            return;
        }
        let Some(at) = self.state.terrain_features[fi].tiles.iter().position(|t| t.x == tx && t.y == ty) else { return };
        self.state.terrain_features[fi].tiles.remove(at);
        let cell = self.state.terrain_features[fi].cell;
        let mut map: Tiles = IndexMap::new();
        for t in &self.state.terrain_features[fi].tiles {
            map.insert((t.x, t.y), ());
        }
        self.state.terrain_features[fi].contours = if map.is_empty() { Vec::new() } else { trace_rock_contours(&map, cell) };
        let count = self.state.terrain_features.len();
        self.geo.reset_rock_cache(count);
        self.state.nav_dirty = true;
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (tx + dx, ty + dy);
            if !map.contains_key(&(nx, ny)) {
                continue;
            }
            if self.state.nodes.iter().any(|m| on_tile(m, nx, ny) && m.remaining > 0.0) {
                continue;
            }
            let jitter = (Self::grove_hash(nx, ny, 1) - 0.5) * 24.0;
            let scale = 0.9 + Self::grove_hash(nx, ny, 2) * 0.3;
            let tree = self.rim_tree(fi, nx, ny, -dx, -dy, jitter, scale);
            if self.land_free(tree.x, tree.y, 52.0, false) {
                self.state.nodes.push(tree);
            }
        }
    }
}

#[allow(dead_code)]
fn unused(_: Plot) {}
