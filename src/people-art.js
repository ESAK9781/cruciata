/* Painted human animation masters. Curves and material detail survive atlas baking. */
(() => {
  "use strict";
  function draw(g, u, phase, angle, action = "idle") {
    const order = window.CruciataOrders?.style(u.team),
      team = order
        ? order.field
        : u.team === 1
          ? "#2c795f"
          : u.team === 0
            ? "#ad3c30"
            : "#a48c52",
      islamic = u.team === 1,
      civilian = ["worker", "civilian"].includes(u.type),
      priest = u.type === "chaplain",
      mounted = u.type === "knight",
      armor = !civilian && !priest,
      cloth = civilian
        ? islamic
          ? "#c8ac79"
          : "#b6a282"
        : priest
          ? "#ded2b2"
          : team,
      swing = Math.sin(phase),
      riderSwing = mounted && action === "walk" ? 0 : swing,
      move = action === "walk" && !mounted ? swing : 0,
      work = !["idle", "walk", "attack"].includes(action),
      bend = work
        ? (1 - Math.cos(phase)) * 1.8
        : mounted && action === "walk"
          ? Math.sin(phase * 2) * 0.7
          : 0,
      base = mounted ? -12 : 0,
      facing = Math.sin(angle),
      side = Math.cos(angle),
      front = Math.sin(angle) > -0.35;
    const ellipse = (x, y, rx, ry, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    };
    function line(points, width, color) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    function shape(points, color) {
      g.fillStyle = color;
      g.beginPath();
      points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    }
    function shaded(x, y, rx, ry, light, dark) {
      const grad = g.createRadialGradient(
        x - rx * 0.4,
        y - ry * 0.4,
        0,
        x,
        y,
        Math.max(rx, ry),
      );
      grad.addColorStop(0, light);
      grad.addColorStop(1, dark);
      ellipse(x, y, rx, ry, grad);
    }
    if (mounted) {
      const hx = side * 17,
        gait = (action === "walk" ? swing : 0) * 2.2,
        coat = islamic ? "#79543b" : "#8b6040",
        lightCoat = islamic ? "#ad8058" : "#bd8e60";
      // Build a horse with a distinct barrel, shoulder, hindquarters and raised neck.
      shaded(-4, -19, 14, 8, lightCoat, "#684832");
      shaded(-13, -20, 8, 8, "#aa7951", "#65452f");
      shaded(7, -20, 8, 9, lightCoat, "#65452f");
      shaded(hx - side * 2, -29, 5.5, 12, lightCoat, "#65452f");
      shape(
        [
          [hx - side * 5, -36],
          [hx - side * 2, -40],
          [hx + side * 7, -37],
          [hx + side * 8, -33],
          [hx + side * 2, -31],
          [hx - side * 3, -32],
        ],
        coat,
      );
      ellipse(hx + side * 8, -34, 1.5, 1.1, "#201b17");
      for (const s of [-1, 1]) {
        shape(
          [
            [hx + s * 1.5, -38],
            [hx + s * 2.2, -44],
            [hx + s * 4, -39],
          ],
          coat,
        );
        ellipse(hx + s * 2.7, -39.5, 0.65, 1.4, "#4b3327");
      }
      // Mane, bridle, cheek strap and flowing tail give the profile a clear silhouette.
      line(
        [
          [hx - side * 5, -37],
          [hx - side * 6, -31],
          [hx - side * 5, -24],
        ],
        2.7,
        "#392922",
      );
      line(
        [
          [hx + side * 6, -35],
          [hx + side * 1, -28],
          [hx - side * 4, -26],
        ],
        1.1,
        "#463328",
      );
      line(
        [
          [hx + side * 7, -35],
          [hx + side * 3, -30],
          [hx + side * 1, -23],
        ],
        0.9,
        "#c39a68",
      );
      line(
        [
          [-side * 19, -20],
          [-side * 23, -13],
          [-side * 22, -7],
          [-side * 19, -5],
        ],
        2.5,
        "#493427",
      );
      // Alternating articulated legs move with the horse; the rider remains seated.
      for (const [x, fore] of [
        [-10, false],
        [-5, false],
        [7, true],
        [12, true],
      ]) {
        const phase = gait * (fore ? 1 : -1) * (x < 0 ? -1 : 1),
          knee = (fore ? -2 : 1) + phase,
          hoof = (fore ? 1 : -1) * phase * 1.6;
        line(
          [
            [x, -17],
            [x + knee * 0.45, -9 - Math.max(0, phase)],
            [x + knee, -3 + hoof],
            [x + knee, 0 + hoof],
          ],
          2.7,
          "#654832",
        );
        line(
          [
            [x + knee - 1.1, 0 + hoof],
            [x + knee + 1.6, 0 + hoof],
          ],
          1.5,
          "#302a23",
        );
      }
      // Padded saddle, blanket, girth and stirrups sit below the rider's hips.
      shape(
        [
          [-13, -23],
          [-10, -27],
          [-3, -28],
          [8, -27],
          [12, -24],
          [13, -19],
          [9, -15],
          [-10, -15],
          [-14, -19],
        ],
        team,
      );
      line(
        [
          [-11, -17],
          [-4, -16],
          [7, -16],
          [10, -18],
        ],
        1.1,
        "#d9c28d",
      );
      line(
        [
          [-12, -23],
          [-7, -26],
          [5, -26],
          [11, -23],
        ],
        1,
        "#e0c78f",
      );
      if (!islamic) {
        line(
          [
            [0, -24],
            [0, -18],
          ],
          0.9,
          "#f0dfb5",
        );
        line(
          [
            [-2.5, -21],
            [2.5, -21],
          ],
          0.9,
          "#f0dfb5",
        );
      } else {
        line(
          [
            [-8, -20],
            [8, -20],
          ],
          0.8,
          "#d9bb75",
        );
      }
      shape(
        [
          [-8, -27],
          [7, -27],
          [10, -23],
          [-11, -23],
        ],
        "#49382b",
      );
      line(
        [
          [-10, -22],
          [-11, -11],
          [-8, -10],
        ],
        1.2,
        "#49382b",
      );
      line(
        [
          [8, -22],
          [10, -11],
          [13, -10],
        ],
        1.2,
        "#49382b",
      );
      line(
        [
          [-11, -10],
          [-7, -10],
        ],
        1.7,
        "#b99760",
      );
      line(
        [
          [9, -10],
          [14, -10],
        ],
        1.7,
        "#b99760",
      );
    }
    g.save();
    g.translate(mounted ? side * 2 : 0, base + bend);
    // Articulated calves, leather boots, hem and natural shoulder contour.
    for (const s of [-1, 1]) {
      if (mounted) {
        // Thighs angle down from the saddle; boots stay planted in the stirrups.
        line(
          [
            [s * 4, -13],
            [s * 10, -12],
            [s * 14, -7],
          ],
          4.4,
          "#756047",
        );
        line(
          [
            [s * 14, -7],
            [s * 13, 0],
            [s * 12, 4],
          ],
          3.4,
          "#59665b",
        );
        line(
          [
            [s * 12, 2],
            [s * 12, 4],
            [s * 15, 4],
          ],
          3.4,
          "#493b2d",
        );
      } else {
        const stride = move * s * 3;
        line(
          [
            [s * 3, -15],
            [s * 3 + stride * 0.5, -8],
            [s * 3 - stride, -2],
          ],
          3.4,
          priest ? "#c1b693" : "#75654e",
        );
        ellipse(s * 3 - stride + side, -1, 2.5, 1.6, "#483f32");
      }
    }
    const body = g.createLinearGradient(-6, -29, 7, -15);
    body.addColorStop(0, armor ? "#b1b7ab" : cloth);
    body.addColorStop(1, armor ? "#657369" : "#877354");
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-4, -29);
    g.bezierCurveTo(-9, -28, -7, -22, -7, -14);
    g.quadraticCurveTo(0, -11, 7, -14);
    g.bezierCurveTo(6, -22, 9, -28, 4, -29);
    g.closePath();
    g.fill();
    if (armor) {
      // Small interleaved chain rings, rather than a flat gray block.
      for (let y = -27; y < -15; y += 2)
        for (let x = -5 + (y % 4 === 0 ? 1 : 0); x < 6; x += 2)
          ellipse(x, y, 0.48, 0.65, (x + y) % 3 ? "#c0c4b4" : "#4e5f57");
      shape(
        [
          [-3, -29],
          [3, -29],
          [4, -13],
          [-4, -13],
        ],
        u.rank > 0 && !islamic && !order ? "#ddd5b9" : team,
      );
      if (order) window.CruciataOrders.emblem(g, 0, -21, 3.7, u.team);
      else if (!islamic) {
        line(
          [
            [0, -25],
            [0, -18],
          ],
          0.9,
          "#f0dfb5",
        );
        line(
          [
            [-2, -23],
            [2, -23],
          ],
          0.9,
          "#f0dfb5",
        );
      }
      if (u.rank > 0)
        line(
          [
            [-5, -14],
            [5, -14],
          ],
          1,
          "#cfb36a",
        );
    } else {
      for (const x of [-3, 0, 3])
        line(
          [
            [x, -24],
            [x * 0.8, -14],
          ],
          0.55,
          "#8d7c60",
        );
      if (civilian)
        shape(
          [
            [-4, -23],
            [4, -23],
            [5, -12],
            [-5, -12],
          ],
          "#d7c6a2",
        );
    }
    line(
      [
        [-6, -16],
        [6, -16],
      ],
      1.3,
      "#68543b",
    );
    ellipse(1, -16, 1, 1, "#c6ac69");
    const armY = work
        ? -23 - Math.cos(phase) * 7
        : -24 + (action === "attack" ? riderSwing * 6 : move * 2),
      armX = work ? 8 + Math.sin(phase) * 3 : 8;
    for (const s of [-1, 1]) {
      line(
        [
          [s * 6, -27],
          [s * 8, -22],
          [s * armX, armY],
        ],
        3.2,
        armor ? "#87958a" : cloth,
      );
      ellipse(s * armX, armY, 1.8, 1.6, "#cda275");
    }
    shaded(0, -32, 3, 4, "#dfba8a", "#a57a53");
    shaded(side * 0.5, -36, 4.2, 5, "#e1ba88", "#b28a61");
    if (front) {
      line(
        [
          [-1.9 + side, -36],
          [-1.2 + side, -36],
        ],
        0.6,
        "#423f33",
      );
      line(
        [
          [1.3 + side, -36],
          [2 + side, -36],
        ],
        0.6,
        "#423f33",
      );
      line(
        [
          [side, -35],
          [side + 0.7, -33.7],
        ],
        0.6,
        "#8e694b",
      );
      line(
        [
          [-1, -32.3],
          [1.5, -32.3],
        ],
        0.6,
        "#865c43",
      );
    }
    if (armor) {
      shaded(
        0,
        -39,
        4.8,
        3.8,
        islamic ? "#d4c7a2" : "#c4ccc0",
        islamic ? "#8e9176" : "#68786f",
      );
      if (islamic) {
        for (let y = -40; y < -36; y += 1.5)
          line(
            [
              [-4, y],
              [4, y - 0.6],
            ],
            0.8,
            "#d7d0ad",
          );
        shape(
          [
            [-4, -37],
            [-5, -29],
            [-2, -30],
            [-2, -37],
          ],
          "#d6c8a4",
        );
      } else {
        line(
          [
            [0, -42],
            [0, -37],
          ],
          0.65,
          "#e1e6d7",
        );
        if (front)
          line(
            [
              [0, -37],
              [0, -33],
            ],
            1,
            "#9ba89e",
          );
      }
    } else if (priest) {
      ellipse(0, -39, 4.7, 2.5, "#dfd3b6");
      line(
        [
          [-4, -37],
          [-5, -29],
        ],
        1.6,
        "#c7ba98",
      );
    } else {
      ellipse(0, -40, 4.7, 1.8, islamic ? "#d2c3a0" : "#8b7653");
      if (islamic)
        line(
          [
            [-4, -39],
            [4, -40],
          ],
          1.2,
          "#e2d5b3",
        );
    }
    if (u.type === "sword" || mounted) {
      if (islamic) shaded(-8, -23, 5.3, 6.3, "#bcb597", team);
      else
        shape(
          [
            [-13, -29],
            [-4, -29],
            [-4, -22],
            [-8, -16],
            [-12, -22],
          ],
          team,
        );
      if (islamic) {
        // Muslim shields bear a crescent and star, never a cross.
        g.save();
        g.strokeStyle = "#eadbb6";
        g.lineWidth = 1.1;
        g.beginPath();
        g.arc(-8.6, -23, 3.3, 0.75, Math.PI * 2 - 0.75);
        g.stroke();
        g.fillStyle = "#eadbb6";
        g.beginPath();
        g.arc(-6.6, -23, 1, 0, Math.PI * 2);
        g.fill();
        g.restore();
      } else if (order) {
        window.CruciataOrders.emblem(g, -8, -22.5, 4.2, u.team);
      } else {
        line(
          [
            [-8, -27],
            [-8, -20],
          ],
          1,
          "#eadbb6",
        );
        line(
          [
            [-11, -25],
            [-5, -25],
          ],
          1,
          "#eadbb6",
        );
      }
      line(
        [
          [8, armY],
          [12 + riderSwing * 2, armY - 16],
        ],
        1.5,
        "#d2d8cb",
      );
      line(
        [
          [5, armY - 3],
          [12, armY - 2],
        ],
        1.2,
        "#bc9d59",
      );
    } else if (u.type === "archer") {
      g.strokeStyle = "#9d7549";
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(-10, -25, 5, 12, 0, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      line(
        [
          [-10, -37],
          [-7 + (action === "attack" ? swing * 3 : 0), -25],
          [-10, -13],
        ],
        0.55,
        "#e4d4b4",
      );
      line(
        [
          [6, -28],
          [7, -38],
        ],
        3,
        "#755536",
      );
      for (let i = 0; i < 3; i++) {
        line(
          [
            [6 + i, -35],
            [6 + i, -43],
          ],
          0.6,
          "#c2ab7f",
        );
        line(
          [
            [6 + i, -42],
            [5 + i, -43],
          ],
          0.8,
          "#d5c9aa",
        );
      }
      if (u.rank > 0)
        line(
          [
            [-15, -26],
            [-5, -26],
          ],
          2,
          "#795431",
        );
    } else if (priest) {
      line(
        [
          [10, 0],
          [10, -47],
        ],
        1.6,
        "#806141",
      );
      line(
        [
          [7, -43],
          [13, -43],
        ],
        1.4,
        "#cfb06b",
      );
      line(
        [
          [-3, -25],
          [-2, -13],
        ],
        1,
        "#c7ad6d",
      );
    } else if (civilian && (work || u.type === "worker")) {
      const tx = armX,
        ty = armY;
      if (!work) {
        // Carry tools down beside the leg while travelling. The harvesting
        // arc belongs only to stationary work, never to the walk cycle.
        line(
          [
            [tx, ty - 1],
            [tx + 2, ty + 12],
          ],
          1.4,
          "#957047",
        );
        line(
          [
            [tx - 2, ty + 11],
            [tx + 5, ty + 12],
          ],
          1.8,
          "#9ca99d",
        );
      } else if (action === "berries") {
        shaded(9, -4, 5, 3, "#c4a16c", "#8f714b");
        for (let i = 0; i < 6; i++)
          ellipse(6 + (i % 3) * 2, -5 - Math.floor(i / 3), 0.9, 0.8, "#b34a38");
        line(
          [
            [tx, ty],
            [tx + 4, ty + 3],
          ],
          1.3,
          "#cda275",
        );
      } else if (action === "food") {
        g.strokeStyle = "#b2beb0";
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(tx + 2, ty - 4, 5, Math.PI, Math.PI * 1.9);
        g.stroke();
        line(
          [
            [tx, ty],
            [tx - 2, ty + 4],
          ],
          1.5,
          "#8b6540",
        );
        for (let i = 0; i < 4; i++)
          line(
            [
              [-9 + i, -1],
              [-8 + i, -8],
            ],
            0.65,
            "#cfb164",
          );
      } else {
        line(
          [
            [tx, ty + 3],
            [tx + Math.sin(phase) * 7, ty - 13],
          ],
          1.4,
          "#957047",
        );
        const hx = tx + Math.sin(phase) * 7,
          hy = ty - 13;
        if (action === "wood")
          shape(
            [
              [hx - 1, hy - 3],
              [hx + 5, hy - 4],
              [hx + 6, hy + 2],
              [hx, hy + 1],
            ],
            "#a2b1a5",
          );
        else
          line(
            [
              [hx - 6, hy + 1],
              [hx, hy - 2],
              [hx + 6, hy + 1],
            ],
            2,
            "#9ca99d",
          );
        if (work && swing < -0.6)
          for (let i = 0; i < 4; i++)
            ellipse(
              tx + 3 + i * 2,
              -2 - (i % 2) * 3,
              0.8,
              0.6,
              action === "gold"
                ? "#d8b864"
                : action === "wood"
                  ? "#bb9362"
                  : "#b1b4a8",
            );
      }
    }
    if (u.carry > 0) {
      shaded(-6, -19, 4, 6, "#bb9965", "#80633f");
      for (let y = -23; y < -14; y += 2)
        line(
          [
            [-9, y],
            [-3, y],
          ],
          0.5,
          "#d0b17c",
        );
    }
    g.restore();
  }
  window.CruciataPeopleArt = { draw };
})();
