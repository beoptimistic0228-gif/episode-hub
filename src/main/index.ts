import { app, BrowserWindow, net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRoot, registerIpc } from './ipc';
import { safeEpisodePath } from './pathGuard';
import { startWatcher } from './watcher';

// hub://<episodeId>/<relPath> → <root>/output/episodes/<id>/<relPath> (이미지 표시용)
protocol.registerSchemesAsPrivileged([
  { scheme: 'hub', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

let stopWatcher: (() => void) | null = null;
let mainWin: BrowserWindow | null = null;

app.whenReady().then(() => {
  protocol.handle('hub', (request) => {
    const root = getRoot();
    if (!root) return new Response('no root', { status: 404 });
    const u = new URL(request.url);
    const id = u.host;
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
    try {
      const filePath = safeEpisodePath(root, id, rel);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('forbidden', { status: 403 });
    }
  });

  registerIpc((root) => {
    stopWatcher?.();
    stopWatcher = startWatcher(root, () => {
      mainWin?.webContents.send('episodes:changed');
    });
  });

  mainWin = createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
