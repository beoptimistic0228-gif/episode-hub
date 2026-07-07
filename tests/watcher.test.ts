import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWatcher } from '../src/main/watcher';

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe('startWatcher', () => {
  let root: string;
  let stop: (() => void) | null = null;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wch-'));
    mkdirSync(join(root, 'output', 'episodes', 'ep1'), { recursive: true });
  });
  afterEach(async () => {
    stop?.();
    stop = null;
    await wait(100); // chokidar close 정리 대기
    rmSync(root, { recursive: true, force: true });
  });

  test('파일 변경 → notify, 짧은 연속 변경은 디바운스로 1회 병합', async () => {
    let calls = 0;
    stop = startWatcher(root, () => { calls += 1; });
    await wait(800); // chokidar ready 대기 (ignoreInitial)
    writeFileSync(join(root, 'output', 'episodes', 'ep1', 'a.md'), '1');
    await wait(150);
    writeFileSync(join(root, 'output', 'episodes', 'ep1', 'a.md'), '2');
    writeFileSync(join(root, 'output', 'episodes', 'ep1', 'b.md'), 'x');
    // awaitWriteFinish(300ms 안정) + debounce(500ms) 경과를 넉넉히 기다린다
    await wait(2500);
    expect(calls).toBe(1);
  });

  test('정지 함수 호출 후에는 notify 없음', async () => {
    let calls = 0;
    const stopNow = startWatcher(root, () => { calls += 1; });
    await wait(800);
    stopNow();
    await wait(200);
    writeFileSync(join(root, 'output', 'episodes', 'ep1', 'c.md'), 'x');
    await wait(1500);
    expect(calls).toBe(0);
  });
});
