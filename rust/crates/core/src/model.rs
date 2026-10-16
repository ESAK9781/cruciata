//! State model. Field names follow the JS game (`camelCase` in JSON) so that
//! `cruciata.snapshot()` documents and JS saves load unchanged.

use crate::nav::Pt;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub type Extra = Map<String, Value>;

pub fn is_default<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

/// A neighbouring-wall link: an offset (and an optional terrain flag).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Link {
    pub x: f64,
    pub y: f64,
    pub terrain: Option<Value>,
}


#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum UType {
    #[default]
    Worker,
    Sword,
    Archer,
    Knight,
    Chaplain,
    Standard,
    Trebuchet,
    Civilian,
    Pilgrim,
    Ram,
    Ballista,
    Merchant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BKind {
    #[default]
    Towncenter,
    House,
    Farm,
    Mill,
    Lumbercamp,
    Miningcamp,
    Barracks,
    Stable,
    Chapel,
    Tower,
    Siegeworkshop,
    Fort,
    Watchtower,
    Wall,
    Gate,
    Bastionwall,
    Bastiongate,
    Greatengine,
    Colossus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Res {
    #[default]
    Food,
    Wood,
    Gold,
    Stone,
}

impl Res {
    pub const ALL: [Res; 4] = [Res::Food, Res::Wood, Res::Gold, Res::Stone];
}

#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Resources {
    pub food: f64,
    pub wood: f64,
    pub gold: f64,
    pub stone: f64,
}

impl Resources {
    pub fn get(&self, r: Res) -> f64 {
        match r {
            Res::Food => self.food,
            Res::Wood => self.wood,
            Res::Gold => self.gold,
            Res::Stone => self.stone,
        }
    }
    pub fn get_mut(&mut self, r: Res) -> &mut f64 {
        match r {
            Res::Food => &mut self.food,
            Res::Wood => &mut self.wood,
            Res::Gold => &mut self.gold,
            Res::Stone => &mut self.stone,
        }
    }
}

/// A (possibly partial) price list. Order of `entries` follows JS key order.
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct Cost(pub Vec<(Res, f64)>);

/// Serialise as a JSON object with the JS key order.
impl Cost {
    pub fn of(items: &[(Res, f64)]) -> Cost {
        Cost(items.to_vec())
    }
    pub fn get(&self, r: Res) -> f64 {
        self.0.iter().find(|(k, _)| *k == r).map(|(_, v)| *v).unwrap_or(0.0)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Order {
    pub x: f64,
    pub y: f64,
    pub attack: Option<bool>,
    pub formation: Option<u32>,
    pub rally: Option<Pt>,
    pub swarm: Option<bool>,
    pub arrive: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Job {
    pub kind: String,
    pub target: Option<u32>,
    pub depot: Option<u32>,
    pub cluster: Option<Vec<u32>>,
    pub resource: Option<Res>,
    pub phase: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Progress {
    pub x: f64,
    pub y: f64,
    pub t: f64,
    pub last: f64,
    pub stalled: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct PathRequest {
    pub start: Pt,
    pub goal: Pt,
    pub revision: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Approach {
    pub id: u32,
    pub extra: f64,
    pub revision: i64,
    pub expires: f64,
    pub point: Pt,
    pub unreachable: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct HarvestSpot {
    pub x: f64,
    pub y: f64,
    pub target: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct BuildContact {
    pub x: f64,
    pub y: f64,
    pub target: u32,
    pub revision: i64,
    pub expires: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Unit {
    pub id: u32,
    #[serde(rename = "type")]
    pub ty: UType,
    pub team: i32,
    pub x: f64,
    pub y: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub angle: f64,
    pub order: Option<Order>,
    pub target: Option<u32>,
    pub manual_target: bool,
    pub path: Vec<Pt>,
    pub path_goal: Option<Pt>,
    pub path_timer: f64,
    pub path_revision: i64,
    pub cooldown: f64,
    pub anim: f64,
    pub strike: f64,
    pub moving: bool,
    pub working: bool,
    pub hold: bool,
    pub stance: String,
    pub blessed: f64,
    pub job: Option<Job>,
    pub carry: f64,
    pub carry_type: Option<Res>,
    pub flee_until: f64,
    pub formation: Option<Value>,
    pub stuck: f64,
    pub deployment: String,
    pub deploy_timer: f64,
    pub pending_order: Option<Order>,
    pub acquire_at: Option<f64>,
    pub progress: Option<Progress>,
    pub path_request: Option<PathRequest>,
    pub vx: Option<f64>,
    pub vy: Option<f64>,
    pub dust_at: Option<f64>,
    pub approach: Option<Approach>,
    pub exhausted_cluster: Option<bool>,
    pub harvest_spot: Option<HarvestSpot>,
    pub gather_source: Option<String>,
    pub work_phase: Option<f64>,
    pub squad: Option<String>,
    pub home: Option<Pt>,
    pub curtain_guard: Option<bool>,
    pub scout: Option<bool>,
    pub march_goal: Option<Pt>,
    pub wander: Option<f64>,
    pub site: Option<u32>,
    pub arrival_avoid_side: Option<f64>,
    pub shared_route_revision: Option<i64>,
    pub stalls: Option<f64>,
    pub flee_at: Option<f64>,
    pub build_contact: Option<BuildContact>,
    pub build_blocked_at: Option<f64>,
    pub city: Option<u32>,
    pub city_defender: Option<bool>,
    pub rank: Option<f64>,
    pub campaign_post: Option<u32>,
    pub garrison_base: Option<u32>,
    pub regional_mission: Option<u32>,
    pub march_offset: Option<Pt>,
    pub run_up: Option<f64>,
    pub run_at: Option<f64>,
    pub last_attacker: Option<u32>,
    pub last_hit: Option<f64>,
    pub aim_angle: Option<f64>,
    pub route: Option<Vec<Pt>>,
    pub route_index: Option<usize>,
    pub escort_waiting: Option<bool>,
    pub castle_guard: Option<bool>,
    pub mission_supply: Option<bool>,
    pub shelter: Option<Pt>,
    pub fixed_defense: Option<bool>,
    pub build_queue: Option<Vec<u32>>,
    pub auto_scout: Option<u32>,
    pub fire_target: Option<Pt>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct QueueItem {
    pub kind: String,
    #[serde(rename = "type")]
    pub ty: Option<UType>,
    pub tech: Option<String>,
    pub time: f64,
    pub duration: f64,
    pub cost: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct WallAttachment {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub fortified: Option<bool>,
    pub wall_angle: Option<f64>,
    pub links: Option<BTreeMap<String, Link>>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct GateSegment {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub wall_angle: Option<f64>,
    pub fortified: Option<bool>,
    pub links: Option<BTreeMap<String, Link>>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Building {
    pub id: u32,
    pub kind: BKind,
    pub fortified: bool,
    pub architecture: Option<String>,
    pub team: i32,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub r: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub progress: f64,
    pub queue: Vec<QueueItem>,
    pub remaining: Option<f64>,
    pub max: Option<f64>,
    pub rally: Option<Pt>,
    pub closed: Option<bool>,
    pub guard_cooldown: f64,
    pub spent: Option<Value>,
    pub site: Option<u32>,
    pub outpost: Option<bool>,
    pub wall_attachment: Option<WallAttachment>,
    pub defence_layer: Option<f64>,
    pub defence: Option<bool>,
    pub wall_angle: Option<f64>,
    pub links: Option<BTreeMap<String, Link>>,
    pub bastion_gate: Option<bool>,
    pub gate_angle: Option<f64>,
    pub gate_segments: Option<Vec<GateSegment>>,
    pub city: Option<u32>,
    pub city_center: Option<bool>,
    pub campaign_post: Option<Value>,
    pub militia_passage: Option<bool>,
    pub castle: Option<bool>,
    pub auto_closed: Option<bool>,
    pub gate: Option<bool>,
    pub fortress_shape: Option<Value>,
    pub district: Option<bool>,
    pub fire_at: Option<f64>,
    pub rotation: Option<f64>,
    pub stance: Option<String>,
    pub aim_angle: Option<f64>,
    pub attack_target: Option<u32>,
    pub fire_target: Option<Pt>,
    pub last_shot: Option<f64>,
    pub shots: Option<f64>,
    pub announced: Option<bool>,
    pub upgrade_owner: Option<u32>,
    pub replant_remaining: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Node {
    pub id: u32,
    pub kind: Res,
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub remaining: f64,
    pub max: f64,
    pub palm: bool,
    pub snow: bool,
    pub scale: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Tile {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct TerrainFeature {
    pub kind: String,
    pub forest: Option<bool>,
    pub x: f64,
    pub y: f64,
    pub rx: f64,
    pub ry: f64,
    pub r: f64,
    pub block: bool,
    pub contours: Vec<Vec<Pt>>,
    pub cell: f64,
    pub tiles: Vec<Tile>,
    pub palm: Option<bool>,
    pub snow: Option<bool>,
    pub biome: f64,
    pub seed: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Arrow {
    pub x: f64,
    pub y: f64,
    pub tx: f64,
    pub ty: f64,
    pub target: Option<u32>,
    pub team: i32,
    pub damage: f64,
    pub siege: bool,
    pub life: f64,
    pub sx: f64,
    pub sy: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Boulder {
    pub x: f64,
    pub y: f64,
    pub tx: f64,
    pub ty: f64,
    pub sx: f64,
    pub sy: f64,
    pub t: f64,
    pub duration: f64,
    pub heavy: bool,
    pub team: i32,
    pub source: Option<u32>,
    pub damage: f64,
    pub r: f64,
    pub lift: Option<f64>,
    pub hit: Option<bool>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Formation {
    pub id: u32,
    pub members: Vec<u32>,
    pub anchor: Pt,
    pub destination: Pt,
    pub path: Vec<Pt>,
    pub revision: i64,
    pub speed: f64,
    pub arrived: bool,
    pub wait: f64,
    pub route_start: Option<Pt>,
    pub shared_route: Option<bool>,
    pub route_ready: Option<bool>,
    pub escort_id: Option<u32>,
    pub team: Option<i32>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Squad {
    pub id: String,
    pub role: String,
    pub members: Vec<u32>,
    pub origin: Pt,
    pub phase: String,
    pub timer: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Site {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub progress: f64,
    pub captured: bool,
    pub name: String,
    pub optional: Option<bool>,
    pub team: Option<i32>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct City {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub name: String,
    pub radius: f64,
    pub capture: f64,
    pub captured: bool,
    pub reward: Option<Resources>,
    pub center: Option<u32>,
    pub reward_claimed: Option<bool>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Stats {
    pub gathered: Resources,
    pub built: f64,
    pub rescued: f64,
    pub siege_hits: f64,
    pub cities_captured: Option<f64>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Capitals {
    pub player: Option<u32>,
    pub enemy: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Enemy {
    pub faith: f64,
    pub gathered: Resources,
    pub paid: Resources,
    pub consumed: f64,
    pub resources: Resources,
    pub upgrades: BTreeMap<String, f64>,
    pub think: f64,
    pub scout: f64,
    pub attack: f64,
    pub discovered: bool,
    pub spent: f64,
    pub techs: Option<BTreeMap<String, bool>>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CampaignRules {
    pub version: f64,
    pub farms: f64,
    pub food: f64,
    pub survival: f64,
    pub hold: f64,
    pub gates: f64,
    pub deliveries: f64,
    pub strength: f64,
    pub interval: f64,
    pub grace: f64,
    pub attacks: f64,
    pub posts: Vec<Value>,
    pub think: Option<f64>,
    pub route: Option<Vec<Pt>>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct State {
    pub version: f64,
    pub mode: String,
    pub config: Option<Value>,
    pub slot: Option<Value>,
    pub seed: f64,
    pub resource_scale: f64,
    pub upgrades: BTreeMap<String, f64>,
    pub enemy: Enemy,
    pub difficulty: String,
    pub level: usize,
    pub time: f64,
    pub paused: bool,
    pub result: Option<String>,
    pub resources: Resources,
    pub faith: f64,
    pub units: Vec<Unit>,
    pub buildings: Vec<Building>,
    pub nodes: Vec<Node>,
    pub sites: Vec<Site>,
    pub squads: Vec<Squad>,
    pub cities: Vec<City>,
    pub formations: Vec<Formation>,
    pub techs: BTreeMap<String, bool>,
    pub control_groups: Value,
    pub particles: Vec<Value>,
    pub arrows: Vec<Arrow>,
    pub boulders: Vec<Boulder>,
    pub corpses: Vec<Value>,
    pub marks: Vec<Value>,
    pub rings: Vec<Value>,
    pub wave_timer: f64,
    pub save_timer: f64,
    pub losses: f64,
    pub kills: f64,
    pub healed: f64,
    pub stats: Stats,
    pub citadel_taken: bool,
    pub occupation: f64,
    pub campaign_rules: Option<CampaignRules>,
    pub nav_dirty: bool,
    pub capitals: Capitals,
    pub terrain_features: Vec<TerrainFeature>,
    pub nav_combat: bool,
    pub nav_at: f64,
    pub roads: Vec<Vec<Pt>>,
    pub screen_shake: Option<f64>,
    pub gate_timer: Option<f64>,
    pub scouting_groups: Option<Vec<Value>>,
    pub regional_think: Option<f64>,
    pub regions: Value,
    pub city_economies: Value,
    pub alerts: Option<Vec<Value>>,
    pub alert_at: Option<f64>,
    pub shot_sights: Option<Vec<Value>>,
    pub cheats: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}
