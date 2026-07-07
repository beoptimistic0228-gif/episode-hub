import { app, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveOrchestratorRoot, saveConfig } from './config';
import { completeEpisode, fetchStatus, pullFF, restoreIfNoTextDiff, syncStatus } from './git';
import { assertEpisodeId, safeEpisodePath } from './pathGuard';
import { scanEpisodeDetail, scanEpisodes } from './scanner';
import { patchEpisode, saveRender, writeText, type EpisodePatch } from './writer';

const DEFAULT_ROOT = 'C:\\nakgwan-channel-infra\\orchestrator';

export const configFile = (): string => join(app.getPath('userData'), 'hub-config.json');

let currentRoot: string | null = null;
export const getRoot = (): string | null => currentRoot;

function discoverRoot(): string | null {
  const saved = loadConfig(configFile());
  if (saved && existsSync(join(saved.orchestratorRoot, 'output', 'episodes'))) {
    return saved.orchestratorRoot;
  }
  // ⓐ 앱이 레포 안: app.getAppPath() = episode-hub/ (dev 기준)
  return resolveOrchestratorRoot(app.getAppPath(), DEFAULT_ROOT, existsSync);
}

export function registerIpc(onRootChanged: (root: string) => void): void {
  currentRoot = discoverRoot();
  if (currentRoot) onRootChanged(currentRoot);

  ipcMain.handle('config:get', () => ({ root: currentRoot }));

  ipcMain.handle('config:pickRoot', async () => {
    const res = await dialog.showOpenDialog({
      title: 'orchestrator 폴더 선택',
      properties: ['openDirectory'],
    });
    const picked = res.filePaths[0];
    if (picked && existsSync(join(picked, 'output', 'episodes'))) {
      currentRoot = picked;
      saveConfig(configFile(), { orchestratorRoot: picked });
      onRootChanged(picked);
      return { root: picked };
    }
    return { root: currentRoot };
  });

  ipcMain.handle('episodes:list', () =>
    currentRoot ? scanEpisodes(currentRoot) : []);

  ipcMain.handle('episodes:detail', (_e, id: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    assertEpisodeId(id);
    return scanEpisodeDetail(currentRoot, id);
  });

  ipcMain.handle('files:readText', (_e, id: string, relPath: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return readFileSync(safeEpisodePath(currentRoot, id, relPath), 'utf-8');
  });

  ipcMain.handle('files:writeText', async (_e, id: string, relPath: string, content: string, expectedMtimeMs?: number) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    const res = writeText(currentRoot, id, relPath, content, expectedMtimeMs);
    if ('ok' in res) await restoreIfNoTextDiff(currentRoot, id, relPath); // 내용 원복 시 유령 dirty 제거
    return res;
  });

  // 이미지가 있는 폴더를 파일 탐색기에서 연다 (경로 가드 경유)
  ipcMain.handle('files:showInFolder', (_e, id: string, relPath: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    shell.showItemInFolder(safeEpisodePath(currentRoot, id, relPath));
    return { ok: true };
  });

  ipcMain.handle('renders:save', (_e, id: string, category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return saveRender(currentRoot, id, category, row, new Uint8Array(bytes), overwrite);
  });

  ipcMain.handle('episode:patch', async (_e, id: string, patch: EpisodePatch) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    const res = patchEpisode(currentRoot, id, patch);
    // 승인 토글 원복 등으로 내용이 HEAD와 같아지면 유령 dirty(EOL)를 정리 — Complete 비활성 복귀
    await restoreIfNoTextDiff(currentRoot, id, 'episode.json');
    return res;
  });

  ipcMain.handle('git:sync', (_e, auto: boolean) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return syncStatus(currentRoot, auto);
  });

  // 로컬(no-fetch) 상태 갱신 — 인앱 변경·watcher 직후 Complete 활성 배선용. 네트워크 fetch 없음.
  ipcMain.handle('git:status', () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return fetchStatus(currentRoot, false);
  });

  ipcMain.handle('git:pull', () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return pullFF(currentRoot);
  });

  ipcMain.handle('git:complete', (_e, episodeId: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return completeEpisode(currentRoot, episodeId);
  });
}
