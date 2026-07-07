import { app, dialog, ipcMain } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveOrchestratorRoot, saveConfig } from './config';
import { completeEpisode, pullFF, syncStatus } from './git';
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

  ipcMain.handle('files:writeText', (_e, id: string, relPath: string, content: string, expectedMtimeMs?: number) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return writeText(currentRoot, id, relPath, content, expectedMtimeMs);
  });

  ipcMain.handle('renders:save', (_e, id: string, category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return saveRender(currentRoot, id, category, row, new Uint8Array(bytes), overwrite);
  });

  ipcMain.handle('episode:patch', (_e, id: string, patch: EpisodePatch) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return patchEpisode(currentRoot, id, patch);
  });

  ipcMain.handle('git:sync', (_e, auto: boolean) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return syncStatus(currentRoot, auto);
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
