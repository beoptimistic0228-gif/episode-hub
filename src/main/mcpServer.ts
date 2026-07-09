import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { completeEpisode, resolveGitRoot } from './git';
import { readStats } from './statsFetcher';
import { safeEpisodePath } from './pathGuard';
import { scanEpisodeDetail, scanEpisodes } from './scanner';
import { patchEpisode, saveRender, writeText, type EpisodePatch } from './writer';

export type GetRoot = () => string | null;

const ok = (data: unknown) => ({
  // read_file 처럼 이미 문자열이면 원문 그대로, 그 외(객체)는 JSON 직렬화.
  content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data) }],
});
const fail = (e: unknown) => ({
  content: [{ type: 'text' as const, text: String((e as Error)?.message ?? e) }],
  isError: true as const,
});

function requireRoot(getRoot: GetRoot): string {
  const root = getRoot();
  if (!root) throw new Error('orchestrator 루트 미설정');
  return root;
}

const patchShape = z.object({
  approve: z.object({ key: z.string() }).optional(),
  unapprove: z.object({ key: z.string() }).optional(),
  addPublication: z.object({ platform: z.string(), url: z.string().optional(), date: z.string() }).passthrough().optional(),
  removePublication: z.object({ index: z.number() }).optional(),
});

/** 8개 에피소드 tool을 MCP 서버에 등록한다. 모두 기존 순수 함수를 가드 경유로 호출. */
export function registerEpisodeTools(server: McpServer, getRoot: GetRoot): void {
  server.registerTool('list_episodes',
    { description: '모든 에피소드 요약(단계·그룹 수·발행·견적·조회수) 목록', inputSchema: {} },
    async () => {
      try {
        const root = requireRoot(getRoot);
        const videos = readStats(await resolveGitRoot(root)).videos;
        return ok(scanEpisodes(root, videos));
      } catch (e) { return fail(e); }
    });

  server.registerTool('read_episode',
    { description: '특정 에피소드 상세(그룹별 파일·episode.json)', inputSchema: { id: z.string().describe('ep<YYYYMMDD>_<slug>') } },
    async ({ id }) => {
      try { return ok(scanEpisodeDetail(requireRoot(getRoot), id)); } catch (e) { return fail(e); }
    });

  server.registerTool('read_file',
    { description: '에피소드 폴더 내 파일 텍스트 읽기(경로 탈출 차단)', inputSchema: { id: z.string(), relPath: z.string().describe('episodes/<id>/ 기준 상대경로') } },
    async ({ id, relPath }) => {
      try { return ok(readFileSync(safeEpisodePath(requireRoot(getRoot), id, relPath), 'utf-8')); } catch (e) { return fail(e); }
    });

  server.registerTool('get_channel_stats',
    { description: '채널 통계 로컬 캐시 조회(네트워크 수집 없음)', inputSchema: {} },
    async () => {
      try { return ok(readStats(await resolveGitRoot(requireRoot(getRoot)))); } catch (e) { return fail(e); }
    });

  server.registerTool('write_file',
    { description: '.md 파일 저장(expectedMtimeMs 주면 충돌 감지)', inputSchema: { id: z.string(), relPath: z.string(), content: z.string(), expectedMtimeMs: z.number().optional() } },
    async ({ id, relPath, content, expectedMtimeMs }) => {
      try { return ok(writeText(requireRoot(getRoot), id, relPath, content, expectedMtimeMs)); } catch (e) { return fail(e); }
    });

  server.registerTool('patch_episode',
    { description: 'episode.json 부분 병합 — 승인 게이트·발행 기록', inputSchema: { id: z.string(), patch: patchShape } },
    async ({ id, patch }) => {
      try { return ok(patchEpisode(requireRoot(getRoot), id, patch as EpisodePatch)); } catch (e) { return fail(e); }
    });

  server.registerTool('save_render',
    { description: 'SKU 렌더 이미지 저장(base64) → renders/<카테고리>__<row>.png', inputSchema: { id: z.string(), category: z.string(), row: z.string(), bytesBase64: z.string().describe('PNG 바이트의 base64'), overwrite: z.boolean().optional() } },
    async ({ id, category, row, bytesBase64, overwrite }) => {
      try {
        const bytes = new Uint8Array(Buffer.from(bytesBase64, 'base64'));
        return ok(saveRender(requireRoot(getRoot), id, category, row, bytes, overwrite));
      } catch (e) { return fail(e); }
    });

  server.registerTool('git_complete',
    { description: '해당 EP 폴더만 add→commit→push(이미지 제외)', inputSchema: { id: z.string() } },
    async ({ id }) => {
      try { return ok(await completeEpisode(requireRoot(getRoot), id)); } catch (e) { return fail(e); }
    });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : undefined;
}

export interface BridgeHandle { port: number; stop: () => Promise<void> }

/** 127.0.0.1 에 stateless Streamable HTTP MCP 서버를 띄운다. Bearer 토큰 검증. */
export function startMcpBridge(opts: {
  getRoot: GetRoot;
  token: string;
  port: number;
  path?: string;
}): Promise<BridgeHandle> {
  const path = opts.path ?? '/mcp';
  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      if ((req.url ?? '').split('?')[0] !== path) { res.writeHead(404).end(); return; }
      if (req.headers.authorization !== `Bearer ${opts.token}`) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; } // stateless: GET/DELETE 미지원
      try {
        const body = await readJsonBody(req);
        const server = new McpServer({ name: 'episode-hub', version: '0.1.0' });
        registerEpisodeTools(server, opts.getRoot);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String((e as Error)?.message ?? e) }));
        }
      }
    })();
  });
  return new Promise((resolve, reject) => {
    const onErr = (e: unknown) => reject(e);
    httpServer.once('error', onErr);
    httpServer.listen(opts.port, '127.0.0.1', () => {
      httpServer.removeListener('error', onErr);
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({ port, stop: () => new Promise<void>((r) => httpServer.close(() => r())) });
    });
  });
}
