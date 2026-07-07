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
