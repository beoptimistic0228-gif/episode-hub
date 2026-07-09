import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateToken, writeMcpJson } from '../src/main/mcpBridge';

describe('mcpBridge', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcpbridge-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test('loadOrCreateToken: 최초 생성 후 재호출 시 동일 토큰', () => {
    const file = join(dir, 'sub', 'mcp-bridge.json'); // 없는 디렉토리도 생성돼야
    const t1 = loadOrCreateToken(file);
    expect(t1).toMatch(/^[0-9a-f]{48}$/);
    expect(existsSync(file)).toBe(true);
    const t2 = loadOrCreateToken(file);
    expect(t2).toBe(t1);
  });

  test('writeMcpJson: episode-hub http 엔트리 생성', () => {
    const p = writeMcpJson(dir, 7801, 'tok123');
    expect(p).toBe(join(dir, '.mcp.json'));
    const doc = JSON.parse(readFileSync(p, 'utf-8'));
    expect(doc.mcpServers['episode-hub']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:7801/mcp',
      headers: { Authorization: 'Bearer tok123' },
    });
  });

  test('writeMcpJson: 기존 다른 서버 보존(병합)', () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { type: 'stdio' } } }));
    writeMcpJson(dir, 7801, 'tok123');
    const doc = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(doc.mcpServers.other).toEqual({ type: 'stdio' });
    expect(doc.mcpServers['episode-hub'].url).toBe('http://127.0.0.1:7801/mcp');
  });
});
