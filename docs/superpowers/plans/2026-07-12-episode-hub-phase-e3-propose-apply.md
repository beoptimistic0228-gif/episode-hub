# Episode Hub Phase E3 — 제안→승인→적용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AskClaude 패널에서 자유 지시를 받아 Claude가 `propose_edit` MCP 도구로 수정안을 제안하고, 부부가 파일별로 골라 승인하면 앱(main)이 저장한다 — Claude의 쓰기 권한은 끝까지 0.

**Architecture:** E1 MCP 서버에 9번째 도구 `propose_edit`(스테이징 전용)를 추가하고, main의 `proposalStore` 싱글턴이 제안을 보관·상태 전이·적용(기존 `writeText` 재사용, mtime 충돌 감지)한다. E2 aiBridge는 allowedTools에 propose_edit 1종만 추가(DENY_TOOLS 불변), AskClaude 패널이 propose 이벤트를 모아 제안 카드(체크박스+줄 diff)로 표시한다.

**Tech Stack:** Electron(electron-vite)+React+TS, @modelcontextprotocol/sdk, vitest, Playwright-Electron. **신규 외부 의존성 없음** (줄 diff는 자체 LCS 구현).

**Spec:** `docs/superpowers/specs/2026-07-12-episode-hub-phase-e3-propose-apply-design.md`

## Global Constraints

- 저장 대상은 **보고 있는 에피소드 폴더 안 `.md`만** — `safeEpisodePath` 검증을 제출 시+적용 시 **이중**으로.
- aiBridge `DENY_TOOLS`(`Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch,Read,Glob,Grep,Task`)는 **한 글자도 바꾸지 않는다**.
- $0: 실 claude를 게이트 테스트에서 호출하지 않는다(스텁만). Anthropic SDK/API 키 금지.
- UI 카피는 쉬운 한국어(비개발자 부부). AI 출력·제안 내용은 신뢰 불가 입력 — md 렌더는 기존 `renderMarkdown`(DOMPurify)만, diff 행은 textContent로만 렌더(innerHTML 금지).
- 게이트: `npm run test` 그린 · `npm run typecheck` 0 · `npm run build` OK · `npm run test:e2e` 그린. 작업 디렉토리는 `C:\GitHub\episode-hub` (main 브랜치 직접).
- 커밋: `<type>(episode-hub): <subject>` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 푸터.
- vitest는 globals 모드(`describe/test/expect/vi` import 불필요) — 기존 tests/* 스타일을 따른다.

---

### Task 1: proposalStore — 제안 저장소(순수 계층)

**Files:**
- Create: `src/main/proposalStore.ts`
- Test: `tests/proposalStore.test.ts`

**Interfaces:**
- Consumes: 없음 (이 Task는 저장·상태 전이만; fs 연동은 Task 2)
- Produces: `ProposalItem`, `ProposalSummary`, `submitProposal(input): ProposalSummary`, `getProposal(itemId): ProposalItem | null`, `listProposals(episodeId): ProposalSummary[]`(pending만), `rejectProposals(episodeId, itemIds): ProposalSummary[]`, `setOnPropose(cb | null)`, `clearProposals()`(테스트 전용)

- [ ] **Step 1: Write the failing test**

`tests/proposalStore.test.ts`:

```ts
import {
  submitProposal, getProposal, listProposals, rejectProposals, setOnPropose, clearProposals,
  type ProposalSummary,
} from '../src/main/proposalStore';

describe('proposalStore — 저장·상태 전이', () => {
  beforeEach(() => { clearProposals(); setOnPropose(null); });

  const submit = (episodeId = 'ep20260101_a', relPath = 'script/콘티.md') =>
    submitProposal({ episodeId, relPath, newContent: '# 새 내용\n', reason: '톤 정리', baseMtimeMs: 123 });

  test('submitProposal — summary 반환(itemId 부여) + notifier 호출', () => {
    const seen: ProposalSummary[] = [];
    setOnPropose((s) => seen.push(s));
    const s = submit();
    expect(s.itemId).toBeTruthy();
    expect(s.status).toBe('pending');
    expect(s.isNew).toBe(false);
    expect(seen).toEqual([s]);
    expect(getProposal(s.itemId)?.newContent).toBe('# 새 내용\n');
  });

  test('baseMtimeMs=null(신규 파일)이면 isNew=true', () => {
    const s = submitProposal({ episodeId: 'ep20260101_a', relPath: 'osmu/new.md', newContent: 'x', reason: 'r', baseMtimeMs: null });
    expect(s.isNew).toBe(true);
  });

  test('listProposals — 해당 에피소드의 pending만', () => {
    const a = submit('ep20260101_a');
    submit('ep20260101_b');
    const rejected = submit('ep20260101_a', 'script/b.md');
    rejectProposals('ep20260101_a', [rejected.itemId]);
    expect(listProposals('ep20260101_a').map((s) => s.itemId)).toEqual([a.itemId]);
  });

  test('rejectProposals — pending→rejected, 남의 에피소드 id는 무시', () => {
    const a = submit('ep20260101_a');
    const done = rejectProposals('ep20260101_b', [a.itemId]); // 에피소드 불일치 — 처리 안 됨
    expect(done).toEqual([]);
    expect(getProposal(a.itemId)?.status).toBe('pending');
    rejectProposals('ep20260101_a', [a.itemId]);
    expect(getProposal(a.itemId)?.status).toBe('rejected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/proposalStore.test.ts`
Expected: FAIL — `Cannot find module '../src/main/proposalStore'`

- [ ] **Step 3: Write minimal implementation**

`src/main/proposalStore.ts`:

```ts
/** E3 제안 저장소 — Claude가 propose_edit로 제출한 수정안을 파일에 쓰지 않고 보관한다.
 *  실제 저장(applyProposals)은 부부 승인 후에만. 앱 메모리 전용(비영구 — spec §3). */

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed';

export interface ProposalItem {
  itemId: string;
  episodeId: string;
  relPath: string;
  newContent: string;
  reason: string;
  /** 제안 시점 대상 파일 mtime — 신규 파일 제안이면 null. 적용 시 충돌 감지 기준. */
  baseMtimeMs: number | null;
  status: ProposalStatus;
}

export interface ProposalSummary {
  itemId: string;
  episodeId: string;
  relPath: string;
  reason: string;
  status: ProposalStatus;
  isNew: boolean;
}

let seq = 0;
const items = new Map<string, ProposalItem>();
let onPropose: ((s: ProposalSummary) => void) | null = null;

const toSummary = (it: ProposalItem): ProposalSummary => ({
  itemId: it.itemId, episodeId: it.episodeId, relPath: it.relPath,
  reason: it.reason, status: it.status, isNew: it.baseMtimeMs === null,
});

export function setOnPropose(cb: ((s: ProposalSummary) => void) | null): void { onPropose = cb; }

export function submitProposal(input: {
  episodeId: string; relPath: string; newContent: string; reason: string; baseMtimeMs: number | null;
}): ProposalSummary {
  const item: ProposalItem = { itemId: `p${++seq}`, status: 'pending', ...input };
  items.set(item.itemId, item);
  const s = toSummary(item);
  onPropose?.(s);
  return s;
}

export function getProposal(itemId: string): ProposalItem | null { return items.get(itemId) ?? null; }

export function listProposals(episodeId: string): ProposalSummary[] {
  return [...items.values()].filter((it) => it.episodeId === episodeId && it.status === 'pending').map(toSummary);
}

export function rejectProposals(episodeId: string, itemIds: string[]): ProposalSummary[] {
  const done: ProposalSummary[] = [];
  for (const id of itemIds) {
    const it = items.get(id);
    if (!it || it.episodeId !== episodeId || it.status !== 'pending') continue;
    it.status = 'rejected';
    done.push(toSummary(it));
  }
  return done;
}

/** 테스트 전용 — 전부 비움 */
export function clearProposals(): void { items.clear(); seq = 0; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/proposalStore.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/proposalStore.ts tests/proposalStore.test.ts
git commit -m "feat(episode-hub): E3 proposalStore — 제안 보관·상태 전이(순수 계층)"
```

---

### Task 2: applyProposals + getProposalDiff — 승인 후 저장(이중 검증·충돌 감지)

**Files:**
- Modify: `src/main/proposalStore.ts` (Task 1 산출에 함수 2개 추가)
- Test: `tests/proposalStore-apply.test.ts`

**Interfaces:**
- Consumes: `writeText(root, id, relPath, content, expectedMtimeMs?): WriteTextResult`(`src/main/writer.ts` — `{ok:true;mtimeMs}` | `{conflict:true;currentMtimeMs}`, .md 아니면 throw), `safeEpisodePath(root, id, relPath)`(`src/main/pathGuard.ts` — 탈출 시 throw), `restoreIfNoTextDiff(root, id, relPath)`(`src/main/git.ts` — 비-git 폴더에서도 throw하지 않음, mcpServer write_file 미러)
- Produces: `ApplyResult`, `applyProposals(root, episodeId, itemIds, force?): Promise<ApplyResult[]>`, `getProposalDiff(root, itemId): { relPath; reason; oldText; newText } | null`

- [ ] **Step 1: Write the failing test**

`tests/proposalStore-apply.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  submitProposal, getProposal, applyProposals, getProposalDiff, clearProposals, setOnPropose,
} from '../src/main/proposalStore';

const EP = 'ep20260101_apply';

function makeRoot() {
  const base = mkdtempSync(join(tmpdir(), 'prop-apply-'));
  const epDir = join(base, 'output', 'episodes', EP, 'script');
  mkdirSync(epDir, { recursive: true });
  writeFileSync(join(epDir, '콘티.md'), '# 콘티\n\n원본\n');
  return base;
}
const contPath = (root: string) => join(root, 'output', 'episodes', EP, 'script', '콘티.md');

describe('applyProposals — 승인 후 저장', () => {
  let root: string;
  beforeEach(() => { clearProposals(); setOnPropose(null); root = makeRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const submitFor = (over: Partial<{ relPath: string; baseMtimeMs: number | null }> = {}) =>
    submitProposal({
      episodeId: EP, relPath: over.relPath ?? 'script/콘티.md',
      newContent: '# 콘티\n\n제안본\n', reason: 'r',
      baseMtimeMs: over.baseMtimeMs !== undefined ? over.baseMtimeMs : statSync(contPath(root)).mtimeMs,
    });

  test('정상 적용 — 파일 저장 + status=applied', async () => {
    const s = submitFor();
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs).toEqual([{ itemId: s.itemId, relPath: 'script/콘티.md', ok: true }]);
    expect(readFileSync(contPath(root), 'utf-8')).toBe('# 콘티\n\n제안본\n');
    expect(getProposal(s.itemId)?.status).toBe('applied');
  });

  test('mtime 충돌 — conflict 반환 + pending 유지, force=true면 적용', async () => {
    const s = submitFor({ baseMtimeMs: 1 }); // 디스크 mtime과 확실히 다름
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs).toEqual([{ itemId: s.itemId, relPath: 'script/콘티.md', conflict: true }]);
    expect(getProposal(s.itemId)?.status).toBe('pending');
    const forced = await applyProposals(root, EP, [s.itemId], true);
    expect(forced[0]).toEqual({ itemId: s.itemId, relPath: 'script/콘티.md', ok: true });
  });

  test('신규 파일 제안(baseMtimeMs=null)인데 그새 파일이 생겼으면 conflict', async () => {
    const s = submitFor({ relPath: 'script/new.md', baseMtimeMs: null });
    writeFileSync(join(root, 'output', 'episodes', EP, 'script', 'new.md'), '누가 먼저 만듦');
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs[0]).toEqual({ itemId: s.itemId, relPath: 'script/new.md', conflict: true });
  });

  test('신규 파일 제안 정상 적용 — 파일 생성', async () => {
    const s = submitFor({ relPath: 'script/new.md', baseMtimeMs: null });
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs[0]).toEqual({ itemId: s.itemId, relPath: 'script/new.md', ok: true });
    expect(existsSync(join(root, 'output', 'episodes', EP, 'script', 'new.md'))).toBe(true);
  });

  test('경로 탈출 제안은 적용 시 재검증에서 error + status=failed', async () => {
    // 제출 검증(mcpServer)을 우회해 store에 직접 심어도 적용 시 safeEpisodePath가 막는다(이중 검증).
    const s = submitProposal({ episodeId: EP, relPath: '../../탈출.md', newContent: 'x', reason: 'r', baseMtimeMs: null });
    const rs = await applyProposals(root, EP, [s.itemId]);
    expect(rs[0]).toHaveProperty('error');
    expect(getProposal(s.itemId)?.status).toBe('failed');
  });

  test('에피소드 불일치·비pending은 error 항목으로 보고', async () => {
    const s = submitFor();
    const rs = await applyProposals(root, 'ep20260101_other', [s.itemId, 'p없음']);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toHaveProperty('error');
    expect(rs[1]).toHaveProperty('error');
    expect(getProposal(s.itemId)?.status).toBe('pending'); // 원본 무손상
  });

  test('getProposalDiff — 디스크 원문(old)과 제안(new) 반환, 신규 파일은 old=""', async () => {
    const s = submitFor();
    const d = getProposalDiff(root, s.itemId);
    expect(d).toEqual({ relPath: 'script/콘티.md', reason: 'r', oldText: '# 콘티\n\n원본\n', newText: '# 콘티\n\n제안본\n' });
    const n = submitFor({ relPath: 'script/new.md', baseMtimeMs: null });
    expect(getProposalDiff(root, n.itemId)?.oldText).toBe('');
    expect(getProposalDiff(root, 'p없음')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/proposalStore-apply.test.ts`
Expected: FAIL — `applyProposals is not a function` (또는 export 없음)

- [ ] **Step 3: Write minimal implementation**

`src/main/proposalStore.ts`에 추가 (파일 상단에 import 추가):

```ts
import { existsSync, readFileSync } from 'node:fs';
import { safeEpisodePath } from './pathGuard';
import { writeText } from './writer';
import { restoreIfNoTextDiff } from './git';
```

파일 끝에 추가:

```ts
export type ApplyResult =
  | { itemId: string; relPath: string; ok: true }
  | { itemId: string; relPath: string; conflict: true }
  | { itemId: string; relPath: string; error: string };

/** 승인분만 저장. 경로는 적용 시 safeEpisodePath로 재검증(제출 시와 이중 — spec §5-6).
 *  충돌: 제안 이후 원본이 바뀌었으면(mtime) 저장하지 않고 conflict — UI가 "그래도 적용"(force) 제공. */
export async function applyProposals(
  root: string, episodeId: string, itemIds: string[], force = false,
): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const itemId of itemIds) {
    const it = items.get(itemId);
    if (!it || it.episodeId !== episodeId || it.status !== 'pending') {
      out.push({ itemId, relPath: it?.relPath ?? '?', error: '적용할 수 없는 제안이에요' });
      continue;
    }
    try {
      const full = safeEpisodePath(root, it.episodeId, it.relPath); // 이중 검증
      if (!force && it.baseMtimeMs === null && existsSync(full)) {
        out.push({ itemId, relPath: it.relPath, conflict: true }); // 신규 제안인데 그새 파일이 생김
        continue;
      }
      const res = writeText(root, it.episodeId, it.relPath, it.newContent, force ? undefined : it.baseMtimeMs ?? undefined);
      if ('conflict' in res) { out.push({ itemId, relPath: it.relPath, conflict: true }); continue; }
      await restoreIfNoTextDiff(root, it.episodeId, it.relPath); // 유령 dirty(EOL) 정리 — mcpServer write_file 미러
      it.status = 'applied';
      out.push({ itemId, relPath: it.relPath, ok: true });
    } catch (e) {
      it.status = 'failed';
      out.push({ itemId, relPath: it.relPath, error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

/** 비교 화면용 — 디스크 원문과 제안 전문. 목록 이벤트에는 요약만 싣고 전문은 이 경로로만(폭주 방지). */
export function getProposalDiff(root: string, itemId: string):
  { relPath: string; reason: string; oldText: string; newText: string } | null {
  const it = items.get(itemId);
  if (!it) return null;
  let oldText = '';
  try {
    const full = safeEpisodePath(root, it.episodeId, it.relPath);
    if (existsSync(full)) oldText = readFileSync(full, 'utf-8');
  } catch { /* 탈출 경로 등 — old는 빈 문자열로 */ }
  return { relPath: it.relPath, reason: it.reason, oldText, newText: it.newContent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/proposalStore-apply.test.ts tests/proposalStore.test.ts`
Expected: PASS (Task 1 회귀 포함)

- [ ] **Step 5: Commit**

```bash
git add src/main/proposalStore.ts tests/proposalStore-apply.test.ts
git commit -m "feat(episode-hub): E3 applyProposals — 승인 후 저장(이중 경로검증·mtime 충돌)"
```

---

### Task 3: mcpServer — `propose_edit` 도구 등록(검증 3중)

**Files:**
- Modify: `src/main/mcpServer.ts`
- Test: `tests/mcp-propose.test.ts` (신규), `tests/mcp-tools.test.ts` (tools/list 9종으로 갱신)

**Interfaces:**
- Consumes: Task 1 `submitProposal`, `clearProposals`, `listProposals`
- Produces: `registerEpisodeTools(server, getRoot, getImageRoot?, extras?)` — `extras: { getActiveAskEpisode?: () => string | null }`; `startMcpBridge(opts)`에 `getActiveAskEpisode?` 옵션 추가. MCP tool `propose_edit { id, relPath, newContent, reason }`

- [ ] **Step 1: Write the failing test**

`tests/mcp-propose.test.ts` (연결 헬퍼는 `tests/mcp-tools.test.ts` 패턴):

```ts
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
```

`tests/mcp-tools.test.ts`의 tools/list 단언을 9종으로 갱신:

```ts
  test('tools/list 는 9개 tool 노출', async () => {
    const c = await connect(r.base);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_channel_stats', 'git_complete', 'list_episodes', 'patch_episode',
      'propose_edit', 'read_episode', 'read_file', 'save_render', 'write_file',
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-propose.test.ts tests/mcp-tools.test.ts`
Expected: FAIL — propose_edit 미등록(`Tool propose_edit not found` 계열) + tools/list 8≠9

- [ ] **Step 3: Write minimal implementation**

`src/main/mcpServer.ts` 수정:

1. import 갱신 — 1행을 `import { existsSync, readFileSync, statSync } from 'node:fs';`로, 그리고 `import { submitProposal } from './proposalStore';` 추가.
2. `registerEpisodeTools` 시그니처에 extras 추가:

```ts
export interface EpisodeToolExtras {
  /** E3 — 앱 질문 패널에서 진행 중인 ask의 에피소드 id (없으면 propose_edit 전면 거절) */
  getActiveAskEpisode?: () => string | null;
}

export function registerEpisodeTools(
  server: McpServer, getRoot: GetRoot, getImageRoot: GetRoot = () => null, extras: EpisodeToolExtras = {},
): void {
```

3. `git_complete` 등록 다음(함수 끝)에 9번째 도구 추가:

```ts
  server.registerTool('propose_edit',
    {
      description: '파일을 직접 쓰지 않고 수정안을 앱 승인 카드에 제출(.md만). 부부가 승인해야 저장된다',
      inputSchema: {
        id: z.string(), relPath: z.string().describe('episodes/<id>/ 기준 상대경로 (.md만)'),
        newContent: z.string().describe('파일 전체의 새 내용'), reason: z.string().describe('한 줄 변경 이유'),
      },
    },
    async ({ id, relPath, newContent, reason }) => {
      try {
        const root = requireRoot(getRoot);
        const active = extras.getActiveAskEpisode?.() ?? null;
        if (!active || active !== id) throw new Error('앱 질문 패널에서 진행 중인 에피소드에만 제안할 수 있어요');
        if (!/\.md$/i.test(relPath)) throw new Error(`md 파일만 제안 가능: ${relPath}`);
        const full = safeEpisodePath(root, id, relPath); // 경로 탈출 차단(제출 시 1차)
        const baseMtimeMs = existsSync(full) ? statSync(full).mtimeMs : null;
        return ok(submitProposal({ episodeId: id, relPath, newContent, reason, baseMtimeMs }));
      } catch (e) { return fail(e); }
    });
```

4. `startMcpBridge` opts에 `getActiveAskEpisode?: () => string | null;` 추가하고, 내부 `registerEpisodeTools(server, opts.getRoot, opts.getImageRoot)` 호출을 `registerEpisodeTools(server, opts.getRoot, opts.getImageRoot, { getActiveAskEpisode: opts.getActiveAskEpisode })`로 변경.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp-propose.test.ts tests/mcp-tools.test.ts tests/mcp-http.test.ts`
Expected: PASS (기존 mcp 테스트 회귀 포함 — extras 미전달 경로는 default `{}`로 안전)

- [ ] **Step 5: Commit**

```bash
git add src/main/mcpServer.ts tests/mcp-propose.test.ts tests/mcp-tools.test.ts
git commit -m "feat(episode-hub): E3 propose_edit MCP 도구 — 스테이징 제출(검증 3중, 쓰기 없음)"
```

---

### Task 4: aiBridge — allowedTools 확장·프리앰블·activeEpisode

**Files:**
- Modify: `src/main/aiBridge.ts`
- Test: `tests/aiBridge-pure.test.ts` (갱신), `tests/aiBridge-active.test.ts` (신규)

**Interfaces:**
- Consumes: 기존 `READ_TOOLS`, `AiBridge`, `buildAskArgs`, `buildPrompt`
- Produces: `PROPOSE_TOOL = 'mcp__episode-hub__propose_edit'`, `ASK_TOOLS = [...READ_TOOLS, PROPOSE_TOOL]`, `AiBridge.activeEpisode(): string | null`, `AskEvent.kind`에 `'propose'` + 필드 `itemId?/relPath?/reason?/isNew?`

- [ ] **Step 1: Write the failing test**

`tests/aiBridge-pure.test.ts` 갱신 — import에 `ASK_TOOLS` 추가하고 buildAskArgs 첫 테스트의 allowed 단언을 교체:

```ts
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toBe(ASK_TOOLS.join(','));
    expect(allowed).toContain('mcp__episode-hub__propose_edit'); // E3 — 제안 1종만 추가
    expect(allowed).not.toMatch(/write_file|patch_episode|save_render|git_complete/);
```

buildPrompt describe에 테스트 추가:

```ts
  test('프리앰블에 propose_edit 제안 지침 포함(직접 쓰기 금지)', () => {
    const p = buildPrompt('ep-x', '콘티 고쳐줘', true);
    expect(p).toContain('propose_edit');
    expect(p).toContain('직접 고치지 말고');
  });
```

`tests/aiBridge-active.test.ts` (신규):

```ts
import { EventEmitter } from 'node:events';
import { AiBridge, type SpawnLike } from '../src/main/aiBridge';

function fakeChild() {
  const em = new EventEmitter();
  const child = {
    stdout: new EventEmitter() as unknown as NodeJS.ReadableStream,
    stderr: new EventEmitter() as unknown as NodeJS.ReadableStream,
    stdin: { end: () => {} } as unknown as NodeJS.WritableStream,
    on: (ev: 'close' | 'exit', cb: (code: number | null) => void) => em.on(ev, cb),
    kill: () => {},
  } as SpawnLike;
  return { child, exit: (code: number) => em.emit('exit', code) };
}

test('activeEpisode — ask 진행 중에만 에피소드 id 노출', () => {
  const f = fakeChild();
  const bridge = new AiBridge({ mcpConfigPath: 'x.json', onEvent: () => {}, spawnImpl: () => f.child });
  expect(bridge.activeEpisode()).toBeNull();
  bridge.ask('ep20260101_e2e', '콘티 고쳐줘');
  expect(bridge.activeEpisode()).toBe('ep20260101_e2e');
  f.exit(0);
  expect(bridge.activeEpisode()).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiBridge-pure.test.ts tests/aiBridge-active.test.ts`
Expected: FAIL — `ASK_TOOLS` export 없음 / `activeEpisode is not a function` / 프리앰블 미포함

- [ ] **Step 3: Write minimal implementation**

`src/main/aiBridge.ts` 수정:

1. `READ_TOOLS` 아래에 추가:

```ts
/** E3 — 제안 스테이징 도구. 실제 저장은 승인 후 앱(main)이 하므로 쓰기 권한이 아니다.
 *  진짜 쓰기 MCP 도구(write_file 등)와 내장 도구 차단(DENY_TOOLS)은 E2 그대로. */
export const PROPOSE_TOOL = 'mcp__episode-hub__propose_edit';
export const ASK_TOOLS = [...READ_TOOLS, PROPOSE_TOOL] as const;
```

2. `buildAskArgs`의 `'--allowedTools', READ_TOOLS.join(',')`를 `'--allowedTools', ASK_TOOLS.join(',')`로.
3. `buildPrompt` 프리앰블 배열에서 `'- 비개발자 부부가 읽습니다...'` 줄 다음에 추가:

```ts
    '- 수정 지시를 받으면 파일을 직접 고치지 말고 propose_edit 도구로 수정안을 제안하세요.',
    '  파일 전체의 새 내용을 제출하고, 지시받지 않은 파일은 제안하지 마세요. 제안은 부부가 앱에서 승인해야 저장됩니다.',
```

4. `AskEvent` 확장:

```ts
export interface AskEvent {
  kind: 'init' | 'text' | 'tool' | 'result' | 'error' | 'done' | 'propose';
  text?: string;
  tool?: string;
  sessionId?: string;
  episodeId?: string;
  itemId?: string;   // propose 전용
  relPath?: string;  // propose 전용
  reason?: string;   // propose 전용
  isNew?: boolean;   // propose 전용
}
```

5. `AiBridge`에 현재 에피소드 추적 추가 — 필드 `private current: string | null = null;`, `ask()`에서 `this.child = child;` 다음 줄에 `this.current = episodeId;`, `settle()`의 `this.child = null;` 다음 줄에 `this.current = null;`, 그리고 메서드:

```ts
  /** 진행 중 ask의 에피소드 id — propose_edit 검증(mcpServer extras)용 */
  activeEpisode(): string | null { return this.child ? this.current : null; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiBridge-pure.test.ts tests/aiBridge-active.test.ts tests/aiBridge-run.test.ts tests/aiBridge-ipc.test.ts`
Expected: PASS (E2 회귀 포함)

- [ ] **Step 5: Commit**

```bash
git add src/main/aiBridge.ts tests/aiBridge-pure.test.ts tests/aiBridge-active.test.ts
git commit -m "feat(episode-hub): E3 aiBridge — propose_edit 허용·제안 프리앰블·activeEpisode(DENY 불변)"
```

---

### Task 5: aiIpc·index.ts·preload — 배선(IPC 4종 + propose 브로드캐스트)

**Files:**
- Modify: `src/main/aiIpc.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/aiBridge-ipc.test.ts` (채널 8종으로 갱신)

**Interfaces:**
- Consumes: Task 1·2 store 함수 전부, Task 4 `bridge.activeEpisode()`
- Produces: `registerAiIpc(opts)` — opts에 `getRoot: () => string | null` 추가, 반환 `{ dispose(): void; getActiveAskEpisode(): string | null }`. IPC 채널 `ai:proposals`·`ai:proposalDiff`·`ai:applyProposal`·`ai:rejectProposal`. preload `window.hub.ai.{proposals, proposalDiff, applyProposal, rejectProposal}`

- [ ] **Step 1: Write the failing test**

`tests/aiBridge-ipc.test.ts`의 테스트를 갱신 (registerAiIpc 호출에 getRoot 추가 + 채널 8종):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/aiBridge-ipc.test.ts`
Expected: FAIL — `ai:proposals` 등 미등록 / `getActiveAskEpisode is not a function`

- [ ] **Step 3: Write minimal implementation**

`src/main/aiIpc.ts` 전체를 다음으로 교체:

```ts
import { ipcMain, BrowserWindow } from 'electron';
import { join } from 'node:path';
import {
  AiBridge, resolveClaudeBin, spawnClaude, writeAiMcpConfig, type AskEvent,
} from './aiBridge';
import {
  applyProposals, getProposalDiff, listProposals, rejectProposals, setOnPropose,
} from './proposalStore';

export function registerAiIpc(opts: {
  userDataDir: string; port: number; token: string; getRoot: () => string | null;
}): { dispose(): void; getActiveAskEpisode(): string | null } {
  const mcpConfigPath = writeAiMcpConfig(join(opts.userDataDir, 'ai-mcp-config.json'), opts.port, opts.token);
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

  // E3 — propose_edit가 store에 적재한 제안을 같은 ai:stream 경로로 패널에 알린다(서버 검증 통과분만).
  setOnPropose((s) => broadcast({
    kind: 'propose', episodeId: s.episodeId, itemId: s.itemId, relPath: s.relPath, reason: s.reason, isNew: s.isNew,
  }));

  ipcMain.handle('ai:status', () => ({ available: resolveClaudeBin() !== null, busy: bridge.busy() }));
  ipcMain.handle('ai:ask', (_e, episodeId: string, question: string) => {
    try { return bridge.ask(String(episodeId), String(question)); }
    catch (err) {
      console.error('[aiIpc] ai:ask 실패:', err);
      return { ok: false, message: '이 PC에서 Claude Code를 찾지 못했어요.' };
    }
  });
  ipcMain.handle('ai:cancel', () => { bridge.cancel(); return { ok: true as const }; });
  ipcMain.handle('ai:reset', (_e, episodeId: string) => { bridge.reset(String(episodeId)); return { ok: true as const }; });

  ipcMain.handle('ai:proposals', (_e, episodeId: string) => listProposals(String(episodeId)));
  ipcMain.handle('ai:proposalDiff', (_e, itemId: string) => {
    const root = opts.getRoot();
    if (!root) return null;
    return getProposalDiff(root, String(itemId));
  });
  ipcMain.handle('ai:applyProposal', (_e, episodeId: string, itemIds: string[], force?: boolean) => {
    const root = opts.getRoot();
    if (!root) throw new Error('orchestrator 루트가 설정되지 않았어요');
    return applyProposals(root, String(episodeId), (Array.isArray(itemIds) ? itemIds : []).map(String), force === true);
  });
  ipcMain.handle('ai:rejectProposal', (_e, episodeId: string, itemIds: string[]) =>
    rejectProposals(String(episodeId), (Array.isArray(itemIds) ? itemIds : []).map(String)));

  return {
    dispose: () => { bridge.cancel(); setOnPropose(null); },
    getActiveAskEpisode: () => bridge.activeEpisode(),
  };
}
```

`src/main/index.ts` 수정 — `app.whenReady()` 안에서 aiIpc 등록을 MCP 브리지 기동보다 **앞으로** 옮기고 getter를 넘긴다. 기존:

```ts
  void (async () => {
    try {
      bridge = await startMcpBridge({ getRoot, token: mcpToken, port: MCP_PORT, getImageRoot });
    } catch (e) { ... }
  })();

  const aiIpc = registerAiIpc({ userDataDir: app.getPath('userData'), port: MCP_PORT, token: mcpToken });
  app.on('before-quit', () => aiIpc.dispose());
```

를 다음으로:

```ts
  // E3 — propose_edit 검증에 진행 중 ask 에피소드가 필요해 aiIpc를 먼저 등록한다.
  const aiIpc = registerAiIpc({ userDataDir: app.getPath('userData'), port: MCP_PORT, token: mcpToken, getRoot });
  app.on('before-quit', () => aiIpc.dispose());

  void (async () => {
    try {
      bridge = await startMcpBridge({
        getRoot, token: mcpToken, port: MCP_PORT, getImageRoot,
        getActiveAskEpisode: aiIpc.getActiveAskEpisode,
      });
    } catch (e) {
      // 포트 사용중·git 루트 미발견 등 — 브리지만 스킵, 앱은 정상 (토큰은 e에 미포함)
      console.error('[mcp-bridge] start skipped:', e);
    }
  })();
```

`src/preload/index.ts` 수정 — import에 `import type { ProposalSummary, ApplyResult } from '../main/proposalStore';` 추가, `ai:` 객체에 4개 추가 (onStream 앞):

```ts
    proposals: (episodeId: string): Promise<ProposalSummary[]> =>
      ipcRenderer.invoke('ai:proposals', episodeId),
    proposalDiff: (itemId: string): Promise<{ relPath: string; reason: string; oldText: string; newText: string } | null> =>
      ipcRenderer.invoke('ai:proposalDiff', itemId),
    applyProposal: (episodeId: string, itemIds: string[], force?: boolean): Promise<ApplyResult[]> =>
      ipcRenderer.invoke('ai:applyProposal', episodeId, itemIds, force),
    rejectProposal: (episodeId: string, itemIds: string[]): Promise<ProposalSummary[]> =>
      ipcRenderer.invoke('ai:rejectProposal', episodeId, itemIds),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/aiBridge-ipc.test.ts` 이후 `npm run typecheck`
Expected: 테스트 PASS + typecheck 0 에러 (electron mock이 dialog 등 부재로 깨지면 mock 객체에 해당 스텁을 추가하지 말고 — aiIpc는 ipc.ts를 import하지 않으므로 발생하지 않아야 정상)

- [ ] **Step 5: Commit**

```bash
git add src/main/aiIpc.ts src/main/index.ts src/preload/index.ts tests/aiBridge-ipc.test.ts
git commit -m "feat(episode-hub): E3 IPC 배선 — 제안 브로드캐스트+승인 4채널, activeAsk 게이트 연결"
```

---

### Task 6: lineDiff — 줄 단위 diff(자체 LCS, 의존성 0)

**Files:**
- Create: `src/renderer/lib/lineDiff.ts`
- Test: `tests/lineDiff.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: `DiffRow = { type: 'same' | 'del' | 'add'; text: string }`, `lineDiff(oldText: string, newText: string): DiffRow[]`

- [ ] **Step 1: Write the failing test**

`tests/lineDiff.test.ts`:

```ts
import { lineDiff } from '../src/renderer/lib/lineDiff';

describe('lineDiff — 줄 단위 LCS', () => {
  test('동일 텍스트 → 전부 same', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' }, { type: 'same', text: 'b' },
    ]);
  });
  test('중간 삽입 → add 1줄', () => {
    expect(lineDiff('a\nc', 'a\nb\nc')).toEqual([
      { type: 'same', text: 'a' }, { type: 'add', text: 'b' }, { type: 'same', text: 'c' },
    ]);
  });
  test('중간 삭제 → del 1줄', () => {
    expect(lineDiff('a\nb\nc', 'a\nc')).toEqual([
      { type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' },
    ]);
  });
  test('교체 → del+add', () => {
    const rows = lineDiff('a\n원본\nc', 'a\n제안\nc');
    expect(rows).toContainEqual({ type: 'del', text: '원본' });
    expect(rows).toContainEqual({ type: 'add', text: '제안' });
    expect(rows.filter((r) => r.type === 'same')).toHaveLength(2);
  });
  test('신규 파일(old="") → 전부 add', () => {
    expect(lineDiff('', 'a\nb').every((r) => r.type === 'add')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lineDiff.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write minimal implementation**

`src/renderer/lib/lineDiff.ts`:

```ts
export type DiffRow = { type: 'same' | 'del' | 'add'; text: string };

/** 줄 단위 LCS diff — 대상이 소형 md(수천 줄 이하)라 O(n·m) DP로 충분, 외부 의존 없음. */
export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  const n = a.length;
  const m = b.length;
  // dp[i][j] = a[i..] vs b[j..]의 LCS 길이
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: a[i] }); i++; }
    else { rows.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] });
  while (j < m) rows.push({ type: 'add', text: b[j++] });
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lineDiff.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/lineDiff.ts tests/lineDiff.test.ts
git commit -m "feat(episode-hub): E3 lineDiff — 줄 단위 LCS diff(의존성 0)"
```

---

### Task 7: 제안 카드 UI — ProposalCard + AskClaude 통합 + 스타일

**Files:**
- Create: `src/renderer/components/ProposalCard.tsx`
- Modify: `src/renderer/components/AskClaude.tsx`, `src/renderer/brand.css`
- Test: 이 Task는 UI 조립 — `npm run typecheck` + `npm run build`가 게이트(동작 검증은 Task 8 e2e)

**Interfaces:**
- Consumes: Task 5 `window.hub.ai.{proposals, proposalDiff, applyProposal, rejectProposal}`, Task 6 `lineDiff`, Task 4 `AskEvent`(kind `'propose'`)
- Produces: `ProposalCardItem = { itemId; relPath; reason; isNew; status: 'pending'|'applied'|'rejected'|'failed'|'conflict' }`, `<ProposalCard episodeId items />`. CSS 클래스: `.proposal-card`, `.proposal-row`, `.diff-view`, `.diff-row.add/.del/.same` (e2e 셀렉터로 사용)

- [ ] **Step 1: ProposalCard 구현**

`src/renderer/components/ProposalCard.tsx`:

```tsx
import { useState } from 'react';
import { lineDiff, type DiffRow } from '../lib/lineDiff';

export type ProposalCardItem = {
  itemId: string;
  relPath: string;
  reason: string;
  isNew: boolean;
  status: 'pending' | 'applied' | 'rejected' | 'failed' | 'conflict';
};

const STATUS_LABEL: Record<ProposalCardItem['status'], string> = {
  pending: '', applied: '적용됨 ✓', rejected: '거부됨', failed: '실패',
  conflict: '파일이 그새 바뀌었어요 ⚠',
};

/** E3 제안 카드 — 파일별 체크박스로 골라 적용. diff 행은 textContent로만 렌더(innerHTML 금지). */
export default function ProposalCard({ episodeId, items: initial }: { episodeId: string; items: ProposalCardItem[] }) {
  const [items, setItems] = useState(initial);
  const [checked, setChecked] = useState<Set<string>>(new Set(initial.map((i) => i.itemId))); // 기본 전체 체크
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [busy, setBusy] = useState(false);

  const selectable = (it: ProposalCardItem) => it.status === 'pending' || it.status === 'conflict';
  const openItems = items.filter(selectable);
  const hasConflict = items.some((i) => i.status === 'conflict');

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const showDiff = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    const d = await window.hub.ai.proposalDiff(id);
    if (!d) return;
    setRows(lineDiff(d.oldText, d.newText));
    setOpen(id);
  };

  const applyStatuses = (rs: Awaited<ReturnType<typeof window.hub.ai.applyProposal>>) =>
    setItems((prev) => prev.map((it) => {
      const r = rs.find((x) => x.itemId === it.itemId);
      if (!r) return it;
      if ('ok' in r) return { ...it, status: 'applied' as const };
      if ('conflict' in r) return { ...it, status: 'conflict' as const };
      return { ...it, status: 'failed' as const };
    }));

  const apply = async (force: boolean) => {
    const ids = items.filter((it) => selectable(it) && checked.has(it.itemId)).map((it) => it.itemId);
    if (!ids.length) return;
    setBusy(true);
    try { applyStatuses(await window.hub.ai.applyProposal(episodeId, ids, force)); }
    catch { setItems((prev) => prev.map((it) => (checked.has(it.itemId) && selectable(it) ? { ...it, status: 'failed' } : it))); }
    setBusy(false);
  };

  const rejectAll = async () => {
    setBusy(true);
    try {
      await window.hub.ai.rejectProposal(episodeId, openItems.map((i) => i.itemId));
      setItems((prev) => prev.map((it) => (selectable(it) ? { ...it, status: 'rejected' } : it)));
    } catch { /* 거부 실패 — 상태 유지 */ }
    setBusy(false);
  };

  return (
    <div className="proposal-card">
      <div className="proposal-head">📝 수정 제안 — 적용할 파일을 골라주세요</div>
      {items.map((it) => (
        <div key={it.itemId}>
          <div className={`proposal-row ${it.status}`}>
            {selectable(it) && (
              <input type="checkbox" checked={checked.has(it.itemId)} disabled={busy} onChange={() => toggle(it.itemId)} />
            )}
            <button className="proposal-file" onClick={() => void showDiff(it.itemId)}>
              {it.relPath}{it.isNew ? ' (새 파일)' : ''}
            </button>
            <span className="proposal-reason">{it.reason}</span>
            {STATUS_LABEL[it.status] && <span className={`proposal-status ${it.status}`}>{STATUS_LABEL[it.status]}</span>}
          </div>
          {open === it.itemId && (
            <div className="diff-view">
              {rows.map((r, i) => <div key={i} className={`diff-row ${r.type}`}>{r.text || ' '}</div>)}
            </div>
          )}
        </div>
      ))}
      {openItems.length > 0 && (
        <div className="proposal-actions">
          <button className="chip" disabled={busy || !openItems.some((i) => checked.has(i.itemId))} onClick={() => void apply(false)}>
            선택한 파일 적용
          </button>
          {hasConflict && (
            <button className="chip" disabled={busy} onClick={() => void apply(true)}>그래도 적용</button>
          )}
          <button className="chip" disabled={busy} onClick={() => void rejectAll()}>모두 거부</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: AskClaude 통합**

`src/renderer/components/AskClaude.tsx` 수정:

1. import 추가: `import ProposalCard, { type ProposalCardItem } from './ProposalCard';`
2. Bubble 타입 교체:

```ts
type Bubble =
  | { role: 'user' | 'assistant' | 'error'; text: string }
  | { role: 'proposal'; items: ProposalCardItem[] };
```

3. ref 추가: `const turnProposalsRef = useRef<ProposalCardItem[]>([]);`
4. 마운트 effect(기존 `ai.status` effect)에 pending 복원 추가:

```ts
  useEffect(() => {
    void window.hub.ai.status().then((s) => { setAvailable(s.available); setBusy(s.busy); });
    void window.hub.ai.proposals(episodeId).then((pend) => {
      if (pend.length === 0) return;
      const items = pend.map((p) => ({ itemId: p.itemId, relPath: p.relPath, reason: p.reason, isNew: p.isNew, status: 'pending' as const }));
      setBubbles((b) => [...b, { role: 'proposal', items }]);
    });
  }, [episodeId]);
```

5. onStream 핸들러에 propose 수집 추가 (`if (ev.kind === 'tool')` 앞에):

```ts
    if (ev.kind === 'propose') {
      turnProposalsRef.current = [...turnProposalsRef.current, {
        itemId: ev.itemId ?? '', relPath: ev.relPath ?? '', reason: ev.reason ?? '',
        isNew: ev.isNew ?? false, status: 'pending',
      }];
      setStep('수정안 접수 중…');
    }
```

6. `done` 처리에서 assistant 말풍선 append 다음에 카드 확정:

```ts
      const proposals = turnProposalsRef.current;
      turnProposalsRef.current = [];
      if (proposals.length) setBubbles((b) => [...b, { role: 'proposal', items: proposals }]);
```

(주의: 기존 `done` 블록의 `liveRef` 캡처·정리 로직은 그대로 두고 그 뒤에 추가.)

7. 말풍선 렌더 분기에 proposal 추가:

```tsx
        {bubbles.map((b, i) =>
          b.role === 'proposal'
            ? <ProposalCard key={i} episodeId={episodeId} items={b.items} />
            : b.role === 'assistant'
              ? <div key={i} className="ask-bubble assistant md-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />
              : <div key={i} className={`ask-bubble ${b.role}`}>{b.text}</div>,
        )}
```

8. 패널 제목·placeholder 갱신 — `<h3>🤖 Claude에게 물어보기</h3>`는 유지하되 input placeholder를 `"물어보거나 시켜보세요 (예: 3번 대사 더 유쾌하게 고쳐줘)"`로 교체.

- [ ] **Step 3: 스타일 추가**

`src/renderer/brand.css` 끝에 추가 (기존 `.ask-panel` 계열 토큰·변수 스타일을 따를 것 — 색상은 파일 내 기존 CSS 변수 사용, 하드코딩 hex 최소화):

```css
/* ── E3 제안 카드 ─────────────────────────────── */
.proposal-card { border: 1px solid var(--border, #d8d3cb); border-radius: 12px; padding: 10px 12px; margin: 8px 0; background: var(--panel, #fff); }
.proposal-head { font-weight: 700; margin-bottom: 6px; }
.proposal-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.proposal-file { background: none; border: none; cursor: pointer; text-decoration: underline; font-family: inherit; padding: 0; }
.proposal-reason { opacity: 0.75; font-size: 0.9em; flex: 1; }
.proposal-status.applied { color: #2c7a3f; font-weight: 600; }
.proposal-status.rejected, .proposal-status.failed { color: #a33; }
.proposal-status.conflict { color: #b7791f; }
.proposal-actions { display: flex; gap: 8px; margin-top: 8px; }
.diff-view { max-height: 320px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 12px; border: 1px solid var(--border, #d8d3cb); border-radius: 8px; margin: 4px 0 8px; }
.diff-row { padding: 0 8px; white-space: pre-wrap; }
.diff-row.add { background: rgba(46, 160, 67, 0.18); }
.diff-row.del { background: rgba(248, 81, 73, 0.18); text-decoration: line-through; }
```

- [ ] **Step 4: 게이트 확인**

Run: `npm run typecheck` → 0 에러, `npm run build` → 성공, `npx vitest run` → 전부 PASS
Expected: 전부 그린

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ProposalCard.tsx src/renderer/components/AskClaude.tsx src/renderer/brand.css
git commit -m "feat(episode-hub): E3 제안 카드 UI — 파일별 체크·줄 diff·적용/거부(패널 통합)"
```

---

### Task 8: e2e — 스텁 propose 흐름 + 게이트 완주

**Files:**
- Modify: `e2e/stub/claude-stub.js`, `e2e/hub.e2e.ts`

**Interfaces:**
- Consumes: Task 3 propose_edit(HTTP MCP), Task 7 CSS 셀렉터(`.proposal-card`, `.diff-view`, `.diff-row.add`), 기존 e2e fixture(EP_ID `ep20260101_e2e`, `epDir`)
- Produces: e2e 테스트 ⑪ (지시→카드→적용→디스크 검증)

- [ ] **Step 1: 스텁 확장**

`e2e/stub/claude-stub.js` 전체 교체:

```js
// 실제 claude 대역. 기본: stdin(프롬프트)을 읽고 고정 stream-json을 뱉는다.
// 프롬프트에 '고쳐'가 있으면 argv의 --mcp-config 접속정보로 propose_edit를 실제 호출(E3 제안 흐름).
// require 해석은 이 파일 위치(e2e/stub/) 기준 상위 node_modules를 쓴다.
const { readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

let stdin = '';
process.stdin.resume();
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => { main().catch((e) => { process.stderr.write(String(e)); process.exit(1); }); });

async function main() {
  out({ type: 'system', subtype: 'init', session_id: 'stub-session-1' });
  if (stdin.includes('고쳐')) {
    const cfgFile = args[args.indexOf('--mcp-config') + 1];
    const cfg = JSON.parse(readFileSync(cfgFile, 'utf-8')).mcpServers['episode-hub'];
    const m = /지금 보고 있는 에피소드: (\S+)/.exec(stdin);
    if (!m) throw new Error('프리앰블에서 에피소드 id를 찾지 못함(새 대화가 아님?)');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'stub', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } }));
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__episode-hub__propose_edit', input: {} }] } });
    const res = await client.callTool({
      name: 'propose_edit',
      arguments: { id: m[1], relPath: 'script/콘티.md', newContent: '# 콘티\n\nE2E-PROPOSED\n', reason: '더 유쾌한 톤으로 정리' },
    });
    await client.close();
    if (res.isError) throw new Error('propose_edit 거절: ' + JSON.stringify(res.content));
    out({ type: 'result', subtype: 'success', is_error: false, result: '수정안을 제안했어요. 아래 카드에서 확인해 주세요.', session_id: 'stub-session-1' });
  } else {
    out({ type: 'assistant', message: { content: [{ type: 'text', text: '스텁 답변: 총 예산은 **667,250원**입니다.' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: '스텁 답변: 총 예산은 **667,250원**입니다.', session_id: 'stub-session-1' });
  }
  process.exit(0);
}
```

- [ ] **Step 2: e2e 테스트 ⑪ 추가**

`e2e/hub.e2e.ts` 끝(⑩ 다음)에 추가:

```ts
// ── E3 제안→승인→적용: 스텁이 propose_edit를 실제 호출 → 카드 → 적용 → 디스크 검증 ──────
test('⑪ E3 수정 지시: 제안 카드 → 선택 적용 → 파일 반영', async () => {
  // ⑩이 stub-session-1을 남겼음 — resume이면 프리앰블(에피소드 id)이 없어 스텁이 실패하므로 새 대화로 시작.
  await page.getByRole('button', { name: '새 대화' }).click();
  const input = page.locator('.ask-input');
  await input.fill('콘티 고쳐줘');
  await input.press('Enter');

  const card = page.locator('.proposal-card').last();
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText('script/콘티.md');
  await expect(card).toContainText('더 유쾌한 톤으로 정리');

  // 파일명 클릭 → 줄 diff 표시(추가 행 존재)
  await card.locator('.proposal-file').click();
  await expect(page.locator('.diff-view .diff-row.add').first()).toBeVisible();

  // 기본 전체 체크 상태 → 적용 → 디스크 반영 + 카드 상태 갱신
  await card.getByRole('button', { name: '선택한 파일 적용' }).click();
  await expect
    .poll(() => readFileSync(join(epDir, 'script', '콘티.md'), 'utf-8'))
    .toBe('# 콘티\n\nE2E-PROPOSED\n');
  await expect(card).toContainText('적용됨');
});
```

- [ ] **Step 3: 게이트 완주**

Run (순서대로, 모두 `C:\GitHub\episode-hub`):
1. `npx vitest run` → 전부 PASS
2. `npm run typecheck` → 0 에러
3. `npm run test:e2e` → ①~⑪ 전부 PASS (build 포함)

Expected: 전부 그린. ⑪ 실패 시 스텁 stderr가 aiBridge 에러 말풍선으로 노출되므로 Playwright 트레이스에서 원인 확인 가능.

- [ ] **Step 4: Commit**

```bash
git add e2e/stub/claude-stub.js e2e/hub.e2e.ts
git commit -m "test(episode-hub): E3 e2e — 스텁 propose_edit 실호출 → 카드 → 적용 흐름 + 게이트 완주"
```

---

### Task 9: 문서 갱신 (CLAUDE.md — E3 완료·도구 9종·다음 단계)

**Files:**
- Modify: `CLAUDE.md` (episode-hub 레포 루트)

**Interfaces:**
- Consumes: 완료된 Task 1~8
- Produces: 최신 상태를 반영한 운영 문서

- [ ] **Step 1: CLAUDE.md 수정**

1. §"MCP 브리지" — "tool 8종"을 "tool 9종"으로 갱신하고 나열에 `propose_edit` 추가.
2. 같은 섹션의 E2 문단 다음에 E3 문단 추가:

```markdown
**E3(앱→AI 자유 지시, 제안→승인→적용)**: 같은 패널에서 수정 지시 — 스폰된 Claude는 `propose_edit`(스테이징)로 수정안만 제출하고(쓰기 권한 0, DENY_TOOLS 불변), 부부가 제안 카드에서 파일별로 골라 승인하면 main이 `writeText`(mtime 충돌 감지)로 저장한다. 대상은 보고 있는 에피소드의 `.md`만. 핵심: `src/main/proposalStore.ts`. 설계 `docs/superpowers/specs/2026-07-12-episode-hub-phase-e3-propose-apply-design.md`.
```

3. §"다음" 교체:

```markdown
## 다음
- **파이프라인 구동·작업 큐**(E3 후속): 앱에서 팀/에이전트 단계 실행 버튼 + 와이프→Owner 작업 큐(PC 간 동기화 설계 필요). E3 제안 게이트·aiBridge 재사용.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(episode-hub): E3 완료 반영 — 도구 9종·제안 게이트, 다음=파이프라인 구동·작업 큐"
```

---

## Self-Review 체크 결과

- **Spec coverage**: §5-1 propose_edit(Task 3) · §5-2 proposalStore(Task 1·2) · §5-3 aiBridge(Task 4) · §5-4 IPC/preload(Task 5) · §5-5 카드 UI(Task 7, diff는 Task 6) · §5-6 적용(Task 2·5) · §6 에러(Task 2·3·7) · §7 테스트(Task 1~8, spec의 "spawn 통합"은 store-레벨 통합 + e2e 실호출로 커버 — 스텁이 HTTP로 propose_edit를 실제 호출하므로 서버→store→이벤트→적용 전 구간이 e2e에서 이어짐).
- **Placeholder scan**: 통과 (모든 코드 스텝에 전체 코드 포함).
- **Type consistency**: `ProposalSummary`/`ApplyResult`(Task 1·2 정의 → Task 5 preload·Task 7 UI 소비), `ASK_TOOLS`/`activeEpisode`(Task 4 → Task 5), CSS 셀렉터(Task 7 → Task 8 e2e) 일치 확인.
