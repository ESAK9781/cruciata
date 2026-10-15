/* Original projected timber machinery. Height is a real model coordinate. */
(() => {
  "use strict";
  function workshop(g, angle, heightScale = 1, wood = null) {
    const A = window.CruciataArt,
      ca = Math.cos(angle),
      sa = Math.sin(angle),
      commands = [];
    let layer = 0;
    const height = (z) => (z <= 12 ? z : 12 + (z - 12) * heightScale);
    const project = ([x, y, z]) => [
      x * ca - y * sa,
      (x * sa + y * ca) * 0.72 - height(z),
    ];
    const depth = (points) =>
      points.reduce(
        (sum, [x, y, z]) => sum + x * sa + y * ca + height(z) * 0.72,
        0,
      ) / points.length;
    const vertices = (points) =>
      points.map((p) => [
        ...project(p),
        p[0] * sa + p[1] * ca + height(p[2]) * 0.72,
      ]);
    const face = (points, color, stroke = "#342f24") =>
      commands.push({
        layer,
        vertices: vertices(points),
        points: points.map(project),
        color,
        stroke,
        depth: depth(points),
      });
    const stroke = (points, width, color) =>
      commands.push({
        layer,
        vertices: vertices(points),
        points: points.map(project),
        width,
        color,
        depth: depth(points),
      });
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const normalized = (v) => {
      const d = Math.hypot(...v) || 1;
      return v.map((n) => n / d);
    };
    const bar = (
      a,
      b,
      size = 9,
      colors = wood || ["#a58351", "#775935", "#c4a26a"],
    ) => {
      const axis = normalized(b.map((n, i) => n - a[i])),
        u = normalized(
          cross(axis, Math.abs(axis[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1]),
        ),
        v = cross(axis, u);
      const points = [a, b].flatMap((p) =>
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([su, sv]) =>
          p.map((n, i) => n + ((u[i] * su + v[i] * sv) * size) / 2),
        ),
      );
      for (const [i, indices] of [
        [0, [0, 1, 2, 3]],
        [1, [4, 5, 6, 7]],
        [2, [0, 1, 5, 4]],
        [3, [1, 2, 6, 5]],
        [4, [2, 3, 7, 6]],
        [5, [3, 0, 4, 7]],
      ])
        face(
          indices.map((n) => points[n]),
          colors[i % colors.length],
        );
      stroke(
        [
          a.map((n, i) => n + v[i] * size * 0.48),
          b.map((n, i) => n + v[i] * size * 0.48),
        ],
        0.8,
        "#e0bf8c",
      );
    };
    const box = (x, y, z, w, h, d, colors) =>
      bar([x, y, z], [x, y, z + d], Math.min(w, h), colors);
    const wheel = (x, y, z, r, turn = 0, steel = false) => {
      const circle = (offset, radius) =>
        Array.from({ length: 32 }, (_, i) => [
          x + offset,
          y + Math.cos((i * Math.PI) / 16) * radius,
          z + Math.sin((i * Math.PI) / 16) * radius,
        ]);
      face(circle(-3, r), steel ? "#454f49" : "#695033");
      face(circle(3, r), steel ? "#8a967e" : "#bd9561", "#363c30");
      face(circle(3.4, r * 0.67), "#56513b", "#d1b485");
      for (let i = 0; i < 6; i++) {
        const a = turn + (i * Math.PI) / 3;
        stroke(
          [
            [x + 4, y, z],
            [x + 4, y + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85],
          ],
          2,
          steel ? "#c2b381" : "#d0ae77",
        );
      }
      face(circle(4.5, r * 0.17), "#c3b289");
    };
    const cog = (x, y, z, r, turn) => {
      const teeth = Array.from({ length: 48 }, (_, i) => {
        const a = turn + (i * Math.PI) / 24,
          rr = i % 4 < 2 ? r : r * 0.87;
        return [x, y + Math.cos(a) * rr, z + Math.sin(a) * rr];
      });
      face(teeth, "#9b895e", "#343e35");
      wheel(x, y, z, r * 0.83, turn, true);
    };
    const person = (x, y, z, team) => {
      bar([x, y, z + 2], [x, y, z + 14], 6, [
        team === 1 ? "#667555" : "#a48961",
        "#6d674c",
        "#bda37a",
      ]);
      box(x, y, z + 17, 6, 6, 4, ["#b78c66", "#d9b587", "#eed0a0"]);
      for (const sign of [-1, 1])
        stroke(
          [
            [x + sign * 2, y, z + 3],
            [x + sign * 4, y + 2, z],
          ],
          2,
          "#594937",
        );
    };
    return {
      project,
      face,
      stroke,
      bar,
      box,
      wheel,
      cog,
      person,
      setLayer(value) {
        layer = value;
      },
      paint() {
        if (window.CruciataModelRaster) {
          window.CruciataModelRaster.paint(g, commands);
          return;
        }
        commands.sort((a, b) => a.layer - b.layer || a.depth - b.depth);
        for (const c of commands)
          c.width
            ? A.line(g, c.points, c.width, c.color)
            : A.polygon(g, c.points, c.color, c.stroke);
      },
    };
  }
  function drawGreatEngine(g, b, time) {
    const A = window.CruciataArt;
    const elapsed = Number.isFinite(b.lastShot)
      ? Math.max(0, time - b.lastShot)
      : 18;
    const launch = elapsed < 0.7 ? Math.sin((elapsed / 0.7) * Math.PI) : 0;
    const reload = elapsed > 1 && elapsed < 16 ? (elapsed - 1) / 15 : 1;
    const turn = (b.aimAngle ?? -Math.PI / 2) + Math.PI / 2,
      big = b.kind === "colossus";
    g.save();
    g.translate(b.x, b.y);
    // The Colossus is the same machine at twice the size, ringed with gilded
    // buttresses and a second hoop; its crew are real villagers beside it.
    g.scale(big ? 1.4 : 0.7, big ? 1.4 : 0.7);
    // A stationary circular stone drum and toothed bearing support the turret.
    const stoneTop = big ? "#6f7b6c" : "#a7a180",
      stoneSide = big ? "#475246" : "#6f715a",
      stoneEdge = big ? "#262e27" : "#414d3f",
      gold = ["#d7b24a", "#8f7424", "#f5df8a"];
    // The Colossus stands on a taller, darker bastion-stone plinth.
    for (let y = big ? 31 : 17; y >= -4; y -= 7) {
      A.ellipse(g, 0, y, 116, 84, y === -4 ? stoneTop : stoneSide, stoneEdge);
      for (let i = 0; i < 20; i++) {
        const a = (i * Math.PI) / 10;
        A.line(
          g,
          [
            [Math.cos(a) * 115, y + Math.sin(a) * 83],
            [Math.cos(a) * 115, y + 7 + Math.sin(a) * 83],
          ],
          1,
          "#424a39",
        );
      }
    }
    A.ellipse(
      g,
      0,
      -7,
      104,
      75,
      big ? "#2d372f" : "#414e44",
      big ? "#c9a84a" : "#bcb187",
    );
    A.ellipse(
      g,
      0,
      -9,
      89,
      62,
      big ? "#5b5a43" : "#8d825e",
      big ? "#1c2a20" : "#283b2e",
    );
    for (let i = 0; i < 48; i++) {
      const a = (i * Math.PI) / 24;
      A.ellipse(
        g,
        Math.cos(a) * 99,
        -8 + Math.sin(a) * 71,
        2,
        1.6,
        big ? "#d2b25a" : "#c4b681",
      );
    }
    if (big)
      // Crenellations around the rim of the plinth.
      for (let i = 0; i < 36; i++) {
        const a = (i * Math.PI) / 18,
          x = Math.cos(a) * 112,
          y = Math.sin(a) * 81;
        if (y > -30) {
          A.ellipse(g, x, y - 2, 4.5, 3.4, "#5d6a5b", "#232b24");
          A.ellipse(g, x, y - 6, 4.5, 3.4, "#7c897a", "#232b24");
        }
      }
    const m = workshop(
        g,
        turn,
        1,
        big ? ["#5b422b", "#352619", "#7f6040"] : null,
      ),
      steel = big
        ? ["#3b433e", "#202923", "#79826f"]
        : ["#566058", "#303e35", "#a6ac95"];
    // The machine itself is a circular cage on radial bearings. Its tall hoops
    // and inward-sloping uprights establish a round, raised silhouette.
    for (let x = -65; x <= 65; x += 13) {
      const length = Math.sqrt(68 * 68 - x * x);
      m.bar([x, -length, 17], [x, length, 17], 11);
    }
    const ring = (radius, z, size, colors) => {
      for (let i = 0; i < 20; i++) {
        const a = (i * Math.PI) / 10,
          b = ((i + 1) * Math.PI) / 10;
        m.bar(
          [Math.cos(a) * radius, Math.sin(a) * radius, z],
          [Math.cos(b) * radius, Math.sin(b) * radius, z],
          size,
          colors,
        );
      }
    };
    ring(70, 22, 9);
    ring(58, 51, 5, steel);
    ring(49, 78, 8, steel);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4,
        b = a + 0.34;
      m.bar(
        [Math.cos(a) * 68, Math.sin(a) * 68, 22],
        [Math.cos(a) * 47, Math.sin(a) * 47, 78],
        10,
      );
      m.bar(
        [Math.cos(a) * 64, Math.sin(a) * 64, 25],
        [Math.cos(b) * 49, Math.sin(b) * 49, 73],
        5,
      );
      m.bar([0, 0, 20], [Math.cos(a) * 69, Math.sin(a) * 69, 20], 7);
    }
    for (const sign of [-1, 1]) {
      m.bar([sign * 46, -12, 62], [sign * 24, 0, 122], 12);
      m.bar([sign * 46, 12, 62], [sign * 24, 0, 122], 12);
      m.cog(sign * 29, 0, 114, 24, -launch * 2.4 + reload * 4);
      m.cog(sign * 48, 30, 39, 13, reload * 12);
      for (let z = 43; z < 103; z += 7)
        m.stroke(
          [
            [sign * 33, 12, z],
            [sign * 33, 16, z + 4],
            [sign * 33, 12, z + 7],
          ],
          2,
          "#d0c194",
        );
      m.bar([sign * 42, 29, 30], [sign * 42, 29, 50], 6, steel);
    }
    m.bar([-35, 0, 122], [35, 0, 122], 12, steel);
    const theta = -0.55 + launch * 1.9 + (1 - reload) * 0.25;
    const tip = [0, Math.cos(theta) * 102, 122 + Math.sin(theta) * 102];
    const tail = [0, -Math.cos(theta) * 38, 122 - Math.sin(theta) * 38];
    m.bar(tail, tip, 15);
    for (let n = 0; n < 5; n++) {
      const f = n / 5;
      m.bar(
        [-8, tip[1] * f, 122 + (tip[2] - 122) * f],
        [8, tip[1] * f, 122 + (tip[2] - 122) * f],
        3,
        steel,
      );
    }
    // Suspended stone counterweight, with three shaded faces and iron bindings.
    const weightZ = tail[2] - 43;
    for (const x of [-13, 13])
      m.stroke(
        [
          [x, tail[1], tail[2]],
          [x, tail[1], weightZ + 23],
        ],
        3,
        "#c7b78a",
      );
    m.bar([-15, tail[1], weightZ + 12], [15, tail[1], weightZ + 12], 26, [
      "#7d8273",
      "#4e594f",
      "#b7b8a1",
    ]);
    for (const x of [-10, 10])
      m.bar(
        [x, tail[1] - 14, weightZ],
        [x, tail[1] - 14, weightZ + 25],
        3,
        steel,
      );
    const bag = [0, tip[1] + 23 - launch * 30, tip[2] - 20 + launch * 18];
    for (const x of [-8, 8])
      m.stroke(
        [
          [x, tip[1], tip[2]],
          [x, bag[1], bag[2]],
        ],
        2,
        "#dbcda2",
      );
    m.bar([-10, bag[1], bag[2]], [10, bag[1], bag[2]], 12, [
      "#5c442e",
      "#302f24",
      "#b1915e",
    ]);
    if (elapsed > 8 || !Number.isFinite(b.lastShot))
      m.box(0, bag[1], bag[2] + 8, 17, 17, 13, [
        "#747d6e",
        "#454d43",
        "#c0b99b",
      ]);
    const flames = [];
    if (big) {
      const stone = ["#59644f", "#2f3a30", "#85917e"];
      ring(40, 104, 7, gold);
      ring(31, 116, 5, steel);
      // Gilded bands on the throwing arm and a golden crest on the axle.
      for (const f of [0.18, 0.42, 0.66, 0.9])
        m.bar(
          [0, tip[1] * f, 122 + (tip[2] - 122) * f],
          [0, tip[1] * (f + 0.05), 122 + (tip[2] - 122) * (f + 0.05)],
          18,
          gold,
        );
      m.box(0, 0, 118, 16, 16, 12, gold);
      // Gilded bands on the counterweight.
      for (const z of [weightZ + 2, weightZ + 22])
        m.bar([-16, tail[1], z], [16, tail[1], z], 28, gold);
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6 + Math.PI / 12,
          x = Math.cos(a) * 103,
          y = Math.sin(a) * 103;
        m.box(x, y, 0, 17, 17, 44, stone);
        m.box(x, y, 44, 12, 12, 6, gold);
        // Every buttress is braced to the middle hoop by a timber strut.
        m.bar(
          [x * 0.97, y * 0.97, 46],
          [Math.cos(a) * 49, Math.sin(a) * 49, 78],
          6,
        );
        if (i % 3 === 0) {
          m.bar([x, y, 50], [x, y, 128], 3, steel);
          m.box(x, y, 126, 6, 6, 6, gold);
          // The cloth is drawn live (see waveFlag) so it can wave.
        } else {
          // Iron braziers burn atop the remaining buttresses.
          m.box(x, y, 50, 11, 11, 7, steel);
          m.face(
            [
              [x - 4, y, 57],
              [x + 4, y, 57],
              [x + 1, y, 74 + (i % 2) * 5],
            ],
            "#f4872a",
            false,
          );
          m.face(
            [
              [x - 2, y, 57],
              [x + 2, y, 57],
              [x, y, 67],
            ],
            "#ffe08a",
            false,
          );
          flames.push([x, y, 62]);
        }
      }
    } else {
      m.person(-96, 33, 1, b.team);
      m.person(96, 38, 1, b.team);
    }
    m.paint();
    for (const f of flames) {
      const [px, py] = m.project(f);
      A.ellipse(g, px, py, 14, 9, "#ffa83a33");
      A.ellipse(g, px, py, 7, 5, "#ffcf6a4d");
    }
    g.restore();
  }
  function drawSiegeMachine(g, u, time, angle = u.angle || 0) {
    const A = window.CruciataArt,
      m = workshop(
        g,
        angle + Math.PI / 2,
        u.type === "ram" ? 0.65 : u.type === "ballista" ? 0.6 : 1,
      ),
      ram = u.type === "ram";
    const rolling = u.moving
        ? ((Math.round((((time * 5) % (Math.PI / 3)) / (Math.PI / 3)) * 8) %
            8) *
            (Math.PI / 3)) /
          8
        : 0,
      strike = Math.max(0, u.strike || 0);
    A.ellipse(g, 5, 9, ram ? 42 : 40, ram ? 30 : 25, "#29362b44");
    for (const x of [-23, 23])
      for (const y of [-25, 25]) m.wheel(x, y, 8, 8, rolling);
    for (const x of [-19, 19]) m.bar([x, -35, 11], [x, 35, 11], 7);
    for (const y of [-26, 24]) m.bar([-27, y, 10], [27, y, 10], 6);
    if (ram) {
      for (const x of [-20, 20])
        for (const y of [-31, 31]) m.bar([x, y, 12], [x, y, 43], 5);
      // Sloped protective hide roof, iron rivets and a hanging impact log.
      m.setLayer(1);
      m.face(
        [
          [-25, -40, 43],
          [0, -40, 58],
          [0, 40, 58],
          [-25, 40, 43],
        ],
        u.team === 1 ? "#51674d" : "#a66d45",
        "#564b32",
      );
      m.face(
        [
          [0, -40, 58],
          [25, -40, 43],
          [25, 40, 43],
          [0, 40, 58],
        ],
        u.team === 1 ? "#819373" : "#c59a65",
        "#514633",
      );
      for (let y = -34; y <= 35; y += 12)
        m.bar([-25, y, 44], [0, y, 59], 2, ["#53584a", "#333f32", "#b7ad83"]);
      m.setLayer(0);
      for (const y of [-24, 24])
        m.stroke(
          [
            [0, y, 48],
            [0, y, 25],
          ],
          2,
          "#c1b28a",
        );
      const swing = (Math.round(Math.sin(time * 8) * 12) / 12) * strike * 11;
      m.bar([0, -49 - swing, 25], [0, 35 - swing, 25], 12);
      m.bar([-8, -50 - swing, 25], [8, -50 - swing, 25], 14, [
        "#647167",
        "#364439",
        "#c5c3a3",
      ]);
      for (const x of [-6, 6])
        m.bar([x, -50 - swing, 25], [x, -59 - swing, 29], 3, [
          "#8c927b",
          "#414d40",
          "#ddd0a7",
        ]);
      for (const y of [-35, -10, 17])
        m.bar([-7, y - swing, 25], [7, y - swing, 25], 3, [
          "#707666",
          "#343f33",
          "#c4b993",
        ]);
      m.person(-31, 17, 0, u.team);
      m.person(31, 19, 0, u.team);
    } else if (u.type === "ballista") {
      for (let x = -17; x <= 17; x += 7) m.bar([x, -24, 17], [x, 26, 17], 6);
      for (const x of [-17, 17]) {
        m.bar([x, -20, 18], [x, -20, 41], 9);
        for (let z = 23; z <= 37; z += 3)
          m.stroke(
            [
              [x - 4, -25, z],
              [x + 4, -25, z],
            ],
            1.4,
            "#d7c7a1",
          );
        m.bar([x, -20, 41], [x * 2, -31, 37], 5);
        m.bar([x * 2, -31, 37], [x * 2.6, -14, 31], 5);
      }
      const nock = 17 - strike * 36;
      m.stroke(
        [
          [-44, -14, 31],
          [0, nock, 33],
          [44, -14, 31],
        ],
        1.5,
        "#e1d7b4",
      );
      m.bar([0, -40, 25], [0, 28, 25], 8);
      m.bar([0, -58, 33], [0, 17, 33], 2, ["#a69772", "#655c43", "#e1d1a4"]);
      m.face(
        [
          [0, -64, 33],
          [-4, -53, 33],
          [4, -53, 33],
        ],
        "#c3ccba",
        "#3b4e40",
      );
      m.face(
        [
          [-4, 12, 33],
          [0, 5, 33],
          [4, 12, 33],
          [0, 17, 33],
        ],
        u.team === 1 ? "#819373" : "#caa779",
      );
      m.cog(19, 22, 23, 7, strike * 5);
      m.stroke(
        [
          [0, nock, 33],
          [0, 25, 26],
        ],
        1,
        "#bbb08b",
      );
      m.person(-28, 24, 0, u.team);
      m.person(27, 25, 0, u.team);
    } else {
      const unfold =
        u.deployment === "deployed"
          ? 1
          : u.deployment === "setting-up"
            ? Math.max(0, 1 - (u.deployTimer || 0) / 6)
            : u.deployment === "packing"
              ? Math.min(1, (u.deployTimer || 0) / 4)
              : 0;
      const pivot = 24 + unfold * 31;
      for (let x = -14; x <= 14; x += 7) m.bar([x, -32, 17], [x, 32, 17], 5);
      for (const sign of [-1, 1]) {
        m.bar([sign * 20, -26, 13], [sign * 10, 0, pivot], 7);
        m.bar([sign * 20, 26, 13], [sign * 10, 0, pivot], 7);
        m.bar(
          [sign * (22 + unfold * 7), 31, 8],
          [sign * 12, 0, pivot * 0.8],
          4,
        );
        m.wheel(sign * (22 + unfold * 7), 31, 4, 4, 0);
        m.cog(sign * 15, 0, pivot - 6, 9, strike * 3);
      }
      m.bar([-18, 0, pivot], [18, 0, pivot], 6, [
        "#697565",
        "#384c3b",
        "#c4c6aa",
      ]);
      const theta = -0.48 + strike * 1.5,
        tip = [
          0,
          Math.cos(theta) * (37 + unfold * 14),
          pivot + Math.sin(theta) * (37 + unfold * 14),
        ];
      const weight = [0, -Math.cos(theta) * 19, pivot - Math.sin(theta) * 19];
      m.bar(weight, tip, 7);
      m.bar(
        [-7, weight[1], weight[2] - 12],
        [7, weight[1], weight[2] - 12],
        13,
        ["#788072", "#4e5d4e", "#b9b69b"],
      );
      m.stroke([weight, [0, weight[1], weight[2] - 9]], 2, "#cfbf92");
      for (const x of [-4, 4])
        m.stroke(
          [
            [x, tip[1], tip[2]],
            [x, tip[1] + 12, tip[2] - 10],
          ],
          1.3,
          "#dac69a",
        );
      m.box(0, tip[1] + 12, tip[2] - 12, 8, 8, 8, [
        "#767e71",
        "#48594b",
        "#b4b79e",
      ]);
      m.cog(
        16,
        25,
        20,
        6,
        u.deployment === "setting-up" || u.deployment === "packing"
          ? ((Math.round((((time * 4) % (Math.PI / 3)) / (Math.PI / 3)) * 8) %
              8) *
              (Math.PI / 3)) /
              8
          : 0,
      );
      m.person(-29, 20, 0, u.team);
      m.person(29, 22, 0, u.team);
    }
    m.paint();
  }
  const spriteCache = new Map();
  let spritePixels = 0;
  const cacheMetrics = { hits: 0, misses: 0 };
  function sprite(g, object, key, width, height, origin, draw) {
    if (
      globalThis.CruciataAtlas?.draw(
        g,
        "siege:" + key,
        width,
        height,
        ...origin,
      )
    )
      return;
    if (
      globalThis.CruciataBakeSprite?.(
        "siege:" + key,
        width,
        height,
        ...origin,
        draw,
      )
    )
      return;
    const transform = g.getTransform();
    const resolution = Math.min(
      4,
      Math.max(1, Math.ceil(Math.hypot(transform.a, transform.b))),
    );
    key += ":" + resolution + ":" + width + ":" + height;
    let entry = spriteCache.get(key);
    if (!entry) {
      cacheMetrics.misses++;
      const canvas = document.createElement("canvas");
      canvas.width = width * resolution;
      canvas.height = height * resolution;
      const cg = canvas.getContext("2d");
      cg.scale(resolution, resolution);
      cg.translate(...origin);
      draw(cg);
      entry = { key, canvas };
      const area = canvas.width * canvas.height;
      while (
        spriteCache.size &&
        (spriteCache.size >= 128 || spritePixels + area > 8000000)
      ) {
        const first = spriteCache.keys().next().value,
          old = spriteCache.get(first);
        spritePixels -= old.canvas.width * old.canvas.height;
        spriteCache.delete(first);
      }
      spritePixels += area;
      spriteCache.set(key, entry);
    } else {
      cacheMetrics.hits++;
      spriteCache.delete(key);
      spriteCache.set(key, entry);
    }
    g.drawImage(entry.canvas, -origin[0], -origin[1], width, height);
  }
  // Faction banners are drawn live, not baked into the machine sprite: a flat
  // flag (Jerusalem cross on red, crescent on green) cached once per side and
  // drawn in vertical strips that ripple like the building banners.
  const flatFlags = {};
  function flatFlag(team) {
    const key = team === 1 ? 1 : 0;
    if (flatFlags[key]) return flatFlags[key];
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 84;
    const q = c.getContext("2d"),
      cream = "#efe2bf";
    q.fillStyle = key ? "#2b6a4e" : "#a3342a";
    q.fillRect(0, 0, 120, 84);
    q.strokeStyle = "#1b1410";
    q.lineWidth = 3;
    q.strokeRect(1.5, 1.5, 117, 81);
    q.fillStyle = cream;
    q.strokeStyle = cream;
    const bar = (x, y, w, h) => q.fillRect(x - w / 2, y - h / 2, w, h),
      potent = (x, y, len, t) => {
        // A cross with crossbars on every arm.
        bar(x, y, t, len * 2);
        bar(x, y, len * 2, t);
        for (const [dx, dy] of [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ]) {
          const ex = x + dx * len,
            ey = y + dy * len;
          if (dx) bar(ex, ey, t * 0.9, t * 2.4);
          else bar(ex, ey, t * 2.4, t * 0.9);
        }
      };
    if (key) {
      q.beginPath();
      q.arc(52, 42, 24, 0, Math.PI * 2);
      q.fill();
      q.fillStyle = "#2b6a4e";
      q.beginPath();
      q.arc(60, 42, 21, 0, Math.PI * 2);
      q.fill();
      q.fillStyle = cream;
      q.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 4.5 : 10,
          a = -Math.PI / 2 + (i * Math.PI) / 5;
        q.lineTo(80 + Math.cos(a) * r, 42 + Math.sin(a) * r);
      }
      q.fill();
    } else {
      // Jerusalem cross: a great cross potent with four small crosses.
      potent(60, 42, 21, 8);
      for (const [x, y] of [
        [34, 20],
        [86, 20],
        [34, 64],
        [86, 64],
      ])
        potent(x, y, 7, 3);
    }
    return (flatFlags[key] = c);
  }
  function waveFlag(g, x, y, team, time, w, h) {
    const flag = flatFlag(team),
      strips = 16,
      gust = 0.75 + Math.sin(time * 0.57) * 0.18 + Math.sin(time * 0.23) * 0.1,
      sw = flag.width / strips;
    for (let i = 0; i < strips; i++) {
      const t = i / strips,
        wave =
          (Math.sin(time * 2.1 - t * 5.4) * 3 +
            Math.sin(time * 3.3 - t * 9) * 0.9) *
          t *
          gust,
        drop = t * 3;
      g.drawImage(
        flag,
        i * sw,
        0,
        sw,
        flag.height,
        x + t * w,
        y + wave,
        w / strips + 0.7,
        h - drop,
      );
      const light = Math.cos(time * 2.6 - t * 6);
      g.fillStyle =
        light > 0
          ? `rgba(255,239,209,${(light * 0.14).toFixed(3)})`
          : `rgba(0,0,0,${(-light * 0.14).toFixed(3)})`;
      g.fillRect(x + t * w, y + wave, w / strips + 0.7, h - drop);
    }
  }
  function greatEngine(g, b, time) {
    // The Colossus bakes fewer reload poses: its sprites are four times larger.
    const big = b.kind === "colossus",
      step = big ? 1 : 2;
    let elapsed = Number.isFinite(b.lastShot)
      ? Math.max(0, time - b.lastShot)
      : 18;
    elapsed =
      elapsed < 1
        ? Math.floor(elapsed * 12) / 12
        : elapsed < 16
          ? Math.floor(elapsed * step) / step
          : 18;
    const angle =
      (Math.round(((b.aimAngle ?? -Math.PI / 2) * 8) / Math.PI) * Math.PI) / 8;
    b = {
      ...b,
      aimAngle: angle,
      lastShot: elapsed === 18 ? undefined : time - elapsed,
    };
    const pose =
      elapsed < 1
        ? "fire-" + Math.floor(elapsed * 12)
        : elapsed < 16
          ? "reload-" + Math.floor(elapsed * step)
          : "ready";
    g.save();
    g.translate(b.x, b.y);
    sprite(
      g,
      b,
      `${big ? "colossus:" : ""}${b.team}:${Math.round(((b.aimAngle ?? -Math.PI / 2) * 180) / Math.PI)}:${pose}`,
      big ? 420 : 300,
      big ? 660 : 340,
      big ? [210, 500] : [150, 240],
      (cg) => drawGreatEngine(cg, { ...b, x: 0, y: 0 }, time),
    );
    if (big) {
      // Four banner poles stand on the buttresses; their flags wave live.
      const turn = (b.aimAngle ?? -Math.PI / 2) + Math.PI / 2,
        ca = Math.cos(turn),
        sa = Math.sin(turn);
      for (const i of [0, 3, 6, 9]) {
        const a = (i * Math.PI) / 6 + Math.PI / 12,
          x = Math.cos(a) * 103,
          y = Math.sin(a) * 103;
        waveFlag(
          g,
          (x * ca - y * sa) * 1.4,
          ((x * sa + y * ca) * 0.72 - 124) * 1.4,
          b.team,
          time,
          52,
          36,
        );
      }
    }
    g.restore();
  }
  function siegeMachine(g, u, time, angle = u.angle || 0) {
    angle =
      (Math.round(
        (Math.atan2(Math.sin(angle), Math.cos(angle)) * 8) / Math.PI,
      ) *
        Math.PI) /
      8;
    const deploying = ["setting-up", "packing"].includes(u.deployment),
      track = deploying
        ? u.deployment
        : u.moving
          ? "walk"
          : u.strike > 0
            ? "attack"
            : u.deployment === "deployed"
              ? "deployed"
              : "idle",
      frame = deploying
        ? Math.round((u.deployTimer || 0) * 2)
        : u.moving
          ? Math.floor(time * 24) % 8
          : u.strike > 0
            ? Math.round(u.strike * 8)
            : 0,
      cycleTime =
        track === "walk"
          ? ((frame / 8) * Math.PI) / 15
          : ((frame / 8) * Math.PI) / 4;
    u = {
      ...u,
      strike: track === "attack" ? frame / 8 : 0,
      deployTimer: deploying ? frame / 2 : 0,
    };
    sprite(
      g,
      u,
      `machine:${u.type}:${u.team}:${Math.round((angle * 180) / Math.PI)}:${track}:${frame}`,
      160,
      180,
      [80, 120],
      (cg) => drawSiegeMachine(cg, u, cycleTime, angle),
    );
  }
  window.CruciataSiegeArt = {
    greatEngine,
    siegeMachine,
    cacheStats: () => ({
      entries: spriteCache.size,
      pixels: spritePixels,
      ...cacheMetrics,
    }),
  };
})();
