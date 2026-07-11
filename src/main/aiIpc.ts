import { ipcMain, BrowserWindow } from 'electron';
import { join } from 'node:path';
import {
  AiBridge, resolveClaudeBin, spawnClaude, writeAiMcpConfig, type AskEvent,
} from './aiBridge';
import {
  applyProposals, getProposalDiff, listProposals, rejectProposals, setOnPropose,
} from './proposalStore';

export function registerAiIpc(opts: {
  userDataDir: string; port: number; token: string; getRoot: () => string | null;
}): { dispose(): void; getActiveAskEpisode(): string | null } {
  const mcpConfigPath = writeAiMcpConfig(join(opts.userDataDir, 'ai-mcp-config.json'), opts.port, opts.token);
  const broadcast = (ev: AskEvent) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('ai:stream', ev);
  };
  const bridge = new AiBridge({
    mcpConfigPath,
    onEvent: broadcast,
    spawnImpl: (args) => {
      const b = resolveClaudeBin(); // ask 시점 재해석(설치 직후 재시작 불필요)
      if (!b) throw new Error('claude not found');
      return spawnClaude(b, args);
    },
  });

  // E3 — propose_edit가 store에 적재한 제안을 같은 ai:stream 경로로 패널에 알린다(서버 검증 통과분만).
  setOnPropose((s) => broadcast({
    kind: 'propose', episodeId: s.episodeId, itemId: s.itemId, relPath: s.relPath, reason: s.reason, isNew: s.isNew,
  }));

  ipcMain.handle('ai:status', () => ({ available: resolveClaudeBin() !== null, busy: bridge.busy() }));
  ipcMain.handle('ai:ask', (_e, episodeId: string, question: string) => {
    try { return bridge.ask(String(episodeId), String(question)); }
    catch (err) {
      console.error('[aiIpc] ai:ask 실패:', err);
      return { ok: false, message: '이 PC에서 Claude Code를 찾지 못했어요.' };
    }
  });
  ipcMain.handle('ai:cancel', () => { bridge.cancel(); return { ok: true as const }; });
  ipcMain.handle('ai:reset', (_e, episodeId: string) => { bridge.reset(String(episodeId)); return { ok: true as const }; });

  ipcMain.handle('ai:proposals', (_e, episodeId: string) => listProposals(String(episodeId)));
  ipcMain.handle('ai:proposalDiff', (_e, itemId: string) => {
    const root = opts.getRoot();
    if (!root) return null;
    return getProposalDiff(root, String(itemId));
  });
  ipcMain.handle('ai:applyProposal', (_e, episodeId: string, itemIds: string[], force?: boolean) => {
    const root = opts.getRoot();
    if (!root) throw new Error('orchestrator 루트가 설정되지 않았어요');
    return applyProposals(root, String(episodeId), (Array.isArray(itemIds) ? itemIds : []).map(String), force === true);
  });
  ipcMain.handle('ai:rejectProposal', (_e, episodeId: string, itemIds: string[]) =>
    rejectProposals(String(episodeId), (Array.isArray(itemIds) ? itemIds : []).map(String)));

  return {
    dispose: () => { bridge.cancel(); setOnPropose(null); },
    getActiveAskEpisode: () => bridge.activeEpisode(),
  };
}
