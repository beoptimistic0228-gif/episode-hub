import { normCategory, APPROVAL_GATES, RENDER_ROWS, STAGES } from '@shared/episode';

test('normCategory — 공백 압축→언더스코어 + trim', () => {
  expect(normCategory('  게이밍 데스크 ')).toBe('게이밍_데스크');
  expect(normCategory('책상')).toBe('책상');
  expect(normCategory('a  b\tc')).toBe('a_b_c');
});

test('상수 형태', () => {
  expect(APPROVAL_GATES.map((g) => g.key)).toEqual(['moodboard', 'script_final']);
  expect(RENDER_ROWS).toEqual(['row1', 'row2']);
  expect(STAGES).toContain('렌더');
  expect(STAGES).toContain('완료');
});
