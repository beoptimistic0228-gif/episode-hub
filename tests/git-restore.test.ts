import { rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restoreIfNoTextDiff } from '../src/main/git';
import { g, makeRepoWithRemote } from './gitTestUtil';

describe('restoreIfNoTextDiff', () => {
  let r: ReturnType<typeof makeRepoWithRemote>;
  beforeEach(() => {
    r = makeRepoWithRemote();
    // 실 레포 환경 재현: autocrlf=true + 파이썬(orchestrator)이 CRLF로 쓴 파일 커밋
    g(r.repo, 'config', 'core.autocrlf', 'true');
  });
  afterEach(() => { rmSync(r.base, { recursive: true, force: true }); });

  const epFile = () => join(r.orch, 'output', 'episodes', r.ep, 'episode.json');
  const pretty = '{\n  "schema_version": 1\n}\n';

  function commitCrlf() {
    writeFileSync(epFile(), pretty.replace(/\n/g, '\r\n'));
    g(r.repo, 'add', '-A');
    g(r.repo, 'commit', '-m', 'crlf commit');
  }

  test('EOL만 다른 유령 변경은 복원되어 status가 깨끗해진다', async () => {
    commitCrlf();
    // 앱(writer)이 같은 내용을 LF로 재작성 → 유령 dirty
    writeFileSync(epFile(), pretty);
    expect(g(r.repo, 'status', '--porcelain')).not.toBe('');
    const restored = await restoreIfNoTextDiff(r.orch, r.ep, 'episode.json');
    expect(restored).toBe(true);
    expect(g(r.repo, 'status', '--porcelain')).toBe('');
  });

  test('실제 내용 변경은 복원하지 않고 보존한다', async () => {
    commitCrlf();
    const changed = '{\n  "schema_version": 1,\n  "stage": "렌더"\n}\n';
    writeFileSync(epFile(), changed);
    const restored = await restoreIfNoTextDiff(r.orch, r.ep, 'episode.json');
    expect(restored).toBe(false);
    expect(readFileSync(epFile(), 'utf-8')).toBe(changed); // 파일 그대로
    expect(g(r.repo, 'status', '--porcelain')).not.toBe('');
  });

  test('변경 자체가 없으면 아무것도 하지 않는다', async () => {
    commitCrlf();
    const restored = await restoreIfNoTextDiff(r.orch, r.ep, 'episode.json');
    expect(restored).toBe(false);
  });
});
