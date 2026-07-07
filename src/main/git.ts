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
