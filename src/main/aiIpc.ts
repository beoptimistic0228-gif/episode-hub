import { ipcMain, BrowserWindow } from 'electron';
import { join } from 'node:path';
import {
  AiBridge, resolveClaudeBin, spawnClaude, writeAiMcpConfig, type AskEvent,
} from './aiBridge';

export function registerAiIpc(opts: { userDataDir: string; port: number; token: string }): { dispose(): void } {
  const mcpConfigPath = writeAiMcpConfig(join(opts.userDataDir, 'ai-mcp-config.json'), opts.port, opts.token);
  const bin = resolveClaudeBin();
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

  ipcMain.handle('ai:status', () => ({ available: resolveClaudeBin() !== null }));
  ipcMain.handle('ai:ask', (_e, episodeId: string, question: string) => {
    try { return bridge.ask(String(episodeId), String(question)); }
    catch (err) { return { ok: false, message: String(err) }; }
  });
  ipcMain.handle('ai:cancel', () => { bridge.cancel(); return { ok: true as const }; });
  ipcMain.handle('ai:reset', (_e, episodeId: string) => { bridge.reset(String(episodeId)); return { ok: true as const }; });
  void bin; // 기동 시 1회 탐지는 status 채널로 충분 — 변수 미사용 경고 방지
  return { dispose: () => bridge.cancel() };
}
