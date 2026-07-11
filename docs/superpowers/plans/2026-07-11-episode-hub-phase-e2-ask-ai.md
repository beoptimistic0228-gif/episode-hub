# Phase E2 "에피소드에게 물어보기" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에피소드 화면 안에서 부부가 Claude에게 읽기 전용 질문을 하는 패널 — 앱이 headless `claude`를 spawn하고 E1 MCP 서버로 데이터를 읽어 답한다.

**Architecture:** `src/main/aiBridge.ts`(신설)가 `claude -p --output-format stream-json`을 spawn(프롬프트는 stdin, 도구는 `--allowedTools` 읽기 4종 잠금, E1 접속은 `--mcp-config` 파일 주입). stream-json 라인을 정규화해 `ai:stream` IPC로 renderer에 흘리고, 세션 id를 에피소드별로 보관해 `--resume`으로 이어묻기. renderer는 `AskClaude.tsx` 패널이 말풍선 UI + `renderMarkdown`(DOMPurify)로 표시.

**Tech Stack:** Electron main(node:child_process) + React + vitest + Playwright-Electron. **신규 런타임 의존성 0.**

**Spec:** `docs/superpowers/specs/2026-07-11-episode-hub-phase-e2-ask-ai-design.md`

## Global Constraints

- **$0**: SDK·API 키 금지. 이미 설치된 `claude` CLI만 사용. 신규 유료 의존성 금지.
- **읽기 전용 구조 보장**: spawn 인자에 `--allowedTools`는 정확히 `mcp__episode-hub__list_episodes,mcp__episode-hub__read_episode,mcp__episode-hub__read_file,mcp__episode-hub__get_channel_stats` 4종. `--disallowedTools "Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch"` 병기.
- **게이트**: 각 Task 커밋 전 해당 테스트 그린. 마지막 Task에서 unit 전체 · `npm run typecheck` 0 · `npm run build` OK · `npm run test:e2e` 그린.
- **커밋 컨벤션**: `feat(episode-hub): ...` / `test(episode-hub): ...`, 커밋 footer에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **테스트에서 실제 `claude` 호출 금지** — 단위는 DI(가짜 프로세스), e2e는 `HUB_CLAUDE_BIN` 스텁.
- Windows 우선(레포 표준 환경). spawn은 `shell: true`(win32) + 공백 인자 수동 쿼팅.
- UI 문구는 쉬운 한국어(비개발자 부부).

---

### Task 1: aiBridge 순수 함수 (프롬프트·인자 조립 + 스트림 파싱)

**Files:**
- Create: `src/main/aiBridge.ts`
- Test: `tests/aiBridge-pure.test.ts`

**Interfaces:**
- Consumes: `MCP_PATH` (`src/main/mcpBridge.ts`, 기존 `'/mcp'`)
- Produces (후속 Task가 그대로 씀):
  - `READ_TOOLS: readonly string[]` — 읽기 4종 풀네임
  - `type AskEvent = { kind: 'init'|'text'|'tool'|'result'|'error'|'done'; text?: string; tool?: string; sessionId?: string }`
  - `buildPrompt(episodeId: string, question: string, isNewSession: boolean): string`
  - `buildAskArgs(opts: { mcpConfigPath: string; resumeSessionId?: string }): string[]` — 프롬프트는 인자에 없음(stdin 전달)
  - `parseStreamLine(line: string): AskEvent | null`
  - `writeAiMcpConfig(file: string, port: number, token: string): string`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/aiBridge-pure.test.ts`

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  READ_TOOLS, buildPrompt, buildAskArgs, parseStreamLine, writeAiMcpConfig,
} from '../src/main/aiBridge';

describe('buildPrompt', () => {
  test('새 세션 첫 질문에는 에피소드 맥락 프리앰블을 접두한다', () => {
    const p = buildPrompt('ep20260628_ippool-g009', '예산 왜 이렇게 나왔어?', true);
    expect(p).toContain('ep20260628_ippool-g009');
    expect(p).toContain('episode-hub MCP 도구');
    expect(p).toContain('추측으로 만들지 마세요');
    expect(p.endsWith('질문: 예산 왜 이렇게 나왔어?')).toBe(true);
  });
  test('이어묻기(resume)는 질문만 그대로 보낸다', () => {
    expect(buildPrompt('ep-x', '더 싼 대안은?', false)).toBe('더 싼 대안은?');
  });
});

describe('buildAskArgs', () => {
  test('읽기 4종 잠금 + 쓰기·셸 도구 차단 + strict mcp-config', () => {
    const args = buildAskArgs({ mcpConfigPath: 'C:/x/ai-mcp.json' });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--strict-mcp-config');
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toBe(READ_TOOLS.join(','));
    expect(allowed).not.toMatch(/write_file|patch_episode|save_render|git_complete/);
    const denied = args[args.indexOf('--disallowedTools') + 1];
    expect(denied).toContain('Bash');
    expect(denied).toContain('Write');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('C:/x/ai-mcp.json');
    expect(args).not.toContain('--resume');
  });
  test('resumeSessionId가 있으면 --resume을 붙인다', () => {
    const args = buildAskArgs({ mcpConfigPath: 'x.json', resumeSessionId: 's-123' });
    expect(args[args.indexOf('--resume') + 1]).toBe('s-123');
  });
});

describe('parseStreamLine', () => {
  test('system/init → init + session_id', () => {
    const ev = parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }));
    expect(ev).toEqual({ kind: 'init', sessionId: 's-1' });
  });
  test('assistant tool_use → tool 이벤트(단계 표시용)', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__episode-hub__read_episode', input: {} }] } });
    expect(parseStreamLine(line)).toEqual({ kind: 'tool', tool: 'mcp__episode-hub__read_episode' });
  });
  test('assistant text → text 이벤트', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '총 예산은 ' }] } });
    expect(parseStreamLine(line)).toEqual({ kind: 'text', text: '총 예산은 ' });
  });
  test('result 성공 → result + 전체 답변 + session_id', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '답변 전문', session_id: 's-1' });
    expect(parseStreamLine(line)).toEqual({ kind: 'result', text: '답변 전문', sessionId: 's-1' });
  });
  test('result is_error → error 이벤트', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '실패 사유', session_id: 's-1' });
    expect(parseStreamLine(line)).toEqual({ kind: 'error', text: '실패 사유', sessionId: 's-1' });
  });
  test('빈 줄·JSON 아님·모르는 타입 → null(무시)', () => {
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('not-json')).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: 'user' }))).toBeNull();
  });
});

test('writeAiMcpConfig — episode-hub http 엔트리 + Bearer 토큰', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-mcp-'));
  const file = writeAiMcpConfig(join(dir, 'ai-mcp.json'), 7801, 'tok123');
  const doc = JSON.parse(readFileSync(file, 'utf-8'));
  expect(doc.mcpServers['episode-hub'].url).toBe('http://127.0.0.1:7801/mcp');
  expect(doc.mcpServers['episode-hub'].headers.Authorization).toBe('Bearer tok123');
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/aiBridge-pure.test.ts`
Expected: FAIL — `Cannot find module '../src/main/aiBridge'`

- [ ] **Step 3: 최소 구현** — `src/main/aiBridge.ts` 신설

```ts
import { writeFileSync } from 'node:fs';
import { MCP_PATH } from './mcpBridge';

/** E2 읽기 전용 보장의 핵심 — 이 4종 외 도구는 스폰된 claude에 존재하지 않는다. */
export const READ_TOOLS = [
  'mcp__episode-hub__list_episodes',
  'mcp__episode-hub__read_episode',
  'mcp__episode-hub__read_file',
  'mcp__episode-hub__get_channel_stats',
] as const;

const DENY_TOOLS = 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch';

export interface AskEvent {
  kind: 'init' | 'text' | 'tool' | 'result' | 'error' | 'done';
  text?: string;
  tool?: string;
  sessionId?: string;
}

export function buildPrompt(episodeId: string, question: string, isNewSession: boolean): string {
  if (!isNewSession) return question;
  return [
    '당신은 "누구의 공간" 채널 Episode Hub 앱에서 부부의 질문에 답하는 도우미입니다.',
    `지금 보고 있는 에피소드: ${episodeId}`,
    'episode-hub MCP 도구(read_episode·read_file 등)로 실제 데이터를 읽고 답하세요.',
    '- 제품·가격 숫자는 에피소드 데이터에서 인용만 하고, 추측으로 만들지 마세요.',
    '- 비개발자 부부가 읽습니다. 쉬운 한국어로 답하세요.',
    '',
    `질문: ${question}`,
  ].join('\n');
}

/** 프롬프트는 argv가 아니라 stdin으로 넣는다(따옴표·개행 이스케이프 문제 원천 차단). */
export function buildAskArgs(opts: { mcpConfigPath: string; resumeSessionId?: string }): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose',
    '--mcp-config', opts.mcpConfigPath, '--strict-mcp-config',
    '--allowedTools', READ_TOOLS.join(','),
    '--disallowedTools', DENY_TOOLS,
  ];
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  return args;
}

export function parseStreamLine(line: string): AskEvent | null {
  const t = line.trim();
  if (!t) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(t); } catch { return null; }
  if (j.type === 'system' && j.subtype === 'init') return { kind: 'init', sessionId: String(j.session_id) };
  if (j.type === 'assistant') {
    const msg = j.message as { content?: Array<{ type: string; text?: string; name?: string }> } | undefined;
    const parts = msg?.content ?? [];
    const tool = parts.find((c) => c.type === 'tool_use');
    if (tool) return { kind: 'tool', tool: tool.name };
    const text = parts.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return text ? { kind: 'text', text } : null;
  }
  if (j.type === 'result') {
    const sessionId = j.session_id ? String(j.session_id) : undefined;
    if (j.is_error) return { kind: 'error', text: String(j.result ?? j.subtype ?? '알 수 없는 오류'), sessionId };
    return { kind: 'result', text: String(j.result ?? ''), sessionId };
  }
  return null;
}

/** 스폰된 claude에 줄 E1 접속 정보(mcp-config) 파일. userData에 기록(비밀 토큰 — 레포 밖). */
export function writeAiMcpConfig(file: string, port: number, token: string): string {
  const doc = {
    mcpServers: {
      'episode-hub': {
        type: 'http',
        url: `http://127.0.0.1:${port}${MCP_PATH}`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
  writeFileSync(file, JSON.stringify(doc, null, 2), 'utf-8');
  return file;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/aiBridge-pure.test.ts`
Expected: PASS (전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add src/main/aiBridge.ts tests/aiBridge-pure.test.ts
git commit -m "feat(episode-hub): E2 aiBridge 순수 계층 — 프롬프트·인자 조립+스트림 파싱"
```

---

### Task 2: AiBridge 실행기 (spawn 수명 관리 — DI로 테스트)

**Files:**
- Modify: `src/main/aiBridge.ts` (Task 1 파일에 추가)
- Test: `tests/aiBridge-run.test.ts`

**Interfaces:**
- Consumes: Task 1의 `buildPrompt`/`buildAskArgs`/`parseStreamLine`/`AskEvent`
- Produces:
  - `type SpawnLike = { stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream; stdin: NodeJS.WritableStream; on(ev: 'close', cb: (code: number | null) => void): unknown; kill(): void }`
  - `class AiBridge { constructor(deps: AiBridgeDeps); busy(): boolean; ask(episodeId: string, question: string): { ok: true } | { ok: false; message: string }; cancel(): void; reset(episodeId: string): void }`
  - `type AiBridgeDeps = { mcpConfigPath: string; onEvent: (ev: AskEvent) => void; spawnImpl: (args: string[]) => SpawnLike; timeoutMs?: number }` (기본 timeoutMs 120_000)
  - `resolveClaudeBin(): string | null` — env `HUB_CLAUDE_BIN` 우선, 없으면 `where`/`which claude` 1행. 못 찾으면 null.
  - `spawnClaude(bin: string, args: string[]): SpawnLike` — 실제 spawn(win32는 `shell: true` + 공백 인자 `"..."` 쿼팅)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/aiBridge-run.test.ts`

```ts
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AiBridge, type AskEvent, type SpawnLike } from '../src/main/aiBridge';

class FakeChild extends EventEmitter implements SpawnLike {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  kill() { this.killed = true; this.emit('close', 1); }
}

function line(obj: unknown): string { return JSON.stringify(obj) + '\n'; }

function makeBridge(timeoutMs?: number) {
  const events: AskEvent[] = [];
  const spawned: { args: string[]; child: FakeChild }[] = [];
  const bridge = new AiBridge({
    mcpConfigPath: 'C:/x/ai-mcp.json',
    onEvent: (ev) => events.push(ev),
    spawnImpl: (args) => { const child = new FakeChild(); spawned.push({ args, child }); return child; },
    timeoutMs,
  });
  return { bridge, events, spawned };
}

async function tick() { await new Promise((r) => setTimeout(r, 0)); }

test('정상 흐름: init→tool→text→result 이벤트 중계 + done + 세션 저장', async () => {
  const { bridge, events, spawned } = makeBridge();
  expect(bridge.ask('ep-1', '예산?')).toEqual({ ok: true });
  const { child } = spawned[0];
  child.stdout.write(line({ type: 'system', subtype: 'init', session_id: 's-1' }));
  child.stdout.write(line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__episode-hub__read_episode' }] } }));
  child.stdout.write(line({ type: 'assistant', message: { content: [{ type: 'text', text: '답변' }] } }));
  child.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: '답변', session_id: 's-1' }));
  child.stdout.end();
  child.emit('close', 0);
  await tick();
  expect(events.map((e) => e.kind)).toEqual(['init', 'tool', 'text', 'result', 'done']);
  // 같은 에피소드 두 번째 질문 = --resume 승계
  bridge.ask('ep-1', '더 싼 건?');
  expect(spawned[1].args).toContain('--resume');
  expect(spawned[1].args[spawned[1].args.indexOf('--resume') + 1]).toBe('s-1');
  // 다른 에피소드는 새 세션
  spawned[1].child.emit('close', 0);
  await tick();
  bridge.ask('ep-2', '안녕?');
  expect(spawned[2].args).not.toContain('--resume');
});

test('첫 질문 프롬프트는 stdin으로 프리앰블 포함 전달', async () => {
  const { bridge, spawned } = makeBridge();
  bridge.ask('ep-1', '예산?');
  const child = spawned[0].child;
  const written: Buffer[] = [];
  child.stdin.on('data', (c: Buffer) => written.push(c));
  await tick();
  const sent = Buffer.concat(written).toString('utf-8');
  expect(sent).toContain('지금 보고 있는 에피소드: ep-1');
  expect(sent).toContain('질문: 예산?');
});

test('busy 중 재요청 거부', () => {
  const { bridge } = makeBridge();
  expect(bridge.ask('ep-1', 'a')).toEqual({ ok: true });
  const second = bridge.ask('ep-1', 'b');
  expect(second.ok).toBe(false);
});

test('result 없이 종료(exit≠0) → error + done', async () => {
  const { bridge, events, spawned } = makeBridge();
  bridge.ask('ep-1', 'a');
  const { child } = spawned[0];
  child.stderr.write('boom');
  child.stdout.end();
  child.emit('close', 1);
  await tick();
  expect(events.some((e) => e.kind === 'error' && e.text?.includes('boom'))).toBe(true);
  expect(events[events.length - 1].kind).toBe('done');
  expect(bridge.busy()).toBe(false);
});

test('cancel → 프로세스 kill + done', async () => {
  const { bridge, events, spawned } = makeBridge();
  bridge.ask('ep-1', 'a');
  bridge.cancel();
  await tick();
  expect(spawned[0].child.killed).toBe(true);
  expect(events[events.length - 1].kind).toBe('done');
});

test('타임아웃: timeoutMs 동안 stdout 무출력 → kill + error', async () => {
  vi.useFakeTimers();
  const { bridge, events, spawned } = makeBridge(1000);
  bridge.ask('ep-1', 'a');
  vi.advanceTimersByTime(1100);
  vi.useRealTimers();
  await tick();
  expect(spawned[0].child.killed).toBe(true);
  expect(events.some((e) => e.kind === 'error')).toBe(true);
});

test('resume 실행이 실패(exit≠0)하면 세션을 폐기 — 다음 질문은 새 세션', async () => {
  const { bridge, spawned } = makeBridge();
  bridge.ask('ep-1', 'a');
  spawned[0].child.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's-1' }));
  spawned[0].child.stdout.end();
  spawned[0].child.emit('close', 0);
  await tick();
  bridge.ask('ep-1', 'b'); // --resume s-1
  spawned[1].child.stdout.end();
  spawned[1].child.emit('close', 1); // 만료 세션 등으로 실패
  await tick();
  bridge.ask('ep-1', 'c');
  expect(spawned[2].args).not.toContain('--resume');
});

test('reset → 다음 질문이 --resume 없이 새 세션', async () => {
  const { bridge, spawned } = makeBridge();
  bridge.ask('ep-1', 'a');
  const { child } = spawned[0];
  child.stdout.write(line({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's-9' }));
  child.stdout.end();
  child.emit('close', 0);
  await tick();
  bridge.reset('ep-1');
  bridge.ask('ep-1', 'b');
  expect(spawned[1].args).not.toContain('--resume');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/aiBridge-run.test.ts`
Expected: FAIL — `AiBridge is not exported` (또는 동등한 미정의 오류)

- [ ] **Step 3: 구현** — `src/main/aiBridge.ts`에 추가

```ts
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
// (기존 import 유지. writeFileSync는 이미 있음)

export interface SpawnLike {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  on(ev: 'close', cb: (code: number | null) => void): unknown;
  kill(): void;
}

export interface AiBridgeDeps {
  mcpConfigPath: string;
  onEvent: (ev: AskEvent) => void;
  spawnImpl: (args: string[]) => SpawnLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class AiBridge {
  private child: SpawnLike | null = null;
  private sessions = new Map<string, string>();
  constructor(private deps: AiBridgeDeps) {}

  busy(): boolean { return this.child !== null; }

  ask(episodeId: string, question: string): { ok: true } | { ok: false; message: string } {
    if (this.child) return { ok: false, message: '이미 답변 중이에요. 끝나면 다시 물어봐 주세요.' };
    const resume = this.sessions.get(episodeId);
    const args = buildAskArgs({ mcpConfigPath: this.deps.mcpConfigPath, resumeSessionId: resume });
    const child = this.deps.spawnImpl(args);
    this.child = child;

    const timeoutMs = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer = setTimeout(onTimeout, timeoutMs);
    const bump = () => { clearTimeout(timer); timer = setTimeout(onTimeout, timeoutMs); };
    const self = this;
    function onTimeout() {
      self.deps.onEvent({ kind: 'error', text: '응답이 없어 중단했어요. 다시 시도해 주세요.' });
      child.kill();
    }

    let sawResult = false;
    let stderrTail = '';
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      bump();
      buf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const ev = parseStreamLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (!ev) continue;
        if (ev.sessionId) this.sessions.set(episodeId, ev.sessionId);
        if (ev.kind === 'result' || ev.kind === 'error') sawResult = true;
        this.deps.onEvent(ev);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString('utf-8')).slice(-500); });
    child.on('close', (code) => {
      clearTimeout(timer);
      this.child = null;
      if (!sawResult && code !== 0) {
        // 만료 세션 resume 실패 등 — 세션 폐기해 다음 질문은 새 세션으로
        if (resume) this.sessions.delete(episodeId);
        this.deps.onEvent({ kind: 'error', text: `Claude 실행이 실패했어요. ${stderrTail || `(exit ${code})`}` });
      }
      this.deps.onEvent({ kind: 'done' });
    });
    child.stdin.end(buildPrompt(episodeId, question, !resume));
    return { ok: true };
  }

  cancel(): void { this.child?.kill(); }
  reset(episodeId: string): void { this.sessions.delete(episodeId); }
}

/** claude 실행 파일 탐지 — env HUB_CLAUDE_BIN 우선(테스트·스텁), 없으면 PATH 조회. */
export function resolveClaudeBin(): string | null {
  const envBin = process.env.HUB_CLAUDE_BIN;
  if (envBin) return existsSync(envBin) ? envBin : null;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf-8' });
  if (r.status !== 0) return null;
  const first = (r.stdout ?? '').split(/\r?\n/).find(Boolean);
  return first ?? null;
}

/** 실제 spawn. win32는 .cmd 셔임 대응으로 shell 경유 + 공백 인자만 쿼팅(프롬프트는 stdin이라 안전). */
export function spawnClaude(bin: string, args: string[]): SpawnLike {
  if (process.platform === 'win32') {
    const q = (s: string) => (/[ \t]/.test(s) ? `"${s}"` : s);
    return spawn(q(bin), args.map(q), { shell: true, windowsHide: true }) as unknown as SpawnLike;
  }
  return spawn(bin, args) as unknown as SpawnLike;
}
```

- [ ] **Step 4: 통과 확인 (신규 + Task 1 회귀)**

Run: `npx vitest run tests/aiBridge-run.test.ts tests/aiBridge-pure.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/main/aiBridge.ts tests/aiBridge-run.test.ts
git commit -m "feat(episode-hub): E2 AiBridge 실행기 — spawn 수명·세션 승계·타임아웃(DI 테스트)"
```

---

### Task 3: IPC + preload 배선

**Files:**
- Create: `src/main/aiIpc.ts` — ⚠️ **aiBridge.ts에 넣지 말 것**: electron import가 들어가면 Task 1·2의 electron-mock 없는 단위 테스트가 깨진다. electron 의존은 이 파일에 격리.
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/aiBridge-ipc.test.ts` (등록 함수의 인자 검증만 — Electron 모듈은 mock)

**Interfaces:**
- Consumes: Task 2의 `AiBridge`/`resolveClaudeBin`/`spawnClaude`/`writeAiMcpConfig`, `index.ts`의 기존 `mcpToken`·`MCP_PORT`
- Produces:
  - main: `registerAiIpc(opts: { userDataDir: string; port: number; token: string }): { dispose(): void }` — `ai:status`/`ai:ask`/`ai:cancel`/`ai:reset` handle 등록, `ai:stream` 이벤트는 `BrowserWindow.getAllWindows()` 전체에 send
  - preload: `window.hub.ai = { status(): Promise<{ available: boolean }>, ask(episodeId, question): Promise<{ ok: boolean; message?: string }>, cancel(): Promise<{ ok: true }>, reset(episodeId): Promise<{ ok: true }>, onStream(cb: (ev: AskEvent) => void): () => void }`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/aiBridge-ipc.test.ts`

```ts
// registerAiIpc는 Electron 런타임 의존이라 electron 모듈을 mock하고
// "채널 4종 등록 + mcp-config 파일 생성"만 검증한다(로직 본체는 Task 1·2에서 검증 완료).
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const handles = new Map<string, unknown>();
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: unknown) => handles.set(ch, fn) },
  BrowserWindow: { getAllWindows: () => [] },
}));

test('registerAiIpc — ai:* 채널 4종 등록 + ai-mcp-config.json 생성', async () => {
  const { registerAiIpc } = await import('../src/main/aiIpc');
  const dir = mkdtempSync(join(tmpdir(), 'ai-ipc-'));
  registerAiIpc({ userDataDir: dir, port: 7801, token: 'tok' });
  for (const ch of ['ai:status', 'ai:ask', 'ai:cancel', 'ai:reset']) {
    expect(handles.has(ch)).toBe(true);
  }
  expect(existsSync(join(dir, 'ai-mcp-config.json'))).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/aiBridge-ipc.test.ts`
Expected: FAIL — `registerAiIpc is not a function`

- [ ] **Step 3: 구현**

`src/main/aiIpc.ts` 신설:

```ts
import { ipcMain, BrowserWindow } from 'electron';
import { join } from 'node:path';
import {
  AiBridge, resolveClaudeBin, spawnClaude, writeAiMcpConfig, type AskEvent,
} from './aiBridge';

export function registerAiIpc(opts: { userDataDir: string; port: number; token: string }): { dispose(): void } {
  const mcpConfigPath = writeAiMcpConfig(join(opts.userDataDir, 'ai-mcp-config.json'), opts.port, opts.token);
  const bin = resolveClaudeBin();
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

  ipcMain.handle('ai:status', () => ({ available: resolveClaudeBin() !== null }));
  ipcMain.handle('ai:ask', (_e, episodeId: string, question: string) => {
    try { return bridge.ask(String(episodeId), String(question)); }
    catch (err) { return { ok: false, message: String(err) }; }
  });
  ipcMain.handle('ai:cancel', () => { bridge.cancel(); return { ok: true as const }; });
  ipcMain.handle('ai:reset', (_e, episodeId: string) => { bridge.reset(String(episodeId)); return { ok: true as const }; });
  void bin; // 기동 시 1회 탐지는 status 채널로 충분 — 변수 미사용 경고 방지
  return { dispose: () => bridge.cancel() };
}
```

`src/main/index.ts` — 기존 `mcpToken` 생성(94행 부근)과 `startMcpBridge` 호출 이후에 배선. import에 `registerAiIpc` 추가:

```ts
import { registerAiIpc } from './aiIpc';
// ... app.whenReady() 안, startMcpBridge 부근:
const aiIpc = registerAiIpc({ userDataDir: app.getPath('userData'), port: MCP_PORT, token: mcpToken });
app.on('before-quit', () => aiIpc.dispose());
```

`src/preload/index.ts` — `api` 객체에 `ai` 네임스페이스 추가 (`events:` 블록의 리스너 해제 패턴과 동일):

```ts
import type { AskEvent } from '../main/aiBridge';
// api 객체 안:
  ai: {
    status: (): Promise<{ available: boolean }> => ipcRenderer.invoke('ai:status'),
    ask: (episodeId: string, question: string): Promise<{ ok: boolean; message?: string }> =>
      ipcRenderer.invoke('ai:ask', episodeId, question),
    cancel: (): Promise<{ ok: true }> => ipcRenderer.invoke('ai:cancel'),
    reset: (episodeId: string): Promise<{ ok: true }> => ipcRenderer.invoke('ai:reset', episodeId),
    onStream: (cb: (ev: AskEvent) => void): (() => void) => {
      const listener = (_e: unknown, ev: AskEvent) => cb(ev);
      ipcRenderer.on('ai:stream', listener);
      return () => ipcRenderer.removeListener('ai:stream', listener);
    },
  },
```

- [ ] **Step 4: 통과 + 회귀 + 타입 확인**

Run: `npx vitest run && npm run typecheck`
Expected: 전 테스트 PASS, typecheck 에러 0

- [ ] **Step 5: 커밋**

```bash
git add src/main/aiIpc.ts src/main/index.ts src/preload/index.ts tests/aiBridge-ipc.test.ts
git commit -m "feat(episode-hub): E2 IPC·preload 배선 — ai:* 채널 + mcp-config 주입"
```

---

### Task 4: AskClaude 질문 패널 (renderer)

**Files:**
- Create: `src/renderer/components/AskClaude.tsx`
- Modify: `src/renderer/components/EpisodeView.tsx` (GroupDetail 아래 패널 추가)
- Modify: `src/renderer/brand.css` (패널 스타일)

**Interfaces:**
- Consumes: Task 3의 `window.hub.ai.*`, 기존 `renderMarkdown`(`src/renderer/lib/markdown.ts`)
- Produces: `<AskClaude episodeId={string} />` — EpisodeView가 `key={detail.id}`로 리마운트(에피소드 전환 시 대화 초기화)

- [ ] **Step 1: 컴포넌트 구현** — `src/renderer/components/AskClaude.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import type { AskEvent } from '../../main/aiBridge';

type Bubble = { role: 'user' | 'assistant' | 'error'; text: string };

export default function AskClaude({ episodeId }: { episodeId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [live, setLive] = useState('');          // 스트리밍 중 답변 버퍼
  const [step, setStep] = useState<string | null>(null); // "에피소드 읽는 중…"
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const liveRef = useRef('');

  useEffect(() => { void window.hub.ai.status().then((s) => setAvailable(s.available)); }, []);

  useEffect(() => window.hub.ai.onStream((ev: AskEvent) => {
    if (ev.kind === 'tool') setStep('에피소드 읽는 중…');
    if (ev.kind === 'text') { setStep(null); liveRef.current += ev.text ?? ''; setLive(liveRef.current); }
    if (ev.kind === 'result') { liveRef.current = ev.text || liveRef.current; setLive(liveRef.current); }
    if (ev.kind === 'error') {
      setBubbles((b) => [...b, { role: 'error', text: ev.text ?? '오류가 났어요.' }]);
      liveRef.current = ''; setLive('');
    }
    if (ev.kind === 'done') {
      if (liveRef.current) setBubbles((b) => [...b, { role: 'assistant', text: liveRef.current }]);
      liveRef.current = ''; setLive(''); setStep(null); setBusy(false);
    }
  }), []);

  const send = async () => {
    const q = draft.trim();
    if (!q || busy) return;
    setBubbles((b) => [...b, { role: 'user', text: q }]);
    setDraft(''); setBusy(true);
    const r = await window.hub.ai.ask(episodeId, q);
    if (!r.ok) { setBubbles((b) => [...b, { role: 'error', text: r.message ?? '요청이 거부됐어요.' }]); setBusy(false); }
  };

  const newChat = async () => { await window.hub.ai.reset(episodeId); setBubbles([]); };

  if (available === false) {
    return (
      <section className="ask-panel">
        <h3>🤖 Claude에게 물어보기</h3>
        <p className="ask-unavailable">이 PC에는 Claude Code가 없어 질문 기능을 쓸 수 없어요.</p>
      </section>
    );
  }

  return (
    <section className="ask-panel">
      <div className="ask-head">
        <h3>🤖 Claude에게 물어보기</h3>
        {bubbles.length > 0 && <button className="chip" onClick={() => void newChat()} disabled={busy}>새 대화</button>}
      </div>
      <div className="ask-thread">
        {bubbles.map((b, i) =>
          b.role === 'assistant'
            ? <div key={i} className="ask-bubble assistant md-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />
            : <div key={i} className={`ask-bubble ${b.role}`}>{b.text}</div>,
        )}
        {live && <div className="ask-bubble assistant md-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(live) }} />}
        {step && <div className="ask-step">{step}</div>}
      </div>
      <div className="ask-input-row">
        <input
          className="ask-input"
          placeholder="이 에피소드에 대해 물어보세요 (예: 예산 구성이 왜 이래?)"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
        />
        {busy
          ? <button className="chip" onClick={() => void window.hub.ai.cancel()}>중단</button>
          : <button className="chip" onClick={() => void send()} disabled={!draft.trim()}>보내기</button>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: EpisodeView에 패널 배치** — `src/renderer/components/EpisodeView.tsx`

import에 `import AskClaude from './AskClaude';` 추가, `<GroupDetail ... />` 다음 줄에:

```tsx
      {/* key=id — 에피소드 전환 시 대화 UI 리마운트(세션은 main이 에피소드별 보관) */}
      <AskClaude key={`ask-${detail.id}`} episodeId={detail.id} />
```

- [ ] **Step 3: 스타일 추가** — `src/renderer/brand.css` 말미에

```css
/* ── E2: Claude에게 물어보기 패널 ── */
.ask-panel { margin: 16px; padding: 12px 16px; border: 1px solid var(--line, #d9d9d9); border-radius: 12px; }
.ask-head { display: flex; align-items: center; justify-content: space-between; }
.ask-thread { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
.ask-bubble { max-width: 85%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap; }
.ask-bubble.user { align-self: flex-end; background: var(--sky, #aed1ef); }
.ask-bubble.assistant { align-self: flex-start; background: rgba(0, 0, 0, 0.05); white-space: normal; }
.ask-bubble.error { align-self: flex-start; background: rgba(234, 79, 35, 0.12); color: #a33; }
.ask-step { font-size: 12px; opacity: 0.6; }
.ask-unavailable { opacity: 0.6; }
.ask-input-row { display: flex; gap: 8px; }
.ask-input { flex: 1; padding: 8px 10px; border: 1px solid var(--line, #d9d9d9); border-radius: 8px; }
```

(⚠️ brand.css에 이미 같은 목적의 변수·클래스가 있으면 그것을 재사용하고 중복 정의하지 말 것 — 파일 말미 주석·기존 `.chip`/`.md-view` 스타일 확인.)

- [ ] **Step 4: 게이트 확인**

Run: `npm run typecheck && npm run build`
Expected: 둘 다 성공

- [ ] **Step 5: 커밋**

```bash
git add src/renderer/components/AskClaude.tsx src/renderer/components/EpisodeView.tsx src/renderer/brand.css
git commit -m "feat(episode-hub): E2 질문 패널 — 말풍선 스트리밍 UI(DOMPurify 렌더)"
```

---

### Task 5: e2e — 스텁 claude로 질문→답변 흐름 검증 + 전체 게이트

**Files:**
- Create: `e2e/stub/claude.cmd`, `e2e/stub/claude-stub.js`
- Modify: `e2e/hub.e2e.ts` (테스트 1건 추가 + launch env에 `HUB_CLAUDE_BIN`)

**Interfaces:**
- Consumes: Task 2의 `HUB_CLAUDE_BIN` env 오버라이드(resolveClaudeBin), Task 4의 패널 DOM(`.ask-input`, `.ask-bubble.assistant`)
- Produces: e2e ⑩ 시나리오

- [ ] **Step 1: 스텁 실행 파일 작성**

`e2e/stub/claude-stub.js`:

```js
// 실제 claude 대역: stdin(프롬프트)을 읽고 고정 stream-json 3줄을 뱉는다.
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'system', subtype: 'init', session_id: 'stub-session-1' });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: '스텁 답변: 총 예산은 **667,250원**입니다.' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: '스텁 답변: 총 예산은 **667,250원**입니다.', session_id: 'stub-session-1' });
  process.exit(0);
});
```

`e2e/stub/claude.cmd`:

```bat
@echo off
node "%~dp0claude-stub.js" %*
```

- [ ] **Step 2: e2e 테스트 추가** — `e2e/hub.e2e.ts`

기존 `electron.launch({ env: ... })`의 env에 `HUB_CLAUDE_BIN: join(__dirname, 'stub', 'claude.cmd')` 추가 (기존 `HUB_STATS_MOCK` 항목과 같은 자리, `join`은 기존 import 재사용). 파일 말미에 시나리오 추가:

```ts
test('⑩ Claude 질문: 스텁 claude로 질문 → 답변 말풍선 표시', async () => {
  // 에피소드 상세로 진입해 있는 기존 헬퍼/흐름을 재사용한다(선행 테스트와 동일 진입).
  const input = page.locator('.ask-input');
  await expect(input).toBeVisible();
  await input.fill('예산 얼마야?');
  await input.press('Enter');
  await expect(page.locator('.ask-bubble.user').last()).toHaveText('예산 얼마야?');
  await expect(page.locator('.ask-bubble.assistant').last()).toContainText('667,250원', { timeout: 15000 });
});
```

(⚠️ `e2e/hub.e2e.ts`의 기존 테스트들이 에피소드 상세 화면에 이미 진입해 있는지 확인하고, 아니면 선행 테스트가 쓰는 에피소드 클릭 로케이터를 그대로 복사해 진입부를 넣을 것.)

- [ ] **Step 3: 전체 게이트 실행**

Run: `npx vitest run && npm run typecheck && npm run build && npm run test:e2e`
Expected: unit 전체 PASS · typecheck 0 · build OK · e2e 13 passed (기존 12 + 신규 ⑩)

- [ ] **Step 4: 커밋**

```bash
git add e2e/stub/claude.cmd e2e/stub/claude-stub.js e2e/hub.e2e.ts
git commit -m "test(episode-hub): E2 e2e — 스텁 claude 질문→답변 흐름 + 게이트 완주"
```

---

### Task 6: 문서 갱신 + 푸시

**Files:**
- Modify: `CLAUDE.md` (episode-hub 레포 루트)

**Interfaces:**
- Consumes: 완료된 Task 1~5
- Produces: 없음 (마무리)

- [ ] **Step 1: CLAUDE.md 갱신**

`## MCP 브리지 (AI→앱, v0.2.0)` 절 말미에 한 줄 추가:

```markdown
**E2(앱→AI, 읽기 전용 Q&A)**: 에피소드 화면 "Claude에게 물어보기" 패널 — `src/main/aiBridge.ts`가 headless `claude -p`를 spawn(읽기 4종 `--allowedTools` 잠금, `--resume` 이어묻기, Owner PC 전용 CLI 감지). 설계 `docs/superpowers/specs/2026-07-11-episode-hub-phase-e2-ask-ai-design.md`.
```

`## 다음` 절을 교체:

```markdown
## 다음
- **Phase E3**(앱에서 AI 실행): 파이프라인 구동·작업 큐 — 쓰기 발생이라 승인 게이트 설계 필요. E2 aiBridge 재사용.
```

- [ ] **Step 2: 커밋 + 푸시**

```bash
git add CLAUDE.md
git commit -m "docs(episode-hub): E2 완료 반영 — 다음은 E3(앱에서 AI 실행)"
git push
```
