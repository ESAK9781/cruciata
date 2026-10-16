use crate::protocol::Msg;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

/// A reliable ordered message pipe to the other player.
pub trait Link: Send {
    fn send(&mut self, m: &Msg) -> io::Result<()>;
    fn recv(&mut self) -> Option<Msg>;
}

/// In-process pair (tests, local practice).
pub struct MemLink {
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
}

pub fn mem_pair() -> (MemLink, MemLink) {
    let (a_tx, b_rx) = mpsc::channel();
    let (b_tx, a_rx) = mpsc::channel();
    (MemLink { tx: a_tx, rx: a_rx }, MemLink { tx: b_tx, rx: b_rx })
}

impl Link for MemLink {
    fn send(&mut self, m: &Msg) -> io::Result<()> {
        self.tx.send(m.clone()).map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "closed"))
    }
    fn recv(&mut self) -> Option<Msg> {
        self.rx.try_recv().ok()
    }
}

/// Length-prefixed JSON over TCP with `TCP_NODELAY`; a reader thread feeds a channel.
pub struct TcpLink {
    stream: TcpStream,
    rx: Receiver<Msg>,
}

impl TcpLink {
    pub fn new(stream: TcpStream) -> io::Result<TcpLink> {
        stream.set_nodelay(true)?;
        let mut reader = stream.try_clone()?;
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut len = [0u8; 4];
            loop {
                if reader.read_exact(&mut len).is_err() {
                    break;
                }
                let n = u32::from_be_bytes(len) as usize;
                if n > 4 << 20 {
                    break;
                }
                let mut buf = vec![0u8; n];
                if reader.read_exact(&mut buf).is_err() {
                    break;
                }
                match serde_json::from_slice::<Msg>(&buf) {
                    Ok(m) => {
                        if tx.send(m).is_err() {
                            return;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = tx.send(Msg::Closed);
        });
        Ok(TcpLink { stream, rx })
    }

    /// Block up to `timeout` for the next message (handshake only).
    pub fn recv_timeout(&mut self, timeout: std::time::Duration) -> Option<Msg> {
        self.rx.recv_timeout(timeout).ok()
    }
}

impl Link for TcpLink {
    fn send(&mut self, m: &Msg) -> io::Result<()> {
        let body = serde_json::to_vec(m).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let mut frame = Vec::with_capacity(body.len() + 4);
        frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
        frame.extend_from_slice(&body);
        self.stream.write_all(&frame)
    }
    fn recv(&mut self) -> Option<Msg> {
        self.rx.try_recv().ok()
    }
}
