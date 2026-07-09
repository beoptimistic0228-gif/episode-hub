import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpBridge } from '../src/main/mcpServer';

const TOKEN = 'a'.repeat(48);

function makeRoot() {
  const base = mkdtempSync(join(tmpdir(), 'mcphttp-'));
  const ep = 'ep20260709_test';
  const epDir = join(base, 'output', 'episodes', ep);
  mkdirSync(join(epDir, 'script'), { recursive: true });
  writeFileSync(join(epDir, 'script', 'draft.md'), '# hi');
  return { base, ep };
}

describe('MCP HTTP bridge', () => {
  let r: ReturnType<typeof makeRoot>;
  let handle: { port: number; stop: () => Promise<void> } | null = null;
  beforeEach(() => { r = makeRoot(); });
  afterEach(async () => { await handle?.stop(); handle = null; rmSync(r.base, { recursive: true, force: true }); });

  test('무토큰은 거부, 정상 토큰은 read_file 성공', async () => {
    handle = await startMcpBridge({ getRoot: () => r.base, token: TOKEN, port: 0 });
    const url = new URL(`http://127.0.0.1:${handle.port}/mcp`);

    const bad = new Client({ name: 'c', version: '0' });
    await expect(bad.connect(new StreamableHTTPClientTransport(url))).rejects.toBeTruthy();

    const good = new Client({ name: 'c', version: '0' });
    await good.connect(new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }));
    const res = await good.callTool({ name: 'read_file', arguments: { id: r.ep, relPath: 'script/draft.md' } });
    expect((res as { content: { text: string }[] }).content[0].text).toBe('# hi');
    await good.close();
  });
});
