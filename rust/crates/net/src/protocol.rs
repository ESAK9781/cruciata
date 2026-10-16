use cruciata_core::lockstep::PlayerCommand;
use serde::{Deserialize, Serialize};

/// Bumped whenever simulation rules or the wire format change.
pub const PROTOCOL: u32 = 1;
pub const GAME_PORT: u16 = 47814;
pub const DISCOVERY_PORT: u16 = 47813;
pub const MAGIC: &str = "CRUCIATA-LAN";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Msg {
    /// Guest to host after connecting.
    Hello { name: String, protocol: u32, build: String },
    /// Host to guest: the match definition and the guest's team.
    Welcome { config: serde_json::Value, team: i32, host_name: String },
    /// Host refuses the guest (version mismatch or game full).
    Refused { reason: String },
    /// Either side: the sim is built and waiting.
    Ready,
    /// The commands one player issues for a turn (empty turns are sent too).
    Turn { turn: u32, cmds: Vec<PlayerCommand> },
    /// State hash after executing `turn`.
    Hash { turn: u32, hash: u64 },
    Chat { text: String },
    Bye,
    /// Never sent: produced locally when the connection drops.
    Closed,
}

/// UDP announcement a host broadcasts.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Announce {
    pub magic: String,
    pub protocol: u32,
    pub name: String,
    pub port: u16,
    pub map: String,
}
