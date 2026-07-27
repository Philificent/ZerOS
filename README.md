# ZerOS

<p align="center"><img src="assets/logo.svg" width="110" alt="ZerOS logo"></p>

**ZerOS** is a browser operating system in a single static folder — dark layered
glass, one hue, and a real PostgreSQL database beating inside the page.

Open it, and you get a desktop: a dock, draggable glass windows with visible
focus-depth, a clock, a live system-fingerprint widget, two games, a markdown
editor, a fractal wallpaper forge and a SQL terminal wired straight into the
OS's own brain.

---

## Applications

| App | What it does |
|---|---|
| **Voltline** 🕹 | Fully functional neon snake. Arrows/WASD, speeds up as you eat, hall-of-fame persisted in the database. |
| **Zero48** 🕹 | Fully functional 2048 — slide/merge, win & lose detection, undo, swipe support, best score in the database. |
| **Inkwell** ✍ | Functional Markdown editor: live side-by-side preview (built-in renderer), documents saved to the `documents` table, and **remote fetch** — paste any URL and its HTML is converted to Markdown by a DOM-walking html→md converter (with CORS-proxy fallback). |
| **Vaporforge** 🎨 | The **Wallpaper Generator**. Drives the vendored [`waterpipe-ts`](https://github.com/) fractal-smoke library, rendered offscreen **at your desktop's native resolution** (the window shows a live cover-fit preview): presets seeded from your theme, color/opacity/detail controls, re-roll, PNG export — and one click stores the pixel-exact frame in the `wallpapers` table and sets it as your desktop. |
| **Preferences** ⚙ | Wallpaper picker (procedural, built-ins, everything you forged, **and your own uploads** — re-encoded at native screen size), widget visibility, the color system and atmosphere toggles. |
| **ZeroShell** ★ | The special feature — see below. |

## ★ Special feature: ZeroShell — the OS *is* a database

ZerOS keeps **no hidden state**. Settings, wallpapers, documents, game scores,
even shell history live in a genuine PostgreSQL instance
([PGlite](https://pglite.dev/), Postgres compiled to WASM) persisted to
IndexedDB. ZeroShell is a terminal with **raw SQL access to that live OS
database**, and the kernel re-reads the database after every write.

Which means this actually works:

```sql
UPDATE settings SET value='300' WHERE key='hue';   -- the whole desktop re-tints instantly
SELECT game, max(score) FROM scores GROUP BY game; -- your real high scores
SELECT title FROM documents;                       -- your Inkwell files
CREATE TABLE plans (idea TEXT);                    -- sure, extend your OS schema
```

**Why it's special:** most "browser OS" demos fake persistence with scattered
localStorage keys. ZerOS has a single queryable, transactional source of truth
— you can inspect it, script it, migrate it, or break it, from inside the OS
itself. It's the desktop-as-database, and the shell is `psql` for your
wallpaper. Built-ins included too: `help`, `apps`, `open <app>`, `theme`,
`tables`, `neofetch`, `history`.

## Widgets

- **Clock** — analog + digital, date, timezone/UTC offset.
- **System** — live browser-visible fingerprint: FPS, CPU threads, approximate
  RAM, JS heap (Chrome), network type/downlink/RTT, Bluetooth radio
  availability, battery level, screen/window geometry & DPR, storage quota,
  plus a full trait list (GPU, languages, timezone, touch, …) condensed into a
  SHA-256 fingerprint hash.

Both can be shown/hidden from Preferences (or `UPDATE settings …` in ZeroShell).

## Desktop context menu

Right-click any bare patch of desktop: generate a wallpaper, cycle to the next
stored wallpaper, jump to the wallpaper picker, re-tint the OS from a hue
strip (stays open so you can play), cycle the palette mode, and flip the
motes / cursor-glow toggles.

## Visual system

- **Dark layered glass** — every surface is translucent, blurred and edge-lit.
- **Focus depth** — the focused window is bright and sharp; unfocused windows
  recede (dim, desaturate, soft-blur, shallower shadows).
- **A single vanishing point at (0,0)** — volumetric light shafts fan out from
  the browser origin, window shadows are cast away from it, and small dust
  motes drift along the borders of open windows, lighting up only while they
  pass through a shaft.
- **Cursor glow** — the pointer carries a faint lamp: nearby motes brighten in
  its halo, and its wake drags them along and curls them into little eddies as
  it passes (toggle in Preferences or the context menu).
- **One-knob color** — a single hue + intensity, expanded as monochrome,
  duotone (+40°) or complementary (+180°). No confetti.

## Running locally

The folder is fully static, but ES modules + WASM need HTTP:

```bash
cd zeros
python3 -m http.server 8080     # or: npx serve
# open http://localhost:8080
```

Works in current **Chrome** and **Firefox** (Safari too). If PGlite can't
start (e.g. `file://`), ZerOS boots on a localStorage fallback and says so.

## Deploying

Deploy the folder as-is to any static host:

- **Cloudflare Pages** — project root as the build output directory, no build
  command. A `_headers` file is included for sane caching.
- **Firebase Hosting** — `firebase init hosting`, public dir = this folder,
  no rewrites needed.
- **GitHub Pages / Netlify / any nginx** — copy the folder, done.

Everything is vendored (`vendor/pglite`, `vendor/waterpipe`); there are no
external dependencies, no build step, no CDN calls. The only optional network
use is Inkwell's remote fetch.

## Layout

```
index.html            shell document
css/zeros.css         glass design system (driven by --hue/--sat/--glow)
js/kernel/            boot, db (PGlite), window manager, theme, atmosphere, widgets
js/apps/              registry + the six applications
vendor/waterpipe/     waterpipe-ts (fractal smoke) — ESM build
vendor/pglite/        PGlite (PostgreSQL/WASM) — ESM build + wasm + data
assets/               logo + app icons (SVG)
```

## Credits

- [waterpipe-ts](https://github.com/dragdropsite/waterpipe.js) — fractal-curve
  smoke (TypeScript port, vendored from `~/projects/waterpipe-ts`).
- [PGlite](https://pglite.dev/) by ElectricSQL — Postgres in WASM.

MIT.
