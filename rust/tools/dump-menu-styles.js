const { chromium } = require("../../node_modules/@playwright/test");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  await p.goto("http://127.0.0.1:3000/?test");
  await p.waitForTimeout(1200);
  const sels = ["#front-menu",".menu-body",".menu-brand",".menu-brand svg",".menu-brand div",".menu-brand small",".eyebrow","#front-menu h1",".menu-intro",".menu-main-buttons",".menu-main-buttons button",".menu-main-buttons button small","#front-menu blockquote","#front-menu blockquote small",".menu-foot",".menu-vignette","#front-menu::after"];
  const out = {};
  for (const s of sels) out[s] = await p.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return null;
    const c = getComputedStyle(e), r = e.getBoundingClientRect();
    return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], bg: c.backgroundColor, bgi: c.backgroundImage.slice(0,160), color: c.color, font: c.fontSize + " " + c.fontFamily.slice(0,40), weight: c.fontWeight, border: c.border.slice(0,60), pad: c.padding, ls: c.letterSpacing, lh: c.lineHeight };
  }, s);
  console.log(JSON.stringify(out));
  await b.close();
})();
