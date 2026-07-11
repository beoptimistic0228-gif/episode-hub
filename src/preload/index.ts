import { contextBridge, ipcRenderer } from 'electron';
import type { EpisodeDetail, EpisodeSummary, EpisodeDoc } from '../shared/types';
import type { WriteTextResult, SaveRenderResult, EpisodePatch } from '../main/writer';
import type { GitStatus, CompleteResult } from '../main/git';
import type { ChannelStats } from '../shared/stats';
import type { AskEvent } from '../main/aiBridge';
import type { ProposalSummary, ApplyResult } from '../main/proposalStore';

const api = {
  config: {
    get: (): Promise<{ root: string | null; imageRoot: string | null }> => ipcRenderer.invoke('config:get'),
    pickRoot: (): Promise<{ root: string | null }> => ipcRenderer.invoke('config:pickRoot'),
    pickImageRoot: (): Promise<{ imageRoot: string | null }> => ipcRenderer.invoke('config:pickImageRoot'),
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
  images: {
    migrate: (): Promise<{ copied: number }> => ipcRenderer.invoke('images:migrate'),
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
  ai: {
    status: (): Promise<{ available: boolean; busy: boolean }> => ipcRenderer.invoke('ai:status'),
    ask: (episodeId: string, question: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('ai:ask', episodeId, question),
    cancel: (): Promise<{ ok: true }> => ipcRenderer.invoke('ai:cancel'),
    reset: (episodeId: string): Promise<{ ok: true }> => ipcRenderer.invoke('ai:reset', episodeId),
    proposals: (episodeId: string): Promise<ProposalSummary[]> =>
      ipcRenderer.invoke('ai:proposals', episodeId),
    proposalDiff: (itemId: string): Promise<{ relPath: string; reason: string; oldText: string; newText: string } | null> =>
      ipcRenderer.invoke('ai:proposalDiff', itemId),
    applyProposal: (episodeId: string, itemIds: string[], force?: boolean): Promise<ApplyResult[]> =>
      ipcRenderer.invoke('ai:applyProposal', episodeId, itemIds, force),
    rejectProposal: (episodeId: string, itemIds: string[]): Promise<ProposalSummary[]> =>
      ipcRenderer.invoke('ai:rejectProposal', episodeId, itemIds),
    onStream: (cb: (ev: AskEvent) => void): (() => void) => {
      const listener = (_e: unknown, ev: AskEvent) => cb(ev);
      ipcRenderer.on('ai:stream', listener);
      return () => ipcRenderer.removeListener('ai:stream', listener);
    },
  },
};

contextBridge.exposeInMainWorld('hub', api);
export type HubApi = typeof api;
