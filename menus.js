/* Local menus and the campaign atlas. No account or network is required. */
(() => {
  "use strict";
  const game = window.cruciata;
  const cross =
    '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="7"><path d="M50 13v74M13 50h74M38 13h24M38 87h24M13 38v24M87 38v24"/><path stroke-width="5" d="M26 18v16M18 26h16M74 18v16M66 26h16M26 66v16M18 74h16M74 66v16M66 74h16"/></g></svg>';
  const shell = document.getElementById("front-menu");
  const mainMarkup = shell.innerHTML;
  let activeSlot = 0,
    firstVisit = true;
  const presets = {
    frontier: {
      width: 12800,
      height: 8800,
      frequency: 0.45,
      resources: 500,
      units: 8,
      structures: "settlement",
      difficulty: "normal",
    },
    siege: {
      width: 16000,
      height: 10800,
      frequency: 0.65,
      resources: 1400,
      units: 30,
      structures: "developed",
      difficulty: "hard",
    },
    scarcity: {
      width: 12800,
      height: 8800,
      frequency: 0.3,
      resources: 280,
      units: 4,
      structures: "settlement",
      difficulty: "normal",
    },
    empire: {
      width: 19200,
      height: 12800,
      frequency: 0.8,
      resources: 900,
      units: 20,
      structures: "developed",
      difficulty: "hard",
    },
  };
  function frame(title, subtitle, content) {
    shell.hidden = false;
    shell.innerHTML = `<div class="menu-vignette"></div><div class="menu-body"><div class="menu-brand">${cross}<div>cruciāta<small>CHRONICA · FIDES · IMPERIUM</small></div></div><div class="eyebrow">${subtitle}</div><h1>${title}</h1>${content}<div class="menu-foot">A fictional chronicle of the First Crusade · Local saves · Original overhead artwork</div></div>`;
  }
  function bind(id, fn) {
    document.getElementById(id)?.addEventListener("click", fn);
  }
  function hide() {
    shell.hidden = true;
  }
  function saved(slot) {
    try {
      return JSON.parse(
        localStorage.getItem("cruciata-quickmatch-" + slot) || "null",
      );
    } catch {
      return null;
    }
  }
  function main() {
    if (!firstVisit) game.menu();
    firstVisit = false;
    shell.hidden = false;
    shell.innerHTML = mainMarkup;
    shell.removeAttribute("aria-busy");
    shell.querySelectorAll("button").forEach((button) => {
      button.disabled = false;
    });
    bind("open-campaign", campaign);
    bind("open-quickmatch", slots);
    bind("resume-campaign", () => {
      if (game.resume(null)) hide();
      else campaign();
    });
    bind("menu-settings", () =>
      document.getElementById("settings-button").click(),
    );
  }
  // Equirectangular atlas: x longitude scaled by cos(34°), y latitude.
  // Geography is a coastal outline, not a diagram of the fictional mission battlefields.
  const project = (lon, lat) => [
    70 + (lon - 34) * 120 * Math.cos((34 * Math.PI) / 180),
    50 + (37 - lat) * 112,
  ];
  let coastline = null,
    landPolygons = null;
  fetch("assets/maps/levant-coast.json")
    .then((r) => r.json())
    .then((data) => {
      coastline = data.coast;
      landPolygons = data.land;
      if (document.getElementById("campaign-difficulty")) campaign();
    })
    .catch(() => {});
  const locations = [
    [35.96, 36.08],
    [36.12, 36.2],
    [36.16, 36.2],
    [35.84, 34.44],
    [35.23, 31.84],
    [35.23, 31.78],
  ];
  const atlasStops = [
    [258, 108],
    [300, 167],
    [275, 228],
    [255, 370],
    [220, 550],
    [202, 640],
  ];
  function campaign() {
    const difficulty =
      document.getElementById("campaign-difficulty")?.value || "normal";
    const progress = game.campaign();
    const coast = [
      [35.1, 37],
      [35.7, 36.7],
      [35.9, 36.35],
      [35.78, 36.05],
      [35.9, 35.55],
      [35.8, 35.1],
      [35.65, 34.7],
      [35.84, 34.44],
      [35.5, 34.0],
      [35.48, 33.9],
      [35.22, 33.3],
      [35.08, 32.8],
      [34.86, 32.3],
      [34.5, 31.6],
      [34.2, 31.2],
      [33.6, 31.1],
    ];
    const mappedCoast = coastline
      ? coastline.reduce((a, b) => (a.length > b.length ? a : b))
      : coast;
    const points = mappedCoast.map((p) => project(...p).join(",")).join(" ");
    const route = atlasStops.map((p) => p.join(",")).join(" ");
    const next = progress.activeLevel ?? progress.nextLevel;
    const here = atlasStops[next];
    const before = atlasStops[Math.max(0, next - 1)];
    const army =
      progress.completed.length === 6 || progress.activeLevel !== null
        ? [here[0] - 28, here[1] - 8]
        : next === 0
          ? [here[0] - 30, here[1] - 8]
          : [
              before[0] + (here[0] - before[0]) * 0.68,
              before[1] + (here[1] - before[1]) * 0.68,
            ];
    const landMarkup = landPolygons
      ? landPolygons
          .map(
            (poly) =>
              `<polygon points="${poly.map((p) => project(...p).join(",")).join(" ")}"/>`,
          )
          .join("")
      : `<polygon points="${points} 440,710 440,0 0,0"/>`;
    const banner = `<g id="army-standard" data-next-level="${next}" transform="translate(${army.join(" ")})"><ellipse cx="3" cy="8" rx="12" ry="4" fill="#53412277"/><path d="M0 10V-37" stroke="#e3c881" stroke-width="2.5"/><g class="atlas-banner-cloth"><path d="M1-36L28-34L24-11L2-14Z" fill="#942e23" stroke="#e2c176"/><g transform="translate(14 -25) scale(.11)" fill="none" stroke="#ffe1a0" stroke-width="10"><path d="M-50 0H50M0-50V50M-50-10V10M50-10V10M-10-50H10M-10 50H10M-32-23V-41M-41-32H-23M32-23V-41M23-32H41M-32 23V41M-41 32H-23M32 23V41M23 32H41"/></g></g><title>Your army: ${progress.levels[next].name}</title></g>`;
    const relief = `<g class="atlas-relief" clip-path="url(#atlas-land-clip)"><path d="M315 35Q283 140 333 255T325 475T294 685M334 45Q302 152 352 264T344 480T313 694M353 58Q320 165 369 278T362 496T331 710" fill="none" stroke="#4d4b3650" stroke-width="2"/><path d="M303 66l12-21 11 22M317 132l13-26 12 27M318 250l14-29 14 30M300 422l14-24 14 26M285 590l11-23 13 24" fill="#6a664355" stroke="#d3b87a55" stroke-width="2"/><path d="M288 60l11-18 13 21M302 125l12-22 13 25M304 242l12-24 13 28" fill="none" stroke="#e0c58a66"/></g>`;
    const water = `<defs><clipPath id="atlas-land-clip">${landMarkup}</clipPath><mask id="atlas-water-mask"><rect width="440" height="710" fill="white"/><g fill="black">${landMarkup}</g></mask><pattern id="atlas-water-pattern" width="72" height="44" patternUnits="userSpaceOnUse"><path class="atlas-wave" d="M-16 14Q0 5 16 14T48 14T80 14M-32 36Q-16 27 0 36T32 36T64 36T96 36" fill="none" stroke="#6aa3af" stroke-width="1" opacity=".3"/></pattern></defs><rect width="440" height="710" fill="url(#atlas-water-pattern)" mask="url(#atlas-water-mask)"/>`;

    let markers = locations
      .map((p, i) => {
        const [x, y] = atlasStops[i];
        const lx = x + 22,
          ly = y + 4;
        return `<circle cx="${x}" cy="${y}" r="${progress.completed.includes(i) ? 7 : 5}" class="${i <= progress.unlocked ? "atlas-open" : "atlas-locked"}"/><polyline points="${x + 8},${y} ${lx - 10},${ly - 4} ${lx - 3},${ly - 4}" fill="none" stroke="#dfc38d" stroke-width="0.8"/><text x="${lx}" y="${ly}">${["I. Saint Symeon", "II. Orontes", "III. Antioch", "IV. Tripoli", "V. Approach", "VI. Jerusalem"][i]}</text>`;
      })
      .join("");
    frame(
      "The pilgrim's chronicle",
      "ITINERARIUM · 1097–1099",
      `<div class="atlas-layout"><div class="atlas"><svg viewBox="0 0 440 710" role="img" aria-label="Eastern Mediterranean campaign atlas"><rect width="440" height="710" fill="#173642"/>${water}${landPolygons ? landPolygons.map((poly) => `<polygon points="${poly.map((p) => project(...p).join(",")).join(" ")}" fill="#9c8254"/>`).join("") : `<polygon points="${points} 440,710 440,0 0,0" fill="#9c8254"/>`}<polyline points="${points}" fill="none" stroke="#d8bd7d" stroke-width="2"/>${relief}<polyline class="atlas-surf" points="${points}" fill="none" stroke="#b0d5d5" stroke-width="5" opacity=".18"/><polyline points="${route}" fill="none" stroke="#e9d19e" stroke-width="2" stroke-dasharray="5 5"/>${
        coastline
          ? coastline
              .filter((p) => p !== mappedCoast)
              .map(
                (p) =>
                  `<polyline points="${p.map((c) => project(...c).join(",")).join(" ")}" fill="none" stroke="#d8bd7d" stroke-width="1.5"/>`,
              )
              .join("")
          : ""
      }${markers}${banner}<text x="16" y="310" class="sea-label" transform="rotate(-90 16 310)">MARE MEDITERRANEUM</text><text x="280" y="430" class="region-label">LEVANT</text></svg><small>Stylized campaign route; nearby locations are spaced for clarity.</small></div><div class="chapter-menu">${progress.lastVictory ? `<p class="campaign-victory"><strong>Chapter ${progress.lastVictory.level + 1} secured</strong><span>${progress.lastVictory.text}</span></p>` : ""}<label>Enemy command <select id="campaign-difficulty"><option value="easy">Easy · patient opponent</option><option value="normal" selected>Normal · balanced opponent</option><option value="hard">Hard · coordinated opponent</option></select></label>${progress.levels.map((l, i) => `<button id="chapter-${i}" ${i > progress.unlocked ? "disabled" : ""}><span class="chapter-index">${["I", "II", "III", "IV", "V", "VI"][i]}</span><span>${l.name}<small>${l.sub}</small></span><strong>${progress.completed.includes(i) ? "Completed" : i > progress.unlocked ? "Locked" : "Available"}</strong></button>`).join("")}<p class="fine-print">${progress.completed.length} / 6 chapters completed. Difficulty changes decisions and coordination; resources and unit rules stay equal.</p><button id="atlas-back">Back to main menu</button></div></div>`,
    );
    document.getElementById("campaign-difficulty").value = difficulty;
    progress.levels.forEach((l, i) =>
      bind("chapter-" + i, () => {
        hide();
        game.launch(i);
      }),
    );
    bind("atlas-back", main);
  }
  function slots() {
    frame(
      "Quickmatch",
      "TRES CHRONICAE · THREE LOCAL SESSIONS",
      `<div class="save-slots">${[0, 1, 2]
        .map((i) => {
          const s = saved(i);
          return `<article><div class="eyebrow">SESSION ${i + 1}</div><h2>${s ? "Standards over the frontier" : "An unwritten chronicle"}</h2><p>${s ? `${s.world[0]} × ${s.world[1]} · ${s.state.difficulty} · ${Math.floor(s.state.time / 60)} minutes` : "Choose a preset or shape your own battlefield."}</p><button id="slot-${i}">${s ? "Resume session" : "Create session"}</button>${s ? `<button id="delete-${i}" class="quiet-button">Delete this session</button>` : ""}</article>`;
        })
        .join("")}</div><button id="slots-back">Back to main menu</button>`,
    );
    for (let i = 0; i < 3; i++) {
      bind("slot-" + i, () => {
        activeSlot = i;
        if (saved(i)) {
          if (game.resume(i)) hide();
          else creation();
        } else creation();
      });
      bind("delete-" + i, () => {
        localStorage.removeItem("cruciata-quickmatch-" + i);
        slots();
      });
    }
    bind("slots-back", main);
  }
  function creation() {
    frame(
      "Shape the battlefield",
      "QUICKMATCH · SESSION " + (activeSlot + 1),
      `<div class="creation-layout"><div class="preset-buttons">${Object.keys(
        presets,
      )
        .map(
          (p) =>
            `<button id="preset-${p}">${p.charAt(0).toUpperCase() + p.slice(1)}<small>${{ frontier: "Balanced settlement", siege: "Developed armies", scarcity: "Every patch matters", empire: "A grand battlefield" }[p]}</small></button>`,
        )
        .join(
          "",
        )}</div><form id="quick-form"><label>Map size<select name="size"><option value="12800,8800">Large · 12800 × 8800</option><option value="16000,10800">Grand · 16000 × 10800</option><option value="19200,12800">Epic · 19200 × 12800</option></select></label><label>Resource frequency<select name="frequency"><option value=".3">Scarce</option><option value=".45">Sparse</option><option value=".65">Balanced</option><option value=".8">Abundant</option></select></label><label>Starting resources per type<input name="resources" type="number" min="100" max="5000" step="50" value="500" required></label><label>Starting soldiers per army<input name="units" type="number" min="0" max="80" value="8" required></label><label>Army composition<select name="composition"><option value="balanced">Infantry and archers</option><option value="vanguard">Infantry vanguard</option><option value="cavalry">Mounted company</option><option value="siege">Siege company</option></select></label><label>Starting villagers per settlement<input name="workers" type="number" min="4" max="24" value="6" required></label><label>Starting structures<select name="structures"><option value="settlement">Town, barracks, housing</option><option value="developed">Developed settlement and fields</option></select></label><label>AI difficulty<select name="difficulty"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label><label>Biome<select name="biome"><option value="0">Coastal grassland</option><option value="1">River valley</option><option value="2">Arid highlands</option><option value="3">Winter foothills</option></select></label><label>Generation seed<input name="seed" type="number" min="1" max="2147483647" value="${Math.floor(Math.random() * 1000000) + 1}" required></label><p class="fine-print">Both armies receive the same stores, soldiers, workers, buildings, training costs and population rules. Resources are finite; fog conceals your settlement until explored.</p><button type="submit">Raise the standards</button><button type="button" id="creation-back">Back to sessions</button></form></div>`,
    );
    const form = document.getElementById("quick-form");
    for (const [name, p] of Object.entries(presets))
      bind("preset-" + name, () => {
        form.elements.size.value = p.width + "," + p.height;
        for (const key of [
          "frequency",
          "resources",
          "units",
          "structures",
          "difficulty",
        ])
          form.elements[key].value = p[key];
      });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form),
        [width, height] = String(data.get("size")).split(",").map(Number);
      const config = { width, height };
      for (const k of [
        "frequency",
        "resources",
        "units",
        "workers",
        "seed",
        "biome",
      ])
        config[k] = Number(data.get(k));
      for (const k of ["structures", "difficulty", "composition"])
        config[k] = data.get(k);
      hide();
      game.launch(0, config, activeSlot);
      game.save();
    });
    bind("creation-back", slots);
  }
  const menuButton = document.createElement("button");
  menuButton.id = "main-menu-button";
  menuButton.textContent = "Menu";
  document.querySelector(".header-actions").prepend(menuButton);
  menuButton.addEventListener("click", main);
  const clear = document.createElement("button");
  clear.id = "clear-patch";
  clear.textContent = "Clear patch";
  clear.hidden = true;
  clear.addEventListener("click", game.clearPatch);
  document.querySelector(".commands").append(clear);
  const gate = document.createElement("button");
  gate.id = "gate-button";
  gate.textContent = "Open / close gate";
  gate.hidden = true;
  gate.addEventListener("click", game.gate);
  document.querySelector(".commands").append(gate);
  document.querySelector(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    main();
  });
  window.CruciataMenus = { main, campaign, slots };
  document.querySelector(".brand > span").innerHTML = cross;
  main();
})();
