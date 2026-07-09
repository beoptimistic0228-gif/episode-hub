# Episode Hub Phase B (쓰기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase A(읽기 전용) Episode Hub에 쓰기 3종 — md 편집 저장 · SKU 렌더 이미지 드롭 저장 · 승인/stage `episode.json` 기록 — 을 추가한다.

**Architecture:** 모든 쓰기는 main 프로세스 `src/main/writer.ts`의 순수 함수(루트를 인자로 받음 — `scanner.ts`와 동일 패턴)가 담당하고 `pathGuard.safeEpisodePath`로 경로를 가둔다. IPC(`ipc.ts`)가 `getRoot()`로 래핑, preload가 타입 안전 브릿지를 노출, renderer는 store 액션으로 호출한다. 상태 갱신은 기존 chokidar watcher(`episodes:changed`) + store의 명시적 재조회로 처리한다(DB 없음, fs=단일 진실).

**Tech Stack:** electron-vite · React 18 · TypeScript · zustand · vitest(node env, temp-dir 단위 테스트) · marked.

## Global Constraints

- **$0 — 신규 런타임 의존성 추가 금지.** 표준 라이브러리 + 기존 deps만.
- **모든 쓰기 경로는 `safeEpisodePath(root, id, relPath)`를 통과**한다(상위 탈출 차단). renderer는 fs에 직접 접근하지 않는다(preload 브릿지만).
- **fs = 단일 진실.** 쓰기 후 별도 상태 저장 없음 — watcher `episodes:changed` + store 명시적 재조회로 갱신.
- **이미지는 `File.path`에 의존하지 않는다** — renderer가 `File.arrayBuffer()`로 읽어 바이트를 IPC로 전달, main이 경로 전량 검증.
- **화이트리스트 강제:** writeText는 `.md`만 · saveRender row는 `RENDER_ROWS`만 · patch stage는 `STAGES`만 · `episode.json`은 `schema_version===1`만.
- **원자적 저장:** temp 파일 write 후 rename(부분 쓰기 방지).
- **테스트는 `episode-hub/tests/**/*.test.ts`** 에 두고 `scanner.test.ts` 패턴(mkdtempSync temp dir, vitest globals) 미러. main·shared만 단위 테스트; renderer는 `npm run typecheck` + 수동 dev 스모크로 검증(Phase A 관례).
- **커밋 컨벤션:** `<type>(episode-hub): <제목>`. 모든 명령은 `episode-hub/`에서 실행.
- **UI 카피는 한국어.**

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/shared/episode.ts` | 승인 게이트·row·stage 상수 + `ApprovalRecord` 타입 + `normCategory` 공유 유틸 | **신규** |
| `src/shared/types.ts` | `EpisodeDoc.approvals` 타입 구체화 | 수정 |
| `src/renderer/lib/promptMatch.ts` | 로컬 `norm` → 공유 `normCategory` 사용 | 수정 |
| `src/main/writer.ts` | 쓰기 3종 순수 함수(root 인자) | **신규** |
| `src/main/ipc.ts` | 쓰기 IPC 3종 등록 | 수정 |
| `src/preload/index.ts` | `hub.files.writeText`·`hub.renders.save`·`hub.episode.patch` 노출 | 수정 |
| `src/renderer/store/useHub.ts` | `writeText`·`saveRender`·`patchEpisode` 액션 | 수정 |
| `src/renderer/components/MarkdownEditor.tsx` | md 보기/편집 토글 + 저장 + 충돌 배너 | **신규** |
| `src/renderer/components/GroupDetail.tsx` | md 렌더를 `MarkdownEditor`로 교체 | 수정 |
| `src/renderer/components/PromptsWorkbench.tsx` | SKU 카드 row1/row2 드롭존 + 진행률 | 수정 |
| `src/renderer/components/EpisodeView.tsx` | 승인 스트립(게이트 토글 + stage 셀렉트) | 수정 |
| `src/renderer/slack.css` | 편집기·드롭존·승인 스트립 스타일 | 수정 |
| `tests/shared-episode.test.ts` · `tests/writer-*.test.ts` | 단위 테스트 | **신규** |

`api.d.ts`는 `HubApi`에서 파생되므로 수정 불필요.

---

### Task 1: shared 상수·타입 + normCategory 공유 유틸

**Files:**
- Create: `src/shared/episode.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/lib/promptMatch.ts`
- Test: `tests/shared-episode.test.ts`

**Interfaces:**
- Produces:
  - `ApprovalRecord = { approved?: boolean; by?: string; at?: string }`
  - `APPROVAL_GATES: readonly { key: string; label: string }[]`
  - `RenderRow = 'row1' | 'row2'`, `RENDER_ROWS: readonly RenderRow[]`
  - `STAGES: readonly string[]`
  - `normCategory(s: string): string`

- [ ] **Step 1: Write the failing test**

`tests/shared-episode.test.ts`:
```ts
import { normCategory, APPROVAL_GATES, RENDER_ROWS, STAGES } from '@shared/episode';

test('normCategory — 공백 압축→언더스코어 + trim', () => {
  expect(normCategory('  게이밍 데스크 ')).toBe('게이밍_데스크');
  expect(normCategory('책상')).toBe('책상');
  expect(normCategory('a  b\tc')).toBe('a_b_c');
});

test('상수 형태', () => {
  expect(APPROVAL_GATES.map((g) => g.key)).toEqual(['moodboard', 'script_final']);
  expect(RENDER_ROWS).toEqual(['row1', 'row2']);
  expect(STAGES).toContain('렌더');
  expect(STAGES).toContain('완료');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared-episode.test.ts`
Expected: FAIL — `@shared/episode` 모듈 없음.

- [ ] **Step 3: Create `src/shared/episode.ts`**

```ts
export interface ApprovalRecord {
  approved?: boolean;
  by?: string;
  at?: string;
}

// 고정 Owner 게이트 (스펙 §2). 확장 시 이 배열만 수정.
export const APPROVAL_GATES = [
  { key: 'moodboard', label: '무드보드' },
  { key: 'script_final', label: '콘티 FINAL' },
] as const;

export type RenderRow = 'row1' | 'row2';
export const RENDER_ROWS: readonly RenderRow[] = ['row1', 'row2'];

// episode.json stage 허용 값 (스튜디오 보드 스테이지 체인과 정합)
export const STAGES = [
  '기획', '디자인', '리서치', '확정룸', '렌더',
  '생성', '제작', '검수', '발행대기', '완료',
] as const;

/** 카테고리 정규화 — 렌더 파일명·사진 매칭 공통 규칙 (공백→_ + trim) */
export function normCategory(s: string): string {
  return s.trim().replace(/\s+/g, '_');
}
```

- [ ] **Step 4: Refine `src/shared/types.ts` approvals 타입**

`import type { GroupKey } from './groups';` 아래에 추가:
```ts
import type { ApprovalRecord } from './episode';
```
그리고 `EpisodeDoc`의 `approvals` 줄을 교체:
```ts
  approvals: Record<string, ApprovalRecord>;
```

- [ ] **Step 5: `promptMatch.ts`가 공유 유틸을 쓰도록 교체**

`src/renderer/lib/promptMatch.ts`에서 로컬 `const norm = ...` 줄을 삭제하고 상단 import에 추가:
```ts
import { normCategory } from '@shared/episode';
```
`matchPhoto` 내부의 `const token = norm(category.trim());`를 교체:
```ts
  const token = normCategory(category);
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/shared-episode.test.ts tests/promptMatch.test.ts && npm run typecheck`
Expected: PASS (기존 promptMatch 테스트 회귀 없음) + 타입 오류 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/episode.ts src/shared/types.ts src/renderer/lib/promptMatch.ts tests/shared-episode.test.ts
git commit -m "feat(episode-hub): Phase B 공유 상수·타입 + normCategory 유틸"
```

---

### Task 2: writer.writeText — md 저장 + mtime 충돌 검사

**Files:**
- Create: `src/main/writer.ts`
- Test: `tests/writer-writeText.test.ts`

**Interfaces:**
- Consumes: `safeEpisodePath` from `./pathGuard`
- Produces:
  - `type WriteTextResult = { ok: true; mtimeMs: number } | { conflict: true; currentMtimeMs: number }`
  - `writeText(root: string, id: string, relPath: string, content: string, expectedMtimeMs?: number): WriteTextResult`
  - (내부) `atomicWrite(full: string, data: string | Uint8Array): void`

- [ ] **Step 1: Write the failing test**

`tests/writer-writeText.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeText } from '../src/main/writer';

function ep(root: string, id = 'ep20260628_t') {
  const dir = join(root, 'output', 'episodes', id, 'script');
  mkdirSync(dir, { recursive: true });
  return id;
}

describe('writeText', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'wt-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('신규 파일 저장 + mtime 반환', () => {
    const id = ep(root);
    const r = writeText(root, id, 'script/a.md', '# hi');
    expect(r).toMatchObject({ ok: true });
    const full = join(root, 'output', 'episodes', id, 'script', 'a.md');
    expect(readFileSync(full, 'utf-8')).toBe('# hi');
  });

  test('.md 아닌 확장자 거부', () => {
    const id = ep(root);
    expect(() => writeText(root, id, 'script/a.txt', 'x')).toThrow(/md/);
  });

  test('경로 이탈 거부', () => {
    const id = ep(root);
    expect(() => writeText(root, id, '../../data/x.md', 'x')).toThrow(/이탈/);
  });

  test('mtime 일치 시 저장, 불일치 시 conflict', () => {
    const id = ep(root);
    const full = join(root, 'output', 'episodes', id, 'script', 'a.md');
    writeFileSync(full, 'orig');
    const m = statSync(full).mtimeMs;
    const ok = writeText(root, id, 'script/a.md', 'new', m);
    expect(ok).toMatchObject({ ok: true });
    const conflict = writeText(root, id, 'script/a.md', 'newer', m); // m은 이제 stale
    expect(conflict).toMatchObject({ conflict: true });
    expect(readFileSync(full, 'utf-8')).toBe('new'); // conflict는 저장 안 함
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/writer-writeText.test.ts`
Expected: FAIL — `../src/main/writer` 없음.

- [ ] **Step 3: Create `src/main/writer.ts` with writeText**

```ts
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { safeEpisodePath } from './pathGuard';

export type WriteTextResult =
  | { ok: true; mtimeMs: number }
  | { conflict: true; currentMtimeMs: number };

/** temp→rename 원자적 저장 */
function atomicWrite(full: string, data: string | Uint8Array): void {
  const tmp = `${full}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, full);
}

/** .md 텍스트 저장. expectedMtimeMs가 주어지고 디스크가 더 최신이면 저장하지 않고 conflict 반환. */
export function writeText(
  root: string,
  id: string,
  relPath: string,
  content: string,
  expectedMtimeMs?: number,
): WriteTextResult {
  if (!/\.md$/i.test(relPath)) {
    throw new Error(`md 파일만 저장 가능: ${relPath}`);
  }
  const full = safeEpisodePath(root, id, relPath);
  if (expectedMtimeMs !== undefined && existsSync(full)) {
    const cur = statSync(full).mtimeMs;
    if (cur !== expectedMtimeMs) return { conflict: true, currentMtimeMs: cur };
  }
  atomicWrite(full, content);
  return { ok: true, mtimeMs: statSync(full).mtimeMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/writer-writeText.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/writer.ts tests/writer-writeText.test.ts
git commit -m "feat(episode-hub): writer.writeText — md 저장 + mtime 충돌 검사"
```

---

### Task 3: writer.saveRender — SKU 렌더 드롭 저장

**Files:**
- Modify: `src/main/writer.ts`
- Test: `tests/writer-saveRender.test.ts`

**Interfaces:**
- Consumes: `safeEpisodePath`, `normCategory` (`@shared/episode`), `RENDER_ROWS`
- Produces:
  - `type SaveRenderResult = { ok: true; relPath: string } | { exists: true }`
  - `saveRender(root: string, id: string, category: string, row: string, bytes: Uint8Array, overwrite?: boolean): SaveRenderResult`

- [ ] **Step 1: Write the failing test**

`tests/writer-saveRender.test.ts`:
```ts
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRender } from '../src/main/writer';

function ep(root: string, id = 'ep20260628_t') {
  mkdirSync(join(root, 'output', 'episodes', id), { recursive: true });
  return id;
}
const bytes = new Uint8Array([1, 2, 3]);

describe('saveRender', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sr-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('규칙명 저장 — renders/<정규화 카테고리>__<row>.png', () => {
    const id = ep(root);
    const r = saveRender(root, id, '게이밍 데스크', 'row1', bytes);
    expect(r).toEqual({ ok: true, relPath: 'renders/게이밍_데스크__row1.png' });
    const full = join(root, 'output', 'episodes', id, 'renders', '게이밍_데스크__row1.png');
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full)).toEqual(Buffer.from(bytes));
  });

  test('잘못된 row 거부', () => {
    const id = ep(root);
    expect(() => saveRender(root, id, '책상', 'row3', bytes)).toThrow(/row/);
  });

  test('동일명 존재 + overwrite 미지정 → exists', () => {
    const id = ep(root);
    saveRender(root, id, '책상', 'row1', bytes);
    expect(saveRender(root, id, '책상', 'row1', bytes)).toEqual({ exists: true });
    expect(saveRender(root, id, '책상', 'row1', new Uint8Array([9]), true))
      .toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/writer-saveRender.test.ts`
Expected: FAIL — `saveRender` export 없음.

- [ ] **Step 3: Add saveRender to `src/main/writer.ts`**

상단 import에 추가:
```ts
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normCategory, RENDER_ROWS } from '@shared/episode';
```
(기존 `node:fs` import 줄에 `mkdirSync`가 없으면 병합. `safeEpisodePath` import는 유지.)

파일 하단에 추가:
```ts
export type SaveRenderResult = { ok: true; relPath: string } | { exists: true };

/** 드롭된 SKU 렌더 이미지를 renders/<정규화 카테고리>__<row>.png 로 저장 */
export function saveRender(
  root: string,
  id: string,
  category: string,
  row: string,
  bytes: Uint8Array,
  overwrite?: boolean,
): SaveRenderResult {
  if (!RENDER_ROWS.includes(row as (typeof RENDER_ROWS)[number])) {
    throw new Error(`잘못된 row: ${row}`);
  }
  const relPath = `renders/${normCategory(category)}__${row}.png`;
  const full = safeEpisodePath(root, id, relPath);
  if (existsSync(full) && overwrite !== true) return { exists: true };
  mkdirSync(dirname(full), { recursive: true });
  atomicWrite(full, bytes);
  return { ok: true, relPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/writer-saveRender.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/writer.ts tests/writer-saveRender.test.ts
git commit -m "feat(episode-hub): writer.saveRender — SKU 렌더 드롭 저장(규칙명·교체 가드)"
```

---

### Task 4: writer.patchEpisode — episode.json read-modify-write

**Files:**
- Modify: `src/main/writer.ts`
- Test: `tests/writer-patchEpisode.test.ts`

**Interfaces:**
- Consumes: `safeEpisodePath`, `STAGES` (`@shared/episode`), `EpisodeDoc` (`@shared/types`)
- Produces:
  - `interface EpisodePatch { approve?: { key: string }; unapprove?: { key: string }; stage?: string }`
  - `patchEpisode(root: string, id: string, patch: EpisodePatch): { ok: true; doc: EpisodeDoc }`

- [ ] **Step 1: Write the failing test**

`tests/writer-patchEpisode.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchEpisode } from '../src/main/writer';

function ep(root: string, doc?: object, id = 'ep20260628_t') {
  const dir = join(root, 'output', 'episodes', id);
  mkdirSync(dir, { recursive: true });
  if (doc) writeFileSync(join(dir, 'episode.json'), JSON.stringify(doc), 'utf-8');
  return id;
}
const BASE = { schema_version: 1, title: 'T', stage: '렌더', approvals: {} };

describe('patchEpisode', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pe-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('approve → approvals[key].approved=true + by/at', () => {
    const id = ep(root, BASE);
    const { doc } = patchEpisode(root, id, { approve: { key: 'moodboard' } });
    expect(doc.approvals.moodboard.approved).toBe(true);
    expect(doc.approvals.moodboard.by).toBe('owner');
    expect(typeof doc.approvals.moodboard.at).toBe('string');
  });

  test('unapprove → 키 삭제 (멱등)', () => {
    const id = ep(root, { ...BASE, approvals: { moodboard: { approved: true } } });
    expect(patchEpisode(root, id, { unapprove: { key: 'moodboard' } }).doc.approvals.moodboard)
      .toBeUndefined();
    expect(patchEpisode(root, id, { unapprove: { key: 'moodboard' } }).doc.approvals.moodboard)
      .toBeUndefined(); // 두 번 해도 안전
  });

  test('stage 화이트리스트 — 허용값 저장, 그 외 throw', () => {
    const id = ep(root, BASE);
    expect(patchEpisode(root, id, { stage: '검수' }).doc.stage).toBe('검수');
    expect(() => patchEpisode(root, id, { stage: 'bogus' })).toThrow(/stage/);
  });

  test('schema_version ≠ 1 → throw', () => {
    const id = ep(root, { ...BASE, schema_version: 2 });
    expect(() => patchEpisode(root, id, { stage: '검수' })).toThrow(/schema_version/);
  });

  test('episode.json 부재 → 골격 생성 후 패치', () => {
    const id = ep(root); // 파일 없음
    const { doc } = patchEpisode(root, id, { approve: { key: 'script_final' } });
    expect(doc.schema_version).toBe(1);
    expect(doc.title).toBe(id);
    expect(doc.approvals.script_final.approved).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(root, 'output', 'episodes', id, 'episode.json'), 'utf-8'));
    expect(onDisk.approvals.script_final.approved).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/writer-patchEpisode.test.ts`
Expected: FAIL — `patchEpisode` export 없음.

- [ ] **Step 3: Add patchEpisode to `src/main/writer.ts`**

상단 import에 추가:
```ts
import { STAGES } from '@shared/episode';
import type { EpisodeDoc } from '@shared/types';
```

파일 하단에 추가:
```ts
export interface EpisodePatch {
  approve?: { key: string };
  unapprove?: { key: string };
  stage?: string;
}

/** episode.json 부분 병합(read-modify-write). schema_version 가드. 파일 없으면 골격 생성. */
export function patchEpisode(
  root: string,
  id: string,
  patch: EpisodePatch,
): { ok: true; doc: EpisodeDoc } {
  const full = safeEpisodePath(root, id, 'episode.json');
  let doc: EpisodeDoc;
  if (existsSync(full)) {
    doc = JSON.parse(readFileSync(full, 'utf-8')) as EpisodeDoc;
    if (doc.schema_version !== 1) {
      throw new Error(`지원하지 않는 schema_version: ${doc.schema_version}`);
    }
    if (!doc.approvals) doc.approvals = {};
  } else {
    doc = { schema_version: 1, title: id, stage: '', approvals: {} };
  }

  if (patch.approve) {
    doc.approvals[patch.approve.key] = { approved: true, by: 'owner', at: new Date().toISOString() };
  }
  if (patch.unapprove) {
    delete doc.approvals[patch.unapprove.key];
  }
  if (patch.stage !== undefined) {
    if (!STAGES.includes(patch.stage as (typeof STAGES)[number])) {
      throw new Error(`잘못된 stage: ${patch.stage}`);
    }
    doc.stage = patch.stage;
  }

  atomicWrite(full, JSON.stringify(doc, null, 2));
  return { ok: true, doc };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/writer-patchEpisode.test.ts && npm run typecheck`
Expected: PASS (5 tests) + 타입 오류 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/writer.ts tests/writer-patchEpisode.test.ts
git commit -m "feat(episode-hub): writer.patchEpisode — episode.json RMW(승인·stage)"
```

---

### Task 5: IPC 등록 + preload 브릿지

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `writeText`, `saveRender`, `patchEpisode`, `EpisodePatch` (`./writer`)
- Produces (preload `hub` API 확장):
  - `hub.files.writeText(id, relPath, content, expectedMtimeMs?) → Promise<WriteTextResult>`
  - `hub.renders.save(id, category, row, bytes: ArrayBuffer, overwrite?) → Promise<SaveRenderResult>`
  - `hub.episode.patch(id, patch: EpisodePatch) → Promise<{ ok: true; doc: EpisodeDoc }>`

- [ ] **Step 1: ipc.ts — 쓰기 핸들러 등록**

`src/main/ipc.ts` 상단 import 교체(writer 추가):
```ts
import { patchEpisode, saveRender, writeText, type EpisodePatch } from './writer';
```
`registerIpc` 함수 안, 기존 `files:readText` 핸들러 아래에 추가:
```ts
  ipcMain.handle('files:writeText', (_e, id: string, relPath: string, content: string, expectedMtimeMs?: number) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return writeText(currentRoot, id, relPath, content, expectedMtimeMs);
  });

  ipcMain.handle('renders:save', (_e, id: string, category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return saveRender(currentRoot, id, category, row, new Uint8Array(bytes), overwrite);
  });

  ipcMain.handle('episode:patch', (_e, id: string, patch: EpisodePatch) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return patchEpisode(currentRoot, id, patch);
  });
```

- [ ] **Step 2: preload/index.ts — 브릿지 노출**

`src/preload/index.ts` 상단 import 교체:
```ts
import type { EpisodeDetail, EpisodeSummary, EpisodeDoc } from '../shared/types';
import type { WriteTextResult, SaveRenderResult, EpisodePatch } from '../main/writer';
```
`api` 객체의 `files`에 `writeText` 추가하고, `renders`·`episode` 키를 새로 추가:
```ts
  files: {
    readText: (id: string, relPath: string): Promise<string> =>
      ipcRenderer.invoke('files:readText', id, relPath),
    writeText: (id: string, relPath: string, content: string, expectedMtimeMs?: number): Promise<WriteTextResult> =>
      ipcRenderer.invoke('files:writeText', id, relPath, content, expectedMtimeMs),
  },
  renders: {
    save: (id: string, category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean): Promise<SaveRenderResult> =>
      ipcRenderer.invoke('renders:save', id, category, row, bytes, overwrite),
  },
  episode: {
    patch: (id: string, patch: EpisodePatch): Promise<{ ok: true; doc: EpisodeDoc }> =>
      ipcRenderer.invoke('episode:patch', id, patch),
  },
```

- [ ] **Step 3: 전체 테스트 + typecheck**

Run: `npm test && npm run typecheck`
Expected: 기존+신규 테스트 전부 PASS, 타입 오류 0. (preload가 `../main/writer`를 type-only import 하므로 renderer 번들에 main 코드가 섞이지 않음 — `import type`만 사용했는지 확인.)

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat(episode-hub): 쓰기 IPC 3종 + preload 브릿지"
```

---

### Task 6: store 쓰기 액션

**Files:**
- Modify: `src/renderer/store/useHub.ts`

**Interfaces:**
- Consumes: `window.hub.files.writeText`, `window.hub.renders.save`, `window.hub.episode.patch`
- Produces (store 액션):
  - `writeText(relPath, content, expectedMtimeMs?) → Promise<WriteTextResult>`
  - `saveRender(category, row, bytes, overwrite?) → Promise<SaveRenderResult>`
  - `patchEpisode(patch) → Promise<void>`
  - 세 액션 모두 성공 시 현재 `selectedId` detail을 재조회(즉시 갱신; watcher와 중복 무해).

- [ ] **Step 1: useHub.ts — 액션 추가**

`src/renderer/store/useHub.ts` 상단 import 교체:
```ts
import type { EpisodeDetail, EpisodeSummary } from '@shared/types';
import type { WriteTextResult, SaveRenderResult, EpisodePatch } from '../../main/writer';
```
`HubState` 인터페이스에 추가:
```ts
  writeText: (relPath: string, content: string, expectedMtimeMs?: number) => Promise<WriteTextResult>;
  saveRender: (category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => Promise<SaveRenderResult>;
  patchEpisode: (patch: EpisodePatch) => Promise<void>;
```
store 구현부(`pickRoot` 아래)에 추가:
```ts
  writeText: async (relPath, content, expectedMtimeMs) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.files.writeText(selectedId, relPath, content, expectedMtimeMs);
    if ('ok' in res) await get().select(selectedId);
    return res;
  },

  saveRender: async (category, row, bytes, overwrite) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.renders.save(selectedId, category, row, bytes, overwrite);
    if ('ok' in res) await get().select(selectedId);
    return res;
  },

  patchEpisode: async (patch) => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    await window.hub.episode.patch(selectedId, patch);
    await get().select(selectedId);
  },
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 타입 오류 0.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store/useHub.ts
git commit -m "feat(episode-hub): store 쓰기 액션(writeText·saveRender·patchEpisode)"
```

---

### Task 7: MarkdownEditor — 보기/편집 토글 + 저장 + 충돌 배너

**Files:**
- Create: `src/renderer/components/MarkdownEditor.tsx`
- Modify: `src/renderer/components/GroupDetail.tsx`
- Modify: `src/renderer/slack.css`

**Interfaces:**
- Consumes: `useHub().writeText`, `window.hub.files.readText`, `marked`, `FileEntry.mtimeMs`
- Produces: `<MarkdownEditor id relPath mtimeMs />` (default export)

- [ ] **Step 1: Create `src/renderer/components/MarkdownEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { useHub } from '../store/useHub';

export default function MarkdownEditor({
  id, relPath, mtimeMs,
}: { id: string; relPath: string; mtimeMs: number }) {
  const writeText = useHub((s) => s.writeText);
  const [raw, setRaw] = useState('');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null); setEditing(false); setDirty(false); setConflict(false);
    window.hub.files.readText(id, relPath)
      .then((t) => { if (alive) setRaw(t); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [id, relPath]);

  const save = async (force = false) => {
    const res = await writeText(relPath, raw, force ? undefined : mtimeMs);
    if ('conflict' in res) { setConflict(true); return; }
    setDirty(false); setConflict(false);
  };

  if (error) return <div className="chip error">{error}</div>;

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        <button className={`seg-btn${!editing ? ' active' : ''}`} onClick={() => setEditing(false)}>미리보기</button>
        <button className={`seg-btn${editing ? ' active' : ''}`} onClick={() => setEditing(true)}>편집</button>
        {editing && (
          <button className="btn-pill primary sm" disabled={!dirty} onClick={() => save(false)}>
            {dirty ? '저장' : '저장됨'}
          </button>
        )}
      </div>
      {conflict && (
        <div className="banner warn">
          디스크가 더 최신입니다(외부에서 수정됨). 덮어쓰시겠어요?
          <button className="btn-pill sm" onClick={() => save(true)}>덮어쓰기</button>
        </div>
      )}
      {editing ? (
        <textarea
          className="md-textarea"
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setDirty(true); }}
        />
      ) : (
        <div className="md-view" dangerouslySetInnerHTML={{ __html: marked.parse(raw, { async: false }) as string }} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: GroupDetail.tsx — MarkdownView → MarkdownEditor**

`import MarkdownView from './MarkdownView';`를 교체:
```tsx
import MarkdownEditor from './MarkdownEditor';
```
`{openMd && <MarkdownView id={detail.id} relPath={openMd.relPath} />}`를 교체:
```tsx
{openMd && <MarkdownEditor id={detail.id} relPath={openMd.relPath} mtimeMs={openMd.mtimeMs} />}
```
(`PromptsWorkbench`의 room 탭은 `MarkdownView`를 계속 쓰므로 `MarkdownView.tsx`는 삭제하지 않는다.)

- [ ] **Step 3: slack.css — 편집기 스타일 추가**

`src/renderer/slack.css` 끝에 추가:
```css
.md-editor .md-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.md-textarea {
  width: 100%; min-height: 60vh; box-sizing: border-box; padding: 16px;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.6;
  border: 1px solid var(--hairline, #e0e0e0); border-radius: 12px; resize: vertical;
}
.banner.warn {
  display: flex; gap: 12px; align-items: center; margin-bottom: 12px; padding: 10px 14px;
  background: #fff8e1; border: 1px solid #ffe082; border-radius: 10px; font-size: 13px;
}
```
(색상 변수는 기존 `slack.css` 팔레트에 맞춰 조정. `--hairline`이 없으면 실제 변수명으로 교체.)

- [ ] **Step 4: typecheck + 수동 스모크**

Run: `npm run typecheck`
Expected: 타입 오류 0.

수동: `npm run dev` → 에피소드 선택 → 🎬 대본/📋 기획 등 md 있는 그룹 → "편집" → 내용 수정(저장 버튼 활성) → "저장" → 파일이 실제로 갱신됐는지(탐색기/git diff) 확인 → 다시 열어 반영 확인.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/MarkdownEditor.tsx src/renderer/components/GroupDetail.tsx src/renderer/slack.css
git commit -m "feat(episode-hub): MarkdownEditor — md 보기/편집 토글 + 저장 + 충돌 배너"
```

---

### Task 8: PromptsWorkbench — SKU 렌더 드롭존 + 진행률

**Files:**
- Modify: `src/renderer/components/PromptsWorkbench.tsx`
- Modify: `src/renderer/slack.css`

**Interfaces:**
- Consumes: `useHub().saveRender`, `RENDER_ROWS`·`normCategory` (`@shared/episode`), `detail.files.renders`, `EpisodeDetail`
- Produces: SKU 카드마다 row1/row2 드롭존 + 저장본 표시 + 상단 진행률(렌더 완료 SKU / 총 SKU)

- [ ] **Step 1: 드롭존 로직 추가**

`src/renderer/components/PromptsWorkbench.tsx` 상단 import 추가:
```tsx
import { useHub } from '../store/useHub';
import { normCategory, RENDER_ROWS } from '@shared/episode';
```

`PromptsWorkbench` 컴포넌트 본문 상단(`const master = ...` 근처)에 렌더 파일 인덱스와 저장 핸들러 추가:
```tsx
  const saveRender = useHub((s) => s.saveRender);
  const renderNames = new Set(detail.files.renders.map((f) => f.name));
  const hasRender = (category: string, row: string) =>
    renderNames.has(`${normCategory(category)}__${row}.png`);

  const onDrop = async (category: string, row: string, e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const bytes = await file.arrayBuffer();
    let res = await saveRender(category, row, bytes);
    if ('exists' in res) {
      if (!window.confirm(`${category} ${row} 렌더가 이미 있어요. 교체할까요?`)) return;
      res = await saveRender(category, row, bytes, true);
    }
  };
```

진행률: `matched` 계산 아래에 추가:
```tsx
  const doneCount = matched.filter(({ s }) =>
    RENDER_ROWS.some((r) => hasRender(s.category, r))).length;
```

SKU 카드 렌더 블록(`<div className="sku-body">` 안, `s.blocks.map(...)` 아래)에 드롭존 추가:
```tsx
            <div className="drop-row">
              {RENDER_ROWS.map((r) => (
                <div
                  key={r}
                  className={`dropzone${hasRender(s.category, r) ? ' filled' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(s.category, r, e)}
                >
                  {hasRender(s.category, r) ? `✓ ${r} 생성됨` : `${r} 이미지 드롭`}
                </div>
              ))}
            </div>
```

SKU 세그 버튼 라벨에 진행률 표시 — 기존 `제품 마스터시트 ({sections.length})`를 교체:
```tsx
          제품 마스터시트 ({doneCount}/{sections.length})
```

- [ ] **Step 2: slack.css — 드롭존 스타일**

`src/renderer/slack.css` 끝에 추가:
```css
.drop-row { display: flex; gap: 8px; margin-top: 10px; }
.dropzone {
  flex: 1; padding: 12px; text-align: center; font-size: 12px; color: #888;
  border: 1.5px dashed #cfcfcf; border-radius: 10px; cursor: default; user-select: none;
}
.dropzone.filled { color: var(--semantic-success, #2e7d32); border-color: var(--semantic-success, #2e7d32); border-style: solid; }
```

- [ ] **Step 3: typecheck + 수동 스모크**

Run: `npm run typecheck`
Expected: 타입 오류 0.

수동: `npm run dev` → 🎨 렌더 프롬프트 그룹 → 제품 마스터시트 탭 → SKU 카드의 "row1 이미지 드롭"에 이미지 파일 드래그 → `renders/<카테고리>__row1.png` 생성 확인(탐색기) → "✓ row1 생성됨" + 상단 진행률 증가 확인 → 같은 자리에 재드롭 → 교체 확인 다이얼로그.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/PromptsWorkbench.tsx src/renderer/slack.css
git commit -m "feat(episode-hub): 렌더 작업대 SKU 드롭존 + 진행률"
```

---

### Task 9: 승인 스트립 — 게이트 토글 + stage 셀렉트

**Files:**
- Modify: `src/renderer/components/EpisodeView.tsx`
- Modify: `src/renderer/slack.css`

**Interfaces:**
- Consumes: `useHub().patchEpisode`, `APPROVAL_GATES`·`STAGES` (`@shared/episode`), `detail.doc?.approvals`, `detail.stage`

- [ ] **Step 1: EpisodeView.tsx — 승인 스트립 삽입**

`src/renderer/components/EpisodeView.tsx` 상단 import 추가:
```tsx
import { APPROVAL_GATES, STAGES } from '@shared/episode';
```
`useHub()` 구조분해에 액션 추가:
```tsx
  const { detail, patchEpisode } = useHub();
```
`<EpisodeHeader detail={detail} />` 바로 아래에 스트립 삽입:
```tsx
      <div className="approval-strip">
        {APPROVAL_GATES.map((g) => {
          const on = detail.doc?.approvals?.[g.key]?.approved === true;
          return (
            <button
              key={g.key}
              className={`gate-chip${on ? ' on' : ''}`}
              onClick={() => patchEpisode(on ? { unapprove: { key: g.key } } : { approve: { key: g.key } })}
            >
              {on ? '✓ ' : ''}{g.label}
            </button>
          );
        })}
        <select
          className="stage-select"
          value={detail.stage || ''}
          onChange={(e) => patchEpisode({ stage: e.target.value })}
        >
          <option value="" disabled>단계 선택</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
```

- [ ] **Step 2: slack.css — 스트립 스타일**

`src/renderer/slack.css` 끝에 추가:
```css
.approval-strip { display: flex; gap: 8px; align-items: center; margin: 4px 0 16px; flex-wrap: wrap; }
.gate-chip {
  padding: 5px 12px; font-size: 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid #d0d0d0; background: #fff; color: #555;
}
.gate-chip.on { background: var(--semantic-success, #2e7d32); border-color: var(--semantic-success, #2e7d32); color: #fff; }
.stage-select { margin-left: auto; padding: 5px 10px; font-size: 12px; border-radius: 8px; border: 1px solid #d0d0d0; }
```

- [ ] **Step 3: typecheck + 수동 스모크**

Run: `npm run typecheck`
Expected: 타입 오류 0.

수동: `npm run dev` → 에피소드 선택 → 헤더 아래 승인 칩(무드보드·콘티 FINAL) 클릭 → on/off 토글 + 헤더의 "무드보드 승인" 칩 반영 → `episode.json`의 `approvals` 갱신 확인 → stage 셀렉트 변경 → 헤더 "단계" 칩 반영 확인.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/EpisodeView.tsx src/renderer/slack.css
git commit -m "feat(episode-hub): 승인 스트립 — 게이트 토글 + stage 셀렉트"
```

---

### Task 10: 최종 통합 검증

**Files:** (없음 — 검증·문서만)

- [ ] **Step 1: 전체 테스트 + typecheck + 빌드**

Run: `npm test && npm run typecheck && npm run build`
Expected: 전 테스트 PASS · 타입 오류 0 · 빌드 성공. (build 실패 시 원인 수정 — preload가 main writer를 `import type`으로만 참조하는지 재확인.)

- [ ] **Step 2: 엔드투엔드 수동 스모크(쓰기 3종 통합)**

`npm run dev`에서 한 에피소드에 대해: ① 대본 md 편집→저장 ② SKU 렌더 이미지 드롭→진행률 증가 ③ 승인 칩 토글 + stage 변경 — 셋 모두 파일에 반영되고 watcher로 UI가 자동 갱신되는지 확인.

- [ ] **Step 3: 문서 동기화 확인**

`episode-hub` 내 README/주석에 IPC 표면(읽기 전용)이 명시돼 있으면 쓰기 3종을 반영. 없으면 스킵(스펙 §8 — orchestrator·헌법 자산은 이번 대상 아님).

- [ ] **Step 4: 브랜치 최종 리뷰 → main FF 머지**

`superpowers:requesting-code-review`로 `feat/episode-hub-phase-b` 전체 diff 리뷰 → 지적 반영 → Owner 승인 후 `main` FF 머지·푸시(하네스 규약, `superpowers:finishing-a-development-branch`).

---

## Self-Review

**Spec coverage:**
- 쓰기 3종 → Task 2(md)·3(렌더)·5(IPC)·6(store)·7(editor)·8(dropzone)·9(approval) ✅
- raw md 편집(셀 편집 백로그) → Task 7 raw textarea ✅
- 드롭 = SKU만, `<category>__<row>.png` → Task 3·8 ✅
- 승인 = 고정 게이트 + 토글, stage 수동 → Task 1(상수)·4·9 ✅
- safeEpisodePath 가드 전 경로 → Task 2·3·4 (writer 전부) ✅
- File.path 회피(ArrayBuffer) → Task 5·8 ✅
- 충돌 검사(mtime) → Task 2·7 ✅
- schema_version 가드 → Task 4 ✅
- 테스트(writer 4종·normCategory) → Task 1~4 ✅
- 백로그(셀 편집·방 렌더 드롭·e2e·autosave·git Complete) → 계획에서 제외(스펙 §7) ✅

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함, TBD/TODO 없음 ✅

**Type consistency:** `WriteTextResult`·`SaveRenderResult`·`EpisodePatch`가 writer(정의)→ipc→preload→store에서 동일 이름·시그니처. `ApprovalRecord.approved`가 writer(쓰기)·EpisodeHeader(읽기)·Task 9(읽기)에서 일치. `normCategory`가 shared 정의→promptMatch·writer·PromptsWorkbench에서 동일. `RENDER_ROWS`가 shared→writer·PromptsWorkbench 동일 ✅
