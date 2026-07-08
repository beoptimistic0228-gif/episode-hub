import {
  parseYouTubeChannel, parseYouTubeVideos, parseNaverBlog,
} from '../src/main/statsFetcher';

describe('parseYouTubeChannel', () => {
  test('statistics 매핑', () => {
    const json = { items: [{ statistics: { subscriberCount: '12340', viewCount: '458200', videoCount: '42' } }] };
    expect(parseYouTubeChannel(json)).toEqual({ subscribers: 12340, views: 458200, videos: 42 });
  });
  test('items 없으면 throw', () => {
    expect(() => parseYouTubeChannel({ items: [] })).toThrow();
  });
});

describe('parseYouTubeVideos', () => {
  test('id별 통계 맵', () => {
    const json = { items: [
      { id: 'aaaaaaaaaaa', statistics: { viewCount: '32000', likeCount: '1200' } },
      { id: 'bbbbbbbbbbb', statistics: { viewCount: '9000' } },
    ] };
    const r = parseYouTubeVideos(json, '2026-07-08T00:00:00Z');
    expect(r['aaaaaaaaaaa']).toEqual({ views: 32000, likes: 1200, at: '2026-07-08T00:00:00Z' });
    expect(r['bbbbbbbbbbb'].likes).toBe(0);
  });
});

describe('parseNaverBlog', () => {
  test('result 필드 매핑', () => {
    const json = { isSuccess: true, result: { dayVisitorCount: 210, totalVisitorCount: 45100, subscriberCount: 320 } };
    expect(parseNaverBlog(json)).toEqual({ neighbors: 320, visitorsTotal: 45100, visitorsToday: 210 });
  });
  test('isSuccess=false면 throw', () => {
    expect(() => parseNaverBlog({ isSuccess: false })).toThrow();
  });
});
