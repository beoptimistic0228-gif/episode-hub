import { create } from 'zustand';
import type { EpisodeDetail, EpisodeSummary } from '@shared/types';

interface HubState {
  root: string | null;
  episodes: EpisodeSummary[];
  selectedId: string | null;
  detail: EpisodeDetail | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  pickRoot: () => Promise<void>;
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
}));
