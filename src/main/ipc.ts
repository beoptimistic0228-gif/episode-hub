import { app, dialog, ipcMain, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveOrchestratorRoot, updateConfig } from './config';
import { completeEpisode, fetchStatus, pullFF, restoreIfNoTextDiff, syncStatus, resolveGitRoot, commitStats } from './git';
import { readStats, refreshStats } from './statsFetcher';
import { assertEpisodeId, safeEpisodePath } from './pathGuard';
import { scanEpisodeDetail, scanEpisodes } from './scanner';
import { patchEpisode, saveRender, writeText, type EpisodePatch } from './writer';
import { migrateImagesToImageRoot } from './imageMigrate';
import { extractVideoId } from '@shared/stats';

const DEFAULT_ROOT = 'C:\\nakgwan-channel-infra\\orchestrator';

export const configFile = (): string => join(app.getPath('userData'), 'hub-config.json');

let currentRoot: string | null = null;
export const getRoot = (): string | null => currentRoot;

let currentImageRoot: string | null = null;
export const getImageRoot = (): string | null => currentImageRoot;

// 발행된 유튜브/쇼츠 URL → videoId 집합 (에피소드별 성과용). index.ts 부팅 수집과 공유.
export function collectVideoIds(root: string): string[] {
  const ids = new Set<string>();
  for (const ep of scanEpisodes(root)) {
    for (const p of ep.publications) {
      if ((p.platform === 'youtube' || p.platform === 'shorts') && p.url) {
        const id = extractVideoId(p.url);
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

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
  currentImageRoot = loadConfig(configFile())?.imageRoot ?? null;
  if (currentRoot) onRootChanged(currentRoot);

  ipcMain.handle('config:get', () => ({ root: currentRoot, imageRoot: currentImageRoot }));

  ipcMain.handle('config:pickRoot', async () => {
    const res = await dialog.showOpenDialog({
      title: 'orchestrator 폴더 선택',
      properties: ['openDirectory'],
    });
    const picked = res.filePaths[0];
    if (picked && existsSync(join(picked, 'output', 'episodes'))) {
      currentRoot = picked;
      updateConfig(configFile(), { orchestratorRoot: picked });
      onRootChanged(picked);
      return { root: picked };
    }
    return { root: currentRoot };
  });

  ipcMain.handle('config:pickImageRoot', async () => {
    const res = await dialog.showOpenDialog({
      title: '이미지 동기 폴더 선택 (Google Drive 등)',
      properties: ['openDirectory'],
    });
    const picked = res.filePaths[0];
    if (picked) {
      currentImageRoot = picked;
      updateConfig(configFile(), { imageRoot: picked });
    }
    return { imageRoot: currentImageRoot };
  });

  ipcMain.handle('images:migrate', () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    if (!currentImageRoot) throw new Error('이미지 폴더 미설정');
    return migrateImagesToImageRoot(currentRoot, currentImageRoot);
  });

  ipcMain.handle('episodes:list', async () => {
    if (!currentRoot) return [];
    const videos = readStats(await resolveGitRoot(currentRoot)).videos;
    return scanEpisodes(currentRoot, videos, currentImageRoot);
  });

  ipcMain.handle('episodes:detail', (_e, id: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    assertEpisodeId(id);
    return scanEpisodeDetail(currentRoot, id, currentImageRoot);
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

  // SNS 채널 열기 — URL은 main에 고정(임의 URL 열기 차단, Phase D 스펙 §5)
  const SNS_LINKS: Record<string, string> = {
    youtube: 'https://youtube.com/channel/UCqMBCXReIpCPa4PzWiT2grw',
    instagram: 'https://www.instagram.com/beoptimistic.official/',
    blog: 'https://blog.naver.com/be_optimistic228',
  };
  ipcMain.handle('links:open', (_e, kind: string) => {
    const url = SNS_LINKS[kind];
    if (!url) throw new Error(`알 수 없는 링크: ${kind}`);
    void shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('renders:save', (_e, id: string, category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => {
    if (!currentImageRoot) throw new Error('이미지 폴더 미설정 — 먼저 이미지 동기 폴더를 선택하세요');
    return saveRender(currentImageRoot, id, category, row, new Uint8Array(bytes), overwrite);
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

  ipcMain.handle('stats:get', async () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return readStats(await resolveGitRoot(currentRoot));
  });

  ipcMain.handle('stats:refresh', async () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    const gitRoot = await resolveGitRoot(currentRoot);
    const stats = await refreshStats(gitRoot, currentRoot, collectVideoIds(currentRoot));
    void commitStats(currentRoot).catch(() => {}); // 다기기 동기화 — 실패해도 로컬 보존
    return stats;
  });
}
