import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchStatus, resolveGitRoot } from '../src/main/git';
import { makeRepoWithRemote, advanceRemote } from './gitTestUtil';

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
