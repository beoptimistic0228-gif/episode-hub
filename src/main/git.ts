import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { assertEpisodeId } from './pathGuard';

const pexec = promisify(execFile);

/**
 * 경로를 OS 정규 실경로로 변환. Windows에서 `git rev-parse --show-toplevel`은
 * 긴 형식(`C:/Users/jin.choi/…`)을 반환하지만 tmpdir 등은 8.3 단축명
 * (`C:/Users/JIN~1.CHO/…`)을 쓸 수 있다. 두 형식을 맞추지 않으면 relative() 계산이
 * 어긋나 `git add`가 'outside repository'로 거부된다. 존재하지 않으면 원본을 반환. */
function canonicalPath(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

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
  const abs = join(canonicalPath(orchestratorRoot), 'output', 'episodes', episodeId);
  return relative(canonicalPath(gitRoot), abs).split(sep).join('/');
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

export async function pullFF(orchestratorRoot: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const gitRoot = await resolveGitRoot(orchestratorRoot);
  // 작업트리가 더러우면 pull 하지 않는다(작업트리 보존). --ff-only는 더러운 파일과
  // 충돌하지 않는 FF는 허용하므로, 안전을 위해 사전에 명시적으로 거부한다.
  const pre = await fetchStatus(orchestratorRoot, false);
  if (pre.dirty) return { ok: false, message: '작업트리에 커밋되지 않은 변경이 있어 pull을 건너뜁니다' };
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

/**
 * 텍스트 diff가 없는데 status만 dirty한 "유령 변경"(EOL 차이)을 index 상태로 복원.
 * orchestrator(파이썬)는 CRLF, 앱(writer)은 LF로 쓰므로 인앱 변경을 원복해도
 * 줄끝만 남아 Complete가 계속 활성되는 문제를 막는다. 실제 내용 변경은 건드리지 않는다.
 * @returns 복원했으면 true
 */
export async function restoreIfNoTextDiff(
  orchestratorRoot: string,
  episodeId: string,
  fileRel: string,
): Promise<boolean> {
  try {
    assertEpisodeId(episodeId);
    const gitRoot = await resolveGitRoot(orchestratorRoot);
    const rel = `${episodeRelPath(gitRoot, orchestratorRoot, episodeId)}/${fileRel}`;
    const st = await runGit(gitRoot, ['status', '--porcelain', '--', rel]);
    if (!st.stdout.trim()) return false; // 변경 없음
    const diff = await runGit(gitRoot, ['diff', '--quiet', '--', rel]);
    if (diff.code !== 0) return false; // 실제 내용 변경 → 보존
    const co = await runGit(gitRoot, ['checkout', '--', rel]);
    return co.code === 0;
  } catch {
    return false; // git 없음 등 — 복원은 best-effort
  }
}

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

const STATS_REL = 'episode-hub/data/channel_stats.json';

/** 통계 파일만 add→commit→push (completeEpisode의 파일 스코프 판). 비치명적 실패 반환. */
export async function commitStats(orchestratorRoot: string): Promise<CompleteResult> {
  const gitRoot = await resolveGitRoot(orchestratorRoot);
  const add = await runGit(gitRoot, ['add', '--', STATS_REL]);
  if (add.code !== 0) {
    // 통계 파일이 아직 없으면(수집 전) 커밋할 것이 없음 — 치명적 오류 아님.
    if (/did not match any files/i.test(add.stderr)) return { ok: false, reason: 'nothing' };
    return { ok: false, reason: 'error', message: add.stderr.trim() };
  }
  const staged = await runGit(gitRoot, ['diff', '--cached', '--quiet', '--', STATS_REL]);
  if (staged.code === 0) return { ok: false, reason: 'nothing' };
  const date = new Date().toISOString().slice(0, 10);
  const commit = await runGit(gitRoot, ['commit', '-m', `chore(episode-hub): 채널 통계 스냅샷 ${date}`, '--', STATS_REL]);
  if (commit.code !== 0) return { ok: false, reason: 'error', message: commit.stderr.trim() };
  const push = await runGit(gitRoot, ['push']);
  if (push.code !== 0) {
    const m = push.stderr || push.stdout;
    if (/rejected|fetch first|non-fast-forward/i.test(m)) return { ok: false, reason: 'needsUpdate', message: '원격이 앞서 있습니다.' };
    return { ok: false, reason: 'error', message: m.trim() };
  }
  return { ok: true, pushed: true };
}
