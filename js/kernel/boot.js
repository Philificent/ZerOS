/**
 * ZerOS kernel — boot sequence.
 */
import { initDB } from './db.js';
import { initTheme } from './theme.js';
import { initAtmosphere } from './motes.js';
import { initWidgets } from './widgets.js';
import { initDesktop, toast } from './desktop.js';
import { initContextMenu } from './contextmenu.js';

const status = msg => { document.getElementById('boot-status').textContent = msg; };
const progress = p => { document.getElementById('boot-progress').style.width = p + '%'; };

async function boot() {
  const t0 = performance.now();
  progress(8);

  status('mounting database…');
  const { mode, boots } = await initDB(m => status(m));
  progress(55);

  status('applying theme…');
  initTheme();
  progress(65);

  status('condensing atmosphere…');
  initAtmosphere();
  progress(78);

  status('arranging desktop…');
  initDesktop();
  initWidgets();
  initContextMenu();
  progress(100);

  const dt = Math.round(performance.now() - t0);
  status(`ready in ${dt} ms`);

  /* let the logo animation land, then lift the veil */
  const minShow = 1900;
  const wait = Math.max(0, minShow - dt);
  setTimeout(() => {
    document.getElementById('boot').classList.add('done');
    if (mode === 'local') {
      toast('PGlite could not start — running on the localStorage fallback. Serve over http(s) for the full database.', 6000);
    } else if (boots === 1) {
      toast('Welcome to ZerOS. Try ZeroShell — the whole OS is one Postgres database.', 6000);
    }
  }, wait);
}

boot().catch(err => {
  console.error('[zeros] boot failure', err);
  status('boot failure — ' + err.message);
});
