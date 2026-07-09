import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { completeEpisode, resolveGitRoot, restoreIfNoTextDiff } from './git';
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
export function registerEpisodeTools(server: McpServer, getRoot: GetRoot, getImageRoot: GetRoot = () => null): void {
  server.registerTool('list_episodes',
    { description: '모든 에피소드 요약(단계·그룹 수·발행·견적·조회수) 목록', inputSchema: {} },
    async () => {
      try {
        const root = requireRoot(getRoot);
        const videos = readStats(await resolveGitRoot(root)).videos;
        return ok(scanEpisodes(root, videos, getImageRoot()));
      } catch (e) { return fail(e); }
    });

  server.registerTool('read_episode',
    { description: '특정 에피소드 상세(그룹별 파일·episode.json)', inputSchema: { id: z.string().describe('ep<YYYYMMDD>_<slug>') } },
    async ({ id }) => {
      try { return ok(scanEpisodeDetail(requireRoot(getRoot), id, getImageRoot())); } catch (e) { return fail(e); }
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
      try {
        const root = requireRoot(getRoot);
        const res = writeText(root, id, relPath, content, expectedMtimeMs);
        if ('ok' in res) await restoreIfNoTextDiff(root, id, relPath); // 내용 원복 시 유령 dirty(EOL) 제거 (ipc.ts:83 미러)
        return ok(res);
      } catch (e) { return fail(e); }
    });

  server.registerTool('patch_episode',
    { description: 'episode.json 부분 병합 — 승인 게이트·발행 기록', inputSchema: { id: z.string(), patch: patchShape } },
    async ({ id, patch }) => {
      try {
        const root = requireRoot(getRoot);
        const res = patchEpisode(root, id, patch as EpisodePatch);
        await restoreIfNoTextDiff(root, id, 'episode.json'); // 승인 토글 원복 등 유령 dirty 정리 (ipc.ts:116 미러)
        return ok(res);
      } catch (e) { return fail(e); }
    });

  server.registerTool('save_render',
    { description: 'SKU 렌더 이미지 저장(base64) → renders/<카테고리>__<row>.png', inputSchema: { id: z.string(), category: z.string(), row: z.string(), bytesBase64: z.string().describe('PNG 바이트의 base64'), overwrite: z.boolean().optional() } },
    async ({ id, category, row, bytesBase64, overwrite }) => {
      try {
        const imageRoot = getImageRoot();
        if (!imageRoot) throw new Error('이미지 폴더 미설정 — 이미지 동기 폴더를 먼저 선택하세요');
        const bytes = new Uint8Array(Buffer.from(bytesBase64, 'base64'));
        return ok(saveRender(imageRoot, id, category, row, bytes, overwrite));
      } catch (e) { return fail(e); }
    });

  server.registerTool('git_complete',
    { description: '해당 EP 폴더만 add→commit→push(이미지 제외)', inputSchema: { id: z.string() } },
    async ({ id }) => {
      try { return ok(await completeEpisode(requireRoot(getRoot), id)); } catch (e) { return fail(e); }
    });
}

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB — 과대 본문 파싱 전 차단

/** 본문 상한 초과 신호 — 핸들러가 413으로 응답(서버/트랜스포트 생성 전) */
class PayloadTooLargeError extends Error {}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy(); // 수신 중단 — 나머지 바이트 소비 안 함
      throw new PayloadTooLargeError('요청 본문이 너무 큽니다');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : undefined;
}

/** Bearer 토큰 상수시간 비교 — 헤더 누락·형식오류·불일치 시 false */
function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const presented = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(token);
  // timingSafeEqual은 길이 불일치 시 throw — 사전 길이 체크로 회피(길이 노출은 무해)
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export interface BridgeHandle { port: number; stop: () => Promise<void> }

/** 127.0.0.1 에 stateless Streamable HTTP MCP 서버를 띄운다. Bearer 토큰 검증. */
export function startMcpBridge(opts: {
  getRoot: GetRoot;
  token: string;
  port: number;
  path?: string;
  getImageRoot?: GetRoot;
}): Promise<BridgeHandle> {
  const path = opts.path ?? '/mcp';
  const httpServer: Server = createServer((req, res) => {
    void (async () => {
      if ((req.url ?? '').split('?')[0] !== path) { res.writeHead(404).end(); return; }
      if (!isAuthorized(req, opts.token)) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; } // stateless: GET/DELETE 미지원
      try {
        const body = await readJsonBody(req);
        const server = new McpServer({ name: 'episode-hub', version: '0.1.0' });
        registerEpisodeTools(server, opts.getRoot, opts.getImageRoot);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (e) {
        if (res.headersSent) return;
        if (e instanceof PayloadTooLargeError) {
          res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'payload too large' }));
          return;
        }
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String((e as Error)?.message ?? e) }));
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
