import { create } from 'zustand';
import type { EpisodeDetail, EpisodeSummary } from '@shared/types';
import type { WriteTextResult, SaveRenderResult, EpisodePatch } from '../../main/writer';

interface HubState {
  root: string | null;
  episodes: EpisodeSummary[];
  selectedId: string | null;
  detail: EpisodeDetail | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  pickRoot: () => Promise<void>;
  writeText: (relPath: string, content: string, expectedMtimeMs?: number) => Promise<WriteTextResult>;
  saveRender: (category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => Promise<SaveRenderResult>;
  patchEpisode: (patch: EpisodePatch) => Promise<void>;
}

export const useHub = create<HubState>((set, get) => ({
  root: null,
  episodes: [],
  selectedId: null,
  detail: null,

  init: async () => {
    const { root } = await window.hub.config.get();
    set({ root });
    if (root) await get().refresh();
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
    if (root) await get().refresh();
  },

  writeText: async (relPath, content, expectedMtimeMs) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.files.writeText(selectedId, relPath, content, expectedMtimeMs);
    if ('ok' in res) await get().select(selectedId);
    return res;
  },

  saveRender: async (category, row, bytes, overwrite) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.renders.save(selectedId, category, row, bytes, overwrite);
    if ('ok' in res) await get().select(selectedId);
    return res;
  },

  patchEpisode: async (patch) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    await window.hub.episode.patch(selectedId, patch);
    await get().select(selectedId);
  },
}));
