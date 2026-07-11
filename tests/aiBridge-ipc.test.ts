// registerAiIpc는 Electron 런타임 의존이라 electron 모듈을 mock하고
// "채널 4종 등록 + mcp-config 파일 생성"만 검증한다(로직 본체는 Task 1·2에서 검증 완료).
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const handles = new Map<string, unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: unknown) => handles.set(ch, fn) },
  BrowserWindow: { getAllWindows: () => [] },
}));

test('registerAiIpc — ai:* 채널 8종 등록 + ai-mcp-config.json 생성 + activeAskEpisode 노출', async () => {
  const { registerAiIpc } = await import('../src/main/aiIpc');
  const dir = mkdtempSync(join(tmpdir(), 'ai-ipc-'));
  const r = registerAiIpc({ userDataDir: dir, port: 7801, token: 'tok', getRoot: () => null });
  for (const ch of [
    'ai:status', 'ai:ask', 'ai:cancel', 'ai:reset',
    'ai:proposals', 'ai:proposalDiff', 'ai:applyProposal', 'ai:rejectProposal',
  ]) {
    expect(handles.has(ch)).toBe(true);
  }
  expect(r.getActiveAskEpisode()).toBeNull();
  expect(existsSync(join(dir, 'ai-mcp-config.json'))).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
