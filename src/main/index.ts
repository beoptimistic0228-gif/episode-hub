import { app, BrowserWindow, net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { getRoot, registerIpc, collectVideoIds, getImageRoot } from './ipc';
import { resolveGitRoot, commitStats } from './git';
import { readStats, refreshStats } from './statsFetcher';
import { latestSnapshot } from '@shared/stats';
import { safeEpisodePath, resolveImagePath } from './pathGuard';
import { startWatcher } from './watcher';
import { loadOrCreateToken, writeMcpJson, MCP_PORT } from './mcpBridge';
import { startMcpBridge, type BridgeHandle } from './mcpServer';
import { registerAiIpc } from './aiIpc';

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
let bridge: BridgeHandle | null = null;

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

// 루트가 유효해질 때마다 .mcp.json 갱신(부팅 해석·폴더 선택 양쪽 경로). 포트는 고정
// MCP_PORT, 토큰은 idempotent라 브리지 기동 상태와 무관하게 쓸 수 있다.
async function syncMcpJson(root: string, token: string): Promise<void> {
  try {
    writeMcpJson(await resolveGitRoot(root), MCP_PORT, token);
  } catch (e) {
    // 비-git 폴더·git 미설치 등 — .mcp.json만 스킵, 앱은 정상
    console.error('[mcp-bridge] .mcp.json write skipped:', e);
  }
}

app.whenReady().then(() => {
  protocol.handle('hub', (request) => {
    const u = new URL(request.url);
    const id = u.host;
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const imageRoot = getImageRoot();
    // 이미지: imageRoot 우선. 아직 동기 안 됐거나 미설정이면 레포(비디오 등 잔여 미디어) 폴백.
    if (imageRoot) {
      try {
        const p = resolveImagePath(imageRoot, id, rel);
        if (existsSync(p)) return net.fetch(pathToFileURL(p).toString());
      } catch {
        return new Response('forbidden', { status: 403 });
      }
    }
    const root = getRoot();
    if (!root) return new Response('no root', { status: 404 });
    try {
      const p = safeEpisodePath(root, id, rel);
      if (!existsSync(p)) return new Response('not synced', { status: 404 });
      return net.fetch(pathToFileURL(p).toString());
    } catch {
      return new Response('forbidden', { status: 403 });
    }
  });

  const mcpToken = loadOrCreateToken(join(app.getPath('userData'), 'mcp-bridge.json'));

  registerIpc((root) => {
    stopWatcher?.();
    stopWatcher = startWatcher(root, () => {
      mainWin?.webContents.send('episodes:changed');
    });
    // 루트 확정(부팅 해석·폴더 선택) 즉시 .mcp.json 기록 — 패키지 첫 실행 재시작 불필요
    void syncMcpJson(root, mcpToken);
  });

  // E3 — propose_edit 검증에 진행 중 ask 에피소드가 필요해 aiIpc를 먼저 등록한다.
  const aiIpc = registerAiIpc({ userDataDir: app.getPath('userData'), port: MCP_PORT, token: mcpToken, getRoot });
  app.on('before-quit', () => aiIpc.dispose());

  void (async () => {
    try {
      bridge = await startMcpBridge({
        getRoot, token: mcpToken, port: MCP_PORT, getImageRoot,
        getActiveAskEpisode: aiIpc.getActiveAskEpisode,
      });
    } catch (e) {
      // 포트 사용중·git 루트 미발견 등 — 브리지만 스킵, 앱은 정상 (토큰은 e에 미포함)
      console.error('[mcp-bridge] start skipped:', e);
    }
  })();

  mainWin = createWindow();
  void bootCollectStats();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  void bridge?.stop();
});
