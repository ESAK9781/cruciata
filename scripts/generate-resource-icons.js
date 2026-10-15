/* Resource HUD models use the same materials and light as the canvas world. */
const fs = require("node:fs");
const path = require("node:path");
const ink = "#3d4033";
const icons = {
  food: '<path d="m3 19 14-7 14 7-14 8Z" fill="#c4a26a"/><path d="M3 19v8l14 6v-6Z" fill="#775935"/><path d="M17 27v6l14-6v-8Z" fill="#977448"/><path d="m10 23 4-17m5 19 5-20" fill="none" stroke="#d9af54" stroke-width="1.5"/><path d="m13 10-4-4 1 7 3 3m2-9 5-5-1 7-5 4m9-2-3-4-1 6 3 3m3-9 5-4-1 7-5 3" fill="#e0c378" stroke="#9c8046" stroke-width=".7"/>',
  wood: '<path d="m5 21 19-11 7 5-19 11Z" fill="#a58351"/><path d="m5 21 7 5v5l-7-5Zm7 5 19-11v5L12 31Z" fill="#775935"/><path d="m4 15 19-11 8 5-19 11Z" fill="#c4a26a"/><path d="m4 15 8 5v5l-8-5Z" fill="#a58351"/><path d="m12 20 19-11v5L12 25Z" fill="#977448"/><path d="m7 16 3 2m5 2L28 12m-12 3L25 9" fill="none" stroke="#e0bf8c" stroke-width=".8"/>',
  stone:
    '<path d="m3 20 14-7 14 7-14 7Z" fill="#bcaf8c"/><path d="M3 20v7l14 6v-6Z" fill="#83795f"/><path d="M17 27v6l14-6v-7Z" fill="#9f9476"/><path d="m5 11 13-7 12 6-13 7Z" fill="#d2c3a0"/><path d="M5 11v8l12 6v-8Z" fill="#9b8e70"/><path d="M17 17v8l13-7v-8Z" fill="#bcaf8c"/><path d="m7 13 8 4m5 3 8-4" fill="none" stroke="#e3d2ac" stroke-width=".8"/>',
  gold: '<path d="m3 22 13-7 16 7-13 7Z" fill="#d9af54"/><path d="m3 22 2 6 14 5v-4Z" fill="#a17c36"/><path d="m19 29 13-7-2 6-11 5Z" fill="#bf9745"/><path d="m4 12 13-8 15 7-13 8Z" fill="#edcc78"/><path d="m4 12 2 7 13 6v-6Z" fill="#b88e40"/><path d="m19 19 13-8-2 7-11 7Z" fill="#d9af54"/><path d="m8 12 9-5m5 13 7-4" fill="none" stroke="#f5e1a8" stroke-width="1.2"/>',
  people:
    '<path d="m3 19 7-4 7 4-7 4Z" fill="#c86a52"/><path d="M3 19v9l7 4v-9Zm7 4v9l7-4v-9Z" fill="#b53d30"/><path d="m18 17 6-4 7 4-7 4Z" fill="#e2d8ba"/><path d="M18 17v11l6 4V21Z" fill="#b7ac90"/><path d="M24 21v11l7-4V17Z" fill="#d5c9a7"/><ellipse cx="10" cy="11" rx="5" ry="6" fill="#d4a475"/><path d="M5 11V8q5-8 10 0v3l-5-2Z" fill="#a0aaa0"/><ellipse cx="24" cy="9" rx="5" ry="6" fill="#d4a475"/><path d="M19 8q0-8 5-7 5 0 5 7l-5-2Z" fill="#977448"/>',
  faith:
    '<path d="m4 25 13-6 13 6-13 6Z" fill="#d2c3a0"/><path d="M4 25v4l13 4v-2Zm13 6v2l13-4v-4Z" fill="#9f9476"/><path d="m12 20 5-3 5 3v5l-5 3-5-3Z" fill="#bcaf8c"/><path d="M17 3v21M7 13h20M13 3h8M13 24h8M7 9v8M27 9v8" fill="none" stroke="#9b7837" stroke-width="3.5"/><path d="M16 3v20M7 12h19" stroke="#edcc78" stroke-width="1.5"/><path d="M8 4v5M5.5 6.5h5M26 4v5M23.5 6.5h5M8 20v5M5.5 22.5h5M26 20v5M23.5 22.5h5" stroke="#d9af54" stroke-width="1.5"/>',
};
for (const [name, body] of Object.entries(icons))
  fs.writeFileSync(
    path.join(__dirname, "../assets/icons", name + ".svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34"><ellipse cx="17" cy="30" rx="15" ry="3" fill="#253323" opacity=".25"/><g stroke="' +
      ink +
      '" stroke-width="1" stroke-linejoin="round">' +
      body +
      "</g></svg>\n",
  );
