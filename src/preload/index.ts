import { contextBridge, ipcRenderer } from 'electron';
import type { EpisodeDetail, EpisodeSummary } from '../shared/types';

const api = {
  config: {
    get: (): Promise<{ root: string | null }> => ipcRenderer.invoke('config:get'),
    pickRoot: (): Promise<{ root: string | null }> => ipcRenderer.invoke('config:pickRoot'),
  },
  episodes: {
    list: (): Promise<EpisodeSummary[]> => ipcRenderer.invoke('episodes:list'),
    detail: (id: string): Promise<EpisodeDetail> => ipcRenderer.invoke('episodes:detail', id),
  },
  files: {
    readText: (id: string, relPath: string): Promise<string> =>
      ipcRenderer.invoke('files:readText', id, relPath),
  },
  events: {
    onEpisodesChanged: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on('episodes:changed', listener);
      return () => ipcRenderer.removeListener('episodes:changed', listener);
    },
  },
};

contextBridge.exposeInMainWorld('hub', api);
export type HubApi = typeof api;
