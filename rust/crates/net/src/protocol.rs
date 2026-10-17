use cruciata_core::lockstep::PlayerCommand;
use serde::{Deserialize, Serialize};

/// Bumped whenever simulation rules or the wire format change.
pub const PROTOCOL: u32 = 2;
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
    /// Host to guest: the lobby as it stands (settings, factions, ready flags).
    Lobby(LobbyState),
    /// Guest to host: the faction (art slot) the guest wants.
    LobbyPick { faction: i32 },
    /// Guest to host: ready or not.
    LobbyReady { ready: bool },
    /// Host to guest: both are ready; this is the final match configuration.
    Start { config: serde_json::Value },
    Bye,
    /// Never sent: produced locally when the connection drops.
    Closed,
}

/// Everything both players see in the pre-match lobby; only the host edits the settings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LobbyState {
    pub config: serde_json::Value,
    pub host_name: String,
    pub guest_name: String,
    pub host_faction: i32,
    pub guest_faction: i32,
    pub host_ready: bool,
    pub guest_ready: bool,
}

/// UDP announcement a host broadcasts.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Announce {
    pub magic: String,
    pub protocol: u32,
    pub name: String,
    pub port: u16,
    pub map: String,
    /// Identifies one host across the several addresses its broadcast arrives from.
    #[serde(default)]
    pub id: u64,
}
