import { lineDiff } from '../src/renderer/lib/lineDiff';

describe('lineDiff — 줄 단위 LCS', () => {
  test('동일 텍스트 → 전부 same', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { type: 'same', text: 'a' }, { type: 'same', text: 'b' },
    ]);
  });
  test('중간 삽입 → add 1줄', () => {
    expect(lineDiff('a\nc', 'a\nb\nc')).toEqual([
      { type: 'same', text: 'a' }, { type: 'add', text: 'b' }, { type: 'same', text: 'c' },
    ]);
  });
  test('중간 삭제 → del 1줄', () => {
    expect(lineDiff('a\nb\nc', 'a\nc')).toEqual([
      { type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' },
    ]);
  });
  test('교체 → del+add', () => {
    const rows = lineDiff('a\n원본\nc', 'a\n제안\nc');
    expect(rows).toContainEqual({ type: 'del', text: '원본' });
    expect(rows).toContainEqual({ type: 'add', text: '제안' });
    expect(rows.filter((r) => r.type === 'same')).toHaveLength(2);
  });
  test('신규 파일(old="") → 전부 add', () => {
    expect(lineDiff('', 'a\nb').every((r) => r.type === 'add')).toBe(true);
  });
});
