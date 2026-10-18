//! Rigorous LAN checks: lockstep under hostile network conditions, command fuzzing, desync
//! detection, malformed and hostile peers, disconnects and handshake failures.
//!
//! Everything runs in-process (memory links with injected latency, or real loopback TCP), so
//! the suite is deterministic enough for CI. Long soaks are `#[ignore]`d:
//! `cargo test --release -p cruciata-net --test lan_rigor -- --ignored --nocapture`.

use cruciata_core::commands::Command;
use cruciata_core::lockstep::PlayerCommand;
use cruciata_core::model::*;
use cruciata_core::orders::OrderCmd;
use cruciata_core::sim::Sim;
use cruciata_net::link::{mem_pair, Link, MemLink, TcpLink};
use cruciata_net::lockstep::Lockstep;
use cruciata_net::protocol::{Msg, PROTOCOL};
use cruciata_net::session::{self, Host, BUILD};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

// ---------------------------------------------------------------- helpers

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn config(seed: u64, biome: u32, factions: Option<[i32; 2]>) -> serde_json::Value {
    let mut c = serde_json::json!({"seed": seed, "width": 6400, "height": 4400, "biome": biome, "difficulty": "normal"});
    if let Some(f) = factions {
        c["factions"] = serde_json::json!(f);
    }
    c
}

fn build(cfg: &serde_json::Value) -> Sim {
    let mut sim = Sim::start_level(0, Some(cfg.clone()), "normal", false);
    sim.settings.pvp = true;
    sim.state.paused = false;
    sim
}

/// Network conditions applied to what a peer *receives*. Order is always preserved, as TCP does.
#[derive(Clone, Copy)]
struct Net {
    /// Minimum and extra random delay, in `recv` polls.
    base: u32,
    jitter: u32,
    /// Chance (0..1) that a message is delivered twice in a row.
    dup: f64,
    /// Every `blackout_every` polls nothing arrives for `blackout_len` polls (0 = never).
    blackout_every: u32,
    blackout_len: u32,
}
const CLEAN: Net = Net { base: 0, jitter: 0, dup: 0.0, blackout_every: 0, blackout_len: 0 };

struct FaultLink {
    inner: MemLink,
    net: Net,
    rng: Rng,
    clock: u32,
    queue: VecDeque<(u32, Msg)>,
    last_ready: u32,
}

impl FaultLink {
    fn new(inner: MemLink, net: Net, seed: u64) -> FaultLink {
        FaultLink { inner, net, rng: Rng(seed | 1), clock: 0, queue: VecDeque::new(), last_ready: 0 }
    }
}

impl Link for FaultLink {
    fn send(&mut self, m: &Msg) -> std::io::Result<()> {
        self.inner.send(m)
    }
    fn recv(&mut self) -> Option<Msg> {
        self.clock += 1;
        while let Some(m) = self.inner.recv() {
            let d = self.net.base + self.rng.below(self.net.jitter as u64 + 1) as u32;
            let at = (self.clock + d).max(self.last_ready);
            self.last_ready = at;
            let copies = if self.rng.unit() < self.net.dup { 2 } else { 1 };
            for _ in 0..copies {
                self.queue.push_back((at, m.clone()));
            }
        }
        if self.net.blackout_every > 0 && self.clock % self.net.blackout_every < self.net.blackout_len {
            return None;
        }
        match self.queue.front() {
            Some((at, _)) if *at <= self.clock => self.queue.pop_front().map(|(_, m)| m),
            _ => None,
        }
    }
}

type Peer = (Sim, Lockstep);

fn peers(cfg: &serde_json::Value, net_a: Net, net_b: Net, seed: u64) -> (Peer, Peer) {
    let (la, lb) = mem_pair();
    (
        (build(cfg), Lockstep::new(0, Box::new(FaultLink::new(la, net_a, seed)))),
        (build(cfg), Lockstep::new(1, Box::new(FaultLink::new(lb, net_b, seed ^ 0x9e37)))),
    )
}

fn ids<F: Fn(&Sim) -> Vec<u32>>(sim: &Sim, f: F) -> Vec<u32> {
    f(sim)
}

/// A random plausible-or-bogus command drawn from the peer's current view of the world.
fn random_command(sim: &Sim, team: i32, rng: &mut Rng) -> PlayerCommand {
    let mine: Vec<&Unit> = sim.state.units.iter().filter(|u| u.team == team && u.hp > 0.0).collect();
    let my_b: Vec<u32> = sim.state.buildings.iter().filter(|b| b.team == team && b.hp > 0.0).map(|b| b.id).collect();
    let foes: Vec<(f64, f64, u32)> = sim.state.buildings.iter().filter(|b| b.team == 1 - team).map(|b| (b.x, b.y, b.id)).collect();
    let pick_units = |rng: &mut Rng| -> Vec<u32> {
        let mut v: Vec<u32> = mine.iter().filter(|_| rng.below(3) == 0).map(|u| u.id).collect();
        if rng.below(8) == 0 {
            v.push(u32::MAX - rng.below(5) as u32); // bogus id
        }
        if rng.below(10) == 0 {
            v.push(0); // possibly another side's
        }
        v
    };
    let (x, y) = (rng.unit() * 6400.0, rng.unit() * 4400.0);
    match rng.below(12) {
        0 | 1 => {
            let ty = [UType::Worker, UType::Sword, UType::Archer, UType::Knight, UType::Chaplain, UType::Ram, UType::Trebuchet, UType::Ballista][rng.below(8) as usize];
            let mut producers = my_b.clone();
            if rng.below(6) == 0 {
                producers.push(77_777);
            }
            PlayerCommand::Game(Command::Recruit { ty, producers })
        }
        2 => {
            let kind = [BKind::House, BKind::Barracks, BKind::Farm, BKind::Tower, BKind::Stable, BKind::Mill][rng.below(6) as usize];
            let b = pick_units(rng);
            let o = mine.first().map(|u| (u.x, u.y)).unwrap_or((x, y));
            PlayerCommand::Game(Command::PlaceBuild { kind, x: o.0 + rng.unit() * 300.0 - 150.0, y: o.1 + rng.unit() * 300.0 - 150.0, rotation: 0.0, builders: b, append: rng.below(2) == 0 })
        }
        3 => {
            let o = mine.first().map(|u| (u.x, u.y)).unwrap_or((x, y));
            let a = (o.0 + rng.unit() * 200.0, o.1 + rng.unit() * 200.0);
            PlayerCommand::Game(Command::PlaceWall { kind: BKind::Wall, ax: a.0, ay: a.1, bx: a.0 + 160.0 * rng.unit() + 32.0, by: a.1 + 160.0 * rng.unit(), builders: pick_units(rng), append: false })
        }
        4 => PlayerCommand::Game(Command::Research { key: ["engineworks", "colossal", "nonsense"][rng.below(3) as usize].into(), producer: my_b.first().copied().unwrap_or(0) }),
        5 => PlayerCommand::Game(Command::ToggleGate { id: my_b[rng.below(my_b.len() as u64) as usize] }),
        6 => PlayerCommand::Stance { units: pick_units(rng), structures: vec![], value: ["fight", "hold", "stand-down", "garbage"][rng.below(4) as usize].into() },
        7 => PlayerCommand::Rally { id: my_b[rng.below(my_b.len() as u64) as usize], x, y },
        8 => PlayerCommand::Hold { units: pick_units(rng) },
        9 => PlayerCommand::Scout_or_bless(pick_units(rng), rng.below(2) == 0),
        _ => {
            let (tx, ty, enemy) = foes.get(rng.below(foes.len().max(1) as u64) as usize).map(|f| (f.0, f.1, Some(f.2))).unwrap_or((x, y, None));
            let attack = rng.below(2) == 0;
            let (px, py, en) = if rng.below(3) == 0 { (x, y, None) } else { (tx, ty, if attack { enemy } else { None }) };
            PlayerCommand::Order(OrderCmd { units: pick_units(rng), structures: vec![], x: px, y: py, attack, append: rng.below(4) == 0, enemy: en, node: None, building: None, escort: None })
        }
    }
}

trait Ext {
    #[allow(non_snake_case)]
    fn Scout_or_bless(units: Vec<u32>, scout: bool) -> PlayerCommand;
}
impl Ext for PlayerCommand {
    fn Scout_or_bless(units: Vec<u32>, scout: bool) -> PlayerCommand {
        if scout { PlayerCommand::Game(Command::Scout { units }) } else { PlayerCommand::Bless { units } }
    }
}

/// Run both peers for `frames` display frames with random commands. Returns total commands issued.
fn fuzz_match(a: &mut Peer, b: &mut Peer, frames: u32, seed: u64, fps_a: &[f64], fps_b: &[f64]) -> u32 {
    let mut rng = Rng(seed | 1);
    let mut issued = 0;
    for f in 0..frames {
        for (p, fps) in [(&mut *a, fps_a), (&mut *b, fps_b)] {
            if rng.below(7) == 0 {
                let team = p.1.team;
                let c = random_command(&p.0, team, &mut rng);
                p.1.issue(c);
                issued += 1;
            }
            let dt = 1.0 / fps[(f as usize + p.1.team as usize) % fps.len()];
            p.1.advance(&mut p.0, dt);
        }
    }
    issued
}

/// Let both sides settle on a common turn, then compare simulation state exactly.
fn assert_converged(a: &mut Peer, b: &mut Peer, what: &str) {
    assert!(a.1.desync.is_none() && b.1.desync.is_none(), "{what}: desync reported at turn {:?}/{:?}", a.1.desync, b.1.desync);
    // Run until both are on the same turn (whoever is ahead waits; the other catches up).
    // Only the trailing peer advances, so the leader (held by lockstep) is caught up to.
    for _ in 0..4000 {
        let (ta, tb) = (a.1.turn(), b.1.turn());
        if ta == tb {
            break;
        }
        if ta < tb {
            a.1.advance(&mut a.0, 1.0 / 30.0);
        } else {
            b.1.advance(&mut b.0, 1.0 / 30.0);
        }
    }
    assert_eq!(a.1.turn(), b.1.turn(), "{what}: peers could not reach a common turn");
    assert_eq!(a.0.state_hash(), b.0.state_hash(), "{what}: states differ on turn {}", a.1.turn());
    assert_eq!(a.0.state.time.to_bits(), b.0.state.time.to_bits(), "{what}: clocks differ");
}

// ---------------------------------------------------------------- lockstep under bad networks

#[test]
fn random_commands_stay_in_sync_across_seeds_biomes_and_factions() {
    use cruciata_core::factions::*;
    let combos: [(u64, u32, [i32; 2]); 4] = [(7, 0, [TEMPLAR, MUSLIM]), (1234, 1, [HOSPITALLER, TEUTONIC]), (99, 2, [MUSLIM, TEMPLAR]), (31337, 0, [TEUTONIC, HOSPITALLER])];
    for (i, (seed, biome, fac)) in combos.into_iter().enumerate() {
        let cfg = config(seed, biome, Some(fac));
        let (mut a, mut b) = peers(&cfg, CLEAN, CLEAN, seed);
        let n = fuzz_match(&mut a, &mut b, 2500, seed * 3 + 1, &[60.0], &[60.0, 30.0]);
        assert!(n > 100, "fuzz issued {n} commands");
        let w0 = build(&cfg);
        let changed = a.0.state.buildings.len() != w0.state.buildings.len() || a.0.state.units.len() != w0.state.units.len();
        assert!(changed, "combo {i}: fuzzed commands changed nothing, so the check proves little");
        assert!(a.0.state.time > 20.0, "match advanced ({})", a.0.state.time);
        assert_converged(&mut a, &mut b, &format!("combo {i} (seed {seed}, biome {biome})"));
    }
}

#[test]
fn latency_jitter_and_duplicate_messages_do_not_desync() {
    let cfg = config(2024, 0, None);
    let nets = [
        Net { base: 2, jitter: 6, dup: 0.0, blackout_every: 0, blackout_len: 0 },
        Net { base: 0, jitter: 25, dup: 0.2, blackout_every: 0, blackout_len: 0 },
        Net { base: 5, jitter: 40, dup: 0.5, blackout_every: 97, blackout_len: 40 },
    ];
    for (i, net) in nets.into_iter().enumerate() {
        // Asymmetric: only B's inbound path is degraded in the first two, both in the last.
        let (mut a, mut b) = peers(&cfg, if i == 2 { net } else { CLEAN }, net, 500 + i as u64);
        fuzz_match(&mut a, &mut b, 3500, 77 + i as u64, &[60.0, 144.0], &[30.0, 90.0, 12.0]);
        assert!(a.0.state.time > 5.0 && b.0.state.time > 5.0, "net {i}: match must still progress (a {} b {})", a.0.state.time, b.0.state.time);
        assert_converged(&mut a, &mut b, &format!("network profile {i}"));
    }
}

#[test]
fn extreme_frame_rate_mismatch_keeps_peers_aligned() {
    let cfg = config(8, 0, None);
    let (mut a, mut b) = peers(&cfg, CLEAN, CLEAN, 8);
    // 4 fps versus 240 fps: dt larger than the accumulator cap, and tiny dts.
    fuzz_match(&mut a, &mut b, 3000, 5, &[240.0], &[4.0]);
    assert_converged(&mut a, &mut b, "4 fps vs 240 fps");
}

#[test]
fn simultaneous_commands_on_the_same_turn_apply_identically() {
    // Both sides recruit on the very same frame many times; ordering must be team-based, not arrival-based.
    let cfg = config(3, 0, None);
    for jitter in [0, 9] {
        let net = Net { base: 0, jitter, dup: 0.0, blackout_every: 0, blackout_len: 0 };
        let (mut a, mut b) = peers(&cfg, net, net, 11);
        for f in 0..900 {
            for p in [&mut a, &mut b] {
                let tc: Vec<u32> = ids(&p.0, |s| s.state.buildings.iter().filter(|x| x.team == p.1.team && x.kind == BKind::Towncenter).map(|x| x.id).collect());
                if f % 3 == 0 {
                    p.1.issue(PlayerCommand::Game(Command::Recruit { ty: UType::Worker, producers: tc }));
                }
                p.1.advance(&mut p.0, 1.0 / 60.0);
            }
        }
        assert_converged(&mut a, &mut b, "simultaneous recruits");
    }
}

#[test]
fn a_guest_command_changes_only_the_guests_side_on_both_machines() {
    let cfg = config(21, 0, None);
    let (mut a, mut b) = peers(&cfg, CLEAN, CLEAN, 21);
    let queued = |s: &Sim, team: i32| -> usize { s.state.buildings.iter().filter(|x| x.team == team).map(|x| x.queue.len()).sum() };
    let (h0, g0) = (queued(&a.0, 0), queued(&a.0, 1));
    let tc: Vec<u32> = b.0.state.buildings.iter().filter(|x| x.team == 1 && x.kind == BKind::Towncenter).map(|x| x.id).collect();
    b.1.issue(PlayerCommand::Game(Command::Recruit { ty: UType::Worker, producers: tc.clone() }));
    // A host-issued command naming the guest's town centre must NOT work on it.
    a.1.issue(PlayerCommand::Game(Command::Recruit { ty: UType::Worker, producers: tc }));
    for _ in 0..300 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
    }
    for (name, p) in [("host", &a), ("guest", &b)] {
        let (h, g) = (queued(&p.0, 0), queued(&p.0, 1));
        assert!(g > g0, "{name} view: the guest's own recruit never queued ({g0}->{g})");
        assert!(g <= g0 + 1, "{name} view: the host's forged recruit also worked on the guest's building ({g0}->{g})");
        assert_eq!(h, h0, "{name} view: the host's queue was touched by a guest-issued command ({h0}->{h})");
    }
    assert_converged(&mut a, &mut b, "cross-team command");
}

#[test]
fn a_tampered_simulation_is_detected_as_a_desync_on_both_sides() {
    let cfg = config(55, 0, None);
    let (mut a, mut b) = peers(&cfg, CLEAN, CLEAN, 55);
    fuzz_match(&mut a, &mut b, 300, 1, &[60.0], &[60.0]);
    assert!(a.1.desync.is_none() && b.1.desync.is_none());
    // A cheat or memory error on one machine only: give the guest a free pile of gold.
    b.0.state.resources.gold += 5000.0;
    fuzz_match(&mut a, &mut b, 1500, 2, &[60.0], &[60.0]);
    assert!(a.1.desync.is_some(), "host failed to notice the divergence");
    assert!(b.1.desync.is_some(), "guest failed to notice the divergence");
}

#[test]
fn desync_is_found_even_with_a_laggy_link() {
    let cfg = config(56, 0, None);
    let net = Net { base: 3, jitter: 20, dup: 0.1, blackout_every: 0, blackout_len: 0 };
    let (mut a, mut b) = peers(&cfg, net, net, 56);
    fuzz_match(&mut a, &mut b, 200, 1, &[60.0], &[60.0]);
    a.0.state.enemy.resources.wood += 1.0;
    fuzz_match(&mut a, &mut b, 3000, 2, &[60.0], &[60.0]);
    assert!(a.1.desync.is_some() && b.1.desync.is_some());
}

#[test]
fn hostile_command_payloads_never_panic_the_simulation() {
    // A modified peer can send any ids, positions and sizes that deserialise.
    let cfg = config(66, 0, None);
    let (mut a, mut b) = peers(&cfg, CLEAN, CLEAN, 66);
    let huge = 1.0e300;
    let big_ids: Vec<u32> = (0..2000).collect();
    let nasty = vec![
        PlayerCommand::Order(OrderCmd { units: big_ids.clone(), structures: big_ids.clone(), x: huge, y: -huge, attack: true, append: true, enemy: Some(u32::MAX), node: Some(u32::MAX), building: Some(u32::MAX), escort: Some(u32::MAX) }),
        PlayerCommand::Order(OrderCmd { units: vec![], structures: vec![], x: f64::MAX, y: f64::MIN, attack: false, append: false, enemy: None, node: None, building: None, escort: None }),
        PlayerCommand::Game(Command::PlaceBuild { kind: BKind::Colossus, x: -1.0e9, y: 1.0e9, rotation: huge, builders: big_ids.clone(), append: true }),
        PlayerCommand::Game(Command::PlaceBuild { kind: BKind::Towncenter, x: 0.0, y: 0.0, rotation: 0.0, builders: vec![], append: false }),
        PlayerCommand::Game(Command::PlaceWall { kind: BKind::Wall, ax: 0.0, ay: 0.0, bx: 0.0, by: 0.0, builders: vec![], append: false }),
        PlayerCommand::Game(Command::PlaceWall { kind: BKind::Bastionwall, ax: -huge, ay: 0.0, bx: huge, by: 0.0, builders: vec![0], append: false }),
        PlayerCommand::Game(Command::Recruit { ty: UType::Standard, producers: big_ids.clone() }),
        PlayerCommand::Game(Command::Recruit { ty: UType::Pilgrim, producers: vec![] }),
        PlayerCommand::Game(Command::Destroy { id: u32::MAX }),
        PlayerCommand::Game(Command::WallUpgrade { kind: BKind::Gate, first: u32::MAX }),
        PlayerCommand::Game(Command::ClearPatch { units: big_ids.clone(), node: u32::MAX }),
        PlayerCommand::Game(Command::Research { key: String::new(), producer: u32::MAX }),
        PlayerCommand::Stance { units: big_ids.clone(), structures: big_ids.clone(), value: "\u{0}☠".into() },
        PlayerCommand::Deploy { units: big_ids.clone() },
        PlayerCommand::CancelSiege { units: big_ids.clone(), structures: big_ids.clone() },
        PlayerCommand::CancelBuild { id: u32::MAX },
        PlayerCommand::Rally { id: 0, x: huge, y: huge },
        PlayerCommand::Bless { units: big_ids },
    ];
    // The guest forges them; both machines must survive and agree.
    for c in nasty {
        b.1.issue(c);
        for _ in 0..12 {
            a.1.advance(&mut a.0, 1.0 / 60.0);
            b.1.advance(&mut b.0, 1.0 / 60.0);
        }
    }
    for _ in 0..600 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
    }
    assert_converged(&mut a, &mut b, "hostile commands");
    assert!(a.0.state.time > 5.0);
}

#[test]
fn a_replayed_old_turn_does_not_change_the_outcome() {
    // A peer (or duplicating network) re-sending turns A has already executed must be inert.
    let cfg = config(77, 0, None);
    let (la, mut raw) = mem_pair();
    let mut a: Peer = (build(&cfg), Lockstep::new(0, Box::new(la)));
    let guest_tc = a.0.state.buildings.iter().find(|x| x.team == 1 && x.kind == BKind::Towncenter).unwrap().id;
    for t in 0..400u32 {
        raw.send(&Msg::Turn { turn: t, cmds: vec![] }).unwrap();
    }
    for _ in 0..300 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
    }
    let done = a.1.turn();
    assert!(done > 60, "turns executed: {done}");
    let hash = a.0.state_hash();
    // Stale replays carrying a destructive payload, for turns already run.
    for t in 0..done.min(50) {
        raw.send(&Msg::Turn { turn: t, cmds: vec![PlayerCommand::Game(Command::Destroy { id: guest_tc })] }).unwrap();
    }
    // Compare against an identical run that never received the replays.
    let (lb, mut raw2) = mem_pair();
    let mut c: Peer = (build(&cfg), Lockstep::new(0, Box::new(lb)));
    for t in 0..400u32 {
        raw2.send(&Msg::Turn { turn: t, cmds: vec![] }).unwrap();
    }
    for _ in 0..300 {
        c.1.advance(&mut c.0, 1.0 / 60.0);
    }
    assert_eq!(c.1.turn(), done);
    assert_eq!(c.0.state_hash(), hash);
    for _ in 0..200 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        c.1.advance(&mut c.0, 1.0 / 60.0);
    }
    assert_eq!(a.0.state_hash(), c.0.state_hash(), "stale turns altered the simulation");
}

// ---------------------------------------------------------------- connection loss

#[test]
fn a_silent_peer_stalls_without_disconnecting_and_never_runs_ahead() {
    let cfg = config(90, 0, None);
    let (mut a, mut b) = peers(&cfg, CLEAN, CLEAN, 90);
    fuzz_match(&mut a, &mut b, 300, 4, &[60.0], &[60.0]);
    let at = a.1.turn();
    for _ in 0..3000 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
    }
    assert!(a.1.stalled && !a.1.disconnected);
    assert!(a.1.turn() <= at + cruciata_net::lockstep::DELAY + 1, "A ran {} turns beyond what B supplied", a.1.turn() - at);
}

#[test]
fn dropping_one_end_disconnects_the_other_and_advance_becomes_inert() {
    let cfg = config(91, 0, None);
    let (mut a, mut b) = peers(&cfg, CLEAN, CLEAN, 91);
    fuzz_match(&mut a, &mut b, 200, 4, &[60.0], &[60.0]);
    drop(b); // process killed: the channel closes, no Bye
    for _ in 0..5 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
    }
    // MemLink's closed state shows up as a failed send once turns are queued.
    for _ in 0..200 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
    }
    let t = a.0.state.time;
    assert!(a.1.disconnected, "an abruptly dropped peer must be noticed");
    assert_eq!(a.1.advance(&mut a.0, 1.0), 0);
    assert_eq!(a.0.state.time, t);
}

// ---------------------------------------------------------------- real TCP

/// A connected loopback host/guest pair through the real handshake.
fn tcp_pair(cfg: &serde_json::Value, disc: u16) -> (Lockstep, Lockstep) {
    let mut host = Host::start_on("H".into(), "m".into(), cfg.clone(), 0, disc).unwrap();
    let addr = SocketAddr::new("127.0.0.1".parse().unwrap(), host.port);
    let guest = session::join(addr, "G").unwrap();
    let t0 = Instant::now();
    let hs = loop {
        if let Some(s) = host.poll() {
            break s;
        }
        assert!(t0.elapsed() < Duration::from_secs(8), "host never produced a session");
        std::thread::sleep(Duration::from_millis(10));
    };
    let th = std::thread::spawn(move || guest.ready(Duration::from_secs(5)).unwrap());
    let lh = hs.ready(Duration::from_secs(5)).unwrap();
    (lh, th.join().unwrap())
}

#[test]
fn real_tcp_match_with_fuzzed_commands_stays_in_sync() {
    let cfg = config(404, 0, Some([cruciata_core::factions::TEMPLAR, cruciata_core::factions::MUSLIM]));
    let (lh, lg) = tcp_pair(&cfg, 47993);
    let mut a: Peer = (build(&cfg), lh);
    let mut b: Peer = (build(&cfg), lg);
    let mut rng = Rng(9);
    for f in 0..4000u32 {
        for p in [&mut a, &mut b] {
            if rng.below(7) == 0 {
                let team = p.1.team;
                let c = random_command(&p.0, team, &mut rng);
                p.1.issue(c);
            }
            p.1.advance(&mut p.0, 1.0 / 60.0);
        }
        if f % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    // Real sockets: allow the tail of in-flight turns to land before comparing.
    for _ in 0..400 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(a.1.desync.is_none() && b.1.desync.is_none());
    assert!(a.1.turn() > 200 && b.1.turn() > 200, "turns {} / {}", a.1.turn(), b.1.turn());
}

#[test]
fn killing_the_tcp_connection_mid_match_is_reported_to_the_survivor() {
    let cfg = config(405, 0, None);
    let (lh, lg) = tcp_pair(&cfg, 47994);
    let mut a: Peer = (build(&cfg), lh);
    let mut b: Peer = (build(&cfg), lg);
    for _ in 0..300 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
        std::thread::sleep(Duration::from_millis(1));
    }
    drop(b); // closes the socket without a Bye, like a crashed process
    let t0 = Instant::now();
    while !a.1.disconnected && t0.elapsed() < Duration::from_secs(5) {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(a.1.disconnected, "survivor never learned the peer died");
}

#[test]
fn a_polite_goodbye_is_distinguishable_and_stops_both_clocks() {
    let cfg = config(406, 0, None);
    let (lh, lg) = tcp_pair(&cfg, 47995);
    let mut a: Peer = (build(&cfg), lh);
    let mut b: Peer = (build(&cfg), lg);
    for _ in 0..120 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        b.1.advance(&mut b.0, 1.0 / 60.0);
        std::thread::sleep(Duration::from_millis(1));
    }
    b.1.leave();
    let t0 = Instant::now();
    while !a.1.disconnected && t0.elapsed() < Duration::from_secs(3) {
        a.1.advance(&mut a.0, 1.0 / 60.0);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(a.1.disconnected);
}

// ---------------------------------------------------------------- handshake & hostile sockets

fn host_on(disc: u16) -> (Host, SocketAddr) {
    let host = Host::start_on("H".into(), "m".into(), serde_json::Value::Null, 0, disc).unwrap();
    let addr = SocketAddr::new("127.0.0.1".parse().unwrap(), host.port);
    (host, addr)
}

fn frame(m: &Msg) -> Vec<u8> {
    let body = serde_json::to_vec(m).unwrap();
    let mut f = (body.len() as u32).to_be_bytes().to_vec();
    f.extend(body);
    f
}

/// Read one framed message from a raw stream.
fn read_msg(s: &mut TcpStream) -> Option<Msg> {
    s.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut len = [0u8; 4];
    s.read_exact(&mut len).ok()?;
    let mut buf = vec![0u8; u32::from_be_bytes(len) as usize];
    s.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

#[test]
fn a_protocol_or_build_mismatch_is_refused_with_a_reason() {
    let (_host, addr) = host_on(47996);
    for (protocol, build) in [(PROTOCOL + 1, BUILD.to_string()), (PROTOCOL, "0.0.0-other".to_string()), (0, String::new())] {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(&frame(&Msg::Hello { name: "x".into(), protocol, build })).unwrap();
        match read_msg(&mut s) {
            Some(Msg::Refused { reason }) => assert!(reason.to_lowercase().contains("version"), "{reason}"),
            other => panic!("expected refusal, got {other:?}"),
        }
    }
}

#[test]
fn the_host_survives_garbage_and_still_accepts_a_real_guest() {
    let (mut host, addr) = host_on(47997);
    // Each hostile client is handled in turn (the host talks to one at a time), so keep them quick.
    {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(&0xFFFF_FFFFu32.to_be_bytes()).unwrap(); // 4 GiB length prefix
    }
    {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(&frame(&Msg::Chat { text: "not a hello".into() })).unwrap();
    }
    {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(&5u32.to_be_bytes()).unwrap();
        s.write_all(b"{nope").unwrap(); // malformed JSON
    }
    {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(&100u32.to_be_bytes()).unwrap();
        s.write_all(b"{\"truncated").unwrap(); // closes mid-frame
    }
    {
        let _ = TcpStream::connect(addr).unwrap(); // connects and leaves
    }
    let guest = session::join(addr, "Real").expect("a legitimate guest must still get in");
    assert_eq!(guest.team, 1);
    let t0 = Instant::now();
    loop {
        if let Some(s) = host.poll() {
            assert_eq!(s.peer_name, "Real");
            break;
        }
        assert!(t0.elapsed() < Duration::from_secs(15), "host stuck after garbage connections");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn an_idle_connection_does_not_lock_out_other_guests_for_long() {
    let (mut host, addr) = host_on(47998);
    let _squatter = TcpStream::connect(addr).unwrap(); // says nothing, holds the socket open
    let t0 = Instant::now();
    let guest = session::join(addr, "Late");
    let waited = t0.elapsed();
    assert!(guest.is_ok(), "{:?}", guest.err());
    assert!(waited < Duration::from_secs(5), "a silent squatter blocked the real guest for {waited:?}");
    let t1 = Instant::now();
    while host.poll().is_none() {
        assert!(t1.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn joining_nothing_fails_fast_with_a_readable_error() {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    drop(l); // nobody listening
    let t0 = Instant::now();
    let e = session::join(addr, "Lost").err().expect("must fail");
    assert!(t0.elapsed() < Duration::from_secs(5));
    assert!(e.contains("Could not reach"), "{e}");
}

#[test]
fn a_host_that_accepts_but_never_answers_times_out() {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let _hold = std::thread::spawn(move || {
        let (_s, _) = l.accept().unwrap();
        std::thread::sleep(Duration::from_secs(6));
    });
    let t0 = Instant::now();
    let e = session::join(addr, "Impatient").err().expect("must fail");
    assert!(t0.elapsed() < Duration::from_secs(6) && e.contains("did not answer"), "{e} after {:?}", t0.elapsed());
}

#[test]
fn ready_gives_up_on_a_silent_peer_and_reports_a_leaving_peer() {
    // Silent peer: timeout.
    let (mut host, addr) = host_on(47999);
    let guest = session::join(addr, "G").unwrap();
    let hs = loop {
        if let Some(s) = host.poll() {
            break s;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let t0 = Instant::now();
    let r = hs.ready(Duration::from_millis(600));
    assert!(r.is_err() && t0.elapsed() < Duration::from_secs(3), "ready should time out");
    // Leaving peer: the guest sends Bye instead of Ready.
    let mut g = guest;
    g.link.send(&Msg::Bye).unwrap();
    let (mut host2, addr2) = host_on(47989);
    let g2 = session::join(addr2, "G2").unwrap();
    let hs2 = loop {
        if let Some(s) = host2.poll() {
            break s;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let mut g2 = g2;
    g2.link.send(&Msg::Bye).unwrap();
    let e = hs2.ready(Duration::from_secs(3)).err().expect("must fail");
    assert!(e.contains("left"), "{e}");
}

#[test]
fn oversized_or_corrupt_frames_close_the_link_instead_of_crashing() {
    // A raw peer talks to a TcpLink reader.
    for bad in [
        0xFFFF_FFFFu32.to_be_bytes().to_vec(),
        { let mut v = 3u32.to_be_bytes().to_vec(); v.extend(b"\xff\xfe\xfd"); v },
        { let mut v = 2u32.to_be_bytes().to_vec(); v.extend(b"{}"); v },
        { let mut v = 20u32.to_be_bytes().to_vec(); v.extend(b"{\"Turn\":{\"turn\":-1}}"); v },
    ] {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        let mut raw = TcpStream::connect(addr).unwrap();
        let (s, _) = l.accept().unwrap();
        let mut link = TcpLink::new(s).unwrap();
        raw.write_all(&bad).unwrap();
        let t0 = Instant::now();
        let mut got = None;
        while got.is_none() && t0.elapsed() < Duration::from_secs(3) {
            got = link.recv();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(got, Some(Msg::Closed), "bad frame {:?}", &bad[..bad.len().min(8)]);
    }
}

#[test]
fn a_message_split_across_many_tiny_writes_is_reassembled() {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let mut raw = TcpStream::connect(addr).unwrap();
    raw.set_nodelay(true).unwrap();
    let (s, _) = l.accept().unwrap();
    let mut link = TcpLink::new(s).unwrap();
    let cmds = vec![PlayerCommand::Order(OrderCmd { units: (0..300).collect(), structures: vec![], x: 1.5, y: 2.5, attack: true, append: false, enemy: None, node: None, building: None, escort: None })];
    let msg = Msg::Turn { turn: 42, cmds };
    for byte in frame(&msg) {
        raw.write_all(&[byte]).unwrap();
    }
    // And two back-to-back frames in a single write.
    let mut two = frame(&Msg::Chat { text: "a".into() });
    two.extend(frame(&Msg::Chat { text: "b".into() }));
    raw.write_all(&two).unwrap();
    let t0 = Instant::now();
    let mut got = vec![];
    while got.len() < 3 && t0.elapsed() < Duration::from_secs(5) {
        if let Some(m) = link.recv() {
            got.push(m);
        } else {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    assert_eq!(got.len(), 3);
    assert_eq!(got[0], msg);
    assert_eq!(got[1], Msg::Chat { text: "a".into() });
    assert_eq!(got[2], Msg::Chat { text: "b".into() });
}

#[test]
fn a_large_command_burst_crosses_tcp_intact() {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    let c = TcpStream::connect(addr).unwrap();
    let (s, _) = l.accept().unwrap();
    let mut tx = TcpLink::new(c).unwrap();
    let mut rx = TcpLink::new(s).unwrap();
    // 120 units ordered at once, 500 times: ~ several MB of JSON in flight.
    let cmd = PlayerCommand::Order(OrderCmd { units: (0..1500).collect(), structures: (0..50).collect(), x: 3000.25, y: 1999.5, attack: false, append: true, enemy: Some(3), node: None, building: None, escort: None });
    let t0 = Instant::now();
    for turn in 0..500 {
        tx.send(&Msg::Turn { turn, cmds: vec![cmd.clone()] }).unwrap();
    }
    let mut n = 0;
    while n < 500 && t0.elapsed() < Duration::from_secs(20) {
        match rx.recv() {
            Some(Msg::Turn { turn, cmds }) => {
                assert_eq!(turn, n, "order preserved");
                assert_eq!(cmds, vec![cmd.clone()]);
                n += 1;
            }
            Some(other) => panic!("unexpected {other:?}"),
            None => std::thread::sleep(Duration::from_millis(1)),
        }
    }
    assert_eq!(n, 500);
}

// ---------------------------------------------------------------- long soak (opt-in)

#[test]
#[ignore]
fn soak_many_seeds_with_hostile_network() {
    use cruciata_core::factions::*;
    let facs = [[TEMPLAR, MUSLIM], [HOSPITALLER, TEUTONIC], [MUSLIM, HOSPITALLER], [TEUTONIC, TEMPLAR]];
    let mut rng = Rng(0xC0FFEE);
    for round in 0..24u64 {
        let seed = 100 + round * 17;
        let cfg = config(seed, (round % 3) as u32, Some(facs[(round % 4) as usize]));
        let net = Net { base: rng.below(4) as u32, jitter: rng.below(30) as u32, dup: rng.unit() * 0.3, blackout_every: if round % 2 == 0 { 83 } else { 0 }, blackout_len: 25 };
        let (mut a, mut b) = peers(&cfg, net, net, seed);
        let t0 = Instant::now();
        fuzz_match(&mut a, &mut b, 20_000, seed, &[60.0, 144.0, 20.0], &[30.0, 75.0]);
        assert_converged(&mut a, &mut b, &format!("soak round {round} seed {seed}"));
        eprintln!("round {round}: seed {seed} sim {:.0}s turn {} in {:?}", a.0.state.time, a.1.turn(), t0.elapsed());
    }
}

#[test]
fn stale_and_far_future_turns_cannot_grow_memory() {
    let cfg = config(78, 0, None);
    let (la, mut raw) = mem_pair();
    let mut a: Peer = (build(&cfg), Lockstep::new(0, Box::new(la)));
    for t in 0..100u32 {
        raw.send(&Msg::Turn { turn: t, cmds: vec![] }).unwrap();
    }
    for _ in 0..200 {
        a.1.advance(&mut a.0, 1.0 / 60.0);
    }
    for round in 0..50u32 {
        for t in 0..20u32 {
            raw.send(&Msg::Turn { turn: t, cmds: vec![] }).unwrap(); // stale
            raw.send(&Msg::Turn { turn: 1_000_000 + round * 20 + t, cmds: vec![] }).unwrap(); // far future
        }
        a.1.advance(&mut a.0, 1.0 / 60.0);
    }
    assert!(a.1.buffered() < 600, "buffers grew to {}", a.1.buffered());
}
