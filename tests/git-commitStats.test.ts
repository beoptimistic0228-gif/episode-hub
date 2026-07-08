import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitStats } from '../src/main/git';

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf-8' }).trim();
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

(hasGit ? describe : describe.skip)('commitStats', () => {
  let base: string, remote: string, repo: string, orch: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'hub-cs-'));
    remote = join(base, 'r.git'); repo = join(base, 'work'); orch = join(repo, 'orchestrator');
    mkdirSync(join(orch, 'output', 'episodes'), { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
    g(repo, 'init', '-b', 'main'); g(repo, 'config', 'user.email', 't@t.t');
    g(repo, 'config', 'user.name', 't'); g(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'seed.txt'), 'x'); g(repo, 'add', '-A'); g(repo, 'commit', '-m', 'seed');
    g(repo, 'remote', 'add', 'origin', remote); g(repo, 'push', '-u', 'origin', 'main');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  test('통계 파일 커밋+푸시', () => {
    mkdirSync(join(repo, 'episode-hub', 'data'), { recursive: true });
    writeFileSync(join(repo, 'episode-hub', 'data', 'channel_stats.json'), '{"schema_version":1}\n');
    return commitStats(orch).then((res) => {
      expect(res).toEqual({ ok: true, pushed: true });
      expect(g(repo, 'log', '--oneline', 'origin/main')).toContain('채널 통계');
    });
  });
  test('변경 없으면 nothing', () =>
    commitStats(orch).then((res) => expect(res).toEqual({ ok: false, reason: 'nothing' })));
});
