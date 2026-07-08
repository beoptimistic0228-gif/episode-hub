import {
  parseYouTubeChannel, parseYouTubeVideos, parseNaverVisitors, parseNaverNeighbors,
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

describe('parseNaverVisitors', () => {
  test('오늘=마지막 항목 cnt, 총=합계', () => {
    const xml = `<?xml version="1.0"?><visitorcnts>` +
      `<visitorcnt id="20260707" cnt="180"/>` +
      `<visitorcnt id="20260708" cnt="210"/></visitorcnts>`;
    expect(parseNaverVisitors(xml)).toEqual({ today: 210, total: 390 });
  });
});

describe('parseNaverNeighbors', () => {
  test('이웃수 추출', () => {
    const html = `<span class="cnt">이웃 <em>320</em>명</span>`;
    expect(parseNaverNeighbors(html)).toBe(320);
  });
  test('못 찾으면 throw', () => {
    expect(() => parseNaverNeighbors('<div>없음</div>')).toThrow();
  });
});
