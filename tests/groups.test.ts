import { GROUPS, GROUP_KEYS } from '@shared/groups';

test('그룹은 스펙 §3-1과 1:1 — 8종·순서 고정', () => {
  expect(GROUP_KEYS).toEqual([
    'planning', 'products', 'prompts', 'renders',
    'script', 'publish', 'validation', 'manuscript',
  ]);
  expect(GROUPS).toHaveLength(8);
  expect(GROUPS[0]).toEqual({ key: 'planning', emoji: '📋', label: '기획' });
  expect(GROUPS[7]).toEqual({ key: 'manuscript', emoji: '📜', label: '통합 원고' });
});
