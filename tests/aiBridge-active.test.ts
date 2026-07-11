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
