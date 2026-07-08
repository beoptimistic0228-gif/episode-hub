import {
  emptyStats, upsertSnapshot, latestSnapshot, snapshotOnOrBefore,
  extractVideoId, computeDelta, type ChannelSnapshot,
} from '../src/shared/stats';

const snap = (date: string, subs: number): ChannelSnapshot => ({
  date, at: `${date}T00:00:00Z`,
  youtube: { subscribers: subs, views: 0, videos: 0 },
  blog: null,
  sources: { youtube: 'ok', blog: 'error' },
});

describe('upsertSnapshot', () => {
  test('같은 날짜는 덮어쓰기', () => {
    let s = emptyStats();
    s = upsertSnapshot(s, snap('2026-07-08', 100));
    s = upsertSnapshot(s, snap('2026-07-08', 120));
    expect(s.snapshots).toHaveLength(1);
    expect(s.snapshots[0].youtube!.subscribers).toBe(120);
  });
  test('새 날짜는 추가 + 날짜 정렬', () => {
    let s = emptyStats();
    s = upsertSnapshot(s, snap('2026-07-08', 120));
    s = upsertSnapshot(s, snap('2026-07-01', 100));
    expect(s.snapshots.map((x) => x.date)).toEqual(['2026-07-01', '2026-07-08']);
    expect(latestSnapshot(s)!.date).toBe('2026-07-08');
  });
});

describe('snapshotOnOrBefore', () => {
  test('기준일 이하 중 가장 최근', () => {
    let s = emptyStats();
    s = upsertSnapshot(s, snap('2026-07-01', 100));
    s = upsertSnapshot(s, snap('2026-07-08', 120));
    expect(snapshotOnOrBefore(s, '2026-07-05')!.date).toBe('2026-07-01');
    expect(snapshotOnOrBefore(s, '2026-06-01')).toBeNull();
  });
});

describe('extractVideoId', () => {
  test.each([
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://blog.naver.com/x', null],
  ])('%s → %s', (url, id) => { expect(extractVideoId(url)).toBe(id); });
});

describe('computeDelta', () => {
  test('증가/감소/동일/이전없음', () => {
    expect(computeDelta(120, 100)).toEqual({ value: 20, sign: 'up' });
    expect(computeDelta(90, 100)).toEqual({ value: -10, sign: 'down' });
    expect(computeDelta(100, 100)).toEqual({ value: 0, sign: 'flat' });
    expect(computeDelta(100, undefined)).toEqual({ value: 0, sign: 'flat' });
  });
});
