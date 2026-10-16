# Desktop version and LAN multiplayer

The `rust/` workspace is a native port of the game (no browser, no web view).

- **Install:** open `install.html` (linked from the main menu) for the Windows
  installer, macOS disk images and Linux packages. Downloads are published by
  the `Desktop release` workflow when a `v*` tag is pushed.
- **LAN play:** both players choose _LAN multiplayer_. One presses _Host a game_,
  the other sees it listed and presses _Join_. Discovery uses UDP broadcast on
  port 47813 and the match uses TCP port 47814; the Windows installer adds the
  firewall rule.
- **How it stays in sync:** deterministic lockstep. Only player commands cross
  the network; every machine runs the identical simulation and compares a state
  hash every 15 turns (a mismatch is reported in the game).
- **Saves:** the same JSON as the web version.
- **Development:** see `rust/PORT.md` for porting rules and status, and run
  `cd rust && cargo test --release`.
