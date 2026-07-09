# Episode Hub 이미지 공유(클라우드 드라이브 동기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에피소드 이미지만 git 레포 밖 클라우드 드라이브 동기 폴더(`imageRoot`)에 저장·표시하도록 앱을 바꿔, 글자는 git으로·이미지는 드라이브로 PC 간 공유한다.

**Architecture:** per-PC 설정 `imageRoot`(userData `hub-config.json`)를 추가한다. 이미지 경로 구조는 `<imageRoot>/<episodeId>/<groupRel>`(레포보다 한 단계 얕음 — `output/episodes` 세그먼트 없음). 저장(`saveRender`)·표시(`hub://`)·상세 스캔(`scanEpisodeDetail`)이 imageRoot를 경유하되, **imageRoot 미설정 시에는 기존처럼 레포 이미지를 그대로 사용**(하위호환·무중단 과도기)한다.

**Tech Stack:** Electron(main/preload/renderer), TypeScript, React, zustand, vitest. 신규 의존성 없음.

## Global Constraints

- 경로 안전: 에피소드 폴더 밖 fs 접근 금지. 레포 파일은 `safeEpisodePath()`, 이미지는 신규 `resolveImagePath()` — 둘 다 `assertEpisodeId()` 경유. 상위 탈출 시 throw.
- 루트 널 가드: 모든 IPC/MCP 핸들러는 필요한 루트(`currentRoot`/`imageRoot`)가 없으면 즉시 throw/return.
- 이미지 경로 구조: `<imageRoot>/<id>/<rel>` (레포는 `<root>/output/episodes/<id>/<rel>`). 두 루트를 섞지 말 것.
- 드라이브 오프라인·온디맨드 견딤: imageRoot 폴더/파일이 없어도 크래시 금지 — 스캔은 빈 목록, `hub://`는 404를 우아하게.
- 하위호환: `imageRoot` 미설정이면 기존 동작(레포 이미지 표시/저장 대상은 레포 아님 — 저장은 imageRoot 필요) 유지. 저장은 imageRoot 미설정 시 비활성(에러 안내).
- 테스트 실행: `npx vitest run <file>` (Windows PowerShell). 커밋 신원은 레포 로컬 설정(`낙관 <beoptimistic0228@gmail.com>`) 사용 — 별도 지정 불필요.
- 커밋 scope: `feat`/`chore`, 예 `feat(episode-hub): …`.

---

### Task 1: 설정 — `imageRoot` 추가 (config)

**Files:**
- Modify: `src/shared/types.ts` (HubConfig)
- Modify: `src/main/config.ts` (loadConfig 보존 + updateConfig 신규)
- Test: `tests/config.test.ts` (추가)

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `interface HubConfig { orchestratorRoot: string; imageRoot?: string }`
  - `loadConfig(file: string): HubConfig | null` — imageRoot(string)도 보존
  - `updateConfig(file: string, patch: Partial<HubConfig>): HubConfig` — 기존 config에 patch 병합 후 저장, 병합 결과 반환. orchestratorRoot는 patch 또는 기존값 중 하나가 반드시 있어야 함(없으면 throw).

- [ ] **Step 1: 실패 테스트 작성** — `tests/config.test.ts` 끝에 추가

```typescript
import { loadConfig, saveConfig, updateConfig } from '../src/main/config';

test('loadConfig — imageRoot 보존', () => {
  const base = mkdtempSync(join(tmpdir(), 'hub-img-'));
  const file = join(base, 'c.json');
  saveConfig(file, { orchestratorRoot: 'C:\\x\\orchestrator', imageRoot: 'G:\\Drive\\img' });
  expect(loadConfig(file)).toEqual({ orchestratorRoot: 'C:\\x\\orchestrator', imageRoot: 'G:\\Drive\\img' });
  rmSync(base, { recursive: true, force: true });
});

test('updateConfig — 기존 orchestratorRoot 보존하며 imageRoot 병합', () => {
  const base = mkdtempSync(join(tmpdir(), 'hub-upd-'));
  const file = join(base, 'c.json');
  saveConfig(file, { orchestratorRoot: 'C:\\x\\orchestrator' });
  const merged = updateConfig(file, { imageRoot: 'G:\\Drive\\img' });
  expect(merged).toEqual({ orchestratorRoot: 'C:\\x\\orchestrator', imageRoot: 'G:\\Drive\\img' });
  expect(loadConfig(file)).toEqual(merged); // 디스크에도 병합 저장
  rmSync(base, { recursive: true, force: true });
});
```

(파일 상단 import에 `saveConfig`가 이미 있으면 중복 추가 금지 — `loadConfig, saveConfig, resolveOrchestratorRoot`가 이미 import되어 있으니 `updateConfig`만 추가.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `updateConfig` is not a function / imageRoot 필드 누락

- [ ] **Step 3: 구현** — `src/shared/types.ts`의 HubConfig 수정

```typescript
export interface HubConfig { orchestratorRoot: string; imageRoot?: string }
```

- [ ] **Step 4: 구현** — `src/main/config.ts`의 loadConfig 교체 + updateConfig 추가

`loadConfig`를 아래로 교체:

```typescript
export function loadConfig(file: string): HubConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf-8'));
    if (typeof cfg?.orchestratorRoot !== 'string') return null;
    const out: HubConfig = { orchestratorRoot: cfg.orchestratorRoot };
    if (typeof cfg.imageRoot === 'string') out.imageRoot = cfg.imageRoot;
    return out;
  } catch {
    return null;
  }
}

/** 기존 config에 patch를 병합해 저장. orchestratorRoot가 없으면(신규+patch에도 없음) throw. */
export function updateConfig(file: string, patch: Partial<HubConfig>): HubConfig {
  const existing = loadConfig(file);
  const orchestratorRoot = patch.orchestratorRoot ?? existing?.orchestratorRoot;
  if (!orchestratorRoot) throw new Error('orchestratorRoot 미설정 상태에서 config 병합 불가');
  const merged: HubConfig = { ...existing, ...patch, orchestratorRoot };
  saveConfig(file, merged);
  return merged;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (신규 2개 포함 전부)

- [ ] **Step 6: 커밋**

```bash
git add src/shared/types.ts src/main/config.ts tests/config.test.ts
git commit -m "feat(episode-hub): hub-config에 imageRoot 추가 + updateConfig 병합 저장"
```

---

### Task 2: 경로 헬퍼 — `resolveImagePath` (pathGuard)

**Files:**
- Modify: `src/main/pathGuard.ts`
- Test: `tests/imagePath.test.ts` (신규)

**Interfaces:**
- Consumes: `assertEpisodeId` (기존)
- Produces: `resolveImagePath(imageRoot: string, id: string, relPath: string): string` — `<imageRoot>/<id>/<relPath>` 안으로 고정, 상위 탈출 시 throw(`/이탈/`)

- [ ] **Step 1: 실패 테스트 작성** — `tests/imagePath.test.ts` 신규

```typescript
import { join } from 'node:path';
import { resolveImagePath } from '../src/main/pathGuard';

const IMG = join('G:', 'Drive', 'nakgwan-images');

test('정상 상대경로 — <imageRoot>/<id>/<rel> (output/episodes 없음)', () => {
  expect(resolveImagePath(IMG, 'ep1', 'renders/책상__row1.png'))
    .toBe(join(IMG, 'ep1', 'renders', '책상__row1.png'));
});

test('.. 탈출 차단', () => {
  expect(() => resolveImagePath(IMG, 'ep1', '../../secret.png')).toThrow(/이탈/);
});

test('id 자체의 경로 탈출 차단', () => {
  expect(() => resolveImagePath(IMG, 'ep1/../ep2', 'a.png')).toThrow();
  expect(() => resolveImagePath(IMG, '../../etc', 'a.png')).toThrow();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/imagePath.test.ts`
Expected: FAIL — `resolveImagePath` export 없음

- [ ] **Step 3: 구현** — `src/main/pathGuard.ts` 끝에 추가

```typescript
/** <imageRoot>/<id>/<relPath> 안으로 고정 — 이미지 전용(레포와 달리 output/episodes 세그먼트 없음) */
export function resolveImagePath(imageRoot: string, id: string, relPath: string): string {
  assertEpisodeId(id);
  const base = join(imageRoot, id);
  const full = normalize(join(base, relPath));
  if (!full.startsWith(base + sep) && full !== base) {
    throw new Error(`이미지 경로 이탈 차단: ${relPath}`);
  }
  return full;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/imagePath.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/main/pathGuard.ts tests/imagePath.test.ts
git commit -m "feat(episode-hub): resolveImagePath — imageRoot 경로 가드"
```

---

### Task 3: 저장 — `saveRender`를 imageRoot로 (writer)

**Files:**
- Modify: `src/main/writer.ts`
- Test: `tests/writer-saveRender.test.ts` (기존 시그니처 갱신)

**Interfaces:**
- Consumes: `resolveImagePath` (Task 2)
- Produces: `saveRender(imageRoot: string, id: string, category: string, row: string, bytes: Uint8Array, overwrite?: boolean): SaveRenderResult` — **첫 인자가 이제 imageRoot**. `<imageRoot>/<id>/renders/<정규화카테고리>__<row>.png`에 저장. `SaveRenderResult` 타입 불변.

- [ ] **Step 1: 실패 테스트 작성** — `tests/writer-saveRender.test.ts` 전체 교체

```typescript
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRender } from '../src/main/writer';

const bytes = new Uint8Array([1, 2, 3]);
const ID = 'ep20260628_t';

describe('saveRender — imageRoot에 저장', () => {
  let imageRoot: string;
  beforeEach(() => { imageRoot = mkdtempSync(join(tmpdir(), 'sr-img-')); });
  afterEach(() => { rmSync(imageRoot, { recursive: true, force: true }); });

  test('규칙명 저장 — <imageRoot>/<id>/renders/<정규화 카테고리>__<row>.png', () => {
    const r = saveRender(imageRoot, ID, '게이밍 데스크', 'row1', bytes);
    expect(r).toEqual({ ok: true, relPath: 'renders/게이밍_데스크__row1.png' });
    const full = join(imageRoot, ID, 'renders', '게이밍_데스크__row1.png');
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full)).toEqual(Buffer.from(bytes));
  });

  test('잘못된 row 거부', () => {
    expect(() => saveRender(imageRoot, ID, '책상', 'row3', bytes)).toThrow(/row/);
  });

  test('동일명 존재 + overwrite 미지정 → exists', () => {
    saveRender(imageRoot, ID, '책상', 'row1', bytes);
    expect(saveRender(imageRoot, ID, '책상', 'row1', bytes)).toEqual({ exists: true });
    expect(saveRender(imageRoot, ID, '책상', 'row1', new Uint8Array([9]), true))
      .toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/writer-saveRender.test.ts`
Expected: FAIL — 저장 위치가 `imageRoot/<id>/renders`가 아니라 `imageRoot/output/episodes/<id>/renders`

- [ ] **Step 3: 구현** — `src/main/writer.ts`

import 줄에 `resolveImagePath` 추가:

```typescript
import { resolveImagePath, safeEpisodePath } from './pathGuard';
```

`saveRender` 함수를 아래로 교체(주석·시그니처 포함):

```typescript
/** 드롭된 SKU 렌더 이미지를 imageRoot의 <id>/renders/<정규화 카테고리>__<row>.png 로 저장 */
export function saveRender(
  imageRoot: string,
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
  const full = resolveImagePath(imageRoot, id, relPath);
  if (existsSync(full) && overwrite !== true) return { exists: true };
  mkdirSync(dirname(full), { recursive: true });
  atomicWrite(full, bytes);
  return { ok: true, relPath };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/writer-saveRender.test.ts`
Expected: PASS

- [ ] **Step 5: writer 회귀 확인** (writeText/patchEpisode 무변경)

Run: `npx vitest run tests/writer-writeText.test.ts tests/writer-patchEpisode.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/main/writer.ts tests/writer-saveRender.test.ts
git commit -m "feat(episode-hub): saveRender 저장 대상을 imageRoot로 전환"
```

---

### Task 4: 상세 스캔 — imageRoot 이미지 병합 (scanner)

**Files:**
- Modify: `src/main/scanner.ts`
- Test: `tests/scanner-imageRoot.test.ts` (신규)

**Interfaces:**
- Consumes: (없음)
- Produces: `scanEpisodeDetail(root: string, id: string, imageRoot?: string | null): EpisodeDetail` — imageRoot 지정 시 각 그룹에서 **레포 비이미지 파일 + imageRoot 이미지 파일** 병합(mtime 내림차순). imageRoot 미지정(undefined/null) 시 **기존 동작 그대로**(레포 전체 파일, 이미지 포함). 내부 헬퍼 `walkGroup(baseDir, group)` 신설.

- [ ] **Step 1: 실패 테스트 작성** — `tests/scanner-imageRoot.test.ts` 신규

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEpisodeDetail } from '../src/main/scanner';

const ID = 'ep20260709_img';
const GOOD_DOC = JSON.stringify({ schema_version: 1, title: 'T', stage: '', approvals: {} });

function makeEp(root: string) {
  const ep = join(root, 'output', 'episodes', ID);
  mkdirSync(join(ep, 'renders'), { recursive: true });
  writeFileSync(join(ep, 'episode.json'), GOOD_DOC);
  return ep;
}

describe('scanEpisodeDetail — imageRoot 병합', () => {
  let root: string; let imageRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scan-repo-'));
    imageRoot = mkdtempSync(join(tmpdir(), 'scan-img-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(imageRoot, { recursive: true, force: true });
  });

  test('imageRoot 설정 시 이미지는 imageRoot에서, 레포 이미지는 제외', () => {
    const ep = makeEp(root);
    writeFileSync(join(ep, 'renders', 'repo_old.png'), 'x'); // 레포 잔여 이미지 — 제외돼야
    writeFileSync(join(ep, 'renders', 'notes.md'), '# n');   // 레포 텍스트 — 유지
    mkdirSync(join(imageRoot, ID, 'renders'), { recursive: true });
    writeFileSync(join(imageRoot, ID, 'renders', 'synced.png'), 'y'); // imageRoot 이미지 — 표시

    const d = scanEpisodeDetail(root, ID, imageRoot);
    const names = d.files.renders.map((f) => f.name).sort();
    expect(names).toEqual(['notes.md', 'synced.png']); // repo_old.png 없음
    expect(d.files.renders.find((f) => f.kind === 'image')?.name).toBe('synced.png');
  });

  test('imageRoot 미설정 시 레포 이미지 유지(하위호환)', () => {
    const ep = makeEp(root);
    writeFileSync(join(ep, 'renders', 'repo_old.png'), 'x');
    const d = scanEpisodeDetail(root, ID); // imageRoot 없음
    expect(d.files.renders.map((f) => f.name)).toEqual(['repo_old.png']);
  });

  test('imageRoot 폴더 자체가 없어도 크래시 없이 레포 텍스트만', () => {
    const ep = makeEp(root);
    writeFileSync(join(ep, 'renders', 'notes.md'), '# n');
    const missing = join(imageRoot, 'nope');
    const d = scanEpisodeDetail(root, ID, missing);
    expect(d.files.renders.map((f) => f.name)).toEqual(['notes.md']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scanner-imageRoot.test.ts`
Expected: FAIL — 3번째 인자 무시되어 병합/제외 미동작

- [ ] **Step 3: 구현** — `src/main/scanner.ts`

`listGroupFiles`를 `walkGroup` + 얇은 정렬 래퍼로 리팩터(동작 동일). 기존 `listGroupFiles`(37~74줄)를 아래로 교체:

```typescript
/** 그룹 폴더를 1단계 하위까지 걷는다(publish/thumbnails 등). _deprecated 제외. 정렬은 호출측. */
function walkGroup(baseDir: string, group: GroupKey): FileEntry[] {
  const dir = join(baseDir, group);
  if (!existsSync(dir)) return [];
  const out: FileEntry[] = [];
  const walk = (d: string, prefix: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      // 디렉토리 읽기 실패 (권한·삭제 등) — watcher 타이밍 이슈 회피 (§4-6)
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        // 파일 삭제/잠금 등으로 stat 실패 — 건너뜀 (watcher 레이스 가드)
        continue;
      }
      if (st.isDirectory()) {
        if (name === '_deprecated') continue; // 폐기 보관함 — 허브에 안 보임 (orchestrator 관례)
        walk(full, `${prefix}${name}/`);
      } else {
        out.push({
          name,
          relPath: `${group}/${prefix}${name}`,
          kind: classifyKind(name),
          mtimeMs: st.mtimeMs,
        });
      }
    }
  };
  walk(dir, '');
  return out;
}

/** 그룹 파일 목록 (mtime 내림차순) — 레포 에피소드 폴더 기준 */
function listGroupFiles(epDir: string, group: GroupKey): FileEntry[] {
  return walkGroup(epDir, group).sort((a, b) => b.mtimeMs - a.mtimeMs);
}
```

`scanEpisodeDetail`(130~139줄)을 아래로 교체:

```typescript
export function scanEpisodeDetail(root: string, id: string, imageRoot?: string | null): EpisodeDetail {
  assertEpisodeId(id); // 경로 탈출 차단 (MCP read_episode 등 외부 가드 없는 호출자 방어)
  const epDir = join(episodesDir(root), id);
  const files = Object.fromEntries(
    GROUP_KEYS.map((g) => {
      const repo = walkGroup(epDir, g);
      if (!imageRoot) return [g, repo.sort((a, b) => b.mtimeMs - a.mtimeMs)]; // 하위호환: 레포 이미지 유지
      // imageRoot 설정 시: 레포는 비이미지만, 이미지는 imageRoot의 <id>/<group>에서
      const repoNonImage = repo.filter((f) => f.kind !== 'image');
      const images = walkGroup(join(imageRoot, id), g).filter((f) => f.kind === 'image');
      return [g, [...images, ...repoNonImage].sort((a, b) => b.mtimeMs - a.mtimeMs)];
    }),
  ) as Record<GroupKey, FileEntry[]>;
  const summary = summarize(root, id, files);
  const { doc } = loadDoc(epDir);
  return { ...summary, doc, files };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/scanner-imageRoot.test.ts`
Expected: PASS

- [ ] **Step 5: scanner 회귀 확인** (기존 동작 불변)

Run: `npx vitest run tests/scanner.test.ts tests/scanner-youtubeViews.test.ts`
Expected: PASS (특히 `scanEpisodeDetail — 그룹별 FileEntry` 의 `products[0].kind === 'image'`가 imageRoot 미지정이라 유지)

- [ ] **Step 6: 커밋**

```bash
git add src/main/scanner.ts tests/scanner-imageRoot.test.ts
git commit -m "feat(episode-hub): scanEpisodeDetail — imageRoot 이미지 병합(미설정 시 하위호환)"
```

---

### Task 5: IPC 배선 — imageRoot 상태·선택·저장·상세 (ipc)

**Files:**
- Modify: `src/main/ipc.ts`
- Test: `tests/config.test.ts` (updateConfig 병합은 Task 1에서 커버 — 신규 테스트 없음; 검증은 typecheck+build+Task 6/8의 통합)

**Interfaces:**
- Consumes: `updateConfig`(Task 1), `saveRender`(Task 3, imageRoot 인자), `scanEpisodeDetail`(Task 4, imageRoot 인자)
- Produces:
  - `getImageRoot(): string | null` (export, `getRoot`와 대칭)
  - IPC `config:get` → `{ root: string | null; imageRoot: string | null }`
  - IPC `config:pickImageRoot` → `{ imageRoot: string | null }`
  - `renders:save`는 imageRoot 미설정 시 throw(`이미지 폴더 미설정`)

- [ ] **Step 1: 구현** — `src/main/ipc.ts`

import에 `updateConfig` 추가:

```typescript
import { loadConfig, resolveOrchestratorRoot, saveConfig, updateConfig } from './config';
```

모듈 상태(17줄 `getRoot` 아래)에 imageRoot 상태 추가:

```typescript
let currentImageRoot: string | null = null;
export const getImageRoot = (): string | null => currentImageRoot;
```

`registerIpc` 진입부(43~44줄 `currentRoot = discoverRoot();` 직후)에서 저장된 imageRoot 복원:

```typescript
  currentImageRoot = loadConfig(configFile())?.imageRoot ?? null;
```

`config:get` 핸들러(46줄)를 교체:

```typescript
  ipcMain.handle('config:get', () => ({ root: currentRoot, imageRoot: currentImageRoot }));
```

`config:pickRoot` 핸들러 안의 `saveConfig(...)` 호출을 병합 저장으로 교체(imageRoot 유실 방지). 기존:
`saveConfig(configFile(), { orchestratorRoot: picked });`
→
```typescript
      updateConfig(configFile(), { orchestratorRoot: picked });
```

`config:pickRoot` 핸들러 바로 아래에 이미지 폴더 선택 핸들러 신설:

```typescript
  ipcMain.handle('config:pickImageRoot', async () => {
    const res = await dialog.showOpenDialog({
      title: '이미지 동기 폴더 선택 (Google Drive 등)',
      properties: ['openDirectory'],
    });
    const picked = res.filePaths[0];
    if (picked) {
      currentImageRoot = picked;
      updateConfig(configFile(), { imageRoot: picked });
    }
    return { imageRoot: currentImageRoot };
  });
```

`episodes:detail` 핸들러를 imageRoot 전달로 교체:

```typescript
  ipcMain.handle('episodes:detail', (_e, id: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    assertEpisodeId(id);
    return scanEpisodeDetail(currentRoot, id, currentImageRoot);
  });
```

`renders:save` 핸들러를 imageRoot 기반으로 교체:

```typescript
  ipcMain.handle('renders:save', (_e, id: string, category: string, row: string, bytes: ArrayBuffer, overwrite?: boolean) => {
    if (!currentImageRoot) throw new Error('이미지 폴더 미설정 — 먼저 이미지 동기 폴더를 선택하세요');
    return saveRender(currentImageRoot, id, category, row, new Uint8Array(bytes), overwrite);
  });
```

- [ ] **Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: 전체 단위 회귀**

Run: `npm run test`
Expected: PASS (config·writer·scanner 포함 전부 그린)

- [ ] **Step 4: 커밋**

```bash
git add src/main/ipc.ts
git commit -m "feat(episode-hub): IPC — imageRoot 상태/선택/저장/상세 배선"
```

---

### Task 6: 표시(hub://) + MCP 배선 (index, mcpServer)

**Files:**
- Modify: `src/main/index.ts` (hub:// 핸들러, startMcpBridge 인자)
- Modify: `src/main/mcpServer.ts` (registerEpisodeTools/startMcpBridge에 getImageRoot)
- Test: `tests/mcp-tools.test.ts` (save_render→imageRoot 테스트 추가)

**Interfaces:**
- Consumes: `getImageRoot`(Task 5), `resolveImagePath`(Task 2)
- Produces:
  - `registerEpisodeTools(server: McpServer, getRoot: GetRoot, getImageRoot?: GetRoot): void` — getImageRoot 생략 시 `() => null`(이미지 저장 불가, 읽기는 레포 하위호환)
  - `startMcpBridge(opts: { getRoot; token; port; path?; getImageRoot?: GetRoot }): Promise<BridgeHandle>`
  - `hub://<id>/<rel>` — imageRoot에 파일 있으면 imageRoot, 없으면 레포(`safeEpisodePath`) 폴백, 둘 다 없으면 404

- [ ] **Step 1: 실패 테스트 작성** — `tests/mcp-tools.test.ts`

`connect` 헬퍼를 imageRoot 인자를 받도록 확장(기존 호출은 그대로 동작):

```typescript
async function connect(root: string | null, imageRoot: string | null = null) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEpisodeTools(server, () => root, () => imageRoot);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.0' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}
```

`describe` 블록 끝에 테스트 추가(파일 상단 import에 `existsSync`, `join`은 이미 있음):

```typescript
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
```

(파일 상단 import 줄 `import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';`에 `existsSync` 추가.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/mcp-tools.test.ts`
Expected: FAIL — save_render가 imageRoot를 안 씀(현재 getRoot 사용) / getImageRoot 인자 미지원

- [ ] **Step 3: 구현** — `src/main/mcpServer.ts`

import에 `resolveImagePath`는 불필요(saveRender 내부에서 사용). `registerEpisodeTools` 시그니처와 save_render/read_episode 수정:

시그니처 교체:

```typescript
export function registerEpisodeTools(server: McpServer, getRoot: GetRoot, getImageRoot: GetRoot = () => null): void {
```

`read_episode` 핸들러 교체(imageRoot 반영):

```typescript
      try { return ok(scanEpisodeDetail(requireRoot(getRoot), id, getImageRoot())); } catch (e) { return fail(e); }
```

`save_render` 핸들러 교체(imageRoot 가드+사용):

```typescript
    async ({ id, category, row, bytesBase64, overwrite }) => {
      try {
        const imageRoot = getImageRoot();
        if (!imageRoot) throw new Error('이미지 폴더 미설정 — 이미지 동기 폴더를 먼저 선택하세요');
        const bytes = new Uint8Array(Buffer.from(bytesBase64, 'base64'));
        return ok(saveRender(imageRoot, id, category, row, bytes, overwrite));
      } catch (e) { return fail(e); }
    });
```

`startMcpBridge` opts 타입에 `getImageRoot?: GetRoot` 추가하고, `registerEpisodeTools(server, opts.getRoot)` 호출을 교체:

```typescript
export function startMcpBridge(opts: {
  getRoot: GetRoot;
  token: string;
  port: number;
  path?: string;
  getImageRoot?: GetRoot;
}): Promise<BridgeHandle> {
```

```typescript
        registerEpisodeTools(server, opts.getRoot, opts.getImageRoot);
```

- [ ] **Step 4: 구현** — `src/main/index.ts`

import 교체(getImageRoot·resolveImagePath·existsSync 추가):

```typescript
import { existsSync } from 'node:fs';
import { getRoot, registerIpc, collectVideoIds, getImageRoot } from './ipc';
import { safeEpisodePath, resolveImagePath } from './pathGuard';
```

(기존 `import { safeEpisodePath } from './pathGuard';` 줄은 위 한 줄로 대체. `getImageRoot`는 `./ipc` import에 추가.)

`protocol.handle('hub', ...)` 블록(68~80줄)을 imageRoot 우선·레포 폴백으로 교체:

```typescript
  protocol.handle('hub', (request) => {
    const u = new URL(request.url);
    const id = u.host;
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const imageRoot = getImageRoot();
    // 이미지: imageRoot 우선. 아직 동기 안 됐거나 미설정이면 레포(비디오 등 잔여 미디어) 폴백.
    if (imageRoot) {
      try {
        const p = resolveImagePath(imageRoot, id, rel);
        if (existsSync(p)) return net.fetch(pathToFileURL(p).toString());
      } catch {
        return new Response('forbidden', { status: 403 });
      }
    }
    const root = getRoot();
    if (!root) return new Response('no root', { status: 404 });
    try {
      const p = safeEpisodePath(root, id, rel);
      if (!existsSync(p)) return new Response('not synced', { status: 404 });
      return net.fetch(pathToFileURL(p).toString());
    } catch {
      return new Response('forbidden', { status: 403 });
    }
  });
```

`startMcpBridge({ getRoot, token: mcpToken, port: MCP_PORT })` 호출에 getImageRoot 추가:

```typescript
      bridge = await startMcpBridge({ getRoot, token: mcpToken, port: MCP_PORT, getImageRoot });
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/mcp-tools.test.ts`
Expected: PASS

- [ ] **Step 6: MCP·타입 회귀**

Run: `npx vitest run tests/mcp-bridge.test.ts tests/mcp-http.test.ts` 그리고 `npm run typecheck`
Expected: PASS · 0 errors

- [ ] **Step 7: 커밋**

```bash
git add src/main/index.ts src/main/mcpServer.ts tests/mcp-tools.test.ts
git commit -m "feat(episode-hub): hub:// imageRoot 우선 해석 + MCP save_render/read_episode imageRoot 배선"
```

---

### Task 7: 렌더러 배선 — preload + store (preload, useHub)

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/store/useHub.ts`
- Test: typecheck + build (렌더러는 window.hub 의존 — 단위 대상 아님)

**Interfaces:**
- Consumes: IPC `config:get`(root+imageRoot), `config:pickImageRoot`(Task 5)
- Produces:
  - preload `config.get(): Promise<{ root: string | null; imageRoot: string | null }>`
  - preload `config.pickImageRoot(): Promise<{ imageRoot: string | null }>`
  - store `imageRoot: string | null`, `pickImageRoot(): Promise<void>`

- [ ] **Step 1: 구현** — `src/preload/index.ts`

`config` 블록 교체:

```typescript
  config: {
    get: (): Promise<{ root: string | null; imageRoot: string | null }> => ipcRenderer.invoke('config:get'),
    pickRoot: (): Promise<{ root: string | null }> => ipcRenderer.invoke('config:pickRoot'),
    pickImageRoot: (): Promise<{ imageRoot: string | null }> => ipcRenderer.invoke('config:pickImageRoot'),
  },
```

- [ ] **Step 2: 구현** — `src/renderer/store/useHub.ts`

`HubState` 인터페이스에 필드·액션 추가(`root: string | null;` 아래):

```typescript
  imageRoot: string | null;
```

액션 타입 추가(`pickRoot: () => Promise<void>;` 아래):

```typescript
  pickImageRoot: () => Promise<void>;
```

초기 상태에 추가(`root: null,` 아래):

```typescript
  imageRoot: null,
```

`init` 액션의 `const { root } = await window.hub.config.get();`·`set({ root });`를 교체:

```typescript
  init: async () => {
    const { root, imageRoot } = await window.hub.config.get();
    set({ root, imageRoot });
    if (root) {
      await get().refresh();
      void get().loadStats();
      window.hub.git.sync(true).then((gitStatus) => set({ gitStatus })).catch(() => {});
    }
  },
```

`pickRoot` 액션 바로 아래에 `pickImageRoot` 추가(선택 후 이미지 재스캔):

```typescript
  pickImageRoot: async () => {
    const { imageRoot } = await window.hub.config.pickImageRoot();
    set({ imageRoot });
    // 상세 이미지 목록·썸네일 재해석
    const { selectedId } = get();
    if (selectedId) await get().select(selectedId);
  },
```

- [ ] **Step 3: 타입 체크 + 빌드**

Run: `npm run typecheck` 그리고 `npm run build`
Expected: 0 errors · build OK

- [ ] **Step 4: 커밋**

```bash
git add src/preload/index.ts src/renderer/store/useHub.ts
git commit -m "feat(episode-hub): 렌더러 — imageRoot 상태/선택 배선(preload+store)"
```

---

### Task 8: UI — 이미지 폴더 버튼 + 미동기 플레이스홀더 (Sidebar, GroupDetail)

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx` (이미지 폴더 버튼)
- Modify: `src/renderer/components/GroupDetail.tsx` (img onError 플레이스홀더)
- Test: typecheck + build + 수동 확인

**Interfaces:**
- Consumes: store `imageRoot`, `pickImageRoot`(Task 7)
- Produces: (UI만 — 신규 export 없음)

- [ ] **Step 1: 구현** — `src/renderer/components/Sidebar.tsx`

구조분해에 `imageRoot`·`pickImageRoot` 추가:

```typescript
  const { episodes, selectedId, openEpisode, pickRoot, pickImageRoot, root, imageRoot, gitStatus, gitPull, page, goDashboard } = useHub();
```

`footer-actions` div 안, `폴더 변경` 버튼 아래에 이미지 폴더 버튼 추가:

```typescript
          <button className="btn-pill secondary sm" onClick={pickImageRoot} title={imageRoot ?? '이미지 동기 폴더 미설정'}>
            {imageRoot ? '이미지 폴더 ✓' : '이미지 폴더'}
          </button>
```

- [ ] **Step 2: 구현** — `src/renderer/components/GroupDetail.tsx`

파일 상단 `import { useState } from 'react';`는 이미 있음. `hubUrl` 아래에 이미지 썸네일 컴포넌트 추가(로드 실패=미동기 플레이스홀더):

```typescript
function Thumb({ id, file }: { id: string; file: FileEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <figure className="thumb-missing">
        <div className="thumb-placeholder">⏳ 아직 동기 안 됨</div>
        <figcaption>{file.name}</figcaption>
      </figure>
    );
  }
  return (
    <figure>
      <img src={hubUrl(id, file.relPath)} alt={file.name} loading="lazy" onError={() => setFailed(true)} />
      <figcaption>{file.name}</figcaption>
    </figure>
  );
}
```

기존 이미지 그리드(50~59줄)의 `<figure>…<img …/></figure>` 매핑을 `Thumb`로 교체:

```typescript
          {images.length > 0 && (
            <div className="thumb-grid">
              {images.map((f) => (
                <Thumb key={f.relPath} id={detail.id} file={f} />
              ))}
            </div>
          )}
```

- [ ] **Step 3: 타입 체크 + 빌드**

Run: `npm run typecheck` 그리고 `npm run build`
Expected: 0 errors · build OK

- [ ] **Step 4: 수동 확인** (dev)

Run: `npm run dev`
Expected: 사이드바에 "이미지 폴더" 버튼 노출 → 클릭 시 폴더 선택 다이얼로그 → 선택 후 "이미지 폴더 ✓". 렌더 그룹에서 존재하지 않는 이미지는 "⏳ 아직 동기 안 됨" 플레이스홀더로 표시(깨진 이미지 아이콘 아님).

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/components/Sidebar.tsx src/renderer/components/GroupDetail.tsx
git commit -m "feat(episode-hub): UI — 이미지 폴더 선택 버튼 + 미동기 플레이스홀더"
```

---

### Task 9: 기존 이미지 1회 이관 (§5)

**Files:**
- Create: `src/main/imageMigrate.ts`
- Modify: `src/main/ipc.ts` (IPC `images:migrate`)
- Modify: `src/preload/index.ts` (images.migrate)
- Modify: `src/renderer/store/useHub.ts` (migrateImages 액션)
- Modify: `src/renderer/components/Sidebar.tsx` (이관 버튼)
- Test: `tests/imageMigrate.test.ts` (신규)

**Interfaces:**
- Consumes: `resolveImagePath`(Task 2)
- Produces:
  - `migrateImagesToImageRoot(root: string, imageRoot: string): { copied: number }` — 레포 `output/episodes/<id>/**`의 이미지 파일(png/jpg/jpeg/webp)을 `<imageRoot>/<id>/<groupRel>`로 복사(존재하면 건너뜀). 복사 수 반환.
  - IPC `images:migrate` → `{ copied: number }`
  - preload `images.migrate(): Promise<{ copied: number }>`
  - store `migrateImages(): Promise<number>`

- [ ] **Step 1: 실패 테스트 작성** — `tests/imageMigrate.test.ts` 신규

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateImagesToImageRoot } from '../src/main/imageMigrate';

const ID = 'ep20260709_mig';

describe('migrateImagesToImageRoot', () => {
  let root: string; let imageRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mig-repo-'));
    imageRoot = mkdtempSync(join(tmpdir(), 'mig-img-'));
    const ep = join(root, 'output', 'episodes', ID, 'renders');
    mkdirSync(ep, { recursive: true });
    writeFileSync(join(ep, 'a.png'), 'x');
    writeFileSync(join(root, 'output', 'episodes', ID, 'renders', 'notes.md'), '# n'); // 비이미지 — 제외
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(imageRoot, { recursive: true, force: true });
  });

  test('레포 이미지를 imageRoot 동일 구조로 복사(비이미지 제외)', () => {
    const { copied } = migrateImagesToImageRoot(root, imageRoot);
    expect(copied).toBe(1);
    expect(existsSync(join(imageRoot, ID, 'renders', 'a.png'))).toBe(true);
    expect(existsSync(join(imageRoot, ID, 'renders', 'notes.md'))).toBe(false);
  });

  test('이미 존재하면 건너뜀(copied 0)', () => {
    migrateImagesToImageRoot(root, imageRoot);
    expect(migrateImagesToImageRoot(root, imageRoot).copied).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/imageMigrate.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현** — `src/main/imageMigrate.ts` 신규

```typescript
import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { assertEpisodeId, resolveImagePath } from './pathGuard';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** 레포 output/episodes/<id>/** 의 이미지들을 imageRoot/<id>/<rel> 로 1회 복사. 이미 있으면 건너뜀. */
export function migrateImagesToImageRoot(root: string, imageRoot: string): { copied: number } {
  const epsDir = join(root, 'output', 'episodes');
  if (!existsSync(epsDir)) return { copied: 0 };
  let copied = 0;
  for (const id of readdirSync(epsDir)) {
    const epDir = join(epsDir, id);
    let isDir = false;
    try { isDir = statSync(epDir).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    try { assertEpisodeId(id); } catch { continue; } // 규약 외 폴더 스킵
    const walk = (d: string) => {
      let entries: string[];
      try { entries = readdirSync(d); } catch { return; }
      for (const name of entries) {
        const full = join(d, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) {
          if (name === '_deprecated') continue;
          walk(full);
        } else if (IMAGE_EXT.test(name)) {
          const rel = relative(epDir, full).split(sep).join('/');
          const dest = resolveImagePath(imageRoot, id, rel);
          if (existsSync(dest)) continue;
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(full, dest);
          copied++;
        }
      }
    };
    walk(epDir);
  }
  return { copied };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/imageMigrate.test.ts`
Expected: PASS

- [ ] **Step 5: IPC 배선** — `src/main/ipc.ts`

import에 추가:

```typescript
import { migrateImagesToImageRoot } from './imageMigrate';
```

`config:pickImageRoot` 핸들러 아래에 추가:

```typescript
  ipcMain.handle('images:migrate', () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    if (!currentImageRoot) throw new Error('이미지 폴더 미설정');
    return migrateImagesToImageRoot(currentRoot, currentImageRoot);
  });
```

- [ ] **Step 6: preload + store 배선**

`src/preload/index.ts`의 `config` 블록 아래(또는 renders 근처)에 추가:

```typescript
  images: {
    migrate: (): Promise<{ copied: number }> => ipcRenderer.invoke('images:migrate'),
  },
```

`src/renderer/store/useHub.ts` — HubState 액션 타입에 추가(`pickImageRoot` 아래):

```typescript
  migrateImages: () => Promise<number>;
```

액션 구현 추가(`pickImageRoot` 액션 아래):

```typescript
  migrateImages: async () => {
    const { copied } = await window.hub.images.migrate();
    const { selectedId } = get();
    if (selectedId) await get().select(selectedId);
    return copied;
  },
```

- [ ] **Step 7: UI 버튼** — `src/renderer/components/Sidebar.tsx`

구조분해에 `migrateImages` 추가:

```typescript
  const { episodes, selectedId, openEpisode, pickRoot, pickImageRoot, migrateImages, root, imageRoot, gitStatus, gitPull, page, goDashboard } = useHub();
```

이미지 폴더 버튼 아래에 이관 버튼 추가(imageRoot 설정 시에만 노출):

```typescript
          {imageRoot && (
            <button
              className="btn-pill secondary sm"
              title="레포의 기존 이미지를 이미지 폴더로 1회 복사"
              onClick={async () => {
                try {
                  const n = await migrateImages();
                  alert(`이미지 ${n}개를 이미지 폴더로 복사했어요.`);
                } catch (e) {
                  alert('이관 오류: ' + String(e));
                }
              }}
            >
              이미지 이관
            </button>
          )}
```

- [ ] **Step 8: 타입 체크 + 빌드 + 전체 단위**

Run: `npm run typecheck` · `npm run build` · `npm run test`
Expected: 0 errors · build OK · 전체 그린

- [ ] **Step 9: 커밋**

```bash
git add src/main/imageMigrate.ts tests/imageMigrate.test.ts src/main/ipc.ts src/preload/index.ts src/renderer/store/useHub.ts src/renderer/components/Sidebar.tsx
git commit -m "feat(episode-hub): 기존 레포 이미지 → imageRoot 1회 이관(버튼)"
```

---

### Task 10: 통합 게이트 — e2e + 문서

**Files:**
- Modify: `CLAUDE.md` (다음 섹션에서 이미지 공유 항목 갱신)
- Test: e2e 회귀

**Interfaces:**
- Consumes: 전체
- Produces: (없음)

- [ ] **Step 1: e2e 회귀** (imageRoot 없이도 기존 흐름 무변경 확인)

Run: `npm run test:e2e`
Expected: PASS (기존 e2e 회귀 없음 — 스펙 §6)

- [ ] **Step 2: 문서 갱신** — `CLAUDE.md`의 `## 다음` 섹션에서 이미지 공유 항목을 완료로 이동

`## 다음`의 첫 불릿(이미지 공유 …)을 제거하고, `## MCP 브리지` 아래(또는 적절한 위치)에 한 줄 추가:

```markdown
## 이미지 공유(클라우드 드라이브 동기, v0.3)
글자는 git·이미지는 per-PC `imageRoot`(Google Drive 등 동기 로컬 폴더). 경로 구조 `<imageRoot>/<id>/<groupRel>`. 저장 `saveRender`·표시 `hub://`(imageRoot 우선, 레포 폴백)·상세 `scanEpisodeDetail`(imageRoot 이미지 병합; 미설정 시 레포 하위호환)이 `imageRoot` 경유. 핵심: `src/main/pathGuard.ts`(`resolveImagePath`)·`src/main/imageMigrate.ts`(1회 이관). 설정은 사이드바 "이미지 폴더"/"이미지 이관" 버튼.
```

- [ ] **Step 3: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs(episode-hub): 이미지 공유 기능 반영"
```

---

## Self-Review

**1. Spec coverage**

| Spec 항목 | Task |
|---|---|
| §4-1 설정 imageRoot(per-PC, 다이얼로그, 미설정 graceful) | Task 1·5·7·8 |
| §4-2 resolveImagePath(경로 탈출 차단, assertEpisodeId) | Task 2 |
| §4-3 saveRender → imageRoot | Task 3, MCP Task 6 |
| §4-4 hub:// imageRoot 해석 + 404 우아 | Task 6 |
| §4-5 scanEpisodeDetail imageRoot 이미지 스캔 | Task 4 |
| §4-6 미동기 견딤(크래시 금지·플레이스홀더) | Task 4(빈목록)·6(404)·8(플레이스홀더) |
| §5 기존 이미지 1회 이관 | Task 9 |
| §6 단위·기능·e2e 회귀 | Task 1~9 단위 + Task 10 e2e |

**2. Placeholder scan:** 각 코드 스텝은 실제 코드 포함. "적절히 처리" 류 없음.

**3. Type consistency:** `resolveImagePath(imageRoot,id,relPath)`·`saveRender(imageRoot,…)`·`scanEpisodeDetail(root,id,imageRoot?)`·`getImageRoot()`·`registerEpisodeTools(server,getRoot,getImageRoot?)`·`config.get()→{root,imageRoot}`·store `imageRoot`/`pickImageRoot`/`migrateImages`·`migrateImagesToImageRoot(root,imageRoot)→{copied}` — 태스크 간 명칭·시그니처 일치.

**의도적 스펙 정련(기록):** §4-5는 "imageRoot 미설정 시 이미지 목록 빈 상태"라 했으나, 기존 단위 테스트(`scanner.test.ts` 레포 이미지 검증) 및 무중단 과도기(§7)를 위해 **imageRoot 미설정 시 레포 이미지를 유지**(하위호환)하도록 구현한다. 사용자가 imageRoot를 설정하면 즉시 imageRoot 기준으로 전환된다.
