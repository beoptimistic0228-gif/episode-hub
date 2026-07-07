import { GROUPS, GROUP_KEYS } from '@shared/groups';

test('그룹은 스펙 §3-1 + Phase D §2와 1:1 — 10종·순서 고정', () => {
  expect(GROUP_KEYS).toEqual([
    'planning', 'products', 'prompts', 'renders',
    'script', 'publish', 'validation', 'manuscript',
    'final', 'osmu',
  ]);
  expect(GROUPS).toHaveLength(10);
  expect(GROUPS[0]).toEqual({ key: 'planning', emoji: '📋', label: '기획' });
  expect(GROUPS[8]).toEqual({ key: 'final', emoji: '🎞️', label: '최종 영상' });
  expect(GROUPS[9]).toEqual({ key: 'osmu', emoji: '📤', label: 'OSMU' });
});
