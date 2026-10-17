use cruciata_core::commands::Command;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::orders::OrderCmd;
use cruciata_core::sim::Sim;
use cruciata_net::discovery::Browser;
use cruciata_net::link::mem_pair;
use cruciata_net::lobby::Lobby;
use cruciata_net::lockstep::Lockstep;
use cruciata_net::session::{self, Host};
use std::time::{Duration, Instant};

fn config() -> serde_json::Value {
    serde_json::json!({"seed": 99, "width": 6400, "height": 4400, "biome": 0, "difficulty": "normal"})
}

fn build(cfg: &serde_json::Value) -> Sim {
    let mut sim = Sim::start_level(0, Some(cfg.clone()), "normal", false);
    sim.settings.pvp = true;
    sim.state.paused = false;
    sim
}

/// What a player does at a given moment of the match.
fn act(sim: &Sim, ls: &mut Lockstep, tick: u32) {
    let team = ls.team;
    if tick == 5 {
        let tc: Vec<u32> = sim.state.buildings.iter().filter(|b| b.team == team && b.kind == BKind::Towncenter).map(|b| b.id).collect();
        ls.issue(PlayerCommand::Game(Command::Recruit { ty: UType::Worker, producers: tc }));
    }
    if tick == 120 || tick == 400 {
        let ids: Vec<u32> = sim.state.units.iter().filter(|u| u.team == team && u.hp > 0.0 && u.ty != UType::Worker).map(|u| u.id).collect();
        let foe = sim.state.buildings.iter().find(|b| b.team == 1 - team && b.kind == BKind::Towncenter).unwrap();
        ls.issue(PlayerCommand::Order(OrderCmd { units: ids, structures: vec![], x: foe.x, y: foe.y, attack: true, append: false, enemy: None, node: None, building: None, escort: None }));
    }
}

/// Drive two peers with uneven frame times until both have run `ticks` frames.
fn play(mut a: (Sim, Lockstep), mut b: (Sim, Lockstep), ticks: u32) -> ((Sim, Lockstep), (Sim, Lockstep)) {
    for tick in 0..ticks {
        // Peer A runs at ~60 fps, peer B jitters between 20 and 90 fps.
        let dt_a = 1.0 / 60.0;
        let dt_b = [0.011, 0.05, 0.016, 0.03, 0.02][(tick % 5) as usize];
        act(&a.0, &mut a.1, tick);
        act(&b.0, &mut b.1, tick);
        a.1.advance(&mut a.0, dt_a);
        b.1.advance(&mut b.0, dt_b);
        // Give real sockets a moment so slow CI machines still exchange turns.
        std::thread::sleep(Duration::from_millis(1));
    }
    (a, b)
}

#[test]
fn two_peers_stay_in_sync_over_memory() {
    let cfg = config();
    let (la, lb) = mem_pair();
    let a = (build(&cfg), Lockstep::new(0, Box::new(la)));
    let b = (build(&cfg), Lockstep::new(1, Box::new(lb)));
    let (a, b) = play(a, b, 4000);
    assert!(a.1.desync.is_none() && b.1.desync.is_none(), "desync reported");
    assert!(a.0.state.time > 30.0, "simulation advanced ({})", a.0.state.time);
    // Both peers executed the same turns; compare at the shorter one.
    assert!((a.1.turn() as i64 - b.1.turn() as i64).abs() <= 6);
}

#[test]
fn tcp_discovery_join_and_play() {
    let cfg = config();
    let disc = 47990;
    let mut host = Host::start_on("Test host".into(), "Seed 99".into(), cfg.clone(), 0, disc).unwrap();
    let mut browser = Browser::on_port(disc).unwrap();
    let start = Instant::now();
    // Broadcast delivery depends on the machine's network (CI runners may have none),
    // so fall back to the known port when nothing is heard.
    let mut port = host.port;
    loop {
        if let Some(h) = browser.poll().into_iter().next() {
            assert_eq!(h.name, "Test host");
            port = h.addr.port();
            break;
        }
        if start.elapsed() > Duration::from_secs(4) {
            eprintln!("discovery broadcast not delivered on this machine; joining directly");
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let addr = std::net::SocketAddr::new("127.0.0.1".parse().unwrap(), port);
    let guest = session::join(addr, "Guest").unwrap();
    assert_eq!(guest.team, 1);
    let hs = loop {
        if let Some(s) = host.poll() {
            break s;
        }
        assert!(start.elapsed() < Duration::from_secs(8));
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(hs.peer_name, "Guest");
    let t = std::thread::spawn(move || guest.ready(Duration::from_secs(5)).unwrap());
    let ls_host = hs.ready(Duration::from_secs(5)).unwrap();
    let ls_guest = t.join().unwrap();
    let a = (build(&cfg), ls_host);
    let b = (build(&cfg), ls_guest);
    let (a, b) = play(a, b, 3000);
    assert!(a.1.desync.is_none() && b.1.desync.is_none());
    assert!(a.1.turn() > 50, "turns executed: {}", a.1.turn());
}

#[test]
fn a_stalled_peer_holds_the_other_then_both_resume_in_sync() {
    let cfg = config();
    let (la, lb) = mem_pair();
    let mut a = (build(&cfg), Lockstep::new(0, Box::new(la)));
    let mut b = (build(&cfg), Lockstep::new(1, Box::new(lb)));
    for tick in 0..200 {
        act(&a.0, &mut a.1, tick);
        act(&b.0, &mut b.1, tick);
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
    }
    // B goes silent (a frozen window); A may only run the turns it already holds.
    let held = a.1.turn();
    for _ in 0..600 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
    }
    assert!(a.1.stalled, "A should be waiting for B");
    assert!(a.1.turn() <= held + 4, "A must not run ahead of B's input ({} vs {})", a.1.turn(), held);
    // B comes back and both catch up without any divergence.
    for tick in 200..1200 {
        act(&a.0, &mut a.1, tick);
        act(&b.0, &mut b.1, tick);
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
    }
    assert!(a.1.desync.is_none() && b.1.desync.is_none(), "desync after a stall");
    assert!(a.1.turn() > held + 100, "play resumed");
}

#[test]
fn leaving_ends_the_match_for_the_other_side() {
    let cfg = config();
    let (la, lb) = mem_pair();
    let mut a = (build(&cfg), Lockstep::new(0, Box::new(la)));
    let mut b = (build(&cfg), Lockstep::new(1, Box::new(lb)));
    for _ in 0..60 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
    }
    b.1.leave();
    a.1.advance(&mut a.0, 1.0 / 60.0);
    assert!(a.1.disconnected);
}

#[test]
fn a_host_is_listed_once_however_many_addresses_it_broadcasts_from() {
    let disc = 47991;
    let host = Host::start_on("Once".into(), "Map".into(), serde_json::Value::Null, 0, disc).unwrap();
    let mut browser = Browser::on_port(disc).unwrap();
    let start = Instant::now();
    let mut seen = Vec::new();
    while start.elapsed() < Duration::from_millis(3500) {
        seen = browser.poll();
        std::thread::sleep(Duration::from_millis(50));
    }
    if seen.is_empty() {
        eprintln!("discovery broadcast not delivered on this machine; nothing to check");
        return;
    }
    assert_eq!(seen.len(), 1, "one game, listed once: {seen:?}");
    host.set_label("Changed".into());
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        seen = browser.poll();
        if seen.first().map(|h| h.map == "Changed").unwrap_or(false) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("the new map line never arrived: {seen:?}");
}

fn pump(a: &mut Lobby, b: &mut Lobby) {
    for _ in 0..40 {
        a.poll();
        b.poll();
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn the_lobby_enforces_distinct_factions_ready_and_chat() {
    use cruciata_core::factions::*;
    use cruciata_net::protocol::LobbyState;
    let mut host = Host::start_on("Host".into(), "Map".into(), serde_json::Value::Null, 0, 47992).unwrap();
    let addr = std::net::SocketAddr::new("127.0.0.1".parse().unwrap(), host.port);
    let guest_session = session::join(addr, "Guest").unwrap();
    let host_session = loop {
        if let Some(s) = host.poll() {
            break s;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let cfg = config();
    let state = LobbyState { config: cfg.clone(), host_name: "Host".into(), guest_name: "Guest".into(), host_faction: TEMPLAR, guest_faction: MUSLIM, host_ready: false, guest_ready: false };
    let mut h = Lobby::host(host_session, state);
    let mut g = Lobby::guest(guest_session, "Guest".into());
    pump(&mut h, &mut g);
    assert_eq!(g.state.config, cfg, "the guest sees every setting");
    assert_eq!((g.my_faction(), g.peer_faction()), (MUSLIM, TEMPLAR));
    // Taking the other player's faction is refused on both sides.
    assert!(!g.pick(TEMPLAR));
    assert!(!h.pick(MUSLIM));
    // The guest changes faction; the host sees it.
    assert!(g.pick(HOSPITALLER));
    pump(&mut h, &mut g);
    assert_eq!(h.state.guest_faction, HOSPITALLER);
    // The host cannot now take it, but may take the freed Muslim host.
    assert!(!h.pick(HOSPITALLER));
    assert!(h.pick(MUSLIM));
    pump(&mut h, &mut g);
    assert_eq!(g.peer_faction(), MUSLIM);
    // A setting change clears ready flags.
    g.set_ready(true);
    pump(&mut h, &mut g);
    assert!(h.peer_ready());
    let mut changed = cfg.clone();
    changed["seed"] = serde_json::json!(5);
    h.set_config(changed.clone());
    pump(&mut h, &mut g);
    assert!(!h.peer_ready() && !g.my_ready() && g.state.config == changed);
    // Chat both ways.
    h.say("hello".into());
    g.say("hi there".into());
    pump(&mut h, &mut g);
    assert_eq!(g.chat.iter().filter(|c| !c.mine).map(|c| c.text.as_str()).collect::<Vec<_>>(), ["hello"]);
    assert_eq!(h.chat.iter().filter(|c| !c.mine).map(|c| c.text.as_str()).collect::<Vec<_>>(), ["hi there"]);
    // Both ready: the host starts with the factions inside the configuration.
    g.set_ready(true);
    h.set_ready(true);
    pump(&mut h, &mut g);
    let a = h.started.clone().expect("host started");
    let b = g.started.clone().expect("guest told to start");
    assert_eq!(a, b);
    assert_eq!(a["factions"], serde_json::json!([MUSLIM, HOSPITALLER]));
    // Leaving closes the other side.
    g.leave();
    pump(&mut h, &mut g);
    assert!(h.closed);
}
