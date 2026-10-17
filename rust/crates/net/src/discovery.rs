//! Zero-configuration LAN discovery: hosts broadcast a small UDP datagram once
//! a second; browsers collect them. Nobody ever types an address.

use crate::protocol::{Announce, DISCOVERY_PORT, MAGIC, PROTOCOL};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub struct Announcer {
    stop: Arc<AtomicBool>,
    map: Arc<Mutex<String>>,
    handle: Option<JoinHandle<()>>,
}

fn broadcast_targets(port: u16) -> Vec<SocketAddr> {
    // Loopback lets a second copy on this computer find the host, even offline.
    let mut out = vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), port), SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)];
    if let Ok(ifs) = if_addrs::get_if_addrs() {
        for i in ifs {
            if let if_addrs::IfAddr::V4(v4) = i.addr {
                if v4.ip.is_loopback() {
                    continue;
                }
                let b = v4.broadcast.unwrap_or_else(|| {
                    let ip = u32::from(v4.ip);
                    let mask = u32::from(v4.netmask);
                    Ipv4Addr::from(ip | !mask)
                });
                let t = SocketAddr::new(IpAddr::V4(b), port);
                if !out.contains(&t) {
                    out.push(t);
                }
            }
        }
    }
    out
}

impl Announcer {
    /// Broadcast `info` every second until dropped.
    pub fn start(name: String, map: String, game_port: u16, discovery_port: u16) -> Announcer {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let label = Arc::new(Mutex::new(map));
        let shared = label.clone();
        let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1) ^ ((game_port as u64) << 48) | 1;
        let handle = thread::spawn(move || {
            let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else { return };
            let _ = sock.set_broadcast(true);
            while !flag.load(Ordering::Relaxed) {
                let map = shared.lock().map(|m| m.clone()).unwrap_or_default();
                let msg = serde_json::to_vec(&Announce { magic: MAGIC.into(), protocol: PROTOCOL, name: name.clone(), port: game_port, map, id }).unwrap();
                for t in broadcast_targets(discovery_port) {
                    let _ = sock.send_to(&msg, t);
                }
                for _ in 0..10 {
                    if flag.load(Ordering::Relaxed) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            }
        });
        Announcer { stop, map: label, handle: Some(handle) }
    }

    /// Change the map line shown in other players' game lists.
    pub fn set_map(&self, map: String) {
        if let Ok(mut m) = self.map.lock() {
            *m = map;
        }
    }
}

impl Drop for Announcer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HostInfo {
    pub name: String,
    pub addr: SocketAddr,
    pub map: String,
}

pub struct Browser {
    sock: UdpSocket,
    /// One entry per host: its broadcast reaches us from every address it owns (and from
    /// loopback), which used to list the same game several times.
    seen: HashMap<u64, (HostInfo, Instant)>,
}

impl Browser {
    pub fn new() -> std::io::Result<Browser> {
        Browser::on_port(DISCOVERY_PORT)
    }

    pub fn on_port(port: u16) -> std::io::Result<Browser> {
        let sock = UdpSocket::bind(("0.0.0.0", port))?;
        sock.set_nonblocking(true)?;
        Ok(Browser { sock, seen: HashMap::new() })
    }

    /// Collect pending announcements; returns currently visible hosts.
    pub fn poll(&mut self) -> Vec<HostInfo> {
        let mut buf = [0u8; 1024];
        while let Ok((n, from)) = self.sock.recv_from(&mut buf) {
            if let Ok(a) = serde_json::from_slice::<Announce>(&buf[..n]) {
                if a.magic == MAGIC && a.protocol == PROTOCOL {
                    let addr = SocketAddr::new(from.ip(), a.port);
                    // Old builds sent no id: fall back to the sender.
                    let id = if a.id != 0 { a.id } else { ((u32::from(match from.ip() { IpAddr::V4(v) => v, _ => Ipv4Addr::UNSPECIFIED }) as u64) << 16) | a.port as u64 };
                    let keep = match self.seen.get(&id) {
                        // Prefer a real network address over loopback once both are known.
                        Some((old, _)) if addr.ip().is_loopback() && !old.addr.ip().is_loopback() => old.addr,
                        _ => addr,
                    };
                    self.seen.insert(id, (HostInfo { name: a.name, addr: keep, map: a.map }, Instant::now()));
                }
            }
        }
        self.seen.retain(|_, (_, t)| t.elapsed() < Duration::from_secs(4));
        let mut v: Vec<HostInfo> = self.seen.values().map(|(h, _)| h.clone()).collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }
}
