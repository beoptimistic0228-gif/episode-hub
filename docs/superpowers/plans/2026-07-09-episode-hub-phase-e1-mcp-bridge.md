# episode-hub Phase E1 — MCP 브리지 (AI→앱) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** episode-hub가 켜져 있을 때 localhost HTTP MCP 서버를 띄워, Claude Code가 에피소드 상태를 직접 읽고(list/detail/file/stats) 쓰고(md 저장·승인 게이트·렌더·git Complete) 그 결과가 앱 UI에 자동 반영되게 한다.

**Architecture:** Electron main에 MCP 서버(`@modelcontextprotocol/sdk` Streamable HTTP, stateless)를 내장한다. tool 핸들러는 IPC와 **병렬로 동일한 순수 함수**(`scanner`/`writer`/`git`/`statsFetcher`)를 `assertEpisodeId`/`safeEpisodePath` 가드 경유로 호출한다 — 새 도메인 로직 0, 새 공격면 0. AI write → 기존 chokidar watcher가 renderer 자동 갱신. `127.0.0.1` 바인드 + `Authorization: Bearer` 토큰. 토큰은 userData에 1회 생성, 셋업용 `.mcp.json`(gitignored)을 레포 루트에 자동 생성.

**Tech Stack:** Electron 31, TypeScript, `@modelcontextprotocol/sdk` (v1.29+, 신규 dep), `zod` (신규 dep), Node `http`, vitest.

## Global Constraints

- **바인드**: HTTP 서버는 `127.0.0.1`만. 외부 인터페이스 노출 금지.
- **인증**: 모든 요청 `Authorization: Bearer <token>` 필수, 불일치 시 401.
- **토큰 비노출**: 토큰은 `userData/mcp-bridge.json`에만. 레포에 커밋 금지. `.mcp.json`도 gitignored.
- **재사용 원칙**: 새 도메인 로직 금지 — 기존 `scanner`/`writer`/`git`/`statsFetcher` 함수를 그대로 호출. 모든 경로는 기존 가드(`assertEpisodeId`,`safeEpisodePath`) 경유.
- **비치명적 기동**: 포트 사용 중·git 루트 미발견 시 브리지만 스킵, 앱 UI/IPC/watcher는 정상.
- **신규 dep는 `dependencies`** (electron-builder 패키징 대상). `externalizeDepsPlugin`이 main에서 externalize.
- **tool 8종 고정** (spec §4): `list_episodes` `read_episode` `read_file` `get_channel_stats` `write_file` `patch_episode` `save_render` `git_complete`. 늘리지 말 것.
- **커밋 scope**: `episode-hub`. TDD, 잦은 커밋. Agent model은 `opus`/`haiku`만(sonnet 불가).
- **게이트**: 단위 그린 · `npm run typecheck` 0 · `npm run build` OK · e2e 그린.

---

## File Structure

- **Create** `episode-hub/src/main/mcpBridge.ts` — 토큰 load/generate(userData) + `.mcp.json` 생성/병합 + 포트/경로 상수. fs 기반, config.ts 스타일.
- **Create** `episode-hub/src/main/mcpServer.ts` — `registerEpisodeTools(server, getRoot)` (tool 8종 매핑) + `startMcpBridge({getRoot,token,port})` (Node http + Bearer 인증 + 생명주기).
- **Modify** `episode-hub/src/main/index.ts` — `registerIpc` 뒤 브리지 기동 + `.mcp.json` 기록, `will-quit`에서 stop.
- **Modify** `episode-hub/package.json` — `@modelcontextprotocol/sdk`·`zod`를 dependencies에 추가.
- **Modify** `.gitignore` (레포 루트) — `.mcp.json` 추가.
- **Create** `episode-hub/tests/mcp-bridge.test.ts` — 토큰 idempotent, `.mcp.json` 병합.
- **Create** `episode-hub/tests/mcp-tools.test.ts` — InMemoryTransport로 tool end-to-end + 가드.
- **Create** `episode-hub/tests/mcp-http.test.ts` — 실제 HTTP 클라이언트로 401/성공.

작업 디렉토리는 모든 명령에서 `episode-hub/` 기준 (단, 루트 `.gitignore`만 레포 루트).

---

## Task 1: 브리지 설정 모듈 (토큰 · `.mcp.json`) + 의존성

**Files:**
- Create: `episode-hub/src/main/mcpBridge.ts`
- Modify: `episode-hub/package.json` (dependencies)
- Modify: `.gitignore` (레포 루트 — `.mcp.json` 추가)
- Test: `episode-hub/tests/mcp-bridge.test.ts`

**Interfaces:**
- Produces:
  - `loadOrCreateToken(file: string): string` — userData 파일에서 토큰 읽거나 생성·저장(idempotent).
  - `writeMcpJson(gitRoot: string, port: number, token: string): string` — 레포 루트 `.mcp.json`에 `mcpServers['episode-hub']` http 엔트리 병합, 파일 경로 반환.
  - `MCP_PORT: number` (env `HUB_MCP_PORT` 또는 7801), `MCP_PATH = '/mcp'`.

- [ ] **Step 1: 의존성 설치**

Run:
```bash
cd episode-hub && npm install @modelcontextprotocol/sdk zod
```
Expected: `dependencies`에 두 패키지 추가, 설치 성공. (설치 후 `node -e "require('@modelcontextprotocol/sdk/package.json')"`로 존재 확인.)

- [ ] **Step 2: 실패 테스트 작성**

Create `episode-hub/tests/mcp-bridge.test.ts`:
```ts
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
```

- [ ] **Step 3: 실패 확인**

Run: `cd episode-hub && npx vitest run tests/mcp-bridge.test.ts`
Expected: FAIL — `Cannot find module '../src/main/mcpBridge'`.

- [ ] **Step 4: 구현**

Create `episode-hub/src/main/mcpBridge.ts`:
```ts
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
```

- [ ] **Step 5: 통과 확인**

Run: `cd episode-hub && npx vitest run tests/mcp-bridge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: 루트 `.gitignore`에 `.mcp.json` 추가**

레포 루트 `.gitignore` 끝에 다음 블록을 추가:
```
# episode-hub MCP 브리지 — 기기별 토큰·URL 포함(절대 커밋 금지)
.mcp.json
```
Run(확인): `cd .. && git check-ignore .mcp.json`
Expected: `.mcp.json` 출력(무시됨).

- [ ] **Step 7: 커밋**

```bash
cd episode-hub && git add package.json package-lock.json src/main/mcpBridge.ts tests/mcp-bridge.test.ts ../.gitignore
git commit -m "feat(episode-hub): MCP 브리지 토큰·.mcp.json 모듈 + deps

@modelcontextprotocol/sdk·zod 추가. userData에 토큰 1회 생성(idempotent),
레포 루트 .mcp.json(gitignored)에 http 엔트리 병합. Phase E1 Task 1."
```

---

## Task 2: 에피소드 tool 8종 등록 (`registerEpisodeTools`)

**Files:**
- Create: `episode-hub/src/main/mcpServer.ts` (이 태스크에서는 `registerEpisodeTools`만)
- Test: `episode-hub/tests/mcp-tools.test.ts`

**Interfaces:**
- Consumes (기존, 변경 없음): `scanEpisodes`,`scanEpisodeDetail` (`./scanner`); `writeText`,`patchEpisode`,`saveRender`,`EpisodePatch` (`./writer`); `safeEpisodePath` (`./pathGuard`); `readStats` (`./statsFetcher`); `resolveGitRoot`,`completeEpisode` (`./git`).
- Produces: `registerEpisodeTools(server: McpServer, getRoot: () => string | null): void` — 8 tool을 등록. 결과는 `{content:[{type:'text',text:JSON}]}`, 에러는 `{content:[...],isError:true}`.

- [ ] **Step 1: 실패 테스트 작성**

Create `episode-hub/tests/mcp-tools.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

async function connect(root: string | null) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEpisodeTools(server, () => root);
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
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd episode-hub && npx vitest run tests/mcp-tools.test.ts`
Expected: FAIL — `Cannot find module '../src/main/mcpServer'`.

- [ ] **Step 3: 구현**

Create `episode-hub/src/main/mcpServer.ts`:
```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completeEpisode, resolveGitRoot } from './git';
import { readStats } from './statsFetcher';
import { safeEpisodePath } from './pathGuard';
import { scanEpisodeDetail, scanEpisodes } from './scanner';
import { patchEpisode, saveRender, writeText, type EpisodePatch } from './writer';

export type GetRoot = () => string | null;

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd episode-hub && npx vitest run tests/mcp-tools.test.ts`
Expected: PASS (6 tests). (list_episodes/get_channel_stats는 tmp가 git repo가 아니므로 호출 테스트에서 제외 — tools/list 노출과 null-root isError만 검증.)

- [ ] **Step 5: 커밋**

```bash
cd episode-hub && git add src/main/mcpServer.ts tests/mcp-tools.test.ts
git commit -m "feat(episode-hub): MCP 에피소드 tool 8종 등록

기존 scanner/writer/git/statsFetcher를 가드 경유로 tool 매핑(새 로직 0).
InMemoryTransport로 read/write/patch/가드/미설정 e2e 검증. Phase E1 Task 2."
```

---

## Task 3: HTTP 서버 + Bearer 인증 + 앱 기동 배선

**Files:**
- Modify: `episode-hub/src/main/mcpServer.ts` (`startMcpBridge` 추가)
- Modify: `episode-hub/src/main/index.ts:53-77` (기동), `episode-hub/src/main/index.ts:79-81` (will-quit stop)
- Test: `episode-hub/tests/mcp-http.test.ts`

**Interfaces:**
- Consumes: `registerEpisodeTools` (Task 2), `loadOrCreateToken`,`writeMcpJson`,`MCP_PORT` (Task 1), `getRoot` (`./ipc`), `resolveGitRoot` (`./git`).
- Produces: `startMcpBridge(opts: { getRoot: GetRoot; token: string; port: number; path?: string }): Promise<{ port: number; stop: () => Promise<void> }>` — `127.0.0.1` 리슨, Bearer 검증, POST만 처리(stateless), 실제 바인드 포트·stop 반환.

- [ ] **Step 1: 실패 테스트 작성**

Create `episode-hub/tests/mcp-http.test.ts`:
```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd episode-hub && npx vitest run tests/mcp-http.test.ts`
Expected: FAIL — `startMcpBridge` export 없음.

- [ ] **Step 3: `startMcpBridge` 구현 (mcpServer.ts에 추가)**

`episode-hub/src/main/mcpServer.ts` 상단 import에 추가:
```ts
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
```
(기존 `import type { McpServer }`는 값 import로 바뀌므로 `type`을 제거하고 위 값 import로 합친다.)

파일 끝에 추가:
```ts
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
```

- [ ] **Step 4: HTTP 테스트 통과 확인**

Run: `cd episode-hub && npx vitest run tests/mcp-http.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: index.ts에 기동 배선**

`episode-hub/src/main/index.ts` import 블록(1~9행 부근)에 추가:
```ts
import { loadOrCreateToken, writeMcpJson, MCP_PORT } from './mcpBridge';
import { startMcpBridge, type BridgeHandle } from './mcpServer';
```
`stopWatcher`/`mainWin` 선언(36~37행 부근) 옆에 추가:
```ts
let bridge: BridgeHandle | null = null;
```
`app.whenReady().then(() => { ... })` 안, `registerIpc(...)` 호출 **직후**에 추가:
```ts
  void (async () => {
    try {
      const token = loadOrCreateToken(join(app.getPath('userData'), 'mcp-bridge.json'));
      bridge = await startMcpBridge({ getRoot, token, port: MCP_PORT });
      const root = getRoot();
      if (root) writeMcpJson(await resolveGitRoot(root), bridge.port, token);
    } catch {
      /* 포트 사용중·git 루트 미발견 등 — 브리지만 스킵, 앱은 정상 */
    }
  })();
```
(`join`,`app`,`getRoot`,`resolveGitRoot`는 이미 import돼 있음.)

`app.on('window-all-closed', ...)` 아래에 추가:
```ts
app.on('will-quit', () => {
  void bridge?.stop();
});
```

- [ ] **Step 6: 전체 단위 + 타입체크**

Run: `cd episode-hub && npm run test && npm run typecheck`
Expected: 전체 단위 그린(기존 + mcp 3파일), typecheck 0 에러.

- [ ] **Step 7: 커밋**

```bash
cd episode-hub && git add src/main/mcpServer.ts src/main/index.ts tests/mcp-http.test.ts
git commit -m "feat(episode-hub): HTTP MCP 브리지 서버 + Bearer 인증 + 앱 기동

127.0.0.1 stateless Streamable HTTP, POST만 처리, 무토큰 401.
앱 기동 시 토큰 로드·서버 리슨·.mcp.json 기록, will-quit에서 stop.
포트 사용중은 비치명적. 실 HTTP 클라이언트로 401/성공 검증. Phase E1 Task 3."
```

---

## Task 4: 게이트 검증 (build · e2e 회귀 · 수동 스모크)

**Files:** 없음(검증 전용). 필요 시 문서만.

- [ ] **Step 1: 빌드**

Run: `cd episode-hub && npm run build`
Expected: main/preload/renderer 빌드 성공, 에러 0. (SDK/zod가 main 번들에서 externalize되는지 확인 — 실패 시 `externalizeDepsPlugin`이 dependencies를 external 처리하므로 두 패키지가 `dependencies`에 있는지 재확인.)

- [ ] **Step 2: e2e 회귀**

Run: `cd episode-hub && npm run test:e2e`
Expected: 기존 12 그린 유지(브리지는 기존 UI 흐름에 영향 없음). 실패 시 원인 분석 — 브리지 기동 예외가 앱 부팅을 막지 않는지(try/catch 확인).

- [ ] **Step 3: 수동 스모크(문서화)**

다음 절차를 수행하고 결과를 최종 리뷰에 기록:
1. `cd episode-hub && npm run dev` 로 앱 실행 → 레포 루트에 `.mcp.json` 생성 확인(`git check-ignore .mcp.json`로 무시됨도 확인).
2. 별도 터미널에서 레포 루트에서 `claude` 실행 → `/mcp` 로 `episode-hub` 서버 연결 확인 → "에피소드 목록 보여줘"류로 `list_episodes` tool 동작 확인.
3. AI로 특정 EP의 md를 `write_file` → 실행 중인 앱 UI가 자동 갱신되는지 확인(watcher).
Expected: 3단계 모두 정상. (수동 단계이므로 실패 시 원인 기록 후 후속 픽스.)

- [ ] **Step 4: 최종 리뷰 요청**

`superpowers:requesting-code-review`로 전체 feat 브랜치 리뷰. 게이트 재확인: 단위 그린 · typecheck 0 · build OK · e2e 그린 · 수동 스모크 OK.

---

## Self-Review (계획 작성자 확인 완료)

- **Spec 커버리지**: §2 스코프(E1만) → Task 전반 E1 한정 ✓. §3 아키텍처(HTTP 서버·pure fn 재사용·watcher 갱신) → Task 2·3 ✓. §4 tool 8종 → Task 2 정확히 8개 ✓. §5 보안(127.0.0.1·Bearer·토큰 userData·.mcp.json gitignore) → Task 1·3 ✓. §6 테스트(단위·통합·e2e 회귀) → Task 1~4 ✓. §8 열린질문(SDK HTTP transport=stateless per-request 확정 / .mcp.json 병합=writeMcpJson 병합 확정) 해소 ✓.
- **플레이스홀더**: 없음. 모든 코드/명령/기대출력 명시.
- **타입 일관성**: `GetRoot`·`registerEpisodeTools`·`startMcpBridge`·`BridgeHandle`·`loadOrCreateToken`·`writeMcpJson`·`MCP_PORT` 명칭이 정의처와 소비처 전부 일치 ✓. tool 이름 8종이 spec §4·Task 2 테스트·계획 전반 동일 ✓.
- **비고**: SDK는 v1.29 클래식 API 기준(`registerTool` inputSchema=raw zod shape, `server/mcp.js`·`server/streamableHttp.js`·`client/streamableHttp.js`·`inMemory.js` import 경로). 설치 버전이 다르면 구현자가 import 경로만 설치본에 맞춰 조정.
