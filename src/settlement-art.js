/* Frontal architectural masters. These models are baked by the atlas builder. */
(() => {
  "use strict";
  const P = {
    limestone: "#c9b999",
    mortar: "#958975",
    plaster: "#e6d5b3",
    tile: "#b15338",
    timber: "#765035",
    blue: "#397a91",
    turquoise: "#4a9694",
    bastion: "#667063",
    iron: "#596760",
    dark: "#343c36",
    linen: "#e6d8b8",
  };
  const noise = (x, y = 0) => {
    const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  function draw(g, b) {
    const A = window.CruciataArt,
      w = b.w,
      d = b.h / 0.72,
      islamic = b.architecture === "islamic" || b.team === 1,
      order = window.CruciataOrders?.style(b.team);
    const fortified = !!(b.fortified || b.wallAttachment?.fortified),
      stone = fortified ? P.bastion : P.limestone;
    const progress = b.progress < 1 ? 0.3 + 0.7 * b.progress : 1,
      m = A.projectedModel(
        g,
        0,
        (b.kind === "tower" && b.wallAttachment ? 1 : 0.72) * progress,
      );
    const tint = (hex, factor) => {
      const n = parseInt(hex.slice(1), 16);
      return (
        "#" +
        [n >> 16, (n >> 8) & 255, n & 255]
          .map((v) =>
            Math.min(255, Math.max(0, Math.round(v * factor)))
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
      );
    };
    function wall(x, y, z, sw, sd, h, color = stone, plaster = false) {
      m.box(x, y, z, sw, sd, h, color);
      for (let row = 3; row < h; row += plaster ? 5 : 7) {
        for (let col = -sw / 2 + 2; col < sw / 2 - 2; col += plaster ? 6 : 11) {
          const v = noise(col + x, row + z),
            rw = Math.min(plaster ? 3 : 9, sw / 2 - col - 1),
            rz = plaster ? 1 : 5;
          m.face(
            [
              [x + col, y + sd / 2 + 0.12, z + row],
              [x + col + rw, y + sd / 2 + 0.12, z + row],
              [x + col + rw, y + sd / 2 + 0.12, z + row + rz],
              [x + col, y + sd / 2 + 0.12, z + row + rz],
            ],
            tint(color, 0.9 + v * 0.18),
            false,
          );
        }
        if (!plaster)
          m.stroke(
            [
              [x - sw / 2, y + sd / 2 + 0.15, z + row],
              [x + sw / 2, y + sd / 2 + 0.15, z + row],
            ],
            0.45,
            tint(color, 0.73),
          );
      }
      m.box(x, y, z, sw + 2, sd + 2, 3, tint(color, 0.83));
      m.box(x, y, z + h - 2, sw + 2, sd + 2, 2, tint(color, 1.04));
      // Roof courts are broad visible surfaces: individual pavers and weathering
      // keep them from reading as an empty flat polygon.
      for (let py = -sd / 2 + 2; py < sd / 2 - 2; py += 7)
        for (let px = -sw / 2 + 2; px < sw / 2 - 2; px += 9) {
          const rw = Math.min(8, sw / 2 - px - 1),
            rd = Math.min(6, sd / 2 - py - 1);
          m.face(
            [
              [x + px, y + py, z + h + 0.08],
              [x + px + rw, y + py, z + h + 0.08],
              [x + px + rw, y + py + rd, z + h + 0.08],
              [x + px, y + py + rd, z + h + 0.08],
            ],
            tint(color, 0.95 + noise(px, py) * 0.12),
            false,
          );
        }
      for (let py = -sd / 2 + 8; py < sd / 2 - 2; py += 8)
        m.stroke(
          [
            [x - sw / 2 + 2, y + py, z + h + 0.5],
            [x + sw / 2 - 2, y + py, z + h + 0.5],
          ],
          0.4,
          tint(color, 0.8),
        );
      for (let px = -sw / 2 + 10; px < sw / 2 - 2; px += 11)
        m.stroke(
          [
            [x + px, y - sd / 2 + 2, z + h + 0.5],
            [x + px, y + sd / 2 - 2, z + h + 0.5],
          ],
          0.35,
          tint(color, 0.84),
        );
    }
    function opening(x, y, z, sw, h, pointed = islamic, door = false) {
      const outer = [
        [x - sw / 2 - 2, y, z],
        [x + sw / 2 + 2, y, z],
        [x + sw / 2 + 2, y, z + h * 0.68],
      ];
      const inner = [
        [x - sw / 2, y + 0.18, z],
        [x + sw / 2, y + 0.18, z],
        [x + sw / 2, y + 0.18, z + h * 0.68],
      ];
      if (pointed) {
        outer.push([x, y, z + h + 2]);
        inner.push([x, y + 0.18, z + h]);
      } else
        for (let i = 0; i <= 10; i++) {
          const a = (i * Math.PI) / 10;
          outer.push([
            x + Math.cos(a) * (sw / 2 + 2),
            y,
            z + h * 0.68 + Math.sin(a) * (sw / 2 + 2),
          ]);
          inner.push([
            x + (Math.cos(a) * sw) / 2,
            y + 0.18,
            z + h * 0.68 + (Math.sin(a) * sw) / 2,
          ]);
        }
      outer.push([x - sw / 2 - 2, y, z + h * 0.68]);
      inner.push([x - sw / 2, y + 0.18, z + h * 0.68]);
      m.face(outer, islamic ? "#c4a775" : "#a69576", false);
      m.face(inner, door ? "#694a30" : "#303b39", false);
      if (door) {
        for (let col = -sw / 2 + 2; col < sw / 2; col += 4)
          m.stroke(
            [
              [x + col, y + 0.4, z + 1],
              [x + col, y + 0.4, z + h * 0.65],
            ],
            0.7,
            "#9c7950",
          );
        for (const dz of [h * 0.2, h * 0.55])
          m.beam(
            [x - sw / 2, y + 0.5, z + dz],
            [x + sw / 2, y + 0.5, z + dz],
            1,
            P.iron,
          );
        m.dome(x + sw * 0.2, y + 0.6, z + h * 0.35, 0.9, 1, "#c0a66b", 8);
      } else {
        m.stroke(
          [
            [x, y + 0.5, z],
            [x, y + 0.5, z + h * 0.7],
          ],
          0.65,
          islamic ? "#c9a16e" : "#b3a58c",
        );
        m.stroke(
          [
            [x - sw / 2, y + 0.5, z + h * 0.35],
            [x + sw / 2, y + 0.5, z + h * 0.35],
          ],
          0.65,
          islamic ? "#c9a16e" : "#b3a58c",
        );
      }
      m.box(x, y + 0.6, z - 1, sw + 4, 2, 2, stone);
    }
    function tiles(x, y, z, sw, sd, h = 13) {
      m.roof(x, y, z, sw, sd, h, order ? order.roof : P.tile);
      for (let row = -sd / 2 + 3; row < sd / 2; row += 6)
        for (let col = 1; col < 6; col++) {
          const a = col / 6,
            zz = z + h * a;
          for (const s of [-1, 1])
            m.stroke(
              [
                [x + ((s * sw) / 2) * (1 - a), y + row, zz + 0.15],
                [
                  x + ((s * sw) / 2) * (1 - a),
                  y + Math.min(row + 4, sd / 2),
                  zz + 0.15,
                ],
              ],
              0.65,
              noise(row, col) > 0.5 ? "#cd8055" : "#87442f",
            );
        }
    }
    function flatRoof(x, y, z, sw, sd) {
      m.box(x, y, z, sw, sd, 3, P.plaster);
      for (let py = -sd / 2 + 7; py < sd / 2 - 4; py += 7)
        for (let px = -sw / 2 + 7; px < sw / 2 - 4; px += 9) {
          const v = noise(px + x, py + y);
          m.face(
            [
              [x + px, y + py, z + 3.3],
              [x + px + 3, y + py + 0.4, z + 3.3],
              [x + px + 4, y + py + 2, z + 3.3],
              [x + px - 1, y + py + 1.7, z + 3.3],
            ],
            tint(P.plaster, 0.9 + v * 0.08),
            false,
          );
        }
      for (const s of [-1, 1]) {
        m.box(x + s * (sw / 2 - 2), y, z + 3, 3, sd, 4, P.plaster);
        m.box(x, y + s * (sd / 2 - 2), z + 3, sw, 3, 4, P.plaster);
      }
    }
    function frieze(x, y, z, sw) {
      m.face(
        [
          [x - sw / 2, y, z],
          [x + sw / 2, y, z],
          [x + sw / 2, y, z + 4],
          [x - sw / 2, y, z + 4],
        ],
        P.blue,
        false,
      );
      for (let px = -sw / 2 + 3; px < sw / 2; px += 5)
        m.face(
          [
            [x + px, y + 0.15, z + 0.5],
            [x + px + 2, y + 0.15, z + 2],
            [x + px, y + 0.15, z + 3.5],
            [x + px - 2, y + 0.15, z + 2],
          ],
          "#d7c594",
          false,
        );
    }
    function barrel(x, y, z = 3, r = 4) {
      m.cylinder(x, y, z, r, r * 1.8, "#987247", 16);
      for (const dz of [0.3, 1.4])
        m.cylinder(x, y, z + r * dz, r + 0.3, 0.9, P.iron, 16);
    }
    function sack(x, y, z = 3, r = 4) {
      m.dome(x, y, z, r, r * 1.5, "#c0ac7d", 20);
      m.cylinder(x, y, z + r * 1.4, r * 0.35, 1, "#91734c", 12);
    }
    function fence(x, y, sw, h = 12, base = 0) {
      for (let px = -sw / 2; px <= sw / 2; px += 9)
        m.beam([x + px, y, base + 3], [x + px, y, base + h], 1.5, P.timber);
      for (const z of [6, 10])
        m.beam(
          [x - sw / 2, y, base + z],
          [x + sw / 2, y, base + z],
          1.4,
          P.timber,
        );
    }
    function horseHead(x, y, z) {
      m.dome(x, y, z, 4, 7, "#9d7650", 20);
      m.dome(x, y - 4, z + 3, 2.5, 4, "#b18a60", 20);
      m.beam([x - 2, y - 3, z + 8], [x - 2, y - 4, z + 12], 0.9, "#765239");
      m.beam([x + 2, y - 3, z + 8], [x + 2, y - 4, z + 12], 0.9, "#765239");
    }
    function merlons(x, y, z, sw, sd) {
      m.box(x, y, z, sw, sd, 3, stone);
      for (let px = -sw / 2 + 3; px < sw / 2; px += 10)
        for (const s of [-1, 1])
          m.box(x + px, y + s * (sd / 2 - 2), z + 3, 5, 4, 5, stone);
    }
    function minaret(x, y, z, h = 53) {
      m.cylinder(x, y, z, 4.5, h, P.plaster, 24);
      m.cylinder(x, y, z + h * 0.73, 7, 3, P.plaster, 24);
      m.cylinder(x, y, z + h * 0.78, 5.5, 1, P.turquoise, 24);
      m.dome(x, y, z + h, 5.5, 8, P.turquoise, 24);
      m.beam([x, y, z + h + 8], [x, y, z + h + 13], 0.8, "#c6a454");
    }
    if (!(b.kind === "tower" && b.wallAttachment))
      m.box(0, 0, 0, w, d, 2, islamic ? "#c7ba95" : "#ada285");
    if (b.kind === "farm") {
      m.box(0, 0, 2, w - 4, d - 4, 1, "#74603a");
      for (let y = -d / 2 + 6; y < d / 2 - 4; y += 8) {
        m.stroke(
          [
            [-w / 2 + 4, y, 3],
            [w / 2 - 4, y, 3],
          ],
          2,
          "#9a8148",
        );
        for (let x = -w / 2 + 7; x < w / 2 - 4; x += 5) {
          const h = 6 + noise(x, y) * 4;
          m.stroke(
            [
              [x, y, 3],
              [x + 1, y, h],
            ],
            0.75,
            "#d6b86a",
          );
          m.stroke(
            [
              [x - 1, y, h - 1],
              [x + 2, y, h + 1],
            ],
            1,
            "#e5c977",
          );
        }
      }
      fence(0, d / 2 - 3, w - 4, 8);
      sack(w * 0.35, -d * 0.35);
      barrel(w * 0.35, -d * 0.2, 2, 3);
    } else if (["tower", "watchtower"].includes(b.kind)) {
      const attached = !!b.wallAttachment,
        baseWidth = attached ? Math.max(w, fortified ? 48 : 34) : w * 0.9,
        baseDepth = attached ? Math.max(d * 0.9, baseWidth / 0.72) : d * 0.9;
      if (b.kind === "tower" && attached) {
        // The wall curtain is rendered by isometric-art before this sprite.
        // Keep it continuous and layer a round fighting platform over its face.
        const radius = fortified ? 27 : 23,
          height = fortified ? 46 : 40,
          rim = height + 6,
          floor = rim + 1.5,
          trim = fortified ? "#778075" : "#e1d4b4";
        // Stacked drums never share a coplanar face: shaft to height + 2, a
        // wider corbel ring to the rim, then a thinner floor slab above it.
        m.cylinder(0, 0, 2, radius + 3, height, stone, 36);
        m.cylinder(0, 0, height + 2, radius + 5, 4, tint(stone, 0.78), 36);
        m.cylinder(
          0,
          0,
          rim,
          radius + 1,
          1.5,
          islamic ? "#c6b58f" : "#d1c6ab",
          36,
        );
        // Merlons are tangent blocks seated on the rim, so they follow the
        // circle instead of forming a jagged ring of axis-aligned boxes.
        for (let i = 0; i < 12; i++) {
          const angle = (i * Math.PI * 2) / 12,
            half = 0.2,
            r = radius + 3.2;
          m.beam(
            [Math.cos(angle - half) * r, Math.sin(angle - half) * r, rim + 3.5],
            [Math.cos(angle + half) * r, Math.sin(angle + half) * r, rim + 3.5],
            6,
            trim,
          );
        }
        if (islamic) {
          m.cylinder(0, 0, floor, 12, 1.5, "#8e9a81", 24);
          m.dome(0, 0, floor + 1.5, 9, 9, P.turquoise, 24);
          m.cylinder(0, 0, floor + 10, 1, 5, "#d2b46c", 12);
        }
        // A small, high-contrast sentry and bow make the tower's purpose legible.
        const archerY = radius * 0.22,
          archerZ = floor;
        m.box(
          0,
          archerY,
          archerZ + 7,
          8,
          6,
          12,
          islamic ? "#76523e" : "#344b59",
        );
        m.dome(
          0,
          archerY,
          archerZ + 16,
          4.5,
          5,
          islamic ? "#b78656" : "#d1b18a",
          16,
        );
        m.box(
          0,
          archerY + 0.5,
          archerZ + 12,
          9,
          7,
          2,
          islamic ? "#536d57" : "#a43e32",
        );
        m.beam(
          [3, archerY + 1, archerZ + 10],
          [10, archerY + 1, archerZ + 8],
          1.5,
          "#735236",
        );
        m.stroke(
          [
            [10, archerY + 1, archerZ + 7],
            [10, archerY + 1, archerZ + 16],
          ],
          1,
          "#463b31",
        );
        m.beam(
          [6, archerY + 1, archerZ + 13],
          [13, archerY + 1, archerZ + 13],
          1,
          "#342d27",
        );
      } else if (b.kind === "watchtower" && !islamic) {
        const deck = attached ? (fortified ? 64 : 48) : 36;
        for (const x of [-baseWidth * 0.34, baseWidth * 0.34])
          for (const y of [-baseDepth * 0.32, baseDepth * 0.32])
            m.beam([x, y, 2], [x, y, deck], 3, P.timber);
        for (const x of [-baseWidth * 0.34, baseWidth * 0.34]) {
          m.beam(
            [x, -baseDepth * 0.32, 8],
            [x, baseDepth * 0.32, deck - 4],
            2,
            P.timber,
          );
          m.beam(
            [x, baseDepth * 0.32, 8],
            [x, -baseDepth * 0.32, deck - 4],
            2,
            P.timber,
          );
        }
        m.box(0, 0, deck, baseWidth, baseDepth, 3, "#9a774a");
        for (const y of [-baseDepth * 0.46, baseDepth * 0.46])
          fence(0, y, baseWidth, 10, deck);
        tiles(0, 0, deck + 13, baseWidth + 6, baseDepth + 6, 10);
        for (let z = 4; z < deck; z += 5)
          m.beam(
            [-6, baseDepth * 0.38, z],
            [6, baseDepth * 0.38, z],
            1.3,
            P.timber,
          );
      } else {
        const height = attached ? (fortified ? 56 : 47) : 47;
        wall(0, 0, 2, baseWidth, baseDepth, height, stone, islamic);
        merlons(0, 0, height + 2, baseWidth + 4, baseDepth + 4);
        opening(0, baseDepth / 2 + 0.3, 18, 5, 13, islamic);
        for (const x of [-baseWidth * 0.31, baseWidth * 0.31])
          m.box(x, baseDepth * 0.46, 5, 4, 4, height - 8, stone);
        if (islamic) {
          frieze(0, baseDepth * 0.46, height - 7, baseWidth);
          m.dome(0, 0, height + 5, baseWidth * 0.28, 11, P.turquoise, 28);
        }
      }
    } else if (["towncenter", "fort"].includes(b.kind)) {
      if (islamic) {
        wall(0, -d * 0.22, 2, w * 0.8, d * 0.48, 31, P.plaster, true);
        flatRoof(0, -d * 0.22, 33, w * 0.85, d * 0.52);
        m.cylinder(0, -d * 0.22, 39, w * 0.2, 4, P.plaster, 28);
        if (b.kind === "fort") {
          wall(0, -d * 0.22, 37, w * 0.44, d * 0.29, 15, stone, true);
          merlons(0, -d * 0.22, 52, w * 0.47, d * 0.33);
          m.dome(0, -d * 0.22, 57, w * 0.11, 9, "#b9ae89", 32);
        } else m.dome(0, -d * 0.22, 43, w * 0.21, 20, P.turquoise, 32);
        for (const x of [-w * 0.36, w * 0.36]) {
          wall(x, d * 0.13, 2, w * 0.2, d * 0.5, 25, P.plaster, true);
          flatRoof(x, d * 0.13, 27, w * 0.23, d * 0.53);
        }
        for (const x of [-w * 0.22, 0, w * 0.22]) {
          opening(x, d * 0.025 + 0.3, 7, 12, 18, true);
          m.box(x, d * 0.22, 2, 13, d * 0.36, 1, "#9eaa9d");
        }
        wall(0, d * 0.38, 2, w * 0.8, d * 0.12, 15, P.plaster, true);
        opening(0, d * 0.441, 2, 18, 16, true, true);
        frieze(0, d * 0.445, 13, w * 0.8);
        minaret(-w * 0.38, -d * 0.39, 2, b.kind === "fort" ? 53 : 45);
        m.cylinder(0, d * 0.13, 3, 9, 3, "#c5bca1", 24);
        m.cylinder(0, d * 0.13, 6, 6, 1, "#699eaa", 24);
      } else {
        wall(
          0,
          -d * 0.13,
          2,
          w * 0.62,
          d * 0.65,
          b.kind === "fort" ? 39 : 32,
          stone,
        );
        if (b.kind === "fort") {
          wall(0, -d * 0.13, 41, w * 0.57, d * 0.58, 15, stone);
          merlons(0, -d * 0.13, 56, w * 0.63, d * 0.64);
          for (const x of [-w * 0.15, w * 0.15])
            opening(x, d * 0.161, 44, 5, 9, false);
        } else tiles(0, -d * 0.13, 34, w * 0.67, d * 0.7, 18);
        for (const x of [-w * 0.37, w * 0.37])
          for (const y of [-d * 0.32, d * 0.32]) {
            wall(x, y, 2, w * 0.22, d * 0.24, 39, stone);
            merlons(x, y, 41, w * 0.25, d * 0.26);
            opening(x, y + d * 0.121, 16, 4, 10, false);
          }
        opening(0, d * 0.2 + 0.5, 3, 17, 23, false, true);
        for (const x of [-w * 0.2, w * 0.2])
          opening(x, d * 0.201, 17, 7, 10, false);
        m.box(0, d * 0.32, 2, 26, d * 0.2, 2, stone);
        for (let z = 0; z < 3; z++)
          m.box(0, d * 0.39 + z * 3, 1, 26 + z * 4, 5, 3 - z * 0.5, stone);
      }
    } else if (b.kind === "chapel") {
      if (islamic) {
        wall(0, -d * 0.04, 2, w * 0.8, d * 0.76, 27, P.plaster, true);
        flatRoof(0, -d * 0.04, 29, w * 0.84, d * 0.8);
        m.cylinder(0, -d * 0.15, 35, w * 0.28, 4, P.plaster, 28);
        m.dome(0, -d * 0.15, 39, w * 0.3, 24, "#4f9e9c", 32);
        for (const x of [-w * 0.25, 0, w * 0.25])
          opening(x, d * 0.345, 4, x ? 8 : 13, 20, true, !x);
        frieze(0, d * 0.348, 24, w * 0.8);
        minaret(-w * 0.39, -d * 0.34, 2, 55);
        minaret(w * 0.39, -d * 0.34, 2, 47);
      } else {
        wall(0, 0, 2, w * 0.8, d * 0.84, 27, stone);
        tiles(0, 0, 29, w * 0.86, d * 0.9, 20);
        wall(-w * 0.27, -d * 0.28, 2, w * 0.25, d * 0.25, 53, stone);
        tiles(-w * 0.27, -d * 0.28, 55, w * 0.3, d * 0.31, 12);
        opening(-w * 0.27, -d * 0.15, 37, 5, 10, false);
        m.beam(
          [-w * 0.27, -d * 0.28, 68],
          [-w * 0.27, -d * 0.28, 77],
          0.9,
          "#bc9b56",
        );
        m.beam(
          [-w * 0.27 - 3, -d * 0.28, 73],
          [-w * 0.27 + 3, -d * 0.28, 73],
          0.9,
          "#bc9b56",
        );
        opening(0, d * 0.421, 3, 13, 22, false, true);
        for (const x of [-w * 0.27, w * 0.27])
          opening(x, d * 0.421, 12, 5, 12, false);
        m.dome(0, d * 0.43, 31, 5, 5, "#9f7770", 20);
        for (const x of [-w * 0.4, w * 0.4])
          m.box(x, d * 0.2, 2, 5, 9, 23, stone);
      }
    } else if (b.kind === "mill") {
      if (islamic) {
        wall(-w * 0.12, 0, 2, w * 0.6, d * 0.7, 25, P.plaster, true);
        flatRoof(-w * 0.12, 0, 27, w * 0.65, d * 0.74);
        m.cylinder(w * 0.23, -d * 0.08, 2, w * 0.17, 39, P.plaster, 28);
        m.dome(w * 0.23, -d * 0.08, 41, w * 0.18, 9, P.linen, 28);
        frieze(-w * 0.12, d * 0.351, 21, w * 0.6);
      } else {
        m.cylinder(0, 0, 2, w * 0.28, 40, stone, 28);
        tiles(0, 0, 42, w * 0.65, d * 0.6, 14);
        opening(0, d * 0.23, 3, 9, 16, false, true);
      }
      for (let i = 0; i < 4; i++)
        sack(-w * 0.3 + i * w * 0.18, d * 0.32, 3, 3.5);
    } else if (b.kind === "lumbercamp") {
      for (const x of [-w * 0.36, w * 0.36])
        for (const y of [-d * 0.32, d * 0.08])
          m.beam([x, y, 2], [x, y, 24], 2.5, P.timber);
      if (islamic) {
        m.face(
          [
            [-w * 0.42, -d * 0.4, 26],
            [w * 0.42, -d * 0.4, 26],
            [w * 0.42, d * 0.14, 23],
            [-w * 0.42, d * 0.14, 23],
          ],
          "#c7a574",
          false,
        );
      } else tiles(0, -d * 0.15, 25, w * 0.87, d * 0.58, 10);
      for (let i = 0; i < 8; i++) {
        const y = d * 0.3 + (i % 3) * 4,
          z = 5 + Math.floor(i / 3) * 4;
        m.beam([-w * 0.39, y, z], [w * 0.2, y, z], 4.2, "#966b3e");
        m.dome(w * 0.21, y, z - 1, 2.1, 1.2, "#c2a16d", 16);
      }
      m.box(w * 0.25, -d * 0.04, 4, 12, 14, 9, P.timber);
      m.beam([w * 0.12, -d * 0.04, 15], [w * 0.39, -d * 0.04, 15], 1.1, P.iron);
      barrel(-w * 0.3, -d * 0.3, 3, 3);
    } else if (b.kind === "miningcamp") {
      wall(
        -w * 0.22,
        -d * 0.2,
        2,
        w * 0.45,
        d * 0.46,
        17,
        islamic ? P.plaster : stone,
        islamic,
      );
      if (islamic) flatRoof(-w * 0.22, -d * 0.2, 19, w * 0.49, d * 0.5);
      else tiles(-w * 0.22, -d * 0.2, 19, w * 0.5, d * 0.52, 10);
      for (const x of [w * 0.05, w * 0.38])
        m.beam([x, -d * 0.13, 2], [w * 0.22, -d * 0.13, 35], 3, P.timber);
      m.beam([w * 0.22, -d * 0.13, 35], [w * 0.22, d * 0.22, 35], 3, P.timber);
      m.stroke(
        [
          [w * 0.22, d * 0.22, 35],
          [w * 0.22, d * 0.22, 10],
        ],
        0.8,
        "#bea77e",
      );
      m.box(w * 0.22, d * 0.22, 4, 12, 13, 7, P.timber);
      for (let i = 0; i < 8; i++)
        m.dome(
          -w * 0.3 + (i % 4) * 7,
          d * 0.3 + Math.floor(i / 4) * 7,
          2,
          4,
          5,
          i % 3 ? "#999c8d" : "#c3aa64",
          18,
        );
      barrel(w * 0.38, d * 0.32, 3, 3.5);
    } else if (b.kind === "stable") {
      wall(
        0,
        -d * 0.2,
        2,
        w * 0.88,
        d * 0.43,
        22,
        islamic ? P.plaster : stone,
        islamic,
      );
      if (islamic) flatRoof(0, -d * 0.2, 24, w * 0.94, d * 0.49);
      else tiles(0, -d * 0.2, 24, w * 0.98, d * 0.52, 12);
      for (const x of [-w * 0.3, 0, w * 0.3]) {
        m.beam([x, d * 0.25, 2], [x, d * 0.25, 22], 2.4, P.timber);
        horseHead(x, d * 0.05, 9);
        fence(x, d * 0.34, w * 0.26, 13);
      }
      for (let i = 0; i < 3; i++) sack(-w * 0.38 + i * 5, -d * 0.32, 3, 3);
      m.box(w * 0.36, d * 0.12, 2, 9, 15, 6, "#a48748");
    } else if (b.kind === "barracks") {
      if (islamic) {
        for (const x of [-w * 0.3, w * 0.3]) {
          wall(x, -d * 0.03, 2, w * 0.25, d * 0.72, 24, P.plaster, true);
          flatRoof(x, -d * 0.03, 26, w * 0.29, d * 0.76);
        }
        wall(0, -d * 0.28, 2, w * 0.4, d * 0.22, 21, P.plaster, true);
        flatRoof(0, -d * 0.28, 23, w * 0.46, d * 0.26);
        for (const x of [-w * 0.3, w * 0.3]) frieze(x, d * 0.332, 19, w * 0.25);
      } else {
        wall(0, -d * 0.12, 2, w * 0.85, d * 0.59, 25, stone);
        tiles(0, -d * 0.12, 27, w * 0.94, d * 0.66, 14);
        for (const x of [-w * 0.32, w * 0.32]) {
          wall(x, d * 0.22, 2, w * 0.23, d * 0.25, 17, stone);
          tiles(x, d * 0.22, 19, w * 0.28, d * 0.31, 10);
        }
      }
      opening(0, d * 0.18, 3, 13, 19, islamic, true);
      for (const x of [-w * 0.3, w * 0.3]) {
        m.beam([x, d * 0.38, 2], [x, d * 0.38, 23], 2, P.timber);
        m.beam([x - 7, d * 0.38, 17], [x + 7, d * 0.38, 17], 2, P.timber);
        for (const dx of [-4, 4])
          m.beam([x + dx, d * 0.38, 4], [x + dx, d * 0.38, 27], 0.8, P.iron);
        m.face(
          [
            [x - 5, d * 0.39, 15],
            [x + 5, d * 0.39, 15],
            [x + 4, d * 0.39, 8],
            [x, d * 0.39, 5],
            [x - 4, d * 0.39, 8],
          ],
          islamic ? "#307d65" : "#ad4738",
          false,
        );
      }
    } else if (b.kind === "siegeworkshop") {
      wall(
        -w * 0.2,
        -d * 0.1,
        2,
        w * 0.53,
        d * 0.73,
        24,
        islamic ? P.plaster : stone,
        islamic,
      );
      if (islamic) flatRoof(-w * 0.2, -d * 0.1, 26, w * 0.57, d * 0.78);
      else tiles(-w * 0.2, -d * 0.1, 26, w * 0.61, d * 0.8, 14);
      wall(-w * 0.36, -d * 0.29, 26, 8, 10, 17, stone);
      m.box(-w * 0.36, -d * 0.29, 43, 10, 12, 2, P.dark);
      for (const x of [w * 0.1, w * 0.4])
        m.beam([x, d * 0.05, 2], [x, d * 0.05, 31], 3, P.timber);
      m.beam([w * 0.1, d * 0.05, 31], [w * 0.4, d * 0.05, 31], 3, P.timber);
      m.stroke(
        [
          [w * 0.3, d * 0.05, 30],
          [w * 0.3, d * 0.05, 10],
        ],
        0.8,
        "#bda777",
      );
      m.box(w * 0.23, d * 0.18, 4, w * 0.34, d * 0.34, 7, P.timber);
      m.beam([w * 0.05, d * 0.18, 14], [w * 0.4, d * 0.18, 14], 4, P.timber);
      for (const x of [w * 0.05, w * 0.4]) {
        m.cylinder(x, d * 0.18, 7, 5, 2, P.iron, 20);
        m.cylinder(x, d * 0.18, 9, 3, 1, "#b59660", 20);
      }
      barrel(-w * 0.36, d * 0.35, 3, 4);
      sack(-w * 0.15, d * 0.35, 3, 3);
    } else {
      if (islamic) {
        wall(-w * 0.18, -d * 0.08, 2, w * 0.56, d * 0.7, 22, P.plaster, true);
        flatRoof(-w * 0.18, -d * 0.08, 24, w * 0.61, d * 0.75);
        wall(w * 0.25, -d * 0.19, 2, w * 0.3, d * 0.47, 15, P.plaster, true);
        flatRoof(w * 0.25, -d * 0.19, 17, w * 0.34, d * 0.51);
        frieze(-w * 0.18, d * 0.272, 18, w * 0.56);
        opening(-w * 0.18, d * 0.273, 2, 8, 15, true, true);
        opening(-w * 0.34, d * 0.273, 12, 4, 7, true);
        m.face(
          [
            [w * 0.1, d * 0.03, 18],
            [w * 0.43, d * 0.03, 18],
            [w * 0.43, d * 0.33, 14],
            [w * 0.1, d * 0.33, 14],
          ],
          "#ba9a6e",
          false,
        );
      } else {
        wall(0, -d * 0.06, 2, w * 0.82, d * 0.75, 23, "#d1c09f");
        tiles(0, -d * 0.06, 25, w * 0.96, d * 0.86, 14);
        for (const x of [-w * 0.35, w * 0.35])
          m.beam([x, d * 0.316, 3], [x, d * 0.316, 24], 1.8, P.timber);
        m.beam(
          [-w * 0.39, d * 0.316, 14],
          [w * 0.39, d * 0.316, 14],
          1.6,
          P.timber,
        );
        m.beam(
          [-w * 0.35, d * 0.316, 4],
          [w * 0.35, d * 0.316, 23],
          1.2,
          P.timber,
        );
        opening(0, d * 0.32, 2, 9, 16, false, true);
        for (const x of [-w * 0.25, w * 0.25])
          opening(x, d * 0.32, 13, 5, 8, false);
        wall(w * 0.24, -d * 0.16, 30, 6, 7, 12, stone);
      }
      barrel(w * 0.35, d * 0.35, 2, 3);
      sack(-w * 0.34, d * 0.35, 2, 3);
      m.dome(-w * 0.34, d * 0.35, 8, 3, 3, "#638454", 20);
    }
    // Orders fly their own pennants at the front corners.
    if (
      order &&
      b.progress >= 1 &&
      !["farm", "lumbercamp", "miningcamp"].includes(b.kind)
    )
      for (const x of [-w / 2 + 12, w / 2 - 12])
        window.CruciataOrders.pennant(m, x, d * 0.5, b.team, 52);
    if (b.progress < 1) {
      for (const x of [-w * 0.49, w * 0.49])
        for (const y of [-d * 0.48, d * 0.48])
          m.beam([x, y, 0], [x, y, 48], 2, P.timber);
      for (const z of [12, 26, 40])
        m.beam([-w * 0.49, d * 0.49, z], [w * 0.49, d * 0.49, z], 2, P.timber);
    }
    m.paint();
  }
  window.CruciataSettlementArt = { draw };
})();
