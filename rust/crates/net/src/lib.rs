//! LAN multiplayer: wire protocol, lockstep driver, TCP transport and
//! zero-configuration discovery.
pub mod discovery;
pub mod link;
pub mod lobby;
pub mod lockstep;
pub mod protocol;
pub mod session;

/// Is `faction` an art slot a player may choose?
pub fn factions_ok(faction: i32) -> bool {
    cruciata_core::factions::info(faction).is_some()
}
