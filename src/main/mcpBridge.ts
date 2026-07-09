import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MCP_PORT = Number(process.env.HUB_MCP_PORT) || 7801;
export const MCP_PATH = '/mcp';

interface BridgeFile { token: string }

/** userData/mcp-bridge.json 에서 토큰을 읽고, 없거나 손상됐으면 생성·저장한다(idempotent). */
export function loadOrCreateToken(file: string): string {
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf-8')) as Partial<BridgeFile>;
    if (typeof cfg.token === 'string' && /^[0-9a-f]{48}$/.test(cfg.token)) return cfg.token;
  } catch {
    /* 없음/파손 → 재생성 */
  }
  const token = randomBytes(24).toString('hex'); // 48 hex chars
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ token } satisfies BridgeFile, null, 2), 'utf-8');
  return token;
}

/** Claude Code 프로젝트 스코프 .mcp.json 에 episode-hub http 엔트리를 병합한다(gitignored). */
export function writeMcpJson(gitRoot: string, port: number, token: string): string {
  const file = join(gitRoot, '.mcp.json');
  let doc: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      doc = {};
    }
  }
  if (!doc.mcpServers) doc.mcpServers = {};
  doc.mcpServers['episode-hub'] = {
    type: 'http',
    url: `http://127.0.0.1:${port}${MCP_PATH}`,
    headers: { Authorization: `Bearer ${token}` },
  };
  writeFileSync(file, JSON.stringify(doc, null, 2), 'utf-8');
  return file;
}
