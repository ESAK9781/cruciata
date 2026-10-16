//! Static game tables (`TYPES`, `BUILDINGS`, `TECHS`, `LEVELS`) ported from
//! `src/game.js`, including the load-time balance adjustments.

use crate::model::{BKind, Cost, Res, UType};
use std::sync::OnceLock;

#[derive(Clone, Debug)]
pub struct TypeSpec {
    pub name: &'static str,
    pub short: Option<&'static str>,
    pub cost: Option<Cost>,
    pub hp: f64,
    pub speed: f64,
    pub range: f64,
    pub min_range: Option<f64>,
    pub damage: f64,
    pub cooldown: f64,
    pub producer: Option<BKind>,
    pub train: f64,
    pub rank: i32,
}

#[derive(Clone, Debug)]
pub struct BuildingSpec {
    pub name: &'static str,
    pub cost: Option<Cost>,
    pub w: f64,
    pub h: f64,
    pub hp: f64,
    pub time: f64,
    pub pop: f64,
    pub drop: Option<Vec<Res>>,
    pub passable: bool,
    pub range: Option<f64>,
    pub min_range: Option<f64>,
    pub damage: Option<f64>,
    pub vision: Option<f64>,
    pub reload: Option<f64>,
    pub description: Option<&'static str>,
}

#[derive(Clone, Debug)]
pub struct Tech {
    pub key: &'static str,
    pub name: &'static str,
    pub ty: Option<UType>,
    pub rank: i32,
    pub producer: BKind,
    pub cost: Cost,
    pub time: f64,
    pub desc: String,
    pub unlock: Option<BKind>,
    pub requires: Option<&'static str>,
}

#[derive(Clone, Debug)]
pub struct Level {
    pub name: &'static str,
    pub roman: &'static str,
    pub sub: &'static str,
    pub title: &'static str,
    pub date: &'static str,
    pub terrain: i32,
    pub kind: &'static str,
    pub camp: (f64, f64),
    pub fort: (f64, f64),
    pub hp: f64,
    pub wave: f64,
    pub objective: &'static str,
    pub desc: &'static str,
    pub story: &'static str,
    pub win: &'static str,
}

pub struct Data {
    pub types: Vec<(UType, TypeSpec)>,
    buildings: Vec<(BKind, BuildingSpec)>,
    pub techs: Vec<Tech>,
    pub levels: Vec<Level>,
}

pub const ALL_UTYPES: [UType; 12] = [
    UType::Worker,
    UType::Sword,
    UType::Archer,
    UType::Knight,
    UType::Chaplain,
    UType::Standard,
    UType::Trebuchet,
    UType::Civilian,
    UType::Pilgrim,
    UType::Ram,
    UType::Ballista,
    UType::Merchant,
];

impl Data {
    pub fn ty(&self, t: UType) -> &TypeSpec {
        &self.types.iter().find(|(k, _)| *k == t).unwrap().1
    }
    pub fn bld(&self, k: BKind) -> &BuildingSpec {
        &self.buildings.iter().find(|(x, _)| *x == k).unwrap().1
    }
    pub fn tech(&self, key: &str) -> Option<&Tech> {
        self.techs.iter().find(|t| t.key == key)
    }
}

pub fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();
    DATA.get_or_init(build)
}

fn c(items: &[(Res, f64)]) -> Option<Cost> {
    Some(Cost::of(items))
}

#[allow(clippy::too_many_arguments)]
fn ty(
    name: &'static str,
    cost: Option<Cost>,
    hp: f64,
    speed: f64,
    range: f64,
    damage: f64,
    cooldown: f64,
    producer: Option<BKind>,
    train: f64,
    rank: i32,
) -> TypeSpec {
    TypeSpec { name, short: None, cost, hp, speed, range, min_range: None, damage, cooldown, producer, train, rank }
}

fn bs(name: &'static str, cost: Option<Cost>, w: f64, h: f64, hp: f64, time: f64) -> BuildingSpec {
    BuildingSpec {
        name,
        cost,
        w,
        h,
        hp,
        time,
        pop: 0.0,
        drop: None,
        passable: false,
        range: None,
        min_range: None,
        damage: None,
        vision: None,
        reload: None,
        description: None,
    }
}

use Res::{Food, Gold, Stone, Wood};

fn build() -> Data {
    // ---- units ----
    let mut types: Vec<(UType, TypeSpec)> = vec![
        (UType::Worker, ty("Villager", c(&[(Food, 50.0)]), 65.0, 76.0, 0.0, 0.0, 1.0, Some(BKind::Towncenter), 10.0, 4)),
        (UType::Sword, ty("Swordsman", c(&[(Food, 55.0), (Gold, 35.0)]), 130.0, 85.0, 28.0, 18.0, 1.0, Some(BKind::Barracks), 12.0, 0)),
        (UType::Archer, ty("Archer", c(&[(Wood, 45.0), (Gold, 40.0), (Food, 30.0)]), 75.0, 88.0, 225.0, 13.0, 1.4, Some(BKind::Barracks), 14.0, 2)),
        (UType::Knight, ty("Knight", c(&[(Food, 90.0), (Gold, 100.0)]), 230.0, 125.0, 34.0, 29.0, 1.2, Some(BKind::Stable), 22.0, 1)),
        (UType::Chaplain, ty("Chaplain", c(&[(Food, 45.0), (Gold, 90.0)]), 85.0, 80.0, 175.0, 0.0, 1.5, Some(BKind::Chapel), 18.0, 3)),
        (UType::Standard, {
            let mut t = ty("Standard bearer", c(&[(Food, 65.0), (Gold, 75.0), (Wood, 30.0)]), 150.0, 86.0, 24.0, 9.0, 1.3, Some(BKind::Barracks), 18.0, 1);
            t.short = Some("Standard");
            t
        }),
        (UType::Trebuchet, {
            let mut t = ty("Trebuchet", c(&[(Wood, 240.0), (Gold, 180.0), (Stone, 100.0), (Food, 45.0)]), 260.0, 43.0, 690.0, 135.0, 8.0, Some(BKind::Siegeworkshop), 35.0, 5);
            t.min_range = Some(180.0);
            t
        }),
        (UType::Civilian, ty("Townsfolk", None, 50.0, 65.0, 0.0, 0.0, 1.0, None, 0.0, 4)),
        (UType::Pilgrim, ty("Pilgrim caravan", None, 180.0, 55.0, 0.0, 0.0, 1.0, None, 0.0, 4)),
        (UType::Ram, ty("Battering ram", c(&[(Wood, 280.0), (Gold, 100.0)]), 900.0, 38.0, 38.0, 95.0, 3.0, Some(BKind::Siegeworkshop), 40.0, 0)),
        (UType::Ballista, ty("Ballista", c(&[(Wood, 200.0), (Gold, 140.0)]), 220.0, 48.0, 380.0, 42.0, 4.0, Some(BKind::Siegeworkshop), 30.0, 2)),
    ];
    let pilgrim = types.iter().find(|(k, _)| *k == UType::Pilgrim).unwrap().1.clone();
    let mut merchant = pilgrim;
    merchant.name = "Supply caravan";
    merchant.hp = 280.0;
    merchant.speed = 50.0;
    types.push((UType::Merchant, merchant));
    // Load-time balance pass.
    for (k, t) in types.iter_mut() {
        if matches!(k, UType::Sword | UType::Archer | UType::Knight | UType::Standard) {
            t.train *= 0.6;
            if let Some(cost) = t.cost.as_mut() {
                for (_, v) in cost.0.iter_mut() {
                    *v = crate::js::round(*v * 0.72);
                }
            }
            t.damage *= 0.8;
        }
    }

    // ---- buildings ----
    let mut b: Vec<(BKind, BuildingSpec)> = Vec::new();
    {
        let mut tc = bs("Town centre", None, 140.0, 120.0, 1800.0, 0.0);
        tc.pop = 16.0;
        tc.drop = Some(vec![Food, Wood, Gold, Stone]);
        b.push((BKind::Towncenter, tc));
        let mut house = bs("House", c(&[(Wood, 65.0), (Stone, 15.0)]), 64.0, 62.0, 450.0, 18.0);
        house.pop = 6.0;
        b.push((BKind::House, house));
        let mut farm = bs("Farm", c(&[(Wood, 75.0)]), 110.0, 95.0, 400.0, 18.0);
        farm.passable = true;
        b.push((BKind::Farm, farm));
        let mut mill = bs("Mill", c(&[(Wood, 110.0), (Stone, 20.0)]), 80.0, 76.0, 650.0, 24.0);
        mill.drop = Some(vec![Food]);
        b.push((BKind::Mill, mill));
        let mut lumber = bs("Lumber camp", c(&[(Wood, 90.0)]), 76.0, 70.0, 600.0, 20.0);
        lumber.drop = Some(vec![Wood]);
        b.push((BKind::Lumbercamp, lumber));
        let mut mining = bs("Mining camp", c(&[(Wood, 100.0), (Stone, 30.0)]), 78.0, 74.0, 650.0, 23.0);
        mining.drop = Some(vec![Gold, Stone]);
        b.push((BKind::Miningcamp, mining));
        b.push((BKind::Barracks, bs("Barracks", c(&[(Wood, 180.0), (Stone, 70.0)]), 110.0, 95.0, 1000.0, 32.0)));
        b.push((BKind::Stable, bs("Stables", c(&[(Wood, 210.0), (Stone, 90.0)]), 106.0, 96.0, 950.0, 32.0)));
        b.push((BKind::Chapel, bs("Chapel", c(&[(Wood, 170.0), (Stone, 100.0), (Gold, 70.0)]), 86.0, 116.0, 950.0, 35.0)));
        let mut tower = bs("Defense tower", c(&[(Wood, 140.0), (Stone, 120.0)]), 54.0, 54.0, 1050.0, 30.0);
        tower.range = Some(340.0);
        tower.damage = Some(24.0);
        b.push((BKind::Tower, tower));
        b.push((BKind::Siegeworkshop, bs("Siege workshop", c(&[(Wood, 230.0), (Stone, 150.0), (Gold, 80.0)]), 125.0, 100.0, 1100.0, 38.0)));
        let mut fort = bs("Enemy citadel", None, 175.0, 165.0, 2500.0, 0.0);
        fort.range = Some(360.0);
        fort.damage = Some(26.0);
        b.push((BKind::Fort, fort));
        let mut watch = bs("Observation tower", c(&[(Wood, 35.0)]), 38.0, 38.0, 320.0, 10.0);
        watch.vision = Some(1100.0);
        watch.description = Some("Cheap timber lookout. Reveals distant terrain (1100 range), but cannot attack or train troops.");
        b.push((BKind::Watchtower, watch));
        b.push((BKind::Wall, bs("Curtain wall", c(&[(Stone, 12.0), (Wood, 3.0)]), 32.0, 32.0, 3200.0, 4.0)));
        let mut gate = bs("Gatehouse", c(&[(Stone, 110.0), (Wood, 55.0)]), 74.0, 42.0, 4200.0, 25.0);
        gate.passable = true;
        b.push((BKind::Gate, gate));
        let mut bwall = bs("Bastion wall", c(&[(Stone, 48.0), (Wood, 12.0)]), 32.0, 32.0, 11000.0, 16.0);
        bwall.passable = false;
        b.push((BKind::Bastionwall, bwall));
        let mut bgate = bs("Bastion gatehouse", c(&[(Stone, 260.0), (Wood, 120.0)]), 74.0, 42.0, 18000.0, 40.0);
        bgate.passable = true;
        b.push((BKind::Bastiongate, bgate));
        let mut great = bs("Great siege engine", c(&[(Wood, 1200.0), (Stone, 650.0), (Gold, 500.0)]), 203.0, 175.0, 6000.0, 180.0);
        great.range = Some(2200.0);
        great.min_range = Some(320.0);
        great.damage = Some(650.0);
        great.description = Some("Massive permanent counterweight engine. Villagers build it on site. Range 320-2200; huge blasts also hit nearby friendly troops.");
        b.push((BKind::Greatengine, great));
        let mut col = bs("Colossal siege engine", c(&[(Wood, 6000.0), (Stone, 3500.0), (Gold, 2500.0)]), 400.0, 345.0, 16000.0, 2400.0);
        col.damage = Some(650.0);
        col.reload = Some(18.0);
        col.description = Some("Only one per side. Unlimited range beyond a 700-unit minimum: shots scatter further the farther they fly. Never fires on its own. The enemy is told the moment it is begun.");
        b.push((BKind::Colossus, col));
    }
    // Footprints (except curtain pieces) are scaled to 80 percent.
    for (k, spec) in b.iter_mut() {
        if !matches!(k, BKind::Wall | BKind::Gate | BKind::Bastionwall) {
            spec.w = crate::js::round(spec.w * 0.8);
            spec.h = crate::js::round(spec.h * 0.8);
        }
    }
    for (k, spec) in b.iter_mut() {
        match k {
            BKind::House => spec.pop = 12.0,
            BKind::Towncenter => {
                spec.pop = 32.0;
                spec.cost = c(&[(Wood, 500.0), (Stone, 350.0), (Gold, 200.0)]);
                spec.time = 100.0;
            }
            _ => {}
        }
    }

    // ---- research ----
    let variants: [(UType, [&'static str; 3]); 6] = [
        (UType::Sword, ["Swordsman", "Templar", "Veteran Templar"]),
        (UType::Archer, ["Archer", "Crossbowman", "Royal Arbalester"]),
        (UType::Knight, ["Knight", "Order Cavalier", "Marshal's Guard"]),
        (UType::Chaplain, ["Chaplain", "Hospitaller", "Prior"]),
        (UType::Standard, ["Standard bearer", "Gonfalonier", "Sacred Standard"]),
        (UType::Trebuchet, ["Trebuchet", "Counterweight Engine", "Grand Trebuchet"]),
    ];
    let mut techs: Vec<Tech> = Vec::new();
    for (t, names) in variants.iter() {
        let producer = types.iter().find(|(k, _)| k == t).unwrap().1.producer.unwrap();
        for (rank, name) in names.iter().skip(1).enumerate() {
            let key: &'static str = match (t, rank) {
                (UType::Sword, 0) => "sword1",
                (UType::Sword, _) => "sword2",
                (UType::Archer, 0) => "archer1",
                (UType::Archer, _) => "archer2",
                (UType::Knight, 0) => "knight1",
                (UType::Knight, _) => "knight2",
                (UType::Chaplain, 0) => "chaplain1",
                (UType::Chaplain, _) => "chaplain2",
                (UType::Standard, 0) => "standard1",
                (UType::Standard, _) => "standard2",
                (UType::Trebuchet, 0) => "trebuchet1",
                _ => "trebuchet2",
            };
            let r = rank as f64;
            techs.push(Tech {
                key,
                name,
                ty: Some(*t),
                rank: rank as i32 + 1,
                producer,
                cost: Cost::of(&[(Gold, 120.0 + r * 170.0), (Wood, 80.0 + r * 90.0)]),
                time: 28.0 + r * 20.0,
                desc: format!(
                    "Upgrade every existing and future {}. +25% health and damage per rank.",
                    names[0].to_lowercase()
                ),
                unlock: None,
                requires: None,
            });
        }
    }
    techs.push(Tech {
        key: "engineworks",
        name: "Great engines",
        ty: None,
        rank: 0,
        producer: BKind::Siegeworkshop,
        cost: Cost::of(&[(Wood, 450.0), (Stone, 300.0), (Gold, 400.0)]),
        time: 90.0,
        desc: "Siege engineering. Unlocks the permanent great siege engine (range 320-2200) in the Fortification build menu.".into(),
        unlock: Some(BKind::Greatengine),
        requires: None,
    });
    techs.push(Tech {
        key: "colossal",
        name: "Colossal engineering",
        ty: None,
        rank: 0,
        producer: BKind::Siegeworkshop,
        cost: Cost::of(&[(Wood, 1000.0), (Stone, 800.0), (Gold, 1100.0)]),
        time: 150.0,
        desc: "Requires Great engines. Unlocks the Colossal siege engine: unlimited range, one per side.".into(),
        unlock: Some(BKind::Colossus),
        requires: Some("engineworks"),
    });

    Data { types, buildings: b, techs, levels: levels() }
}

fn levels() -> Vec<Level> {
    vec![
        Level {
            name: "The Landing",
            roman: "I",
            sub: "THE LEVANTINE COAST",
            title: "A foothold on the coast",
            date: "SUMMER \u{b7} 1097",
            terrain: 0,
            kind: "settlement",
            camp: (500.0, 1690.0),
            fort: (2690.0, 580.0),
            hp: 1900.0,
            wave: 95.0,
            objective: "Establish a pilgrim settlement",
            desc: "Complete four farms, gather 1,000 food, and wrest the coastal outpost from its defenders.",
            story: "The cross standards rise on the Levantine shore. Your Christian host needs more than courage: send villagers to the orchards and forests, build four farms, gather a thousand provisions, and supply the army before securing the neutral coastal outpost with at least three soldiers.",
            win: "The fields are planted and the coast is secured. A living settlement now supplies the pilgrimage.",
        },
        Level {
            name: "The River",
            roman: "II",
            sub: "THE ORONTES CROSSING",
            title: "A crossing under watchful eyes",
            date: "AUTUMN \u{b7} 1097",
            terrain: 1,
            kind: "escort",
            camp: (480.0, 1710.0),
            fort: (2730.0, 480.0),
            hp: 2400.0,
            wave: 80.0,
            objective: "Escort the pilgrim caravan",
            desc: "Fortify the bridge and escort two caravans across the long contested road to the northeast refuge.",
            story: "The Orontes cuts the road in two. Four enemy camps guard the bridge and the long road to the distant refuge. Establish a watchtower near the crossing and escort your three pilgrim caravans; they march only while soldiers are close and the way is safe.",
            win: "The pilgrims have crossed beneath the protection of your standards. The road to Antioch remains open.",
        },
        Level {
            name: "The Winter Siege",
            roman: "III",
            sub: "THE OUTSKIRTS OF ANTIOCH",
            title: "Endure the winter at Antioch",
            date: "WINTER \u{b7} 1097",
            terrain: 2,
            kind: "survival",
            camp: (1430.0, 1420.0),
            fort: (2710.0, 420.0),
            hp: 3200.0,
            wave: 55.0,
            objective: "Hold through the winter siege",
            desc: "Endure sustained attacks for 10 to 15 minutes and complete a chapel. Winter slows food gathering.",
            story: "Winter closes around Antioch. Attacks will come from several directions, and the harvest is meagre. Fortify your settlement, keep food stores healthy, and build a chapel to sustain the defenders through a prolonged siege from six surrounding enemy camps.",
            win: "The settlement has endured. The bells of the chapel answer the departing winter, and your host is ready to march.",
        },
        Level {
            name: "The Pilgrim Road",
            roman: "IV",
            sub: "THE COASTAL ROAD",
            title: "The price of a safe passage",
            date: "SPRING \u{b7} 1098",
            terrain: 3,
            kind: "liberation",
            camp: (470.0, 1720.0),
            fort: (2800.0, 350.0),
            hp: 3200.0,
            wave: 70.0,
            objective: "Secure the pilgrim road",
            desc: "Hold both distant road villages for 3 to 5 minutes and deliver two escorted supply caravans.",
            story: "The road south runs through two abandoned villages. Secure both settlements and hold them while two supply caravans cross the contested road. Keep the villagers alive and protect the supply road while the opposing host scouts for a weakness.",
            win: "The route is secure. Merchants and pilgrims carry provisions south beneath your banners.",
        },
        Level {
            name: "The Walls",
            roman: "V",
            sub: "THE APPROACH TO JERUSALEM",
            title: "Let the walls answer the stones",
            date: "SUMMER \u{b7} 1099",
            terrain: 4,
            kind: "siege",
            camp: (550.0, 1750.0),
            fort: (2770.0, 540.0),
            hp: 3800.0,
            wave: 65.0,
            objective: "Breach the outer walls",
            desc: "Destroy all three reinforced gatehouses. Use deployed trebuchets to strike the fortifications.",
            story: "Jerusalem rises behind its outer walls. Build a siege workshop, bring timber and stone to the engines, and break all three reinforced gatehouses. Trebuchets must set up before firing; their stones spare neither friend nor foe near the impact.",
            win: "The outer defenses are breached. The engines have opened the path to the Holy City.",
        },
        Level {
            name: "The Holy City",
            roman: "VI",
            sub: "JERUSALEM",
            title: "Beneath the standards of Jerusalem",
            date: "HIGH SUMMER \u{b7} 1099",
            terrain: 5,
            kind: "occupation",
            camp: (490.0, 1790.0),
            fort: (2520.0, 910.0),
            hp: 4500.0,
            wave: 55.0,
            objective: "Take and hold the Holy City",
            desc: "Take the citadel, secure both holy sites, and withstand 4 to 6 minutes of counterattacks.",
            story: "Cross and crescent standards face one another before Jerusalem. Take the citadel and secure both holy sites, then prepare for the counterattack. Your settlement must still survive: an overextended host can lose the road behind it.",
            win: "Your standards fly over Jerusalem. The campaign is complete. The chronicle remembers the pilgrims, villagers, and soldiers who paid for each mile of this road.",
        },
    ]
}
