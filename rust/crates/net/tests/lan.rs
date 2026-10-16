use cruciata_core::commands::Command;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::orders::OrderCmd;
use cruciata_core::sim::Sim;
use cruciata_net::discovery::Browser;
use cruciata_net::link::mem_pair;
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
    let found = loop {
        let hosts = browser.poll();
        if let Some(h) = hosts.into_iter().next() {
            break h;
        }
        assert!(start.elapsed() < Duration::from_secs(5), "host not discovered");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(found.name, "Test host");
    let addr = std::net::SocketAddr::new("127.0.0.1".parse().unwrap(), found.addr.port());
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
    let (a, b) = play(a, b, 1500);
    assert!(a.1.desync.is_none() && b.1.desync.is_none());
    assert!(a.1.turn() > 100);
}
