import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerEpisodeTools } from '../src/main/mcpServer';

function makeRoot() {
  const base = mkdtempSync(join(tmpdir(), 'mcptools-'));
  const ep = 'ep20260709_test';
  const epDir = join(base, 'output', 'episodes', ep);
  mkdirSync(join(epDir, 'script'), { recursive: true });
  writeFileSync(join(epDir, 'episode.json'), JSON.stringify({ schema_version: 1, title: 'T', stage: '', approvals: {} }));
  writeFileSync(join(epDir, 'script', 'draft.md'), '# hi');
  return { base, ep };
}

async function connect(root: string | null, imageRoot: string | null = null) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEpisodeTools(server, () => root, () => imageRoot);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}
const textOf = (res: unknown) => (res as { content: { text: string }[] }).content[0].text;

describe('episode tools (MCP)', () => {
  let r: ReturnType<typeof makeRoot>;
  beforeEach(() => { r = makeRoot(); });
  afterEach(() => { rmSync(r.base, { recursive: true, force: true }); });

  test('tools/list 는 8개 tool 노출', async () => {
    const c = await connect(r.base);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_channel_stats', 'git_complete', 'list_episodes', 'patch_episode',
      'read_episode', 'read_file', 'save_render', 'write_file',
    ]);
  });

  test('read_file 은 파일 내용 반환', async () => {
    const c = await connect(r.base);
    const res = await c.callTool({ name: 'read_file', arguments: { id: r.ep, relPath: 'script/draft.md' } });
    expect(textOf(res)).toBe('# hi');
  });

  test('write_file 저장 후 read_file 로 반영', async () => {
    const c = await connect(r.base);
    await c.callTool({ name: 'write_file', arguments: { id: r.ep, relPath: 'script/draft.md', content: '# bye' } });
    const res = await c.callTool({ name: 'read_file', arguments: { id: r.ep, relPath: 'script/draft.md' } });
    expect(textOf(res)).toBe('# bye');
  });

  test('경로 탈출은 isError 로 거부', async () => {
    const c = await connect(r.base);
    const res = await c.callTool({ name: 'read_file', arguments: { id: r.ep, relPath: '../../secret' } });
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  test('read_episode 경로 탈출 id 는 isError 로 거부', async () => {
    const c = await connect(r.base);
    const res = await c.callTool({ name: 'read_episode', arguments: { id: '../../../..' } });
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  test('patch_episode 승인 게이트 기록', async () => {
    const c = await connect(r.base);
    const res = await c.callTool({ name: 'patch_episode', arguments: { id: r.ep, patch: { approve: { key: 'script_final' } } } });
    const doc = JSON.parse(textOf(res)).doc;
    expect(doc.approvals.script_final.approved).toBe(true);
  });

  test('루트 미설정이면 isError', async () => {
    const c = await connect(null);
    const res = await c.callTool({ name: 'list_episodes', arguments: {} });
    expect((res as { isError?: boolean }).isError).toBe(true);
  });

  test('save_render 는 imageRoot/<id>/renders 에 저장', async () => {
    const imageRoot = mkdtempSync(join(tmpdir(), 'mcp-img-'));
    const c = await connect(r.base, imageRoot);
    const b64 = Buffer.from([1, 2, 3]).toString('base64');
    const res = await c.callTool({ name: 'save_render', arguments: { id: r.ep, category: '책상', row: 'row1', bytesBase64: b64 } });
    expect(textOf(res)).toContain('renders/책상__row1.png');
    expect(existsSync(join(imageRoot, r.ep, 'renders', '책상__row1.png'))).toBe(true);
    rmSync(imageRoot, { recursive: true, force: true });
  });

  test('save_render 는 imageRoot 미설정 시 isError', async () => {
    const c = await connect(r.base); // imageRoot null
    const b64 = Buffer.from([1]).toString('base64');
    const res = await c.callTool({ name: 'save_render', arguments: { id: r.ep, category: '책상', row: 'row1', bytesBase64: b64 } });
    expect((res as { isError?: boolean }).isError).toBe(true);
  });
});
