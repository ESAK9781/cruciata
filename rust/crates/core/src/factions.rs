//! The playable factions of a LAN match. A faction is named by its art slot: the number the
//! sprite keys and `src/orders-art.js` use (1 Muslim, 4-6 the crusader orders).

pub const MUSLIM: i32 = 1;
pub const TEMPLAR: i32 = 4;
pub const HOSPITALLER: i32 = 5;
pub const TEUTONIC: i32 = 6;

pub struct FactionInfo {
    pub slot: i32,
    pub name: &'static str,
    pub blurb: &'static str,
    /// Livery colours (field, charge) for swatches and chat.
    pub field: &'static str,
    pub mark: &'static str,
}

pub const FACTIONS: [FactionInfo; 4] = [
    FactionInfo { slot: TEMPLAR, name: "Knights Templar", blurb: "White mantle, red cross pattee. Red-tiled halls.", field: "#ece5d0", mark: "#b3241f" },
    FactionInfo { slot: HOSPITALLER, name: "Knights Hospitaller", blurb: "Black mantle, white eight-pointed cross. Slate roofs.", field: "#25262c", mark: "#f4efe0" },
    FactionInfo { slot: TEUTONIC, name: "Teutonic Knights", blurb: "White mantle, black cross. Verdigris roofs.", field: "#dedbcd", mark: "#17181a" },
    FactionInfo { slot: MUSLIM, name: "Muslim host", blurb: "Green banners and crescent. Domed courtyard compounds.", field: "#2c795f", mark: "#f2e1b7" },
];

pub fn info(slot: i32) -> Option<&'static FactionInfo> {
    FACTIONS.iter().find(|f| f.slot == slot)
}

pub fn name(slot: i32) -> &'static str {
    info(slot).map(|f| f.name).unwrap_or("Crusaders")
}
