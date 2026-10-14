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
| **Inkwell** ✍ | Functional Markdown editor: live side-by-side preview (built-in renderer), documents saved to the `documents` table, and **remote fetch** — paste any URL and its HTML is converted to Markdown by a DOM-walking html→md converter (direct fetch → raced CORS relays → server-side reader fallback). |
| **Vaporforge** 🎨 | The **Wallpaper Generator**. Drives the vendored [`waterpipe-ts`](https://github.com/) fractal-smoke library, rendered offscreen **at your desktop's native resolution** (the window shows a live cover-fit preview): presets seeded from your theme, color/opacity/detail controls, re-roll, PNG export — and one click stores the pixel-exact frame in the `wallpapers` table and sets it as your desktop. |
| **Periscope** 🌐 | A small web browser, honest about the sandbox: **live mode** embeds the real site in an iframe (sites that refuse framing appear blank), **reader mode** pulls any page through the kernel net layer and distills it to markdown — links keep navigating inside the app — plus back/forward history and an open-in-host-browser escape hatch. |
| **Antenna** 📡 | RSS/Atom feed reader. Subscriptions live in the `feeds` table, fetching rides the same CORS-relay racing net layer, articles are distilled through the escaped html→md→html pipeline. |
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


## Command Palette ⌘K

Press **Cmd/Ctrl + K** anywhere to open the Spotlight-style command palette.
Fuzzy-search across:
- **Apps** — launch any installed app
- **Documents** — open Inkwell docs directly
- **Settings** — quick toggles for motes, cursor glow, widgets
- **Theme presets** — 8 named hue colors (Red, Orange, Green, Teal, Cyan, Blue, Purple, Pink)
- **SQL queries** — common SELECTs pre-written for ZeroShell
- **Window actions** — focus any open window

Navigate with ↑↓ arrows, run with Enter, close with Escape.

## Keyboard Shortcuts

System-wide shortcuts that work in any app:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Open command palette |
| `Cmd/Ctrl + W` | Close focused window |
| `Cmd/Ctrl + M` | Minimize focused window |
| `Cmd/Ctrl + Tab` | Next window |
| `Cmd/Ctrl + Shift + Tab` | Previous window |
| `Cmd/Ctrl + \`` | Cycle windows (reverse) |
| `Cmd/Ctrl + ,` | Open Preferences |
| `Cmd/Ctrl + L` | Lock screen |
| `Cmd/Ctrl + 1-7` | Quick-launch apps (Voltline through ZeroShell) |
| `Escape` | Close menus, palette, or lock screen |

See the full list in **Preferences → Keyboard Shortcuts**.

## Error Recovery

Apps are wrapped in error boundaries. If an app crashes, you'll see a
recovery screen with options to **reload the app**, **close the window**,
or **copy the error** to clipboard — instead of a blank window.

## Database Migrations

The database now has a proper migration system. Schema changes are tracked
in the `schema_version` table and applied automatically on boot. Performance
indexes are included for common queries (scores by game, documents by date).

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
use is remote content the user asks for (Inkwell fetch, Periscope, Antenna),
which goes direct first and falls back to public CORS relays.

## Layout

```
index.html            shell document
css/zeros.css         glass design system (driven by --hue/--sat/--glow)
js/kernel/            boot, db (PGlite), net (CORS relays), window manager, theme, atmosphere, widgets
js/apps/              registry + the eight applications
vendor/waterpipe/     waterpipe-ts (fractal smoke) — ESM build
vendor/pglite/        PGlite (PostgreSQL/WASM) — ESM build + wasm + data
assets/               logo + app icons (SVG)
```

## Credits

- [waterpipe-ts](https://github.com/dragdropsite/waterpipe.js) — fractal-curve
  smoke (TypeScript port, vendored from `~/projects/waterpipe-ts`).
- [PGlite](https://pglite.dev/) by ElectricSQL — Postgres in WASM.

MIT.
