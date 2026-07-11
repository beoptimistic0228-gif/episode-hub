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
