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
