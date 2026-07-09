# Episode Hub Phase C (git 동기화) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Episode Hub에 git 동기화를 내장한다 — 실행 시 자동 FF-pull, 수동 Update, 에피소드 완료 커밋·푸시.

**Architecture:** 모든 git 작업은 main `src/main/git.ts`의 async 함수가 시스템 git을 `execFile`로 호출(신규 런타임 의존성 0). git 루트는 orchestrator 루트의 상위이며 `rev-parse --show-toplevel`로 발견·캐시. IPC(`ipc.ts`) 래핑 → preload 브릿지(`import type`) → zustand store 액션 → renderer. 자동 병합·force push 없음, `pull --ff-only`만.

**Tech Stack:** electron-vite · React 18 · TypeScript · zustand · 시스템 git(child_process) · vitest(node env, 임시 git 저장소 + 로컬 bare 원격) · Playwright-Electron(e2e).

## Global Constraints

- **$0 — 신규 런타임 의존성 추가 금지.** git은 시스템 바이너리를 `child_process.execFile`로 호출(simple-git 등 미사용).
- **파괴적 git 금지:** `reset --hard`·`push --force`·자동 `merge`/`rebase` 절대 없음. pull은 `--ff-only`만. add는 **명시 경로만**(`-- <path>`).
- **git 루트 ≠ orchestrator 루트:** orchestrator 루트는 git 저장소 하위. 모든 git 명령 cwd = git 루트(`resolveGitRoot`가 orchestrator 루트에서 `rev-parse --show-toplevel`로 발견·캐시).
- **Complete 범위 = `output/episodes/<ep>/`만** (git-root-relative 경로는 `path.relative`로 계산; 이미지는 gitignore로 자동 제외). 커밋 메시지 정확히 `feat(orchestrator): <episodeId> 산출물 완료 (Episode Hub)`.
- **Complete 활성 = 해당 EP 폴더 미커밋 변경 있을 때** (`changedPaths`에 `output/episodes/<ep>/` 포함).
- **자동 pull 조건 = behind>0 & ahead==0 & !dirty 일 때만.**
- 렌더러는 fs/git에 직접 접근하지 않음(preload 브릿지만). renderer/preload는 main을 `import type`으로만 참조.
- 테스트: `episode-hub/tests/**/*.test.ts`, 실제 임시 git 저장소 + 로컬 bare 원격으로 실동작 검증. main·shared만 단위 테스트; renderer는 typecheck+build+수동 스모크(Phase A/B 관례) + Playwright e2e.
- 커밋 컨벤션 `<type>(episode-hub): <제목>`, 한국어. 모든 명령은 `episode-hub/`에서.
- UI 카피 한국어.

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/main/git.ts` | git 작업 async 함수(execFile 시스템 git) — resolveGitRoot·fetchStatus·pullFF·syncStatus·completeEpisode | **신규** |
| `src/main/ipc.ts` | git IPC 3종 등록 | 수정 |
| `src/preload/index.ts` | `hub.git.sync/pull/complete` 노출 | 수정 |
| `src/renderer/store/useHub.ts` | `gitStatus` + `refreshGit/gitPull/completeEpisode` + init 자동 sync | 수정 |
| `src/renderer/components/Sidebar.tsx` | git 상태 칩 + Update 버튼(자리표시 교체) | 수정 |
| `src/renderer/components/EpisodeHeader.tsx` | Complete 버튼 활성·배선(자리표시 교체) | 수정 |
| `src/renderer/slack.css` | git 칩·배너 스타일 | 수정 |
| `tests/gitTestUtil.ts` | 임시 git 저장소+bare 원격 헬퍼 | **신규** |
| `tests/git-*.test.ts` | git.ts 단위 테스트 | **신규** |
| `e2e/hub.e2e.ts` | git 스모크 확장 | 수정 |

`api.d.ts`는 `HubApi` 파생 — 변경 불필요.

---

### Task 1: git.ts — resolveGitRoot + fetchStatus + 테스트 헬퍼

**Files:**
- Create: `src/main/git.ts`
- Create: `tests/gitTestUtil.ts`
- Test: `tests/git-status.test.ts`

**Interfaces:**
- Consumes: none (system git)
- Produces:
  - `interface GitStatus { state: 'clean'|'behind'|'ahead'|'diverged'|'error'; ahead: number; behind: number; dirty: boolean; branch: string; changedPaths: string[]; message?: string; fetchFailed?: boolean }`
  - `resolveGitRoot(orchestratorRoot: string): Promise<string>`
  - `fetchStatus(orchestratorRoot: string, doFetch?: boolean): Promise<GitStatus>`
  - (내부) `runGit(cwd: string, args: string[]): Promise<{stdout:string;stderr:string;code:number}>`
  - test util: `g(cwd, ...args): string`, `makeRepoWithRemote(ep?): {base,repo,orch,remote,ep}`, `advanceRemote(remote): void`

- [ ] **Step 1: Create `tests/gitTestUtil.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function g(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/** 작업본 repo + bare 원격 + orchestrator/output/episodes/<ep> 초기 커밋·push(upstream 설정) */
export function makeRepoWithRemote(ep = 'ep20260101_t') {
  const base = mkdtempSync(join(tmpdir(), 'ghub-'));
  const remote = join(base, 'remote.git');
  const repo = join(base, 'work');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  g(repo, 'init', '-b', 'main');
  g(repo, 'config', 'user.email', 't@t.t');
  g(repo, 'config', 'user.name', 'tester');
  g(repo, 'config', 'commit.gpgsign', 'false');
  const orch = join(repo, 'orchestrator');
  const epDir = join(orch, 'output', 'episodes', ep);
  mkdirSync(epDir, { recursive: true });
  writeFileSync(join(epDir, 'episode.json'), '{"schema_version":1}');
  writeFileSync(join(repo, '.gitignore'), 'orchestrator/output/episodes/*/renders/*\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-m', 'init');
  g(repo, 'remote', 'add', 'origin', remote);
  g(repo, 'push', '-u', 'origin', 'main');
  return { base, repo, orch, remote, ep };
}

/** 별도 클론에서 원격에 1커밋 추가 → 원본이 behind가 되도록 */
export function advanceRemote(remote: string): void {
  const c = mkdtempSync(join(tmpdir(), 'gadv-'));
  execFileSync('git', ['clone', remote, c]);
  g(c, 'config', 'user.email', 't@t.t');
  g(c, 'config', 'user.name', 'tester');
  g(c, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(c, 'extra.txt'), 'x');
  g(c, 'add', '-A');
  g(c, 'commit', '-m', 'remote advance');
  g(c, 'push');
}
```

- [ ] **Step 2: Write the failing test** — `tests/git-status.test.ts`

```ts
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchStatus, resolveGitRoot } from '../src/main/git';
import { g, makeRepoWithRemote, advanceRemote } from './gitTestUtil';

describe('fetchStatus', () => {
  let r: ReturnType<typeof makeRepoWithRemote>;
  beforeEach(() => { r = makeRepoWithRemote(); });
  afterEach(() => { rmSync(r.base, { recursive: true, force: true }); });

  test('resolveGitRoot — orchestrator 하위에서 git 루트 발견', async () => {
    const root = await resolveGitRoot(r.orch);
    // realpath 차이(심볼릭) 감안, repo 경로로 끝나는지 확인
    expect(root.replace(/\\/g, '/').toLowerCase()).toContain('work');
  });

  test('비-git 폴더 → state error', async () => {
    const s = await fetchStatus(r.base, false); // base는 git repo 아님
    expect(s.state).toBe('error');
  });

  test('clean 상태', async () => {
    const s = await fetchStatus(r.orch, true);
    expect(s.state).toBe('clean');
    expect(s.ahead).toBe(0); expect(s.behind).toBe(0); expect(s.dirty).toBe(false);
  });

  test('dirty + ahead 계산 + changedPaths가 EP 경로 포함', async () => {
    writeFileSync(join(r.orch, 'output', 'episodes', r.ep, 'episode.json'), '{"schema_version":1,"x":1}');
    const s = await fetchStatus(r.orch, true);
    expect(s.dirty).toBe(true);
    expect(s.changedPaths.some((p) => p.includes(`output/episodes/${r.ep}/`))).toBe(true);
  });

  test('behind — 원격이 앞서면 state behind', async () => {
    advanceRemote(r.remote);
    const s = await fetchStatus(r.orch, true);
    expect(s.state).toBe('behind');
    expect(s.behind).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/git-status.test.ts`
Expected: FAIL — `../src/main/git` 없음.

- [ ] **Step 4: Create `src/main/git.ts`**

```ts
import { execFile } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export interface GitStatus {
  state: 'clean' | 'behind' | 'ahead' | 'diverged' | 'error';
  ahead: number;
  behind: number;
  dirty: boolean;
  branch: string;
  changedPaths: string[];
  message?: string;
  fetchFailed?: boolean;
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await pexec('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? String(e), code: typeof err.code === 'number' ? err.code : 1 };
  }
}

let cache: { orch: string; git: string } | null = null;

export async function resolveGitRoot(orchestratorRoot: string): Promise<string> {
  if (cache?.orch === orchestratorRoot) return cache.git;
  const r = await runGit(orchestratorRoot, ['rev-parse', '--show-toplevel']);
  if (r.code !== 0) throw new Error('git 저장소를 찾을 수 없습니다');
  const gitRoot = r.stdout.trim();
  cache = { orch: orchestratorRoot, git: gitRoot };
  return gitRoot;
}

/** git-root-relative POSIX 경로 (Complete add 경로용) */
export function episodeRelPath(gitRoot: string, orchestratorRoot: string, episodeId: string): string {
  const abs = join(orchestratorRoot, 'output', 'episodes', episodeId);
  return relative(gitRoot, abs).split(sep).join('/');
}

export async function fetchStatus(orchestratorRoot: string, doFetch = true): Promise<GitStatus> {
  let gitRoot: string;
  try {
    gitRoot = await resolveGitRoot(orchestratorRoot);
  } catch {
    return { state: 'error', ahead: 0, behind: 0, dirty: false, branch: '', changedPaths: [], message: 'git 저장소를 찾을 수 없습니다' };
  }
  let fetchFailed = false;
  if (doFetch) {
    const f = await runGit(gitRoot, ['fetch']);
    if (f.code !== 0) fetchFailed = true;
  }
  const branch = (await runGit(gitRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  let ahead = 0;
  let behind = 0;
  let noUpstream = false;
  const rl = await runGit(gitRoot, ['rev-list', '--count', '--left-right', '@{upstream}...HEAD']);
  if (rl.code === 0) {
    const [b, a] = rl.stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
    behind = b; ahead = a;
  } else {
    noUpstream = true;
  }
  const porc = await runGit(gitRoot, ['status', '--porcelain']);
  const changedPaths = porc.stdout.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
  const dirty = changedPaths.length > 0;
  let state: GitStatus['state'];
  if (noUpstream) state = 'error';
  else if (ahead > 0 && behind > 0) state = 'diverged';
  else if (behind > 0) state = 'behind';
  else if (ahead > 0) state = 'ahead';
  else state = 'clean';
  return {
    state, ahead, behind, dirty, branch, changedPaths,
    ...(noUpstream ? { message: '원격 추적(upstream) 브랜치가 없습니다' } : {}),
    ...(fetchFailed ? { fetchFailed: true } : {}),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/git-status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/git.ts tests/gitTestUtil.ts tests/git-status.test.ts
git commit -m "feat(episode-hub): git.ts resolveGitRoot + fetchStatus (상태 산출)"
```

---

### Task 2: git.ts — pullFF + syncStatus

**Files:**
- Modify: `src/main/git.ts`
- Test: `tests/git-pull.test.ts`

**Interfaces:**
- Consumes: `resolveGitRoot`, `fetchStatus`, `GitStatus`
- Produces:
  - `pullFF(orchestratorRoot: string): Promise<{ ok: true } | { ok: false; message: string }>`
  - `syncStatus(orchestratorRoot: string, auto: boolean): Promise<GitStatus>` (auto && behind && !dirty → pullFF 후 재산출)

- [ ] **Step 1: Write the failing test** — `tests/git-pull.test.ts`

```ts
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pullFF, syncStatus } from '../src/main/git';
import { makeRepoWithRemote, advanceRemote } from './gitTestUtil';

describe('pullFF / syncStatus', () => {
  let r: ReturnType<typeof makeRepoWithRemote>;
  beforeEach(() => { r = makeRepoWithRemote(); });
  afterEach(() => { rmSync(r.base, { recursive: true, force: true }); });

  test('behind + clean → FF pull 성공, clean 복귀', async () => {
    advanceRemote(r.remote);
    const p = await pullFF(r.orch);
    expect(p.ok).toBe(true);
    const s = await syncStatus(r.orch, false);
    expect(s.state).toBe('clean');
  });

  test('dirty면 pull 거부(작업트리 보존)', async () => {
    advanceRemote(r.remote);
    writeFileSync(join(r.orch, 'output', 'episodes', r.ep, 'episode.json'), '{"dirty":1}');
    const p = await pullFF(r.orch);
    expect(p.ok).toBe(false);
  });

  test('syncStatus(auto=true) — behind+clean면 자동 pull → clean', async () => {
    advanceRemote(r.remote);
    const s = await syncStatus(r.orch, true);
    expect(s.state).toBe('clean');
  });

  test('syncStatus(auto=true) — dirty면 자동 pull 안 함(behind 유지)', async () => {
    advanceRemote(r.remote);
    writeFileSync(join(r.orch, 'output', 'episodes', r.ep, 'episode.json'), '{"dirty":1}');
    const s = await syncStatus(r.orch, true);
    expect(s.behind).toBeGreaterThan(0);
    expect(s.dirty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/git-pull.test.ts`
Expected: FAIL — `pullFF`/`syncStatus` export 없음.

- [ ] **Step 3: Add pullFF + syncStatus to `src/main/git.ts`**

파일 하단에 추가:
```ts
export async function pullFF(orchestratorRoot: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const gitRoot = await resolveGitRoot(orchestratorRoot);
  const r = await runGit(gitRoot, ['pull', '--ff-only']);
  if (r.code === 0) return { ok: true };
  return { ok: false, message: (r.stderr || r.stdout || 'pull 실패').trim() };
}

/** 상태 조회(+fetch). auto면 behind&clean일 때만 FF-pull 후 재산출. */
export async function syncStatus(orchestratorRoot: string, auto: boolean): Promise<GitStatus> {
  let s = await fetchStatus(orchestratorRoot, true);
  if (auto && s.state === 'behind' && !s.dirty) {
    const p = await pullFF(orchestratorRoot);
    if (p.ok) s = await fetchStatus(orchestratorRoot, false);
  }
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/git-pull.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/git.ts tests/git-pull.test.ts
git commit -m "feat(episode-hub): git.ts pullFF + syncStatus (자동 FF-pull 조건부)"
```

---

### Task 3: git.ts — completeEpisode

**Files:**
- Modify: `src/main/git.ts`
- Test: `tests/git-complete.test.ts`

**Interfaces:**
- Consumes: `resolveGitRoot`, `episodeRelPath`, `runGit`, `assertEpisodeId` (`./pathGuard`)
- Produces:
  - `type CompleteResult = { ok: true; pushed: true } | { ok: false; reason: 'nothing'|'needsUpdate'|'error'; message?: string }`
  - `completeEpisode(orchestratorRoot: string, episodeId: string): Promise<CompleteResult>`

- [ ] **Step 1: Write the failing test** — `tests/git-complete.test.ts`

```ts
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { completeEpisode } from '../src/main/git';
import { g, makeRepoWithRemote, advanceRemote } from './gitTestUtil';

describe('completeEpisode', () => {
  let r: ReturnType<typeof makeRepoWithRemote>;
  beforeEach(() => { r = makeRepoWithRemote(); });
  afterEach(() => { rmSync(r.base, { recursive: true, force: true }); });

  const epFile = () => join(r.orch, 'output', 'episodes', r.ep, 'episode.json');

  test('변경 없으면 nothing', async () => {
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toEqual({ ok: false, reason: 'nothing' });
  });

  test('EP 변경 → 커밋 메시지 + 원격 push 반영', async () => {
    writeFileSync(epFile(), '{"schema_version":1,"done":1}');
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toEqual({ ok: true, pushed: true });
    // 로컬 최신 커밋 메시지
    expect(g(r.repo, 'log', '-1', '--pretty=%s')).toBe(`feat(orchestrator): ${r.ep} 산출물 완료 (Episode Hub)`);
    // 원격에 반영됐는지: 원격 HEAD == 로컬 HEAD
    const localHead = g(r.repo, 'rev-parse', 'HEAD');
    expect(g(r.repo, 'rev-parse', 'origin/main')).toBe(localHead);
  });

  test('다른 EP·이미지는 커밋 범위에서 제외', async () => {
    // 다른 EP 변경 + 대상 EP의 gitignored 렌더 이미지
    const other = join(r.orch, 'output', 'episodes', 'ep20991231_other');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'episode.json'), '{"x":1}');
    const renders = join(r.orch, 'output', 'episodes', r.ep, 'renders');
    mkdirSync(renders, { recursive: true });
    writeFileSync(join(renders, 'a__row1.png'), 'imgbytes');
    writeFileSync(epFile(), '{"changed":1}');
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toEqual({ ok: true, pushed: true });
    // 커밋에 포함된 파일 목록: 대상 EP의 episode.json만
    const files = g(r.repo, 'show', '--name-only', '--pretty=', 'HEAD').split(/\r?\n/).filter(Boolean);
    expect(files.some((f) => f.includes(`episodes/${r.ep}/episode.json`))).toBe(true);
    expect(files.some((f) => f.includes('ep20991231_other'))).toBe(false);
    expect(files.some((f) => f.includes('renders/a__row1.png'))).toBe(false);
  });

  test('원격이 앞서면 push 거부 → needsUpdate (로컬 커밋 보존)', async () => {
    advanceRemote(r.remote); // 원격 1커밋 앞섬
    writeFileSync(epFile(), '{"changed":1}');
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toMatchObject({ ok: false, reason: 'needsUpdate' });
    // 로컬 커밋은 만들어졌어야 함(작업 유실 없음)
    expect(g(r.repo, 'log', '-1', '--pretty=%s')).toBe(`feat(orchestrator): ${r.ep} 산출물 완료 (Episode Hub)`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/git-complete.test.ts`
Expected: FAIL — `completeEpisode` export 없음.

- [ ] **Step 3: Add completeEpisode to `src/main/git.ts`**

상단 import에 추가:
```ts
import { assertEpisodeId } from './pathGuard';
```
파일 하단에 추가:
```ts
export type CompleteResult =
  | { ok: true; pushed: true }
  | { ok: false; reason: 'nothing' | 'needsUpdate' | 'error'; message?: string };

/** 해당 EP 폴더만 add→commit→push. 이미지는 gitignore로 자동 제외. */
export async function completeEpisode(orchestratorRoot: string, episodeId: string): Promise<CompleteResult> {
  assertEpisodeId(episodeId);
  const gitRoot = await resolveGitRoot(orchestratorRoot);
  const rel = episodeRelPath(gitRoot, orchestratorRoot, episodeId);
  const add = await runGit(gitRoot, ['add', '--', rel]);
  if (add.code !== 0) return { ok: false, reason: 'error', message: add.stderr.trim() };
  // 스테이지에 대상 경로 변경이 있는지 (exit 0 = 변경 없음)
  const staged = await runGit(gitRoot, ['diff', '--cached', '--quiet', '--', rel]);
  if (staged.code === 0) return { ok: false, reason: 'nothing' };
  const commit = await runGit(gitRoot, ['commit', '-m', `feat(orchestrator): ${episodeId} 산출물 완료 (Episode Hub)`, '--', rel]);
  if (commit.code !== 0) return { ok: false, reason: 'error', message: commit.stderr.trim() };
  const push = await runGit(gitRoot, ['push']);
  if (push.code !== 0) {
    const m = push.stderr || push.stdout;
    if (/rejected|fetch first|non-fast-forward/i.test(m)) {
      return { ok: false, reason: 'needsUpdate', message: '원격이 앞서 있습니다. Update 먼저 눌러주세요.' };
    }
    return { ok: false, reason: 'error', message: m.trim() };
  }
  return { ok: true, pushed: true };
}
```
> 주: `commit -- <rel>` 로 대상 경로만 커밋(부분 스테이지 오염 방지). `git add -- <rel>`는 gitignore된 렌더 이미지를 자동 제외한다.

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/git-complete.test.ts && npm run typecheck`
Expected: PASS (4 tests) + 타입 오류 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/git.ts tests/git-complete.test.ts
git commit -m "feat(episode-hub): git.ts completeEpisode — EP 폴더만 커밋·푸시"
```

---

### Task 4: git IPC 3종 + preload 브릿지

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `syncStatus`, `pullFF`, `completeEpisode`, `GitStatus`, `CompleteResult` (`./git`)
- Produces (preload):
  - `hub.git.sync(auto: boolean): Promise<GitStatus>`
  - `hub.git.pull(): Promise<{ ok: true } | { ok: false; message: string }>`
  - `hub.git.complete(episodeId: string): Promise<CompleteResult>`

- [ ] **Step 1: ipc.ts — git 핸들러 등록**

상단 import에 추가:
```ts
import { completeEpisode, pullFF, syncStatus } from './git';
```
`registerIpc` 안, 기존 핸들러 아래 추가:
```ts
  ipcMain.handle('git:sync', (_e, auto: boolean) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return syncStatus(currentRoot, auto);
  });

  ipcMain.handle('git:pull', () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return pullFF(currentRoot);
  });

  ipcMain.handle('git:complete', (_e, episodeId: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return completeEpisode(currentRoot, episodeId);
  });
```

- [ ] **Step 2: preload/index.ts — git 브릿지**

상단 import에 추가:
```ts
import type { GitStatus, CompleteResult } from '../main/git';
```
`api` 객체에 `git` 키 추가:
```ts
  git: {
    sync: (auto: boolean): Promise<GitStatus> => ipcRenderer.invoke('git:sync', auto),
    pull: (): Promise<{ ok: true } | { ok: false; message: string }> => ipcRenderer.invoke('git:pull'),
    complete: (episodeId: string): Promise<CompleteResult> => ipcRenderer.invoke('git:complete', episodeId),
  },
```

- [ ] **Step 3: 전체 테스트 + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: 전 테스트 PASS · 타입 0 · build 성공(preload가 `../main/git`을 `import type`으로만 참조 → main 런타임 미번들).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat(episode-hub): git IPC 3종(sync·pull·complete) + preload 브릿지"
```

---

### Task 5: store git 액션 + 실행 시 자동 sync

**Files:**
- Modify: `src/renderer/store/useHub.ts`

**Interfaces:**
- Consumes: `window.hub.git.sync/pull/complete`, `GitStatus`, `CompleteResult`
- Produces (store):
  - state `gitStatus: GitStatus | null`
  - `refreshGit(): Promise<void>` (sync(false))
  - `gitPull(): Promise<{ ok: true } | { ok: false; message: string }>` (pull → refreshGit)
  - `completeEpisode(): Promise<CompleteResult>` (현재 selectedId; 성공 후 refreshGit)
  - `init()`에서 root 확정 시 `sync(true)`(자동 FF-pull) 1회 → gitStatus 설정

- [ ] **Step 1: useHub.ts — git 상태·액션 추가**

상단 import에 추가:
```ts
import type { GitStatus, CompleteResult } from '../../main/git';
```
`HubState` 인터페이스에 추가:
```ts
  gitStatus: GitStatus | null;
  refreshGit: () => Promise<void>;
  gitPull: () => Promise<{ ok: true } | { ok: false; message: string }>;
  completeEpisode: () => Promise<CompleteResult>;
```
상태 초기값에 `gitStatus: null,` 추가. `init` 액션을 교체(자동 sync 추가):
```ts
  init: async () => {
    const { root } = await window.hub.config.get();
    set({ root });
    if (root) {
      await get().refresh();
      // 실행 시 자동 최신화(behind+clean이면 FF-pull) — 네트워크라 UI 블록 없이
      window.hub.git.sync(true).then((gitStatus) => set({ gitStatus })).catch(() => {});
    }
  },
```
구현부에 액션 추가:
```ts
  gitStatus: null,

  refreshGit: async () => {
    if (!get().root) return;
    try { set({ gitStatus: await window.hub.git.sync(false) }); } catch { /* 무시 — 칩이 이전 상태 유지 */ }
  },

  gitPull: async () => {
    const res = await window.hub.git.pull();
    await get().refreshGit();
    return res;
  },

  completeEpisode: async () => {
    const { selectedId } = get();
    if (!selectedId) throw new Error('선택된 에피소드 없음');
    const res = await window.hub.git.complete(selectedId);
    await get().refreshGit();
    return res;
  },
```
> 주: `completeEpisode`가 Phase B에서 이미 있으면 안 됨 — Phase B store 액션은 `patchEpisode`/`writeText`/`saveRender`뿐. 이름 충돌 없음 확인.

- [ ] **Step 2: typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 타입 0 · build 성공.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store/useHub.ts
git commit -m "feat(episode-hub): store git 상태·액션 + 실행 시 자동 sync"
```

---

### Task 6: Sidebar — git 상태 칩 + Update 버튼

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/slack.css`

**Interfaces:**
- Consumes: `useHub()` `gitStatus`·`refreshGit`·`gitPull`, `GitStatus`

- [ ] **Step 1: Sidebar.tsx — footer 자리표시를 칩+Update로 교체**

`useHub()` 구조분해에 추가: `gitStatus, gitPull`. 컴포넌트 상단(반환 전)에 칩 표현 헬퍼:
```tsx
  const chip = (() => {
    const s = gitStatus;
    if (!s || s.state === 'error') return { cls: 'warn', text: s?.message ? 'git: ' + s.message : 'git 사용 불가' };
    if (s.fetchFailed) return { cls: 'warn', text: '오프라인' };
    if (s.state === 'diverged') return { cls: 'err', text: '🔴 충돌 — 수동 정리 필요' };
    if (s.state === 'behind') return { cls: 'info', text: `🔵 받을 것 ${s.behind}` };
    if (s.state === 'ahead') return { cls: 'ok', text: `🟡 올릴 것 ${s.ahead}` };
    return { cls: 'ok', text: '🟢 최신' };
  })();
```
footer 블록 교체:
```tsx
      <div className="footer">
        <div className={`git-chip ${chip.cls}`}>{chip.text}</div>
        <div className="root-path">{root ?? 'orchestrator 미연결'}</div>
        <div className="footer-actions">
          <button className="btn-pill secondary sm" onClick={pickRoot}>폴더 변경</button>
          <button
            className="btn-pill secondary sm"
            onClick={async () => { const r = await gitPull(); if (!r.ok) alert('Update 실패: ' + r.message); }}
          >
            Update
          </button>
        </div>
      </div>
```

- [ ] **Step 2: slack.css — git 칩 스타일**

`src/renderer/slack.css` 끝에 추가:
```css
.git-chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; margin-bottom: 6px; display: inline-block; }
.git-chip.ok { background: rgba(23,117,74,0.12); color: var(--success, #17754a); }
.git-chip.info { background: rgba(29,120,215,0.12); color: #1d78d7; }
.git-chip.warn { background: #fff8e1; color: #8a6d00; }
.git-chip.err { background: rgba(211,47,47,0.12); color: #d32f2f; }
```
(색 토큰이 팔레트에 있으면 그걸로 교체 — `slack.css` grep 후 정합.)

- [ ] **Step 3: typecheck + build + 수동 스모크 기록**

Run: `npm run typecheck && npm run build`
Expected: 타입 0 · build 성공.
수동(리포트에 기재): `npm run dev` → 사이드바 하단 칩이 현재 저장소 상태 표시(클린이면 🟢 최신) → Update 클릭 시 pull 시도·결과.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Sidebar.tsx src/renderer/slack.css
git commit -m "feat(episode-hub): 사이드바 git 상태 칩 + Update 버튼"
```

---

### Task 7: EpisodeHeader — Complete 버튼 활성·배선

**Files:**
- Modify: `src/renderer/components/EpisodeHeader.tsx`
- Modify: `src/renderer/slack.css`

**Interfaces:**
- Consumes: `useHub()` `gitStatus`·`completeEpisode`, `detail.id`

- [ ] **Step 1: EpisodeHeader.tsx — Complete 활성·클릭**

상단에 추가:
```tsx
import { useState } from 'react';
import { useHub } from '../store/useHub';
```
컴포넌트 본문 상단:
```tsx
  const { gitStatus, completeEpisode } = useHub();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const epChanged = (gitStatus?.changedPaths ?? []).some((p) => p.includes(`output/episodes/${detail.id}/`));

  const onComplete = async () => {
    setBusy(true); setNote(null);
    try {
      const res = await completeEpisode();
      if (res.ok) setNote('✓ 완료 — 커밋·푸시됨');
      else if (res.reason === 'nothing') setNote('커밋할 변경이 없어요');
      else if (res.reason === 'needsUpdate') setNote('원격이 앞서 있어요 — Update 먼저 눌러주세요');
      else setNote('실패: ' + (res.message ?? '알 수 없는 오류'));
    } finally { setBusy(false); }
  };
```
기존 disabled Complete 버튼을 교체:
```tsx
      <button className="btn-pill primary sm" disabled={!epChanged || busy} onClick={onComplete} title={epChanged ? '이 에피소드 산출물 커밋·푸시' : '커밋할 변경 없음'}>
        {busy ? '처리 중…' : '✓ Complete'}
      </button>
      {note && <span className="complete-note">{note}</span>}
```

- [ ] **Step 2: slack.css — 완료 안내 텍스트**

`src/renderer/slack.css` 끝에 추가:
```css
.complete-note { font-size: 12px; color: #555; margin-left: 8px; align-self: center; }
```

- [ ] **Step 3: typecheck + build + 수동 스모크 기록**

Run: `npm run typecheck && npm run build`
Expected: 타입 0 · build 성공.
수동(리포트에 기재): 에피소드 md 편집·저장(Phase B)해 변경 발생 → 헤더 Complete 활성 → 클릭 → 커밋·푸시 안내. 원격 앞설 때 "Update 먼저".

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/EpisodeHeader.tsx src/renderer/slack.css
git commit -m "feat(episode-hub): Complete 버튼 활성·배선(EP 변경 시 커밋·푸시)"
```

---

### Task 8: e2e git 스모크 확장 + 최종 통합 검증

**Files:**
- Modify: `episode-hub/e2e/hub.e2e.ts`

- [ ] **Step 1: e2e에 git 픽스처 + 스모크 추가**

기존 `hub.e2e.ts`의 픽스처 루트 생성부를, git 저장소로 초기화하도록 보강한다(`tests/gitTestUtil`의 `makeRepoWithRemote` 방식 재현 — e2e는 tests/를 import하지 말고 인라인 `execFileSync`로 repo+bare 원격 구성 후 `orchestratorRoot = <repo>/orchestrator`로 앱을 띄운다. 앱 config는 기존과 동일하게 `--user-data-dir`+`hub-config.json`으로 orchestratorRoot 주입).

추가 테스트(가능한 것 위주, 나머지는 IPC 직접 호출):
```ts
test('git 상태 칩이 표시된다', async () => {
  await expect(page.locator('.git-chip')).toBeVisible();
});

test('Complete: EP 변경 → IPC로 커밋·푸시 성공', async () => {
  // EP md를 하나 바꿔 변경 발생 (IPC 직접 — 네이티브 편집 UI 대신)
  await page.evaluate(async () => {
    const w = window as unknown as { hub: { files: { writeText: (id: string, rel: string, c: string) => Promise<unknown> } } };
    // 픽스처 EP id/파일명은 beforeAll에서 만든 값으로 치환
  });
  const res = await page.evaluate(async () =>
    (window as unknown as { hub: { git: { complete: (id: string) => Promise<{ ok: boolean }> } } }).hub.git.complete(EP_ID));
  expect(res.ok).toBe(true);
});
```
> 구현 시: `beforeAll`에서 만든 `EP_ID`·파일 경로를 `page.evaluate` 인자로 넘겨 EP script md를 수정(`hub.files.writeText`) → `hub.git.complete(EP_ID)` → `{ok:true}` 단언 + bare 원격 반영을 fs/`git`으로 확인. git 미설치 환경이면 이 테스트만 `test.skip`하고 보고.

- [ ] **Step 2: e2e 실행**

Run: `npm run test:e2e`
Expected: 기존 4 + git 스모크 PASS (또는 git 없음 시 스킵 사유 리포트). 스크린샷 outputDir 저장.

- [ ] **Step 3: 최종 통합 검증**

Run: `npm test && npm run typecheck && npm run build`
Expected: 전 단위 테스트 PASS(Phase B 35 + git 13 = 48+) · 타입 0 · build 성공.

- [ ] **Step 4: 문서 동기화 확인**

`episode-hub` README/주석에 git API 표면이 명시돼 있으면 반영. Sidebar footer 주석("Phase C에서 교체")이 실제로 교체됐는지 확인.

- [ ] **Step 5: Commit + 최종 리뷰 준비**

```bash
git add episode-hub/e2e/hub.e2e.ts
git commit -m "test(episode-hub): git 동기화 GUI 스모크(e2e)"
```
이후 `superpowers:requesting-code-review`로 `feat/episode-hub-phase-c` 전체 diff 리뷰 → 지적 반영 → Owner 승인 후 main FF 머지·푸시(`superpowers:finishing-a-development-branch`).

---

## Self-Review

**Spec coverage:**
- 시스템 git 직접 호출(무의존) → Task 1~3 `git.ts` execFile ✅
- git 루트 ≠ orchestrator 루트, rev-parse 발견·캐시 → Task 1 `resolveGitRoot` ✅
- fetchStatus 상태 산출(clean/behind/ahead/diverged/error + dirty + changedPaths + 오프라인) → Task 1 ✅
- pullFF(FF only, dirty/diverge 거부) + syncStatus 자동조건 → Task 2 ✅
- completeEpisode(EP 폴더만·이미지 제외·커밋 메시지·push·needsUpdate·nothing) → Task 3 ✅
- IPC 3종 + preload(import type) → Task 4 ✅
- store 상태·액션 + 실행 시 자동 sync → Task 5 ✅
- 사이드바 칩(🟢🔵🟡🔴/오프라인/git없음) + Update → Task 6 ✅
- Complete 활성(EP porcelain 변경) + 배선 + needsUpdate 안내 → Task 7 ✅
- 실동작 단위 테스트(임시 git+bare 원격) + e2e → Task 1~3·8 ✅
- 백로그(data 도장·그룹 게이트·board·이미지 공유) → 계획 제외(스펙 §6) ✅

**Placeholder scan:** 모든 코드 스텝에 실제 코드; e2e Task 8은 EP_ID 치환 지점을 명시(픽스처 값 주입) — 구현자가 beforeAll 값으로 채움. TBD 없음 ✅

**Type consistency:** `GitStatus`·`CompleteResult`가 git.ts(정의)→ipc→preload→store→renderer 동일. `resolveGitRoot`/`fetchStatus`/`pullFF`/`syncStatus`/`completeEpisode`/`episodeRelPath` 시그니처가 정의부와 소비부 일치. `changedPaths` EP 필터 규칙(`output/episodes/<id>/` 포함)이 Task 3(생성)·Task 7(소비) 동일. store `completeEpisode`(무인자, selectedId 사용)와 git.ts `completeEpisode`(root,id) 이름 같으나 계층 다름 — 혼동 없음 ✅
