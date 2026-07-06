import { join } from 'node:path';
import { safeEpisodePath } from '../src/main/pathGuard';

const ROOT = join('C:', 'repo', 'orchestrator');

test('정상 상대경로 통과', () => {
  expect(safeEpisodePath(ROOT, 'ep1', 'prompts/a.md'))
    .toBe(join(ROOT, 'output', 'episodes', 'ep1', 'prompts', 'a.md'));
});

test('.. 탈출 차단', () => {
  expect(() => safeEpisodePath(ROOT, 'ep1', '../../data/secret.json')).toThrow(/이탈/);
});

test('id 자체의 경로 탈출 차단', () => {
  expect(() => safeEpisodePath(ROOT, '..\\..\\Windows', 'hosts')).toThrow();
  expect(() => safeEpisodePath(ROOT, '../../etc', 'hosts')).toThrow();
  expect(() => safeEpisodePath(ROOT, 'ep1/../ep2', 'a.md')).toThrow();
});

test('정상 id는 통과', () => {
  expect(() => safeEpisodePath(ROOT, 'ep20260628_ippool-g009', 'prompts/a.md')).not.toThrow();
});
