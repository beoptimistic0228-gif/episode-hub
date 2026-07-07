import { create } from 'zustand';
import type { EpisodeDetail, EpisodeSummary } from '@shared/types';
import type { WriteTextResult, SaveRenderResult, EpisodePatch } from '../../main/writer';
import type { GitStatus, CompleteResult } from '../../main/git';

interface HubState {
  root: string | null;
  episodes: EpisodeSummary[];
  selectedId: string | null;
  detail: EpisodeDetail | null;
  gitStatus: GitStatus | null;
  /** 전역 페이지 — 첫 화면은 대시보드 (Phase D §1) */
  page: 'dashboard' | 'episode';
  goDashboard: () => void;
  openEpisode: (id: string) => Promise<void>;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  pickRoot: () => Promise<void>;
  writeText: (relPath: string, content: string, expectedMtimeMs?: number) => Promise<WriteTextResult>;
  saveRender: (category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => Promise<SaveRenderResult>;
  patchEpisode: (patch: EpisodePatch) => Promise<void>;
  refreshGit: () => Promise<void>;
  refreshGitLocal: () => Promise<void>;
  gitPull: () => Promise<{ ok: true } | { ok: false; message: string }>;
  completeEpisode: () => Promise<CompleteResult>;
}

export const useHub = create<HubState>((set, get) => ({
  root: null,
  episodes: [],
  selectedId: null,
  detail: null,
  gitStatus: null,
  page: 'dashboard',

  goDashboard: () => set({ page: 'dashboard' }),

  // 사용자 이동 — select(데이터 로드)와 분리: refresh의 자동 선택이 페이지를 안 바꾸게
  openEpisode: async (id) => {
    await get().select(id);
    set({ page: 'episode' });
  },

  init: async () => {
    const { root } = await window.hub.config.get();
    set({ root });
    if (root) {
      await get().refresh();
      // 실행 시 자동 최신화(behind+clean이면 FF-pull) — 네트워크라 UI 블록 없이
      window.hub.git.sync(true).then((gitStatus) => set({ gitStatus })).catch(() => {});
    }
  },

  refresh: async () => {
    const episodes = await window.hub.episodes.list();
    set({ episodes });
    const { selectedId } = get();
    if (selectedId && episodes.some((e) => e.id === selectedId)) {
      set({ detail: await window.hub.episodes.detail(selectedId) });
    } else if (episodes.length > 0) {
      await get().select(episodes[0].id);
    } else {
      set({ selectedId: null, detail: null });
    }
  },

  select: async (id) => {
    set({ selectedId: id, detail: await window.hub.episodes.detail(id) });
  },

  pickRoot: async () => {
    const { root } = await window.hub.config.pickRoot();
    set({ root });
    if (root) {
      await get().refresh();
      await get().refreshGitLocal();
    }
  },

  writeText: async (relPath, content, expectedMtimeMs) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.files.writeText(selectedId, relPath, content, expectedMtimeMs);
    if ('ok' in res) { await get().select(selectedId); await get().refreshGitLocal(); }
    return res;
  },

  saveRender: async (category, row, bytes, overwrite) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.renders.save(selectedId, category, row, bytes, overwrite);
    if ('ok' in res) { await get().select(selectedId); await get().refreshGitLocal(); }
    return res;
  },

  patchEpisode: async (patch) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    await window.hub.episode.patch(selectedId, patch);
    await get().select(selectedId);
    await get().refreshGitLocal();
  },

  refreshGit: async () => {
    if (!get().root) return;
    try { set({ gitStatus: await window.hub.git.sync(false) }); } catch { /* 무시 — 칩이 이전 상태 유지 */ }
  },

  // 로컬(no-fetch) 상태 갱신 — 인앱 변경·watcher 직후 호출. 네트워크 fetch 없이 dirty/changedPaths만 재산출.
  refreshGitLocal: async () => {
    if (!get().root) return;
    try { set({ gitStatus: await window.hub.git.status() }); } catch { /* 무시 — 칩이 이전 상태 유지 */ }
  },

  gitPull: async () => {
    const res = await window.hub.git.pull();
    await get().refreshGit();
    return res;
  },

  completeEpisode: async () => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.git.complete(selectedId);
    await get().refreshGit();
    return res;
  },
}));
