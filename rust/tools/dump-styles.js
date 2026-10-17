const { chromium } = require("../../node_modules/@playwright/test");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  await p.goto("http://127.0.0.1:3000/?test");
  await p.waitForTimeout(800);
  await p.evaluate(() => { document.getElementById("front-menu").hidden = true; cruciata.start(0); });
  await p.waitForTimeout(500);
  const sels = ["body","header",".brand",".brand small",".header-motto",".header-actions button",".sidebar",".sidebar h1",".level.active",".level-number",".level-name",".settlement-ledger > button","kbd",".worker-row",".sidebar-bottom p",".game-column",".mission-heading h2",".mission-heading .eyebrow","#timer",".resource-bar",".resource-bar strong",".resource-bar > div > span:last-child","#status-label","#battlefield",".map-label",".map-controls button","#control-groups button","#objective-panel","#objective-text","#objective-sub",".minimap-frame",".minimap-frame span",".map-bottom button",".command-panel",".selection-summary",".selection-summary > canvas","#selection-title","#selection-detail","#selection-role",".commands button",".muster-tabs button",".muster-tabs button[aria-selected=true]",".action-card",".action-card strong",".action-card .cost","footer","#toast","#weather-label","#tooltip"];
  const out = {};
  for (const s of sels) out[s] = await p.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return null;
    const c = getComputedStyle(e), r = e.getBoundingClientRect();
    return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: c.backgroundColor, bgi: c.backgroundImage.slice(0,140), color: c.color, font: c.fontSize + " " + c.fontFamily.slice(0,40), weight: c.fontWeight, border: c.border.slice(0,60), bb: c.borderBottom.slice(0,50), pad: c.padding, ls: c.letterSpacing, shadow: c.boxShadow.slice(0,60) };
  }, s);
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
