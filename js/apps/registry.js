/**
 * ZerOS — application registry.
 * Apps are lazy ES modules: { launch(winApi) } exported per app.
 */
export const APPS = [
  {
    id: 'snake',
    name: 'Voltline',
    desc: 'neon snake — arrow keys / wasd',
    icon: 'assets/icons/snake.svg',
    module: () => import('../apps/snake.js'),
  },
  {
    id: 'g2048',
    name: 'Zero48',
    desc: '2048 — merge the glass tiles',
    icon: 'assets/icons/2048.svg',
    module: () => import('../apps/game2048.js'),
  },
  {
    id: 'markdown',
    name: 'Inkwell',
    desc: 'markdown editor · live preview · url → markdown',
    icon: 'assets/icons/markdown.svg',
    module: () => import('../apps/markdown.js'),
  },
  {
    id: 'wallgen',
    name: 'Vaporforge',
    desc: 'wallpaper generator (waterpipe-ts fractal smoke)',
    icon: 'assets/icons/wallgen.svg',
    module: () => import('../apps/wallgen.js'),
  },
  {
    id: 'browser',
    name: 'Periscope',
    desc: 'web browser — live iframe or reader mode',
    icon: 'assets/icons/browser.svg',
    module: () => import('../apps/browser.js'),
  },
  {
    id: 'rss',
    name: 'Antenna',
    desc: 'rss / atom feed reader',
    icon: 'assets/icons/rss.svg',
    module: () => import('../apps/rss.js'),
  },
  {
    id: 'settings',
    name: 'Preferences',
    desc: 'wallpaper · widgets · color theme · atmosphere',
    icon: 'assets/icons/settings.svg',
    module: () => import('../apps/settings.js'),
  },
  {
    id: 'zeroshell',
    name: 'ZeroShell',
    desc: 'SQL terminal into the OS database ★ special',
    icon: 'assets/icons/shell.svg',
    module: () => import('../apps/zeroshell.js'),
  },
];

export const appById = id => APPS.find(a => a.id === id);
