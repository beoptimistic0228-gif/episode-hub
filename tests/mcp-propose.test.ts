import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerEpisodeTools } from '../src/main/mcpServer';
import { clearProposals, listProposals, setOnPropose } from '../src/main/proposalStore';

const EP = 'ep20260101_prop';

function makeRoot() {
  const base = mkdtempSync(join(tmpdir(), 'mcpprop-'));
  const epDir = join(base, 'output', 'episodes', EP, 'script');
  mkdirSync(epDir, { recursive: true });
  writeFileSync(join(epDir, '콘티.md'), '# 원본');
  return base;
}

async function connect(root: string, active: string | null) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEpisodeTools(server, () => root, () => null, { getActiveAskEpisode: () => active });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

const call = (c: Client, args: Record<string, unknown>) =>
  c.callTool({ name: 'propose_edit', arguments: { id: EP, relPath: 'script/콘티.md', newContent: '# 제안', reason: 'r', ...args } });
const isErr = (res: unknown) => (res as { isError?: boolean }).isError === true;

describe('propose_edit (MCP)', () => {
  let root: string;
  beforeEach(() => { clearProposals(); setOnPropose(null); root = makeRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('정상 제안 — 파일은 안 바뀌고 store에 pending 적재', async () => {
    const c = await connect(root, EP);
    const res = await call(c, {});
    expect(isErr(res)).toBe(false);
    const pending = listProposals(EP);
    expect(pending).toHaveLength(1);
    expect(pending[0].relPath).toBe('script/콘티.md');
    expect(pending[0].isNew).toBe(false);
  });

  test('진행 중 ask 없음 → 거절', async () => {
    const c = await connect(root, null);
    expect(isErr(await call(c, {}))).toBe(true);
    expect(listProposals(EP)).toHaveLength(0);
  });

  test('활성 에피소드 불일치 → 거절', async () => {
    const c = await connect(root, 'ep20260101_other');
    expect(isErr(await call(c, {}))).toBe(true);
  });

  test('경로 탈출 → 거절', async () => {
    const c = await connect(root, EP);
    expect(isErr(await call(c, { relPath: '../../탈출.md' }))).toBe(true);
  });

  test('비 .md → 거절', async () => {
    const c = await connect(root, EP);
    expect(isErr(await call(c, { relPath: 'episode.json' }))).toBe(true);
  });

  test('신규 파일 제안 — isNew=true', async () => {
    const c = await connect(root, EP);
    await call(c, { relPath: 'script/새파일.md' });
    expect(listProposals(EP)[0].isNew).toBe(true);
  });
});
