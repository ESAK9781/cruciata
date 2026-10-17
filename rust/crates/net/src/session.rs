//! Host and join handshakes.

use crate::discovery::Announcer;
use crate::link::{Link, TcpLink};
use crate::lockstep::Lockstep;
use crate::protocol::{Msg, DISCOVERY_PORT, GAME_PORT, PROTOCOL};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const BUILD: &str = env!("CARGO_PKG_VERSION");

/// A connected, handshaken peer.
pub struct Session {
    pub link: TcpLink,
    pub team: i32,
    pub config: serde_json::Value,
    pub peer_name: String,
}

pub fn computer_name() -> String {
    for k in ["CRUCIATA_NAME", "COMPUTERNAME", "HOSTNAME", "HOST", "USER", "USERNAME"] {
        if let Ok(v) = std::env::var(k) {
            if !v.is_empty() {
                return v;
            }
        }
    }
    "Player".into()
}

pub struct Host {
    pub port: u16,
    stop: Arc<AtomicBool>,
    rx: Receiver<Session>,
    handle: Option<JoinHandle<()>>,
    _announcer: Announcer,
}

impl Host {
    /// Listen, advertise on the LAN and handshake the first compatible guest.
    pub fn start(name: String, map_label: String, config: serde_json::Value) -> std::io::Result<Host> {
        Host::start_on(name, map_label, config, GAME_PORT, DISCOVERY_PORT)
    }

    pub fn start_on(name: String, map_label: String, config: serde_json::Value, port: u16, discovery_port: u16) -> std::io::Result<Host> {
        let listener = TcpListener::bind(("0.0.0.0", port)).or_else(|_| TcpListener::bind(("0.0.0.0", 0)))?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let (tx, rx) = mpsc::channel();
        let host_name = name.clone();
        let handle = thread::spawn(move || {
            while !flag.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let _ = stream.set_nonblocking(false);
                        let Ok(mut link) = TcpLink::new(stream) else { continue };
                        match link.recv_timeout(Duration::from_secs(3)) {
                            Some(Msg::Hello { name: guest, protocol, build }) => {
                                if protocol != PROTOCOL || build != BUILD {
                                    let _ = link.send(&Msg::Refused { reason: format!("Version mismatch: host {BUILD}, guest {build}. Please install the same version.") });
                                    continue;
                                }
                                if link.send(&Msg::Welcome { config: config.clone(), team: 1, host_name: host_name.clone() }).is_ok() {
                                    let _ = tx.send(Session { link, team: 0, config: config.clone(), peer_name: guest });
                                    return;
                                }
                            }
                            _ => continue,
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
                    Err(_) => thread::sleep(Duration::from_millis(200)),
                }
            }
        });
        let announcer = Announcer::start(name, map_label, port, discovery_port);
        Ok(Host { port, stop, rx, handle: Some(handle), _announcer: announcer })
    }

    /// A guest has connected.
    pub fn poll(&mut self) -> Option<Session> {
        self.rx.try_recv().ok()
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Connect to a host found by discovery (blocking; run off the UI thread).
pub fn join(addr: SocketAddr, name: &str) -> Result<Session, String> {
    let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(4)).map_err(|e| format!("Could not reach the host: {e}"))?;
    let mut link = TcpLink::new(stream).map_err(|e| e.to_string())?;
    link.send(&Msg::Hello { name: name.into(), protocol: PROTOCOL, build: BUILD.into() }).map_err(|e| e.to_string())?;
    match link.recv_timeout(Duration::from_secs(4)) {
        Some(Msg::Welcome { config, team, host_name }) => Ok(Session { link, team, config, peer_name: host_name }),
        Some(Msg::Refused { reason }) => Err(reason),
        _ => Err("The host did not answer.".into()),
    }
}

impl Session {
    /// Tell the peer our simulation is built, wait for theirs, then start in step.
    pub fn ready(mut self, timeout: Duration) -> Result<Lockstep, String> {
        self.link.send(&Msg::Ready).map_err(|e| e.to_string())?;
        let start = Instant::now();
        loop {
            match self.link.recv_timeout(Duration::from_millis(100)) {
                Some(Msg::Ready) => break,
                Some(Msg::Bye) | Some(Msg::Closed) => return Err("The other player left.".into()),
                _ => {}
            }
            if start.elapsed() > timeout {
                return Err("The other player took too long to load.".into());
            }
        }
        Ok(Lockstep::new(self.team, Box::new(self.link)))
    }
}
