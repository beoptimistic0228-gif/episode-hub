import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { completeEpisode } from '../src/main/git';
import { g, makeRepoWithRemote, advanceRemote } from './gitTestUtil';

describe('completeEpisode', () => {
  let r: ReturnType<typeof makeRepoWithRemote>;
  beforeEach(() => { r = makeRepoWithRemote(); });
  afterEach(() => { rmSync(r.base, { recursive: true, force: true }); });

  const epFile = () => join(r.orch, 'output', 'episodes', r.ep, 'episode.json');

  test('변경 없으면 nothing', async () => {
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toEqual({ ok: false, reason: 'nothing' });
  });

  test('EP 변경 → 커밋 메시지 + 원격 push 반영', async () => {
    writeFileSync(epFile(), '{"schema_version":1,"done":1}');
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toEqual({ ok: true, pushed: true });
    // 로컬 최신 커밋 메시지
    expect(g(r.repo, 'log', '-1', '--pretty=%s')).toBe(`feat(orchestrator): ${r.ep} 산출물 완료 (Episode Hub)`);
    // 원격에 반영됐는지: 원격 HEAD == 로컬 HEAD
    const localHead = g(r.repo, 'rev-parse', 'HEAD');
    expect(g(r.repo, 'rev-parse', 'origin/main')).toBe(localHead);
  });

  test('다른 EP·이미지는 커밋 범위에서 제외', async () => {
    // 다른 EP 변경 + 대상 EP의 gitignored 렌더 이미지
    const other = join(r.orch, 'output', 'episodes', 'ep20991231_other');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'episode.json'), '{"x":1}');
    const renders = join(r.orch, 'output', 'episodes', r.ep, 'renders');
    mkdirSync(renders, { recursive: true });
    writeFileSync(join(renders, 'a__row1.png'), 'imgbytes');
    writeFileSync(epFile(), '{"changed":1}');
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toEqual({ ok: true, pushed: true });
    // 커밋에 포함된 파일 목록: 대상 EP의 episode.json만
    const files = g(r.repo, 'show', '--name-only', '--pretty=', 'HEAD').split(/\r?\n/).filter(Boolean);
    expect(files.some((f) => f.includes(`episodes/${r.ep}/episode.json`))).toBe(true);
    expect(files.some((f) => f.includes('ep20991231_other'))).toBe(false);
    expect(files.some((f) => f.includes('renders/a__row1.png'))).toBe(false);
  });

  test('선-staged 무관 파일은 커밋에서 배제되고 index에 잔류', async () => {
    // 무관 파일 2종(레포 루트·다른 EP)을 먼저 stage해 둔 상태에서 Complete
    writeFileSync(join(r.repo, 'unrelated.txt'), 'x');
    const other = join(r.orch, 'output', 'episodes', 'ep20991231_other');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'episode.json'), '{"x":1}');
    g(r.repo, 'add', '-A');
    writeFileSync(epFile(), '{"changed":1}');
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toEqual({ ok: true, pushed: true });
    // 커밋에는 대상 EP 파일만
    const files = g(r.repo, 'show', '--name-only', '--pretty=', 'HEAD').split(/\r?\n/).filter(Boolean);
    expect(files).toEqual([`orchestrator/output/episodes/${r.ep}/episode.json`]);
    // 선-staged 무관 파일은 커밋되지 않고 stage에 그대로 남는다
    const staged = g(r.repo, 'diff', '--cached', '--name-only').split(/\r?\n/).filter(Boolean);
    expect(staged).toContain('unrelated.txt');
    expect(staged).toContain('orchestrator/output/episodes/ep20991231_other/episode.json');
  });

  test('원격이 앞서면 push 거부 → needsUpdate (로컬 커밋 보존)', async () => {
    advanceRemote(r.remote); // 원격 1커밋 앞섬
    writeFileSync(epFile(), '{"changed":1}');
    const res = await completeEpisode(r.orch, r.ep);
    expect(res).toMatchObject({ ok: false, reason: 'needsUpdate' });
    // 로컬 커밋은 만들어졌어야 함(작업 유실 없음)
    expect(g(r.repo, 'log', '-1', '--pretty=%s')).toBe(`feat(orchestrator): ${r.ep} 산출물 완료 (Episode Hub)`);
  });
});
