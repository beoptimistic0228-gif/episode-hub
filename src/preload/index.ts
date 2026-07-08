import { contextBridge, ipcRenderer } from 'electron';
import type { EpisodeDetail, EpisodeSummary, EpisodeDoc } from '../shared/types';
import type { WriteTextResult, SaveRenderResult, EpisodePatch } from '../main/writer';
import type { GitStatus, CompleteResult } from '../main/git';
import type { ChannelStats } from '../shared/stats';

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
    writeText: (id: string, relPath: string, content: string, expectedMtimeMs?: number): Promise<WriteTextResult> =>
      ipcRenderer.invoke('files:writeText', id, relPath, content, expectedMtimeMs),
    showInFolder: (id: string, relPath: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke('files:showInFolder', id, relPath),
  },
  links: {
    open: (kind: 'youtube' | 'instagram' | 'blog'): Promise<{ ok: true }> =>
      ipcRenderer.invoke('links:open', kind),
  },
  renders: {
    save: (id: string, category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean): Promise<SaveRenderResult> =>
      ipcRenderer.invoke('renders:save', id, category, row, bytes, overwrite),
  },
  episode: {
    patch: (id: string, patch: EpisodePatch): Promise<{ ok: true; doc: EpisodeDoc }> =>
      ipcRenderer.invoke('episode:patch', id, patch),
  },
  git: {
    sync: (auto: boolean): Promise<GitStatus> => ipcRenderer.invoke('git:sync', auto),
    status: (): Promise<GitStatus> => ipcRenderer.invoke('git:status'),
    pull: (): Promise<{ ok: true } | { ok: false; message: string }> => ipcRenderer.invoke('git:pull'),
    complete: (episodeId: string): Promise<CompleteResult> => ipcRenderer.invoke('git:complete', episodeId),
  },
  stats: {
    get: (): Promise<ChannelStats> => ipcRenderer.invoke('stats:get'),
    refresh: (): Promise<ChannelStats> => ipcRenderer.invoke('stats:refresh'),
  },
  events: {
    onEpisodesChanged: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on('episodes:changed', listener);
      return () => ipcRenderer.removeListener('episodes:changed', listener);
    },
    onStatsChanged: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on('stats:changed', listener);
      return () => ipcRenderer.removeListener('stats:changed', listener);
    },
  },
};

contextBridge.exposeInMainWorld('hub', api);
export type HubApi = typeof api;
