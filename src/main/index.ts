import { app, BrowserWindow, net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRoot, registerIpc, collectVideoIds } from './ipc';
import { resolveGitRoot, commitStats } from './git';
import { readStats, refreshStats } from './statsFetcher';
import { latestSnapshot } from '@shared/stats';
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
    // 패키징 후에는 exe에 임베드된 아이콘이 적용된다(build/는 asar 미포함) — dev 창 아이콘만 지정
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
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

// 부팅 자동수집 — pull은 기존 store init의 git.sync(true)가 처리. 오늘 스냅샷 없을 때만 수집(스로틀·기기간 충돌 회피).
async function bootCollectStats(): Promise<void> {
  const root = getRoot();
  if (!root) return;
  try {
    const gitRoot = await resolveGitRoot(root);
    const today = new Date().toISOString().slice(0, 10);
    if (latestSnapshot(readStats(gitRoot))?.date === today) return; // 이미 오늘 수집됨
    await refreshStats(gitRoot, root, collectVideoIds(root));
    mainWin?.webContents.send('stats:changed'); // same-session 렌더러 반영 (스로틀 skip 시엔 이미 최신)
    void commitStats(root).catch(() => {});
  } catch { /* 부팅 수집 실패는 비치명적 */ }
}

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
  void bootCollectStats();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
