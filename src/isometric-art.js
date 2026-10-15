/* Hand-built projected models: one camera, warm sunlight, restrained outlines.
   Ground coordinates stay unchanged; model height never changes collision. */
(() => {
  "use strict";
  const A = window.CruciataArt;
  const P = {
    stone: "#bcaf8c",
    bastion: "#697566",
    plaster: "#d9c59d",
    wood: "#977448",
    roof: "#a84c35",
    metal: "#87918c",
    leaf: "#527c42",
    gold: "#d9af54",
    skin: "#d4a475",
    ink: "#3d4033",
    red: "#b53d30",
    green: "#34795c",
  };
  const colors = new Map();
  function shade(hex, light) {
    const key = hex + light;
    if (colors.has(key)) return colors.get(key);
    const n = parseInt(hex.slice(1), 16);
    const c =
      "#" +
      [n >> 16, (n >> 8) & 255, n & 255]
        .map((v) =>
          Math.max(0, Math.min(255, Math.round(v * light)))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    colors.set(key, c);
    return c;
  }
  // A 36-degree elevated camera. Buildings express ground Y in camera units,
  // so their foundations still coincide exactly with navigation footprints.
  function model(g, angle = 0, rise = 1, groundScale = [1, 1]) {
    const ca = Math.cos(angle),
      sa = Math.sin(angle),
      faces = [];
    const world = ([x, y, z]) => [
      (x * ca - y * sa) * groundScale[0],
      (x * sa + y * ca) * groundScale[1],
      z * rise,
    ];
    const project = (p) => [p[0], p[1] * 0.72 - p[2]];
    function face(points, color, outline = false, light = null, cull = false) {
      const v = points.map(world);
      if (light === null) {
        const a = v[1].map((n, i) => n - v[0][i]);
        const b = v[2].map((n, i) => n - v[0][i]);
        const normal = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        if (cull && normal[1] + 0.72 * normal[2] <= 0) return;
        const length = Math.hypot(...normal) || 1;
        light =
          0.78 +
          0.25 * Math.abs(normal[2] / length) -
          (0.13 * normal[0]) / length -
          (0.1 * normal[1]) / length;
      }
      faces.push({
        vertices: v.map((p) => [...project(p), p[1] + p[2] * 0.72]),
        points: v.map(project),
        color: shade(color, light),
        outline,
        depth: v.reduce((s, p) => s + p[1] + p[2] * 0.72, 0) / v.length,
      });
    }
    function stroke(points, width, color) {
      const v = points.map(world);
      faces.push({
        vertices: v.map((p) => [...project(p), p[1] + p[2] * 0.72]),
        points: v.map(project),
        width,
        color,
        depth: v.reduce((s, p) => s + p[1] + p[2] * 0.72, 0) / v.length + 0.05,
      });
    }
    function box(x, y, z, w, d, h, color) {
      const v = [
        [x - w / 2, y - d / 2, z],
        [x + w / 2, y - d / 2, z],
        [x + w / 2, y + d / 2, z],
        [x - w / 2, y + d / 2, z],
      ];
      const top = v.map((p) => [p[0], p[1], z + h]);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        face([v[i], v[j], top[j], top[i]], color, false, null, true);
      }
      face(top, color, false, null, true);
    }
    function roof(x, y, z, w, d, h, color = P.roof) {
      const a = [x - w / 2, y - d / 2, z],
        b = [x + w / 2, y - d / 2, z],
        c = [x + w / 2, y + d / 2, z],
        e = [x - w / 2, y + d / 2, z];
      const r = [x, y - d / 2, z + h],
        s = [x, y + d / 2, z + h];
      face([a, b, r], P.plaster, true, null, true);
      face([e, s, c], P.plaster, true, null, true);
      face([a, r, s, e], color, true, null, true);
      face([r, b, c, s], color, true, null, true);
      for (let t = 1; t < 6; t++) {
        const q = t / 6;
        stroke(
          [
            [x - (w / 2) * (1 - q), y - d / 2, z + h * q],
            [x - (w / 2) * (1 - q), y + d / 2, z + h * q],
          ],
          0.65,
          shade(color, 0.62),
        );
        stroke(
          [
            [x + (w / 2) * (1 - q), y - d / 2, z + h * q],
            [x + (w / 2) * (1 - q), y + d / 2, z + h * q],
          ],
          0.65,
          shade(color, 1.2),
        );
      }
      stroke([r, s], 2, shade(color, 1.18));
      for (let row = y - d / 2 + 9; row < y + d / 2; row += 9)
        stroke(
          [
            [x - w / 2, row, z],
            [x, row, z + h],
            [x + w / 2, row, z],
          ],
          0.55,
          shade(color, 0.76),
        );
    }
    function dome(x, y, z, r, h, color, segments = 16) {
      segments = Math.max(48, segments);
      const rings = [];
      for (let j = 0; j <= 16; j++) {
        const a = (j * Math.PI) / 32;
        rings.push(
          Array.from({ length: segments }, (_, i) => [
            x + Math.cos((i * Math.PI * 2) / segments) * r * Math.cos(a),
            y + Math.sin((i * Math.PI * 2) / segments) * r * Math.cos(a),
            z + Math.sin(a) * h,
          ]),
        );
      }
      for (let j = 0; j < 16; j++)
        for (let i = 0; i < segments; i++) {
          const k = (i + 1) % segments;
          face(
            [rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]],
            color,
            false,
          );
        }
    }
    function cylinder(x, y, z, r, h, color, n = 12) {
      n = Math.max(40, n);
      const ring = (at) =>
        Array.from({ length: n }, (_, i) => [
          x + Math.cos((i * Math.PI * 2) / n) * r,
          y + Math.sin((i * Math.PI * 2) / n) * r,
          at,
        ]);
      const a = ring(z),
        b = ring(z + h);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        face([a[i], a[j], b[j], b[i]], color);
      }
      face(b, color);
    }
    function beam(a, b, width, color = P.wood) {
      const axis = b.map((n, i) => n - a[i]),
        length = Math.hypot(...axis) || 1;
      const u =
        Math.abs(axis[2] / length) > 0.9
          ? [width / 2, 0, 0]
          : [
              ((-axis[1] / Math.hypot(axis[0], axis[1])) * width) / 2,
              ((axis[0] / Math.hypot(axis[0], axis[1])) * width) / 2,
              0,
            ];
      const v = [
        (-axis[2] * u[1]) / length,
        (axis[2] * u[0]) / length,
        (axis[0] * u[1] - axis[1] * u[0]) / length,
      ];
      const ends = [a, b].map((p) =>
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([s, t]) => p.map((n, i) => n + u[i] * s + v[i] * t)),
      );
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        face([ends[0][i], ends[0][j], ends[1][j], ends[1][i]], color);
      }
      face(ends[1], color);
    }
    function window(x, y, z, w, h, arched = false) {
      const v = [
        [x - w / 2, y, z],
        [x + w / 2, y, z],
        [x + w / 2, y, z + h * 0.7],
      ];
      if (arched) v.push([x, y, z + h]);
      else v.push([x + w / 2, y, z + h], [x - w / 2, y, z + h]);
      v.push([x - w / 2, y, z + h * 0.7]);
      face(v, "#383e34", true, 1);
      stroke(
        [
          [x - w / 2, y, z],
          [x + w / 2, y, z],
        ],
        1.3,
        P.gold,
      );
    }
    function masonry(x, y, z, w, d, h, color) {
      box(x, y, z, w, d, h, color);
      for (let k = 7; k < h; k += 8) {
        for (const side of [-1, 1]) {
          stroke(
            [
              [x + side * (w / 2 + 0.15), y - d / 2, z + k],
              [x + side * (w / 2 + 0.15), y + d / 2, z + k],
            ],
            0.55,
            shade(color, 0.7),
          );
          for (let a = -d / 2 + (((k / 8) | 0) % 2) * 7 + 4; a < d / 2; a += 14)
            stroke(
              [
                [x + side * (w / 2 + 0.2), y + a, z + k - 6],
                [x + side * (w / 2 + 0.2), y + a, z + k],
              ],
              0.55,
              shade(color, 0.73),
            );
        }
        stroke(
          [
            [x - w / 2, y + d / 2 + 0.15, z + k],
            [x + w / 2, y + d / 2 + 0.15, z + k],
          ],
          0.65,
          shade(color, 0.65),
        );
        for (let a = -w / 2 + (((k / 8) | 0) % 2) * 7 + 4; a < w / 2; a += 14)
          stroke(
            [
              [x + a, y + d / 2 + 0.2, z + k - 6],
              [x + a, y + d / 2 + 0.2, z + k],
            ],
            0.6,
            shade(color, 0.69),
          );
      }
    }
    function battlements(x, y, z, w, d, color) {
      box(x, y, z, w, d, 3, color);
      for (let a = -w / 2 + 4; a < w / 2; a += 12)
        for (const s of [-1, 1])
          box(x + a, y + s * (d / 2 - 3), z + 3, 7, 6, 7, color);
      for (let a = -d / 2 + 10; a < d / 2 - 5; a += 12)
        for (const s of [-1, 1])
          box(x + s * (w / 2 - 3), y + a, z + 3, 6, 7, 7, color);
    }
    return {
      face,
      stroke,
      box,
      roof,
      dome,
      cylinder,
      beam,
      window,
      masonry,
      battlements,
      project: (p) => project(world(p)),
      paint() {
        if (globalThis.CruciataModelRaster) {
          globalThis.CruciataModelRaster.paint(g, faces);
          return;
        }
        faces.sort((a, b) => a.depth - b.depth);
        g.lineJoin = "round";
        for (const f of faces) {
          if (f.width) A.line(g, f.points, f.width, f.color);
          else {
            g.beginPath();
            f.points.forEach(([x, y], i) =>
              i ? g.lineTo(x, y) : g.moveTo(x, y),
            );
            g.closePath();
            g.fillStyle = f.color;
            g.fill();
            if (f.outline) {
              g.strokeStyle = P.ink;
              g.lineWidth = 0.65;
              g.stroke();
            }
          }
        }
      },
    };
  }
  // Shared sprite cache, bounded by pixel area as well as entry count.
  const sprites = new Map();
  let pixels = 0;
  const cacheMetrics = {
    hits: 0,
    misses: 0,
    sleepingFlagHits: 0,
    sleepingFlagMisses: 0,
  };
  function sprite(g, key, w, h, ox, oy, draw) {
    if (globalThis.CruciataAtlas?.draw(g, key, w, h, ox, oy)) return;
    if (globalThis.CruciataBakeSprite?.(key, w, h, ox, oy, draw)) return;
    const t = g.getTransform(),
      resolution = Math.max(1, Math.min(3, Math.ceil(Math.hypot(t.a, t.b))));
    key += "/" + resolution;
    let c = sprites.get(key);
    if (!c) {
      cacheMetrics.misses++;
      c = document.createElement("canvas");
      c.width = Math.ceil(w * resolution);
      c.height = Math.ceil(h * resolution);
      const q = c.getContext("2d");
      q.scale(resolution, resolution);
      q.translate(ox, oy);
      draw(q);
      while (
        sprites.size &&
        (sprites.size >= 384 || pixels + c.width * c.height > 16000000)
      ) {
        const first = sprites.keys().next().value,
          old = sprites.get(first);
        pixels -= old.width * old.height;
        sprites.delete(first);
      }
      sprites.set(key, c);
      pixels += c.width * c.height;
    } else {
      cacheMetrics.hits++;
      sprites.delete(key);
      sprites.set(key, c);
    }
    g.drawImage(c, -ox, -oy, w, h);
  }
  const faction = (team) =>
    team === 1 ? P.green : team === 3 ? P.gold : team === 2 ? "#ac9265" : P.red;
  function shadow(g, rx, ry) {
    A.ellipse(g, 7, 7, rx, ry, "#25332330");
  }
  function tower(m, x, y, w, d, height, stone, islamic = false) {
    m.masonry(x, y, 0, w, d, height, stone);
    m.window(x, y + d / 2 + 0.5, height * 0.43, 5, 14, islamic);
    m.battlements(x, y, height, w + 3, d + 3, stone);
    if (islamic) {
      m.cylinder(x, y, height + 4, w * 0.35, 5, P.plaster);
      m.dome(x, y, height + 9, w * 0.38, 9, "#6c9580");
    }
  }
  // Curtains are true projected prisms in world units (arms are world offsets to
  // the seam shared with each neighbour), so every heading lines up with the
  // collision footprint and with adjoining segments, towers and gates.
  function curtainLayout(b) {
    const fort = !!b.fortified,
      hw = fort ? 24 : 15,
      arms = Object.entries(b.links || {}).map(([key, p]) => {
        if (Math.hypot(p.x, p.y) >= 1) return { x: p.x, y: p.y };
        // A zero arm abuts a gatehouse: run the curtain flush to that seam.
        const dx = (key.includes("e") ? 1 : 0) - (key.includes("w") ? 1 : 0),
          dy = (key.includes("s") ? 1 : 0) - (key.includes("n") ? 1 : 0),
          n = Math.hypot(dx, dy) || 1;
        return { x: (dx / n) * 16, y: (dy / n) * 16 };
      }),
      real = arms.filter((p) => Math.hypot(p.x, p.y) >= 1),
      angle = Number.isFinite(b.wallAngle) ? b.wallAngle : 0;
    if (real.length === 1 && arms.length === 1)
      real.push({ x: -real[0].x, y: -real[0].y });
    if (!real.length)
      real.push(
        { x: Math.cos(angle) * 16, y: Math.sin(angle) * 16 },
        { x: -Math.cos(angle) * 16, y: -Math.sin(angle) * 16 },
      );
    const pieces = real.map((a) => {
      const length = Math.hypot(a.x, a.y);
      return { x: a.x, y: a.y, length, ux: a.x / length, uy: a.y / length };
    });
    // Pieces that meet others at an angle reach back to square the outer corner.
    for (const piece of pieces)
      piece.back = pieces.some(
        (o) =>
          o !== piece &&
          Math.abs(piece.ux * o.uy - piece.uy * o.ux) > 0.2 &&
          piece.ux * o.ux + piece.uy * o.uy > -0.97,
      )
        ? hw
        : 0;
    return { fort, hw, height: fort ? 38 : 27, pieces };
  }
  function wall(g, b) {
    const { hw, height, pieces } = curtainLayout(b),
      reach = Math.max(hw * 2, ...pieces.map((p) => p.length + hw)) + 10,
      key = `curtain2:${!!b.fortified}:${pieces
        .map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1))
        .sort()
        .join(";")}`,
      ground = reach * 0.72,
      oy = ground + height + 16;
    sprite(g, key, reach * 2, oy + ground + 8, reach, oy, (q) =>
      wallModel(q, b),
    );
  }
  function wallModel(g, b) {
    const { fort, hw, height, pieces } = curtainLayout(b),
      stone = fort ? P.bastion : P.stone,
      m = model(g);
    const rect = (piece, from, to, half) => {
      const nx = -piece.uy,
        ny = piece.ux,
        at = (t, o) => [piece.ux * t + nx * o, piece.uy * t + ny * o];
      return [at(from, -half), at(to, -half), at(to, half), at(from, half)];
    };
    const prism = (poly, z, h, color, lit = null) => {
      const area = poly.reduce((s, p, i) => {
        const q = poly[(i + 1) % poly.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0);
      const ring = area < 0 ? [...poly].reverse() : poly;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        m.face(
          [
            [ring[i][0], ring[i][1], z],
            [ring[j][0], ring[j][1], z],
            [ring[j][0], ring[j][1], z + h],
            [ring[i][0], ring[i][1], z + h],
          ],
          color,
          false,
          lit,
          true,
        );
      }
      m.face(
        ring.map((p) => [p[0], p[1], z + h]),
        color,
        false,
        lit,
        true,
      );
    };
    // Local test: is a point inside another piece's solid body?
    const covered = (self, x, y, margin) =>
      pieces.some((o) => {
        if (o === self) return false;
        const nx = -o.uy,
          ny = o.ux,
          t = x * o.ux + y * o.uy,
          d = x * nx + y * ny;
        return (
          t > -o.back + margin &&
          t < o.length - margin &&
          Math.abs(d) < hw - margin
        );
      });
    const runs = (piece, offset, step = 1.5) => {
      const out = [];
      let start = null;
      for (let t = -piece.back; t <= piece.length + 0.01; t += step) {
        const nx = -piece.uy * offset,
          ny = piece.ux * offset,
          open = !covered(piece, piece.ux * t + nx, piece.uy * t + ny, 1);
        if (open && start === null) start = t;
        if ((!open || t + step > piece.length + 0.01) && start !== null) {
          out.push([start, open ? t : t - step]);
          start = null;
        }
      }
      return out.filter(([a, c]) => c - a > 2);
    };
    // Stepped plinth, curtain body and walkway.
    for (const piece of pieces) {
      prism(
        rect(piece, -piece.back, piece.length, hw + 1.5),
        0,
        3,
        shade(stone, 0.8),
      );
    }
    for (const piece of pieces)
      prism(rect(piece, -piece.back, piece.length, hw), 2, height - 2, stone);
    for (const piece of pieces) {
      m.face(
        rect(piece, -piece.back, piece.length, hw - 5).map(([x, y]) => [
          x,
          y,
          height + 0.35,
        ]),
        shade(stone, 0.82),
        false,
        1,
      );
    }
    // Parapet lips and merlons only where another curtain does not cross them.
    for (const piece of pieces)
      for (const side of [-1, 1]) {
        const offset = side * (hw - 2);
        for (const [a, c] of runs(piece, offset)) {
          prism(lipRect(piece, a, c, offset), height, 2.2, shade(stone, 1.05));
          for (let t = a + 3; t < c - 4; t += 11)
            prism(lipRect(piece, t, t + 6.5, offset, 2.6), height, 7, stone);
        }
      }
    function lipRect(piece, from, to, offset, half = 1.5) {
      const nx = -piece.uy,
        ny = piece.ux;
      return [
        [
          piece.ux * from + nx * (offset - half),
          piece.uy * from + ny * (offset - half),
        ],
        [
          piece.ux * to + nx * (offset - half),
          piece.uy * to + ny * (offset - half),
        ],
        [
          piece.ux * to + nx * (offset + half),
          piece.uy * to + ny * (offset + half),
        ],
        [
          piece.ux * from + nx * (offset + half),
          piece.uy * from + ny * (offset + half),
        ],
      ];
    }
    // Mortar courses and block joints on the faces the camera can see.
    for (const piece of pieces)
      for (const side of [-1, 1]) {
        const outward = side * piece.ux;
        if (outward <= 0.05) continue;
        const offset = side * (hw + 0.2);
        for (const [a, c] of runs(piece, side * hw, 3))
          for (let z = 8, row = 0; z < height; z += 8, row++) {
            const nx = -piece.uy * offset,
              ny = piece.ux * offset;
            m.stroke(
              [
                [piece.ux * a + nx, piece.uy * a + ny, z],
                [piece.ux * c + nx, piece.uy * c + ny, z],
              ],
              0.6,
              shade(stone, 0.55),
            );
            for (let t = a + 4 + (row % 2) * 7; t < c - 1; t += 14)
              m.stroke(
                [
                  [piece.ux * t + nx, piece.uy * t + ny, z - 7],
                  [piece.ux * t + nx, piece.uy * t + ny, z],
                ],
                0.55,
                shade(stone, 0.62),
              );
          }
      }
    m.paint();
  }
  function buildingCamera(g, b, rise = 1) {
    return model(g, 0, rise * 0.72);
  }
  function buildingModel(g, b) {
    if (
      window.CruciataSettlementArt &&
      !["wall", "gate", "bastiongate"].includes(b.kind)
    )
      return window.CruciataSettlementArt.draw(g, b);
    const w = b.w || 64,
      d = (b.h || 64) / 0.72,
      k = b.kind;
    const islamic = b.architecture === "islamic" || b.team === 1;
    const stone =
      b.fortified || b.bastionGate || b.kind === "bastiongate"
        ? P.bastion
        : P.stone;
    const m = buildingCamera(g, b, b.progress < 1 ? 0.2 + 0.8 * b.progress : 1);
    m.box(0, 0, 0, w, d, 4, stone);
    if (k === "farm") {
      m.box(0, 0, 4, w - 5, d - 5, 2, "#715b36");
      for (let y = -d / 2 + 8; y < d / 2 - 5; y += 10) {
        m.stroke(
          [
            [-w / 2 + 5, y, 7],
            [w / 2 - 5, y, 7],
          ],
          3,
          "#998047",
        );
        for (let x = -w / 2 + 9; x < w / 2 - 5; x += 7) {
          const z = 12 + Math.sin(x + y) * 2;
          m.stroke(
            [
              [x, y, 7],
              [x + 1, y, z],
            ],
            1.4,
            "#ceb768",
          );
          m.stroke(
            [
              [x - 2, y, z - 2],
              [x + 2, y, z + 1],
            ],
            1.2,
            "#e0c378",
          );
        }
      }
      m.box(w / 2 - 9, -d / 2 + 11, 7, 10, 14, 10, P.wood);
    } else if (k === "gate" || k === "bastiongate") {
      const angle = b.gateAngle ?? (b.rotation === 90 ? Math.PI / 2 : 0);
      const q = model(g, angle, b.progress < 1 ? 0.2 + 0.8 * b.progress : 1);
      const strong =
          b.kind === "bastiongate" ||
          b.bastionGate ||
          b.gateSegments?.some((p) => p.fortified),
        h = strong ? 62 : 43;
      for (const s of [-1, 1])
        tower(
          q,
          s * (strong ? 35 : 27),
          0,
          strong ? 30 : 22,
          (strong ? 54 : 38) / 0.72,
          h,
          stone,
          islamic,
        );
      q.masonry(0, 0, h - 14, strong ? 48 : 42, 24, 13, stone);
      q.battlements(0, 0, h, strong ? 48 : 42, 24, stone);
      if (b.closed !== false) {
        q.box(0, 5, 2, 26, 5, h - 18, P.wood);
        for (let x = -11; x < 13; x += 5)
          q.beam([x, 8, 2], [x, 8, h - 16], 1.3, P.metal);
        for (let z = 8; z < h - 17; z += 10)
          q.beam([-13, 8, z], [13, 8, z], 1.8, P.metal);
      } else {
        q.box(0, 5, h - 23, 26, 5, 6, P.wood);
      }
      q.paint();
      return;
    } else if (k === "wall") {
      wall(g, b);
      return;
    } else if (k === "tower" || k === "watchtower") {
      if (k === "watchtower" && !islamic) {
        for (const x of [-w * 0.35, w * 0.35])
          for (const y of [-d * 0.35, d * 0.35])
            m.beam([x, y, 4], [x, y, 48], 4, P.wood);
        for (const x of [-w * 0.35, w * 0.35]) {
          m.beam([x, -d * 0.35, 6], [x, d * 0.35, 44], 3);
          m.beam([x, d * 0.35, 6], [x, -d * 0.35, 44], 3);
        }
        m.box(0, 0, 46, w, d, 4, P.wood);
        m.roof(0, 0, 59, w + 8, d + 8, 13);
        for (let z = 7; z < 43; z += 6)
          m.beam([-6, d * 0.45, z], [6, d * 0.45, z], 1.7);
      } else
        tower(
          m,
          0,
          0,
          w * 0.85,
          d * 0.85,
          k === "tower" ? 63 : 48,
          stone,
          islamic,
        );
    } else if (k === "fort" || k === "towncenter") {
      const h = k === "fort" ? 57 : 43;
      m.masonry(
        0,
        -d * 0.08,
        4,
        w * 0.64,
        d * 0.68,
        h,
        islamic ? P.plaster : stone,
      );
      if (islamic) {
        m.battlements(0, -d * 0.08, h + 4, w * 0.67, d * 0.71, P.plaster);
        m.cylinder(0, -d * 0.08, h + 7, w * 0.21, 5, "#aac2a3");
        m.dome(0, -d * 0.08, h + 12, w * 0.23, 24, "#638674");
        for (const x of [-w * 0.21, 0, w * 0.21])
          m.window(x, d * 0.265 + 0.5, 7, 12, 24, true);
      } else {
        m.roof(0, -d * 0.08, h + 4, w * 0.72, d * 0.76, 26);
        m.box(0, -d * 0.08, h + 31, 10, 12, 14, stone);
      }
      for (const x of [-w * 0.36, w * 0.36])
        for (const y of [-d * 0.34, d * 0.34])
          tower(m, x, y, w * 0.23, d * 0.23, h + 9, stone, islamic);
      m.window(0, d * 0.27 + 1, 4, 18, 27, islamic);
      m.box(0, d * 0.33, 1, 28, d * 0.12, 3, stone);
    } else if (k === "chapel") {
      m.masonry(0, 0, 4, w * 0.76, d * 0.82, 35, islamic ? P.plaster : stone);
      if (islamic) {
        m.battlements(0, 0, 39, w * 0.8, d * 0.85, P.plaster);
        m.cylinder(0, -d * 0.13, 41, w * 0.26, 5, "#aab69a");
        m.dome(0, -d * 0.13, 46, w * 0.29, 25, "#638d77");
        m.cylinder(-w * 0.37, -d * 0.35, 4, 6, 69, P.plaster);
        m.cylinder(-w * 0.37, -d * 0.35, 62, 9, 4, P.gold);
        m.dome(-w * 0.37, -d * 0.35, 73, 7, 11, "#638d77");
      } else {
        m.roof(0, 0, 39, w * 0.88, d * 0.88, 26);
        tower(m, 0, d * 0.29, w * 0.35, d * 0.25, 63, stone);
        m.roof(0, d * 0.29, 66, w * 0.41, d * 0.31, 16);
        m.beam([0, d * 0.29, 83], [0, d * 0.29, 95], 1.5, P.gold);
        m.beam([-4, d * 0.29, 90], [4, d * 0.29, 90], 1.5, P.gold);
      }
      m.window(0, d * 0.415 + 1, 6, 13, 23, true);
      for (const x of [-w * 0.25, w * 0.25])
        m.window(x, d * 0.415 + 1, 19, 5, 13, true);
    } else {
      const camp = k === "lumbercamp" || k === "miningcamp",
        shed = k === "siegeworkshop" || k === "stable";
      const h = k === "house" ? 24 : camp ? 19 : 32;
      m.masonry(
        0,
        -d * 0.1,
        4,
        w * (camp ? 0.65 : 0.86),
        d * 0.7,
        h,
        islamic ? P.plaster : stone,
      );
      if (islamic) {
        m.box(0, -d * 0.1, h + 4, w * 0.91, d * 0.75, 4, P.plaster);
        m.battlements(0, -d * 0.1, h + 8, w * 0.89, d * 0.74, P.plaster);
        if (k === "house" || k === "mill")
          m.dome(-w * 0.15, -d * 0.15, h + 12, w * 0.2, 15, "#9da887");
        for (let x = -w * 0.3; x < w * 0.4; x += w * 0.2)
          m.window(x, d * 0.251, 9, 7, 16, true);
      } else {
        m.roof(0, -d * 0.1, h + 4, w * 0.96, d * 0.82, 18);
        for (const x of [-w * 0.38, w * 0.38])
          m.beam([x, d * 0.25 + 0.4, 4], [x, d * 0.25 + 0.4, h + 4], 2.6);
        m.beam(
          [-w * 0.4, d * 0.25 + 0.4, h * 0.55],
          [w * 0.4, d * 0.25 + 0.4, h * 0.55],
          2.3,
        );
        m.box(w * 0.24, -d * 0.15, h + 18, 7, 9, 12, stone);
      }
      m.window(0, d * 0.251 + 0.5, 4, shed ? 22 : 10, shed ? 25 : 18, islamic);
      const sideX = w * (camp ? 0.325 : 0.43) + 0.2;
      for (const sideY of [-d * 0.25, d * 0.05]) {
        m.face(
          [
            [sideX, sideY - 3, 13],
            [sideX, sideY + 3, 13],
            [sideX, sideY + 3, 23],
            [sideX, sideY - 3, 23],
          ],
          "#383e34",
          true,
          1,
        );
        m.stroke(
          [
            [sideX + 0.2, sideY - 4, 12],
            [sideX + 0.2, sideY + 4, 12],
          ],
          1,
          P.stone,
        );
      }
      for (const x of [-w * 0.27, w * 0.27])
        m.window(x, d * 0.251 + 0.5, 14, 6, 9, islamic);
      if (k === "barracks") {
        for (const x of [-w * 0.38, w * 0.38]) {
          m.beam([x, d * 0.33, 5], [x, d * 0.33, 28], 2);
          m.beam([x - 7, d * 0.33, 20], [x + 7, d * 0.33, 20], 2);
          for (const dx of [-4, 4])
            m.beam([x + dx, d * 0.33, 8], [x + dx, d * 0.33, 32], 0.9, P.metal);
        }
        for (const x of [-w * 0.3, w * 0.3]) {
          m.beam([x, d * 0.4, 5], [x, d * 0.4, 20], 2, P.wood);
          m.face(
            [
              [x - 5, d * 0.41, 18],
              [x + 5, d * 0.41, 18],
              [x + 4, d * 0.41, 11],
              [x, d * 0.41, 8],
              [x - 4, d * 0.41, 11],
            ],
            faction(b.team),
          );
        }
      }
      if (k === "stable")
        for (const x of [-w * 0.3, w * 0.3]) {
          m.beam([x, d * 0.4, 4], [x, d * 0.4, 14], 2);
          m.beam([x - 10, d * 0.4, 9], [x + 10, d * 0.4, 9], 2);
          m.box(x, d * 0.36, 13, 8, 10, 9, "#9c7955");
          m.beam([x, d * 0.31, 20], [x, d * 0.27, 29], 4, "#9c7955");
          m.box(x, d * 0.25, 26, 5, 7, 5, "#b28d63");
        }
      if (k === "siegeworkshop") {
        for (const x of [-w * 0.32, w * 0.32]) {
          m.beam([x, d * 0.38, 6], [x, d * 0.38, 22], 2);
          m.beam([x - 9, d * 0.38, 21], [x + 9, d * 0.38, 21], 3);
          m.cylinder(x, d * 0.38, 10, 6, 3, P.wood, 10);
          for (let a = 0; a < 6; a++) {
            const turn = (a * Math.PI) / 3;
            m.stroke(
              [
                [x, d * 0.38, 13.2],
                [x + Math.cos(turn) * 5, d * 0.38 + Math.sin(turn) * 5, 13.2],
              ],
              0.8,
              P.gold,
            );
          }
        }
        m.beam([-w * 0.35, d * 0.4, 8], [w * 0.3, d * 0.4, 8], 8);
        for (const x of [-w * 0.3, w * 0.3])
          m.cylinder(x, d * 0.4, 4, 7, 3, P.metal);
      }
      if (camp)
        for (let i = 0; i < 5; i++) {
          if (k === "lumbercamp")
            m.beam(
              [-w * 0.25, d * 0.4 + i * 2, 6 + (i % 2) * 4],
              [w * 0.25, d * 0.4 + i * 2, 6 + (i % 2) * 4],
              5,
            );
          else
            m.box(
              -w * 0.25 + i * 9,
              d * 0.4,
              5,
              7,
              8,
              6,
              i % 2 ? P.stone : P.metal,
            );
        }
      if (k === "mill") {
        m.cylinder(w * 0.29, -d * 0.1, h + 19, 7, 9, P.wood);
      }
    }
    if (b.progress < 1) {
      for (const x of [-w * 0.52, w * 0.52])
        for (const y of [-d * 0.52, d * 0.52]) m.beam([x, y, 0], [x, y, 56], 3);
      for (let z = 15; z < 56; z += 15) {
        m.beam([-w * 0.52, d * 0.52, z], [w * 0.52, d * 0.52, z], 3);
        m.beam([-w * 0.52, d * 0.52, z], [w * 0.52, d * 0.52, z + 12], 2);
      }
    }
    m.paint();
  }
  function rubble(g, b) {
    const m = model(g);
    for (let i = 0; i < 26; i++) {
      const a = i * 2.399 + (b.id || 0),
        r = Math.sqrt((i + 1) / 27);
      const x = Math.cos(a) * b.w * 0.46 * r,
        y = (Math.sin(a) * b.h * 0.43 * r) / 0.72;
      m.box(
        x,
        y,
        0,
        6 + (i % 5),
        7 + (i % 4),
        3 + (i % 7),
        i % 4 ? (b.fortified ? P.bastion : P.stone) : P.wood,
      );
      if (i % 6 === 0) m.beam([x - 10, y, 3], [x + 10, y + 5, 7], 3, "#594735");
    }
    m.paint();
  }
  function structure(g, b, time) {
    if (b.kind === "bastionwall") b = { ...b, kind: "wall", fortified: true };
    if (b.wallAttachment?.fortified && !b.fortified)
      b = { ...b, fortified: true };
    if (b.kind === "greatengine" && b.hp > 0) {
      if (b.progress >= 1) A.greatEngine(g, b, time);
      else {
        g.save();
        g.translate(b.x, b.y);
        g.save();
        g.beginPath();
        g.rect(-150, -25 - 150 * b.progress, 300, 200);
        g.clip();
        A.greatEngine(g, { ...b, x: 0, y: 0 }, time);
        g.restore();
        sprite(
          g,
          `engineScaffold:${Math.floor(b.progress * 20)}`,
          320,
          330,
          160,
          230,
          (g) => {
            const m = model(g);
            for (let i = 0; i < 8; i++) {
              const a = (i * Math.PI) / 4,
                x = Math.cos(a) * b.w * 0.42,
                y = (Math.sin(a) * b.h * 0.42) / 0.72;
              m.beam([x, y, 0], [x, y, 55 + b.progress * 40], 3);
              const next = ((i + 1) * Math.PI) / 4;
              m.beam(
                [x, y, 40],
                [
                  Math.cos(next) * b.w * 0.42,
                  (Math.sin(next) * b.h * 0.42) / 0.72,
                  40,
                ],
                3,
              );
            }
            m.paint();
          },
        );
        g.restore();
      }
      return;
    }
    g.save();
    g.translate(b.x, b.y);
    // Curtains are already composed sprites. Do not cache another canvas around
    // an atlas page that may still be decoding, or the wrapper can stay empty.
    if (b.kind === "wall" && b.hp > 0) {
      wall(g, b);
      g.restore();
      return;
    }
    if (b.wallAttachment && b.hp > 0)
      wall(g, {
        ...b,
        ...b.wallAttachment,
        fortified: b.fortified || b.wallAttachment.fortified,
      });
    const links = Object.values(b.links || {})
      .map((p) => `${p.x},${p.y}`)
      .join(";");
    const key = [
      b.kind,
      b.w,
      b.h,
      b.team ?? 0,
      b.architecture || (b.team === 1 ? "islamic" : "christian"),
      !!b.fortified,
      !!b.bastionGate,
      b.wallAttachment ? "attached5" : false,
      b.closed !== false,
      b.gateAngle || 0,
      b.rotation || 0,
      links,
      b.wallAngle || 0,
      b.hp > 0,
      Math.floor((b.progress ?? 1) * 20),
      b.hp <= 0 ? (b.id || 0) % 3 : 0,
    ].join(":");
    const width = Math.max(200, b.w + 120),
      height = Math.max(240, b.h + visualHeight(b) + 90),
      originY = b.h / 2 + visualHeight(b) + 55;
    sprite(g, "building:" + key, width, height, width / 2, originY, (q) =>
      b.hp <= 0
        ? rubble(q, { ...b, id: (b.id || 0) % 3 })
        : buildingModel(q, b),
    );
    if (
      b.hp > 0 &&
      b.progress >= 1 &&
      !["wall", "farm", "gate", "bastiongate"].includes(b.kind)
    ) {
      const frame = Math.floor(((time * 0.7) / (Math.PI * 2)) * 24) % 24;
      sprite(
        g,
        `buildingMotion:${b.kind}:${b.w}:${b.h}:${b.team}:${b.architecture || (b.team === 1 ? "islamic" : "christian")}:${b.wallAttachment ? "attached5" : false}:${!!b.fortified}:${frame}`,
        width,
        height,
        width / 2,
        originY,
        (q) => {
          const g = q,
            time = ((frame / 24) * Math.PI * 2) / 0.7;
          const roofHeight =
            b.kind === "house"
              ? 38
              : b.kind === "fort"
                ? 66
                : b.kind === "towncenter"
                  ? 63
                  : b.kind === "chapel"
                    ? 68
                    : ["tower", "watchtower"].includes(b.kind)
                      ? b.wallAttachment
                        ? 108
                        : 64
                      : 40;
          const flag = buildingCamera(g, b).project([
            0,
            (-b.h * 0.1) / 0.72,
            roofHeight,
          ]);
          A.banner(g, flag[0], flag[1] - 25 * 0.55, b.team, time, 0.55);
          if (b.kind === "mill") {
            const m = buildingCamera(g, b),
              x = b.architecture === "islamic" || b.team === 1 ? b.w * 0.23 : 0,
              y = (b.h * 0.24) / 0.72,
              z = 36;
            for (let i = 0; i < 4; i++) {
              const a = time * 0.7 + (i * Math.PI) / 2;
              m.beam(
                [x, y, z],
                [x + Math.cos(a) * 25, y, z + Math.sin(a) * 25],
                2,
                P.wood,
              );
              m.face(
                [
                  [x + Math.cos(a) * 8, y - 0.4, z + Math.sin(a) * 8],
                  [x + Math.cos(a) * 25, y - 0.4, z + Math.sin(a) * 25],
                  [
                    x + Math.cos(a) * 25 - Math.sin(a) * 6,
                    y - 0.4,
                    z + Math.sin(a) * 25 + Math.cos(a) * 6,
                  ],
                  [
                    x + Math.cos(a) * 8 - Math.sin(a) * 6,
                    y - 0.4,
                    z + Math.sin(a) * 8 + Math.cos(a) * 6,
                  ],
                ],
                "#d5c79d",
              );
            }
            m.paint();
          }
        },
      );
    }
    if (b.hp > 0 && b.maxHp && b.hp < b.maxHp * 0.8) {
      const z = visualHeight(b) * 0.4;
      A.line(
        g,
        [
          [-8, -z - 5],
          [-1, -z + 1],
          [-4, -z + 9],
          [6, -z + 16],
        ],
        1.4,
        "#4d4437",
      );
      if (b.hp < b.maxHp * 0.4) {
        const flicker = Math.sin(time * 9 + (b.id || 0));
        A.ellipse(g, 9, -z, 5, 11 + flicker * 3, "#d9853080");
        A.ellipse(g, 9, -z + 4, 3, 7, "#e6c263");
      }
    }
    g.restore();
  }
  function visualHeight(b) {
    return b.kind === "greatengine"
      ? 160
      : b.kind === "chapel"
        ? 105
        : b.kind === "fort"
          ? 108
          : b.kind === "towncenter"
            ? 95
            : b.kind === "tower"
              ? 80
              : b.kind === "watchtower"
                ? 78
                : b.kind === "gate"
                  ? 75
                  : b.kind === "wall"
                    ? b.fortified
                      ? 46
                      : 35
                    : 65;
  }
  function tree(g, x, y, scale = 1, palm = false, snow = false) {
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    shadow(g, 24, 14);
    sprite(g, `tree:${palm}:${snow}`, 100, 135, 50, 110, (q) => {
      const m = model(q, 0, 0.72);
      m.beam([0, 0, 0], [2, 0, palm ? 54 : 38], 6, P.wood);
      if (palm) {
        for (let i = 0; i < 9; i++) {
          const a = (i * Math.PI * 2) / 9,
            dx = Math.cos(a),
            dy = Math.sin(a);
          m.face(
            [
              [2, 0, 55],
              [dx * 14 - dy * 5, dy * 14 + dx * 5, 60],
              [dx * 34, dy * 34, 43],
              [dx * 15 + dy * 5, dy * 15 - dx * 5, 57],
            ],
            i % 2 ? P.leaf : "#6e924b",
            false,
          );
          m.stroke(
            [
              [2, 0, 56],
              [dx * 16, dy * 16, 58],
              [dx * 34, dy * 34, 43],
            ],
            0.8,
            "#a7aa67",
          );
        }
        m.dome(1, 0, 51, 4, 5, P.wood, 8);
      } else {
        for (const [cx, cy, z, r, h] of [
          [0, 0, 28, 24, 30],
          [-12, 4, 24, 15, 24],
          [14, 5, 28, 14, 25],
          [0, -12, 31, 17, 23],
          [0, 0, 45, 16, 23],
        ]) {
          m.dome(cx, cy, z, r, h, P.leaf, 12);
          if (snow)
            m.dome(
              cx - 2,
              cy - 2,
              z + h * 0.5,
              r * 0.72,
              h * 0.53,
              "#dbe3d3",
              12,
            );
        }
      }
      m.paint();
    });
    g.restore();
  }
  function resource(g, n) {
    if (n.remaining <= 0) return;
    if (n.kind === "wood") {
      tree(g, n.x, n.y, 1.3, n.palm, n.snow);
      return;
    }
    g.save();
    g.translate(n.x, n.y);
    shadow(g, 28, 18);
    sprite(
      g,
      `resource:${n.kind}:${(n.id || 0) % 3}`,
      110,
      110,
      55,
      80,
      (q) => {
        const m = model(q);
        if (n.kind === "food") {
          for (let i = 0; i < 7; i++) {
            const a = i * 2.399,
              x = Math.cos(a) * 13,
              y = Math.sin(a) * 14;
            m.dome(x, y, 1, 11, 15, P.leaf, 10);
            for (let j = 0; j < 3; j++)
              m.dome(
                x + Math.sin(j * 3 + i) * 6,
                y + Math.cos(j * 2 + i) * 6,
                13,
                2.3,
                3,
                P.red,
                6,
              );
          }
        } else {
          for (let i = 0; i < 5; i++) {
            const a = i * 2.399,
              x = Math.cos(a) * 16,
              y = Math.sin(a) * 14,
              r = 12 + (i % 2) * 5;
            const base = Array.from({ length: 6 }, (_, j) => [
              x + Math.cos((j * Math.PI) / 3) * r,
              y + Math.sin((j * Math.PI) / 3) * r,
              2,
            ]);
            const rockHeight = 10 + (i % 3) * 5;
            const top = base.map(([px, py], j) => [
              x + (px - x) * 0.53 - 2,
              y + (py - y) * 0.53 - 2,
              rockHeight + Math.sin(j * 2) * 2,
            ]);
            for (let j = 0; j < 6; j++)
              m.face(
                [base[j], base[(j + 1) % 6], top[(j + 1) % 6], top[j]],
                P.stone,
              );
            m.face(top, P.stone);
            if (n.kind === "gold") {
              m.stroke(
                [
                  [x - r * 0.7, y + r * 0.3, 4],
                  [x - r * 0.3, y + r * 0.5, rockHeight * 0.7],
                  [x + r * 0.2, y + r * 0.4, rockHeight * 0.75],
                ],
                2.5,
                P.gold,
              );
              m.dome(x - 3, y - 2, rockHeight, 3, 3, P.gold, 6);
            }
          }
        }
        m.paint();
      },
    );
    g.restore();
  }
  function horse(m, step, cloth) {
    for (const y of [-7, 0, 7]) m.dome(0, y, 10, 7.4, 13, "#9c7955");
    m.dome(0, 0, 21, 7, 5, cloth, 10);
    m.beam([0, -10, 19], [0, -19, 27], 7, "#9c7955");
    m.dome(0, -23, 22, 4.2, 9, "#b28d63");
    m.dome(0, -27, 23, 3.3, 4.5, "#b28d63");
    for (const x of [-4, 4])
      for (const y of [-9, 11]) {
        const swing = step * (x * y > 0 ? 1 : -1);
        m.beam([x, y, 15], [x, y + swing, 3], 2.5, "#694f39");
        m.box(x, y + swing - 1, 1, 3, 5, 3, "#403e32");
      }
    for (const x of [-2, 2]) m.beam([x, -23, 29], [x, -24, 34], 1.5, "#694f39");
    m.stroke(
      [
        [0, 14, 19],
        [0, 22, 11],
        [1, 24, 5],
      ],
      2.5,
      "#5e4937",
    );
    m.stroke(
      [
        [-4, -25, 26],
        [-5, -16, 22],
        [-4, -4, 28],
      ],
      1,
      "#dbc4a0",
    );
  }
  function person(m, u, step, strike) {
    const civilian = u.type === "worker" || u.type === "civilian",
      mounted = u.type === "knight",
      priest = u.type === "chaplain";
    const base = mounted ? 26 : 0,
      cloth = priest
        ? "#dfd4b5"
        : u.rank > 0 && u.team === 0
          ? "#ded8c0"
          : faction(u.team),
      armor = P.metal;
    if (mounted) horse(m, step, cloth);
    for (const x of [-3, 3]) {
      const swing = mounted ? 0 : step * (x > 0 ? 1 : -1);
      m.beam(
        [x, 0, base + 12],
        [x, swing, base + 3],
        3,
        priest ? cloth : "#665744",
      );
      m.box(x, swing - 1, base + 1, 3.5, 5, 3, "#514538");
    }
    m.box(0, 0, base + 10, 10, 7, 12, civilian || priest ? cloth : armor);
    m.face(
      [
        [-6, 3.8, base + 18],
        [6, 3.8, base + 18],
        [5, 4.2, base + 7],
        [-5, 4.2, base + 7],
      ],
      cloth,
    );
    m.beam(
      [-5, 0, base + 20],
      [-8, -2 - strike * 5, base + 13],
      3,
      civilian ? cloth : armor,
    );
    m.beam(
      [5, 0, base + 20],
      [8, -3 - strike * 7, base + 15 + strike * 4],
      3,
      civilian ? cloth : armor,
    );
    m.dome(0, 0, base + 23, 4.5, 7, P.skin, 10);
    if (civilian || priest)
      m.dome(0, 0, base + 27, 5, 3, priest ? cloth : P.wood, 10);
    else {
      m.dome(0, 0, base + 27, 5.2, 5, armor, 10);
      m.box(0, -4.7, base + 25, 5, 1, 5, armor);
      m.stroke(
        [
          [-2, -5.4, base + 27],
          [2, -5.4, base + 27],
        ],
        0.8,
        "#354039",
      );
    }
    if (u.rank > 0 && !civilian) {
      m.stroke(
        [
          [-4, 4.4, base + 16],
          [4, 4.4, base + 16],
        ],
        1.3,
        P.gold,
      );
      m.dome(0, 0, base + 31, 2, 3, u.rank > 1 ? P.gold : faction(u.team), 8);
    }
    if (u.type === "sword" || mounted) {
      m.face(
        [
          [-8, -2, base + 21],
          [-14, -2, base + 21],
          [-13, -3, base + 10],
          [-10, -3, base + 7],
          [-7, -3, base + 10],
        ],
        faction(u.team),
      );
      m.stroke(
        [
          [-10.5, -3.2, base + 11],
          [-10.5, -3.2, base + 19],
        ],
        1.2,
        "#ded2ad",
      );
      m.beam(
        [8, -4 - strike * 7, base + 14],
        [9, -14 - strike * 13, base + 31 - strike * 12],
        1.6,
        "#c8d1c6",
      );
      m.beam([5, -6, base + 18], [11, -6, base + 18], 1.2, P.gold);
    } else if (u.type === "archer") {
      const crossbow = u.rank > 0;
      m.stroke(
        [
          [-10, -6, base + 10],
          [-14, -9, base + 19],
          [-10, -6, base + 29],
        ],
        1.8,
        P.wood,
      );
      m.stroke(
        [
          [-10, -6, base + 10],
          [-8, -5 - strike * 4, base + 19],
          [-10, -6, base + 29],
        ],
        0.65,
        "#ded2ad",
      );
      m.beam(
        [-9, -7, base + 19],
        [-9, -21, base + 19],
        crossbow ? 2 : 1,
        P.wood,
      );
    } else if (priest) {
      m.beam([9, -2, base + 1], [9, -2, base + 39], 1.6, P.wood);
      m.beam([6, -2, base + 34], [12, -2, base + 34], 1.5, P.gold);
    } else if (u.type === "worker") {
      m.beam([8, -4, base + 12], [8, -5, base + 28 + strike * 4], 1.5, P.wood);
      m.beam(
        [4, -5, base + 27 + strike * 4],
        [12, -5, base + 27 + strike * 4],
        2.3,
        armor,
      );
      if (u.carry > 0) m.box(0, 6, base + 11, 8, 5, 9, P.wood);
    }
  }
  // Shared by the sprite path and the direct atlas path so both agree on keys.
  const personFrame = { key: "", phase: 0, heading: 0, action: "" };
  function personKey(u, time, angle) {
    const heading =
        (Math.round(
          (Math.atan2(Math.sin(angle), Math.cos(angle)) * 4) / Math.PI,
        ) *
          Math.PI) /
        4,
      rank = ["worker", "civilian", "chaplain"].includes(u.type)
        ? 0
        : Math.min(1, u.rank || 0),
      action = u.moving
        ? "walk"
        : u.working
          ? u.job?.resource === "food" && u.gatherSource === "food"
            ? "berries"
            : u.job?.resource ||
              (u.job?.kind === "clear" ? u.gatherSource : null) ||
              "build"
          : u.strike > 0
            ? "attack"
            : "idle",
      clock = u.moving
        ? (u.anim ?? time * 9)
        : u.working
          ? (u.workPhase ?? 0) * Math.PI * 2
          : (1 - (u.strike || 0)) * Math.PI * 2,
      frame =
        action === "idle" ? 0 : Math.floor((clock / (Math.PI * 2)) * 12) % 12;
    const spriteType = u.type === "knight" ? "knight5" : u.type;
    personFrame.key = `person:${spriteType}:${u.team}:${rank}:${heading}:${action}:${frame}:${u.carry > 0}`;
    personFrame.phase = (frame * Math.PI * 2) / 12;
    personFrame.heading = heading;
    personFrame.action = action;
    return personFrame;
  }
  function unit(g, u, time, angle = u.angle || 0) {
    if (window.CruciataPeopleArt) {
      const f = personKey(u, time, angle),
        { phase, heading, action } = f;
      sprite(g, f.key, 100, 120, 50, 95, (q) =>
        window.CruciataPeopleArt.draw(q, u, phase, heading, action),
      );
      return;
    }
    const canonical = Math.atan2(
      Math.sin(angle + Math.PI / 2),
      Math.cos(angle + Math.PI / 2),
    );
    const heading = (Math.round((canonical * 16) / Math.PI) * Math.PI) / 16;
    const step = u.moving ? Math.round(Math.sin(u.anim || time * 9) * 3) : 0,
      strike = Math.round((u.strike || 0) * 3) / 3;
    sprite(
      g,
      `unit:${u.type}:${u.team}:${u.rank || 0}:${heading}:${step}:${strike}:${u.carry > 0}`,
      100,
      120,
      50,
      95,
      (q) => {
        const m = model(q, heading);
        person(m, u, step, strike);
        m.paint();
      },
    );
  }
  function wheel(m, x, y, z, r, turn) {
    const ring = Array.from({ length: 16 }, (_, i) => [
      x,
      y + Math.cos((i * Math.PI) / 8) * r,
      z + Math.sin((i * Math.PI) / 8) * r,
    ]);
    m.face(ring, P.wood);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + turn;
      m.stroke(
        [
          [x - 0.4, y, z],
          [x - 0.4, y + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85],
        ],
        1.3,
        P.gold,
      );
    }
    m.box(x, y, z, 2, 3, 3, P.metal);
  }
  function caravan(g, u, time, angle = u.angle || 0) {
    const heading =
      (Math.round(
        (Math.atan2(Math.sin(angle), Math.cos(angle)) * 8) / Math.PI,
      ) *
        Math.PI) /
      8;
    const frame = u.moving ? Math.floor(time * 12) % 12 : 0,
      step = u.moving ? Math.sin((frame * Math.PI) / 6) * 3 : 0,
      wheelPose = frame % 8;
    const key = `caravan:${u.team}:${heading}:${!!u.moving}:${frame}`;
    sprite(g, key, 160, 180, 80, 120, (q) =>
      drawCaravan(q, u, time, heading, step, wheelPose),
    );
  }
  function drawCaravan(g, u, time, angle, step, wheelPose) {
    const m = model(g, angle + Math.PI / 2);
    horse(m, step, "#ba9861");
    // Harnessed horse ahead of a sprung wagon, cargo visible beneath canvas.
    const cart = m;
    cart.box(0, 37, 12, 29, 32, 4, P.wood);
    for (const x of [-17, 17])
      for (const y of [25, 48])
        wheel(cart, x, y, 8, 8, (wheelPose * (Math.PI / 3)) / 8);
    for (const x of [-11, 11]) cart.beam([x, 18, 12], [x, -2, 13], 2);
    for (let i = 0; i < 5; i++)
      cart.box(
        (i % 2 ? 1 : -1) * 7,
        27 + i * 4,
        16,
        10,
        8,
        9,
        i % 2 ? P.wood : "#bda97d",
      );
    for (const y of [21, 37, 53]) {
      cart.beam([-14, y, 16], [-14, y, 31], 2);
      cart.beam([14, y, 16], [14, y, 31], 2);
      cart.beam([-14, y, 31], [0, y, 38], 2);
      cart.beam([0, y, 38], [14, y, 31], 2);
    }
    cart.face(
      [
        [-15, 20, 30],
        [0, 20, 39],
        [0, 54, 39],
        [-15, 54, 30],
      ],
      "#e2d3ad",
    );
    cart.face(
      [
        [0, 20, 39],
        [15, 20, 30],
        [15, 54, 30],
        [0, 54, 39],
      ],
      "#e2d3ad",
    );
    for (const y of [25, 33, 41, 49])
      cart.stroke(
        [
          [-15, y, 30],
          [0, y, 39],
          [15, y, 30],
        ],
        0.8,
        "#b29b74",
      );
    m.paint();
  }
  function corpse(g, u) {
    g.save();
    g.rotate((u.angle || 0) + Math.PI / 2);
    sprite(g, `corpse:${u.type}:${u.team}`, 100, 100, 50, 50, (g) => {
      const m = model(g);
      if (
        ["trebuchet", "ram", "ballista", "pilgrim", "merchant"].includes(u.type)
      ) {
        for (let i = 0; i < 9; i++) {
          const x = Math.sin(i * 3.7) * 22,
            y = Math.cos(i * 2.4) * 24;
          m.beam([x - 9, y - 5, 1], [x + 9, y + 5, 4 + (i % 3)], 3, P.wood);
          if (i % 3 === 0) wheel(m, x, y, 4, 6, i);
        }
        m.paint();
        return;
      }
      m.box(0, 0, 1, 9, 16, 4, faction(u.team));
      m.dome(0, -11, 1, 4, 4, P.metal, 8);
      for (const x of [-3, 3]) m.beam([x, 7, 3], [x, 16, 2], 2, "#675743");
      m.beam([8, -5, 2], [9, 16, 2], 1.3, P.metal);
      m.paint();
    });
    g.restore();
  }
  function ship(g, x, y, time, variant = 0) {
    g.save();
    g.translate(x, y + Math.sin(time * 0.7 + variant) * 2);
    const frame = Math.floor(
      (((time + variant) % (Math.PI * 2)) / (Math.PI * 2)) * 16,
    );
    sprite(g, `ship:${frame}`, 150, 240, 75, 160, (g) => {
      const time = (frame / 16) * Math.PI * 2,
        variant = 0;
      const m = model(g, -0.08),
        deck = [
          [-19, -42, 12],
          [0, -70, 12],
          [19, -42, 12],
          [22, 37, 12],
          [0, 63, 12],
          [-22, 37, 12],
        ];
      for (let i = 0; i < deck.length; i++) {
        const j = (i + 1) % deck.length;
        m.face(
          [
            deck[i].map((n, k) => (k === 2 ? 0 : n * 0.65)),
            deck[j].map((n, k) => (k === 2 ? 0 : n * 0.65)),
            deck[j],
            deck[i],
          ],
          P.wood,
        );
      }
      m.face(deck, "#b59864");
      for (let y = -45; y < 51; y += 7)
        m.stroke(
          [
            [-17, y, 12.2],
            [17, y, 12.2],
          ],
          0.8,
          "#80613d",
        );
      m.beam([0, 0, 12], [0, 0, 100], 3);
      m.beam([-31, 0, 87], [31, 0, 87], 2);
      const billow = 5 + Math.sin(time + variant) * 2;
      m.face(
        [
          [-29, 0, 86],
          [29, 0, 86],
          [25, -billow, 45],
          [-25, -billow, 45],
        ],
        "#e6d8b3",
      );
      m.stroke(
        [
          [-29, 0, 86],
          [-25, -billow, 45],
          [0, 0, 14],
          [29, 0, 86],
        ],
        0.8,
        "#d6c28f",
      );
      m.box(0, 39, 12, 30, 20, 15, P.wood);
      m.roof(0, 39, 27, 34, 24, 12);
      m.paint();
    });
    g.restore();
  }
  function boulder(g, d) {
    g.save();
    g.translate(d.x, d.y);
    shadow(g, d.r, d.r * 0.65);
    sprite(
      g,
      `boulder:${d.r}`,
      d.r * 3 + 20,
      d.r * 3 + 30,
      d.r * 1.5 + 10,
      d.r * 2 + 15,
      (q) => {
        const m = model(q),
          base = Array.from({ length: 7 }, (_, i) => [
            Math.cos((i * Math.PI * 2) / 7) * d.r,
            Math.sin((i * Math.PI * 2) / 7) * d.r,
            0,
          ]);
        const upper = base.map(([x, y], i) => [
          x * 0.6 - 3,
          y * 0.6 - 2,
          d.r * (0.5 + Math.sin(i * 3) * 0.08),
        ]);
        for (let i = 0; i < 7; i++) {
          const j = (i + 1) % 7;
          m.face([base[i], base[j], upper[j], upper[i]], P.stone);
        }
        m.face(upper, P.stone);
        m.paint();
      },
    );
    g.restore();
  }
  function bridge(g, x, y) {
    g.save();
    g.translate(x, y);
    sprite(g, "bridge", 210, 150, 105, 80, (g) => {
      const m = model(g);
      m.masonry(0, 0, -10, 164, 88 / 0.72, 10, P.stone);
      for (let px = -75; px < 80; px += 13)
        m.stroke(
          [
            [px, -39 / 0.72, 0.2],
            [px, 39 / 0.72, 0.2],
          ],
          0.8,
          "#d5c5a0",
        );
      for (const s of [-1, 1]) {
        m.box(0, (s * 44) / 0.72, 0, 166, 5, 6, P.stone);
        for (let px = -78; px < 81; px += 18)
          m.box(px, (s * 44) / 0.72, 6, 7, 7, 5, P.stone);
      }
      // Recessed voussoirs beneath the walkable deck suggest the river arch.
      m.face(
        [
          [-54, 45 / 0.72, -10],
          [-36, 45 / 0.72, -4],
          [0, 45 / 0.72, -1],
          [36, 45 / 0.72, -4],
          [54, 45 / 0.72, -10],
        ],
        "#52645a",
        false,
      );
      m.paint();
    });
    g.restore();
  }
  // Static terrain retains its painted ground and already raised cliffs. All
  // upright models share a painter queue, including flags and siege machines.
  let frame = null,
    painting = false;
  function defer(g, y, draw) {
    if (!frame || painting || g !== frame.g) {
      draw();
      return;
    }
    frame.objects.push({
      y,
      draw,
      transform: g.getTransform(),
      alpha: g.globalAlpha,
      index: frame.objects.length,
    });
  }
  const projected = {
    structure,
    unit,
    tree,
    resource,
    caravan,
    corpse,
    ship,
    boulder,
  };
  for (const [name, fn] of Object.entries(projected))
    A[name] = (...args) => {
      const g = args[0],
        o = args[1];
      const y =
        name === "tree" || name === "ship"
          ? args[2]
          : name === "unit" || name === "caravan" || name === "corpse"
            ? o?.y || 0
            : o.y +
              (name === "structure"
                ? o.h * 0.3 + (o.wallAttachment ? 40 : 0)
                : 0);
      defer(g, y, () => fn(...args));
    };
  const drawStandard = A.armyStandard,
    sleepingFlags = new WeakMap(),
    standardMotion = new WeakMap();
  A.standardMaster = drawStandard;
  A.armyStandard = (g, u) => {
    const cloth = A.standardCloth(u);
    if (globalThis.CruciataAtlas) {
      let motion = standardMotion.get(u);
      if (!motion) {
        motion = { moving: !!u.moving, stopped: -10 };
        standardMotion.set(u, motion);
      }
      if (motion.moving && !u.moving) motion.stopped = cloth.time;
      motion.moving = !!u.moving;
      const heading = Math.round(
          (Math.atan2(Math.sin(u.angle || 0), Math.cos(u.angle || 0)) * 4) /
            Math.PI,
        ),
        track = u.moving ? "move" : "rest",
        pose = u.moving
          ? Math.floor(cloth.time * 12) % 12
          : Math.min(
              24,
              Math.floor(Math.max(0, cloth.time - motion.stopped) * 3),
            );
      if (
        globalThis.CruciataAtlas.draw(
          g,
          `standard2:${u.team}:${heading}:${track}:${pose}`,
          260,
          180,
          130,
          120,
        )
      )
        return;
    }
    if (!cloth.sleeping) {
      sleepingFlags.delete(u);
      drawStandard(g, u);
      return;
    }
    const resolution = Math.max(
      1,
      Math.min(
        3,
        Math.ceil(Math.hypot(g.getTransform().a, g.getTransform().b)),
      ),
    );
    let entry = sleepingFlags.get(u);
    const key = [u.x, u.y, u.team, u.angle, resolution].join(":");
    if (!entry || entry.key !== key) {
      cacheMetrics.sleepingFlagMisses++;
      const points = cloth.points.map((p) => [
        (p.x - u.x) / 0.72,
        (p.y - p.z - u.y) / 0.72,
      ]);
      points.push(
        [
          (cloth.anchor.x - u.x) / 0.72,
          (cloth.anchor.y - cloth.anchor.z - u.y) / 0.72 - 7,
        ],
        [
          (cloth.anchor.x - u.x) / 0.72,
          (cloth.anchor.y - cloth.anchor.z - u.y) / 0.72 + 65,
        ],
      );
      const left = Math.floor(Math.min(...points.map((p) => p[0]))) - 4,
        top = Math.floor(Math.min(...points.map((p) => p[1]))) - 4;
      const width = Math.ceil(Math.max(...points.map((p) => p[0])) - left) + 4,
        height = Math.ceil(Math.max(...points.map((p) => p[1])) - top) + 4;
      const canvas = document.createElement("canvas");
      canvas.width = width * resolution;
      canvas.height = height * resolution;
      const q = canvas.getContext("2d");
      q.scale(resolution, resolution);
      q.translate(-left, -top);
      drawStandard(q, u);
      entry = { canvas, key, left, top, width, height };
      sleepingFlags.set(u, entry);
    } else cacheMetrics.sleepingFlagHits++;
    g.drawImage(entry.canvas, entry.left, entry.top, entry.width, entry.height);
  };
  for (const name of [
    "siegeMachine",
    "armyStandard",
    "greatEngine",
    "rockMass",
    "cliff",
  ]) {
    const fn = A[name];
    A[name] = (g, o, ...args) =>
      defer(g, o.y + (o.h || 0) * 0.3, () => fn(g, o, ...args));
  }
  A.beginFrame = (g) => {
    frame = { g, objects: [], overlays: [] };
  };
  A.deferOverlay = (g, draw) => {
    if (!frame || painting || g !== frame.g) return false;
    frame.overlays.push({ draw, transform: g.getTransform() });
    return true;
  };
  // Queues one upright figure at ground position (x, y). `base` carries the
  // canvas's translation/scale (a, d, e, f) so the queued transform is arithmetic
  // rather than a captured matrix; outside a frame the figure is drawn at once.
  A.unitFigure = (g, o, time, angle, x, y, base) => {
    if (!frame || painting || g !== frame.g) {
      g.save();
      g.translate(x, y);
      g.scale(0.72, 0.72);
      unit(g, o, time, angle);
      g.restore();
      return;
    }
    frame.objects.push({
      figure: o,
      time,
      angle,
      base,
      x,
      y: o.y,
      a: base.a * 0.72,
      d: base.d * 0.72,
      e: base.e + base.a * x,
      f: base.f + base.d * y,
      alpha: g.globalAlpha,
      index: frame.objects.length,
    });
  };
  // Trees and resource patches queue as plain data and, when baked, draw
  // straight from the atlas without a canvas state change apiece.
  const softShadow = document.createElement("canvas");
  softShadow.width = 64;
  softShadow.height = 40;
  {
    const q = softShadow.getContext("2d");
    q.fillStyle = "#253323";
    q.globalAlpha = 0.19;
    q.beginPath();
    q.ellipse(32, 20, 30, 17, 0, 0, Math.PI * 2);
    q.fill();
  }
  const treeKeys = new Map();
  A.treeFast = (g, x, y, scale, palm, snow, base) => {
    if (!frame || painting || g !== frame.g) {
      A.tree(g, x, y, scale, palm, snow);
      return;
    }
    const code = (palm ? 2 : 0) + (snow ? 1 : 0);
    let key = treeKeys.get(code);
    if (!key) treeKeys.set(code, (key = `tree:${!!palm}:${!!snow}`));
    frame.objects.push({
      prop: 1,
      key,
      x,
      y,
      scale,
      palm,
      snow,
      base,
      alpha: g.globalAlpha,
      index: frame.objects.length,
    });
  };
  A.resourceFast = (g, n, base) => {
    if (n.remaining <= 0) return;
    if (n.kind === "wood") {
      A.treeFast(g, n.x, n.y, 1.3, n.palm, n.snow, base);
      return;
    }
    if (!frame || painting || g !== frame.g) {
      A.resource(g, n, 0);
      return;
    }
    frame.objects.push({
      prop: 2,
      key: `resource:${n.kind}:${(n.id || 0) % 3}`,
      n,
      x: n.x,
      y: n.y,
      base,
      alpha: g.globalAlpha,
      index: frame.objects.length,
    });
  };
  A.flushFrame = () => {
    if (!frame) return;
    const f = frame;
    painting = true;
    const g = f.g;
    g.save();
    f.objects.sort((a, b) => a.y - b.y || a.index - b.index);
    let direct = null;
    for (const o of f.objects) {
      if (o.figure) {
        // Baked people draw straight from the atlas in world space under the
        // canvas's own transform: no per-figure state change at all.
        if (window.CruciataPeopleArt && globalThis.CruciataAtlas?.drawAt) {
          if (direct !== o.base) {
            g.setTransform(o.base.a, 0, 0, o.base.d, o.base.e, o.base.f);
            direct = o.base;
          }
          if (g.globalAlpha !== o.alpha) g.globalAlpha = o.alpha;
          const k = personKey(o.figure, o.time, o.angle);
          if (globalThis.CruciataAtlas.drawAt(g, k.key, 50, 95, o.x, o.y, 0.72))
            continue;
        }
        // Plain-number transform: no matrix object is built or converted.
        direct = null;
        g.setTransform(o.a, 0, 0, o.d, o.e, o.f);
        g.globalAlpha = o.alpha;
        unit(g, o.figure, o.time, o.angle);
        continue;
      }
      if (o.prop && globalThis.CruciataAtlas?.drawAt) {
        if (direct !== o.base) {
          g.setTransform(o.base.a, 0, 0, o.base.d, o.base.e, o.base.f);
          direct = o.base;
        }
        if (g.globalAlpha !== o.alpha) g.globalAlpha = o.alpha;
        const atlas = globalThis.CruciataAtlas;
        if (o.prop === 1) {
          const k = o.scale;
          g.drawImage(
            softShadow,
            o.x + 7 * k - 24 * k,
            o.y + 7 * k - 14 * k,
            48 * k,
            28 * k,
          );
          if (atlas.drawAt(g, o.key, 50, 110, o.x, o.y, k)) continue;
        } else {
          g.drawImage(softShadow, o.x + 7 - 28, o.y + 7 - 18, 56, 36);
          if (atlas.drawAt(g, o.key, 55, 80, o.x, o.y, 1)) continue;
        }
      }
      if (o.prop) {
        // Not baked (or not decoded yet): draw through the full path.
        direct = null;
        g.setTransform(o.base.a, 0, 0, o.base.d, o.base.e, o.base.f);
        if (g.globalAlpha !== o.alpha) g.globalAlpha = o.alpha;
        if (o.prop === 1) tree(g, o.x, o.y, o.scale, o.palm, o.snow);
        else resource(g, o.n);
        continue;
      }
      direct = null;
      g.setTransform(o.transform);
      g.globalAlpha = o.alpha;
      o.draw();
    }
    g.globalAlpha = 1;
    for (const o of f.overlays) {
      g.setTransform(o.transform);
      o.draw();
    }
    g.restore();
    frame = null;
    painting = false;
  };
  A.visualHeight = visualHeight;
  A.bridge = bridge;
  const hitCanvas = document.createElement("canvas");
  hitCanvas.width = hitCanvas.height = 1;
  const hitContext = hitCanvas.getContext("2d", { willReadFrequently: true });
  function pixelHit(p, draw) {
    hitContext.setTransform(1, 0, 0, 1, 0, 0);
    hitContext.clearRect(0, 0, 1, 1);
    hitContext.save();
    hitContext.translate(-p.x, -p.y);
    draw(hitContext);
    hitContext.restore();
    return hitContext.getImageData(0, 0, 1, 1).data[3] > 160;
  }
  // Pick areas follow the drawn silhouettes (measured with scripts/hit-audit.js,
  // plus a few units of margin) so anything painted can be clicked. Boxes are
  // [left, right, top, bottom] relative to the ground point.
  const UNIT_PICK = {
    knight: [-26, 26, -52, 8],
    standard: [-40, 16, -52, 8],
    ram: [-46, 46, -58, 16],
    ballista: [-42, 42, -62, 14],
    trebuchet: [-64, 64, -108, 22],
    pilgrim: [-38, 38, -46, 16],
    merchant: [-38, 38, -46, 16],
  };
  const FOOT_PICK = [-15, 15, -38, 6];
  const BUILDING_PICK = {
    towncenter: [-60, 60, -90, 52],
    fort: [-74, 74, -104, 70],
    barracks: [-48, 48, -70, 42],
    house: [-30, 30, -58, 28],
    tower: [-26, 26, -75, 25],
    watchtower: [-22, 22, -62, 22],
    chapel: [-39, 39, -94, 50],
    gate: [-58, 58, -120, 46],
    bastiongate: [-58, 58, -120, 46],
    stable: [-47, 47, -62, 42],
    siegeworkshop: [-54, 54, -68, 43],
    farm: [-48, 48, -46, 41],
    mill: [-36, 43, -60, 34],
    miningcamp: [-42, 42, -56, 38],
    lumbercamp: [-42, 42, -56, 38],
  };
  // Soldiers and villagers are drawn as small clusters, so their pick area
  // grows by the cluster's spread.
  const CLUSTER = { x: 17, y: 10 };
  A.pickBox = (u) => {
    const base = UNIT_PICK[u.type] || FOOT_PICK;
    if (
      ["ram", "ballista", "trebuchet", "pilgrim", "merchant"].includes(u.type)
    )
      return base;
    return [
      base[0] - CLUSTER.x,
      base[1] + CLUSTER.x,
      base[2] - CLUSTER.y,
      base[3] + CLUSTER.y,
    ];
  };
  A.hitStructure = (b, p, margin = 0) => {
    const x = p.x - b.x,
      y = p.y - b.y;
    if (Math.abs(x) < b.w / 2 + margin && Math.abs(y) < b.h / 2 + margin)
      return true;
    const box =
      b.wallAttachment && b.kind === "tower"
        ? [-38, 38, -108, 27]
        : BUILDING_PICK[b.kind];
    if (b.kind === "wall") return false;
    if (box)
      return (
        x >= box[0] - margin &&
        x <= box[1] + margin &&
        y >= box[2] - margin &&
        y <= box[3] + margin
      );
    if (x > b.w / 2 + 60 || y > 0 || y < -b.h / 2 - visualHeight(b) - 30)
      return false;
    return pixelHit(p, (g) => structure(g, b, 0));
  };
  A.hitUnit = (u, p, time = 0, radius = 27) => {
    const x = p.x - u.x,
      y = p.y - u.y,
      box = A.pickBox(u);
    if (x >= box[0] && x <= box[1] && y >= box[2] && y <= box[3]) return true;
    return radius > 0 && x * x + y * y < radius * radius;
  };
  A.hitResource = (n, p) => {
    const x = p.x - n.x,
      y = p.y - n.y,
      r = (n.r || 24) + 15;
    if (x * x + y * y < r * r) return true;
    if (Math.abs(x) > 65 || y < -120 || y > 35) return false;
    return pixelHit(p, (g) => resource(g, n));
  };
  A.projectedModel = model;
  A.stylePalette = P;
  A.spriteStats = () => ({ entries: sprites.size, pixels, ...cacheMetrics });
})();
