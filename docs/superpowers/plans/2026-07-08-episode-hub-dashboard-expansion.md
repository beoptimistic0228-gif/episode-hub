# Episode Hub 대시보드 확장 (Phase D+) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** episode-hub 대시보드에 유튜브/블로그 채널 통계(자동 수집)·성장/발행 추이 그래프·KPI 강화·에피소드별 조회수를 추가한다.

**Architecture:** Electron main(`statsFetcher.ts`)이 YouTube Data API + 네이버 블로그를 직접 수집해 git-tracked `channel_stats.json`에 하루 1행 upsert하고, renderer가 IPC로 읽어 Recharts로 그린다. 순수 파서/헬퍼는 단위 테스트, UI는 build+e2e로 검증.

**Tech Stack:** Electron 31 / React 18 / TypeScript / zustand / **recharts(신규)** / vitest / Playwright-Electron. 수집은 Node 내장 `fetch`.

## Global Constraints

- **$0 추가 과금** — YouTube Data API 무료 쿼터 + HTTP GET만. 유료 API 금지.
- **런타임 의존성 최소** — 신규 추가는 `recharts` 하나만. 그 외 수집·파싱은 Node 내장으로.
- **DRM 면제** — 이 프로젝트는 내부 공유용(메모리 `feedback_drm_exempt`).
- **커밋 컨벤션** — `<type>(episode-hub): <제목>` (scope 고정 `episode-hub`). 커밋 푸터에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **schema_version=1 유지** — `channel_stats.json`는 additive.
- **CHANNEL_ID** `UCqMBCXReIpCPa4PzWiT2grw` · **NAVER_BLOG_ID** `be_optimistic228` — main `ipc.ts` SNS_LINKS와 동일값.
- **API 키** — `orchestrator/.env`의 `YOUTUBE_API_KEY` (OS env 우선). 없으면 유튜브 소스만 error, 앱은 생존.
- **경로 표기** — 모든 경로는 `episode-hub/` 기준 상대. 작업 디렉토리는 `episode-hub/`.

---

### Task 1: 공유 통계 타입·상수·순수 헬퍼 (`shared/stats.ts`)

**Files:**
- Create: `src/shared/stats.ts`
- Test: `tests/stats-helpers.test.ts`

**Interfaces:**
- Consumes: 없음 (기반)
- Produces:
  - `SourceStatus = 'ok' | 'stale' | 'error'`
  - `interface YoutubeStat { subscribers: number; views: number; videos: number }`
  - `interface BlogStat { neighbors: number; visitorsTotal: number; visitorsToday: number }`
  - `interface ChannelSnapshot { date: string; at: string; youtube: YoutubeStat | null; blog: BlogStat | null; sources: { youtube: SourceStatus; blog: SourceStatus } }`
  - `interface VideoStat { views: number; likes: number; at: string }`
  - `interface ChannelStats { schema_version: 1; snapshots: ChannelSnapshot[]; videos: Record<string, VideoStat> }`
  - `const CHANNEL_ID: string`, `const NAVER_BLOG_ID: string`
  - `emptyStats(): ChannelStats`
  - `upsertSnapshot(stats: ChannelStats, snap: ChannelSnapshot): ChannelStats`
  - `latestSnapshot(stats: ChannelStats): ChannelSnapshot | null`
  - `snapshotOnOrBefore(stats: ChannelStats, date: string): ChannelSnapshot | null`
  - `extractVideoId(url: string): string | null`
  - `interface Delta { value: number; sign: 'up' | 'down' | 'flat' }`
  - `computeDelta(curr: number, prev: number | undefined): Delta`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/stats-helpers.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stats-helpers.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/stats'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/shared/stats.ts
export type SourceStatus = 'ok' | 'stale' | 'error';

export interface YoutubeStat { subscribers: number; views: number; videos: number }
export interface BlogStat { neighbors: number; visitorsTotal: number; visitorsToday: number }

export interface ChannelSnapshot {
  date: string; // 로컬 YYYY-MM-DD (행 키)
  at: string;   // 수집 시각 ISO
  youtube: YoutubeStat | null;
  blog: BlogStat | null;
  sources: { youtube: SourceStatus; blog: SourceStatus };
}

export interface VideoStat { views: number; likes: number; at: string }

export interface ChannelStats {
  schema_version: 1;
  snapshots: ChannelSnapshot[];
  videos: Record<string, VideoStat>;
}

// main ipc.ts SNS_LINKS와 동일 채널 (단일값 — Global Constraints)
export const CHANNEL_ID = 'UCqMBCXReIpCPa4PzWiT2grw';
export const NAVER_BLOG_ID = 'be_optimistic228';

export function emptyStats(): ChannelStats {
  return { schema_version: 1, snapshots: [], videos: {} };
}

/** 같은 date면 덮어쓰기, 아니면 추가 후 date 오름차순 정렬 */
export function upsertSnapshot(stats: ChannelStats, snap: ChannelSnapshot): ChannelStats {
  const snapshots = stats.snapshots.filter((s) => s.date !== snap.date);
  snapshots.push(snap);
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  return { ...stats, snapshots };
}

export function latestSnapshot(stats: ChannelStats): ChannelSnapshot | null {
  return stats.snapshots.length ? stats.snapshots[stats.snapshots.length - 1] : null;
}

/** date 이하 스냅샷 중 가장 최근 (델타 기준선용) */
export function snapshotOnOrBefore(stats: ChannelStats, date: string): ChannelSnapshot | null {
  const eligible = stats.snapshots.filter((s) => s.date <= date);
  return eligible.length ? eligible[eligible.length - 1] : null;
}

/** youtu.be/<id> · v=<id> · /shorts/<id> · /embed/<id> (11자 ID) */
export function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export interface Delta { value: number; sign: 'up' | 'down' | 'flat' }
export function computeDelta(curr: number, prev: number | undefined): Delta {
  if (prev === undefined) return { value: 0, sign: 'flat' };
  const d = curr - prev;
  return { value: d, sign: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stats-helpers.test.ts`
Expected: PASS (4 describe blocks)

- [ ] **Step 5: Commit**

```bash
git add src/shared/stats.ts tests/stats-helpers.test.ts
git commit -m "feat(episode-hub): 채널 통계 공유 타입·순수 헬퍼

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `.env`에서 API 키 읽기 (`config.ts` `readEnvKey`)

**Files:**
- Modify: `src/main/config.ts` (함수 추가)
- Test: `tests/config-envkey.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `readEnvKey(orchestratorRoot: string, name: string): string | null` — `<root>/.env` 파싱, `YOUR_` 플레이스홀더·빈값·파일없음 → null.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/config-envkey.test.ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvKey } from '../src/main/config';

describe('readEnvKey — orchestrator/.env 파싱', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hub-env-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('키 반환 (따옴표·주석·공백 처리)', () => {
    writeFileSync(join(root, '.env'), '# c\nYOUTUBE_API_KEY = "AIzaABC"\nNAVER_ID=x\n');
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBe('AIzaABC');
  });
  test('플레이스홀더는 null', () => {
    writeFileSync(join(root, '.env'), 'YOUTUBE_API_KEY=YOUR_KEY_HERE\n');
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBeNull();
  });
  test('파일 없음 → null', () => {
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBeNull();
  });
  test('없는 키 → null', () => {
    writeFileSync(join(root, '.env'), 'OTHER=1\n');
    expect(readEnvKey(root, 'YOUTUBE_API_KEY')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-envkey.test.ts`
Expected: FAIL — `readEnvKey` is not exported

- [ ] **Step 3: Write minimal implementation**

`src/main/config.ts` 맨 아래에 추가 (기존 `readFileSync`·`join` import 재사용):

```typescript
/**
 * orchestrator/.env 에서 키를 읽는다 (orchestrator lib_config.py와 동일 규칙).
 * YOUR_ 플레이스홀더·빈값·파일없음은 null. OS env 우선순위는 호출측(statsFetcher)에서.
 */
export function readEnvKey(orchestratorRoot: string, name: string): string | null {
  try {
    const raw = readFileSync(join(orchestratorRoot, '.env'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      if (t.slice(0, i).trim() !== name) continue;
      const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!v || v.toUpperCase().startsWith('YOUR_')) return null;
      return v;
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-envkey.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts tests/config-envkey.test.ts
git commit -m "feat(episode-hub): orchestrator/.env 에서 YOUTUBE_API_KEY 읽기

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 응답 파서 3종 (`statsFetcher.ts` 순수 파서)

**Files:**
- Create: `src/main/statsFetcher.ts` (파서 부분만; 수집 오케스트레이션은 Task 4)
- Test: `tests/statsFetcher-parsers.test.ts`

**Interfaces:**
- Consumes: `YoutubeStat`, `BlogStat`, `VideoStat` (Task 1)
- Produces:
  - `parseYouTubeChannel(json: unknown): YoutubeStat` — `items[0].statistics` 없으면 throw.
  - `parseYouTubeVideos(json: unknown, at: string): Record<string, VideoStat>`
  - `parseNaverVisitors(xml: string): { today: number; total: number }` — `NVisitorgp4Ajax` XML 파싱.
  - `parseNaverNeighbors(html: string): number` — 이웃수 best-effort, 못 찾으면 throw.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/statsFetcher-parsers.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/statsFetcher-parsers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/main/statsFetcher.ts
import type { YoutubeStat, VideoStat } from '@shared/stats';

const num = (v: unknown): number => Number(v ?? 0) || 0;

export function parseYouTubeChannel(json: unknown): YoutubeStat {
  const s = (json as { items?: { statistics?: Record<string, string> }[] })?.items?.[0]?.statistics;
  if (!s) throw new Error('YouTube 채널 statistics 없음');
  return { subscribers: num(s.subscriberCount), views: num(s.viewCount), videos: num(s.videoCount) };
}

export function parseYouTubeVideos(json: unknown, at: string): Record<string, VideoStat> {
  const items = (json as { items?: { id?: string; statistics?: Record<string, string> }[] })?.items ?? [];
  const out: Record<string, VideoStat> = {};
  for (const it of items) {
    if (!it.id) continue;
    out[it.id] = { views: num(it.statistics?.viewCount), likes: num(it.statistics?.likeCount), at };
  }
  return out;
}

/** 네이버 방문자 AJAX(NVisitorgp4Ajax) XML: <visitorcnt id="YYYYMMDD" cnt="N"/> 반복 */
export function parseNaverVisitors(xml: string): { today: number; total: number } {
  const matches = [...xml.matchAll(/<visitorcnt\b[^>]*\bcnt="(\d+)"/g)].map((m) => Number(m[1]));
  if (matches.length === 0) throw new Error('방문자 데이터 없음');
  const total = matches.reduce((a, b) => a + b, 0);
  return { today: matches[matches.length - 1], total };
}

/** 이웃수 best-effort — 프로필 HTML에서 '이웃 N' 패턴. 실패 시 throw(호출측 carry-forward) */
export function parseNaverNeighbors(html: string): number {
  const m = html.match(/이웃[^0-9]{0,10}([0-9,]+)/);
  if (!m) throw new Error('이웃수 파싱 실패');
  return Number(m[1].replace(/,/g, ''));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/statsFetcher-parsers.test.ts`
Expected: PASS

> **구현 노트(라이브 검증):** `parseNaverVisitors`/`parseNaverNeighbors`의 실제 셀렉터는 네이버 위젯 마크업에 의존한다. Task 4 완료 후 실제 URL(`https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=be_optimistic228`, 프로필 페이지)을 1회 fetch해 정규식을 실측 마크업에 맞춘다. 필드를 못 얻으면 해당 소스를 `stale`로 두고 carry-forward(앱 생존). 파서는 격리돼 있어 이 함수들만 고치면 된다.

- [ ] **Step 5: Commit**

```bash
git add src/main/statsFetcher.ts tests/statsFetcher-parsers.test.ts
git commit -m "feat(episode-hub): 채널 통계 응답 파서 3종(유튜브 채널·영상·네이버)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 수집 오케스트레이션 (`statsFetcher.ts` `collectSnapshot`·`refreshStats`)

**Files:**
- Modify: `src/main/statsFetcher.ts` (수집·파일 IO 추가)
- Test: `tests/statsFetcher-collect.test.ts`

**Interfaces:**
- Consumes: 파서 3종 (Task 3), `readEnvKey` (Task 2), `ChannelStats`·`ChannelSnapshot`·`emptyStats`·`upsertSnapshot`·`latestSnapshot`·`CHANNEL_ID`·`NAVER_BLOG_ID` (Task 1)
- Produces:
  - `interface CollectDeps { fetchFn?: typeof fetch; apiKey?: string | null; today?: string; videoIds?: string[]; prev?: ChannelSnapshot | null }`
  - `collectSnapshot(deps: CollectDeps): Promise<{ snapshot: ChannelSnapshot; videos: Record<string, VideoStat> }>`
  - `statsFilePath(gitRoot: string): string` — `<gitRoot>/episode-hub/data/channel_stats.json`
  - `readStats(gitRoot: string): ChannelStats`
  - `refreshStats(gitRoot: string, orchestratorRoot: string, videoIds: string[]): Promise<ChannelStats>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/statsFetcher-collect.test.ts
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSnapshot, statsFilePath, readStats } from '../src/main/statsFetcher';
import type { ChannelSnapshot } from '../src/shared/stats';

// 가짜 fetch — URL로 분기해 픽스처 응답을 준다.
function fakeFetch(map: Record<string, { ok?: boolean; body: string }>): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    const key = Object.keys(map).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected url ${url}`);
    const { ok = true, body } = map[key];
    return { ok, status: ok ? 200 : 500, text: async () => body, json: async () => JSON.parse(body) } as Response;
  }) as typeof fetch;
}

describe('collectSnapshot', () => {
  test('유튜브+블로그 모두 성공', async () => {
    const f = fakeFetch({
      '/channels': { body: JSON.stringify({ items: [{ statistics: { subscriberCount: '12340', viewCount: '458200', videoCount: '42' } }] }) },
      '/videos': { body: JSON.stringify({ items: [{ id: 'aaaaaaaaaaa', statistics: { viewCount: '32000', likeCount: '1200' } }] }) },
      'NVisitorgp4Ajax': { body: '<visitorcnts><visitorcnt id="20260708" cnt="210"/></visitorcnts>' },
      'blog.naver.com/be_optimistic228': { body: '<span>이웃 320명</span>' },
    });
    const { snapshot, videos } = await collectSnapshot({ fetchFn: f, apiKey: 'K', today: '2026-07-08', videoIds: ['aaaaaaaaaaa'] });
    expect(snapshot.youtube).toEqual({ subscribers: 12340, views: 458200, videos: 42 });
    expect(snapshot.sources.youtube).toBe('ok');
    expect(snapshot.blog!.visitorsToday).toBe(210);
    expect(videos['aaaaaaaaaaa'].views).toBe(32000);
  });

  test('API 키 없음 → 유튜브 error, 블로그는 정상', async () => {
    const f = fakeFetch({ 'NVisitorgp4Ajax': { body: '<visitorcnts><visitorcnt id="20260708" cnt="210"/></visitorcnts>' }, 'blog.naver.com': { body: '<span>이웃 320명</span>' } });
    const { snapshot } = await collectSnapshot({ fetchFn: f, apiKey: null, today: '2026-07-08' });
    expect(snapshot.sources.youtube).toBe('error');
    expect(snapshot.youtube).toBeNull();
    expect(snapshot.sources.blog).toBe('ok');
  });

  test('블로그 크롤 실패 → carry-forward + stale', async () => {
    const prev: ChannelSnapshot = { date: '2026-07-07', at: 'x', youtube: null, blog: { neighbors: 300, visitorsTotal: 44000, visitorsToday: 190 }, sources: { youtube: 'error', blog: 'ok' } };
    const f = fakeFetch({
      '/channels': { body: JSON.stringify({ items: [{ statistics: { subscriberCount: '1', viewCount: '1', videoCount: '1' } }] }) },
      'NVisitorgp4Ajax': { ok: false, body: '' },
    });
    const { snapshot } = await collectSnapshot({ fetchFn: f, apiKey: 'K', today: '2026-07-08', prev });
    expect(snapshot.sources.blog).toBe('stale');
    expect(snapshot.blog).toEqual(prev.blog); // carry-forward
  });
});

describe('readStats', () => {
  test('파일 없으면 빈 구조', () => {
    const g = mkdtempSync(join(tmpdir(), 'hub-stats-'));
    expect(readStats(g)).toEqual({ schema_version: 1, snapshots: [], videos: {} });
    expect(statsFilePath(g).endsWith(join('episode-hub', 'data', 'channel_stats.json'))).toBe(true);
    rmSync(g, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/statsFetcher-collect.test.ts`
Expected: FAIL — `collectSnapshot` not exported

- [ ] **Step 3: Write minimal implementation**

`src/main/statsFetcher.ts` 상단 import 교체 + 하단에 추가:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type YoutubeStat, type BlogStat, type VideoStat, type ChannelSnapshot,
  type ChannelStats, emptyStats, upsertSnapshot, latestSnapshot,
  CHANNEL_ID, NAVER_BLOG_ID,
} from '@shared/stats';
import { readEnvKey } from './config';
```

```typescript
const YT = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 10_000;

async function getText(fetchFn: typeof fetch, url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

export interface CollectDeps {
  fetchFn?: typeof fetch;
  apiKey?: string | null;
  today?: string;
  videoIds?: string[];
  prev?: ChannelSnapshot | null;
}

/** 소스별 격리 수집 — 한 소스 실패가 다른 소스·앱을 죽이지 않는다 */
export async function collectSnapshot(
  deps: CollectDeps,
): Promise<{ snapshot: ChannelSnapshot; videos: Record<string, VideoStat> }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const at = new Date().toISOString();
  const prev = deps.prev ?? null;

  // ── YouTube ──
  let youtube: YoutubeStat | null = null;
  let ytStatus: ChannelSnapshot['sources']['youtube'] = 'error';
  let videos: Record<string, VideoStat> = {};
  if (deps.apiKey) {
    try {
      const chJson = JSON.parse(await getText(fetchFn, `${YT}/channels?part=statistics&id=${CHANNEL_ID}&key=${deps.apiKey}`));
      youtube = parseYouTubeChannel(chJson);
      ytStatus = 'ok';
      const ids = (deps.videoIds ?? []).slice(0, 50);
      if (ids.length) {
        const vJson = JSON.parse(await getText(fetchFn, `${YT}/videos?part=statistics&id=${ids.join(',')}&key=${deps.apiKey}`));
        videos = parseYouTubeVideos(vJson, at);
      }
    } catch {
      if (prev?.youtube) { youtube = prev.youtube; ytStatus = 'stale'; }
      else { youtube = null; ytStatus = 'error'; }
    }
  } else if (prev?.youtube) { youtube = prev.youtube; ytStatus = 'stale'; }

  // ── Naver Blog ──
  let blog: BlogStat | null = null;
  let blogStatus: ChannelSnapshot['sources']['blog'] = 'error';
  try {
    const vx = await getText(fetchFn, `https://blog.naver.com/NVisitorgp4Ajax.naver?blogId=${NAVER_BLOG_ID}`);
    const { today: vToday, total: vTotal } = parseNaverVisitors(vx);
    let neighbors = prev?.blog?.neighbors ?? 0;
    try {
      const html = await getText(fetchFn, `https://blog.naver.com/${NAVER_BLOG_ID}`);
      neighbors = parseNaverNeighbors(html);
    } catch { /* 이웃수만 실패 — 방문자는 유지 */ }
    blog = { neighbors, visitorsTotal: vTotal, visitorsToday: vToday };
    blogStatus = 'ok';
  } catch {
    if (prev?.blog) { blog = prev.blog; blogStatus = 'stale'; }
    else { blog = null; blogStatus = 'error'; }
  }

  return {
    snapshot: { date: today, at, youtube, blog, sources: { youtube: ytStatus, blog: blogStatus } },
    videos,
  };
}

export function statsFilePath(gitRoot: string): string {
  return join(gitRoot, 'episode-hub', 'data', 'channel_stats.json');
}

export function readStats(gitRoot: string): ChannelStats {
  try {
    const s = JSON.parse(readFileSync(statsFilePath(gitRoot), 'utf-8')) as ChannelStats;
    if (s.schema_version !== 1) return emptyStats();
    return { schema_version: 1, snapshots: s.snapshots ?? [], videos: s.videos ?? {} };
  } catch { return emptyStats(); }
}

function writeStats(gitRoot: string, stats: ChannelStats): void {
  const file = statsFilePath(gitRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(stats, null, 2) + '\n', 'utf-8');
}

/** 수집 → upsert → 파일 기록. 커밋/푸시는 호출측(ipc)이 commitStats로. */
export async function refreshStats(
  gitRoot: string, orchestratorRoot: string, videoIds: string[],
): Promise<ChannelStats> {
  const apiKey = process.env.YOUTUBE_API_KEY || readEnvKey(orchestratorRoot, 'YOUTUBE_API_KEY');
  const prev = latestSnapshot(readStats(gitRoot));
  const { snapshot, videos } = await collectSnapshot({ apiKey, videoIds, prev });
  const cur = readStats(gitRoot);
  const merged: ChannelStats = { ...upsertSnapshot(cur, snapshot), videos: { ...cur.videos, ...videos } };
  writeStats(gitRoot, merged);
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/statsFetcher-collect.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/statsFetcher.ts tests/statsFetcher-collect.test.ts
git commit -m "feat(episode-hub): 채널 통계 수집·upsert·파일 IO (소스별 격리·carry-forward)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 통계 파일 git 커밋+푸시 (`git.ts` `commitStats`)

**Files:**
- Modify: `src/main/git.ts` (함수 추가)
- Test: `tests/git-commitStats.test.ts`

**Interfaces:**
- Consumes: 기존 `resolveGitRoot`·`runGit`·`canonicalPath` (내부), `CompleteResult` 형태
- Produces: `commitStats(orchestratorRoot: string): Promise<CompleteResult>` — `episode-hub/data/channel_stats.json`만 add→commit→push. 변경 없으면 `{ok:false, reason:'nothing'}`, 원격 앞섬 시 `{ok:false, reason:'needsUpdate'}`.

- [ ] **Step 1: Write the failing test**

기존 `tests/git-complete.test.ts`의 fixture 헬퍼(작업본+bare 원격) 패턴을 재사용한다. 그 파일 상단의 repo 생성 헬퍼를 참고해 동일 구조로 작성:

```typescript
// tests/git-commitStats.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitStats } from '../src/main/git';

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf-8' }).trim();
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

(hasGit ? describe : describe.skip)('commitStats', () => {
  let base: string, remote: string, repo: string, orch: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'hub-cs-'));
    remote = join(base, 'r.git'); repo = join(base, 'work'); orch = join(repo, 'orchestrator');
    mkdirSync(join(orch, 'output', 'episodes'), { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
    g(repo, 'init', '-b', 'main'); g(repo, 'config', 'user.email', 't@t.t');
    g(repo, 'config', 'user.name', 't'); g(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'seed.txt'), 'x'); g(repo, 'add', '-A'); g(repo, 'commit', '-m', 'seed');
    g(repo, 'remote', 'add', 'origin', remote); g(repo, 'push', '-u', 'origin', 'main');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  test('통계 파일 커밋+푸시', () => {
    mkdirSync(join(repo, 'episode-hub', 'data'), { recursive: true });
    writeFileSync(join(repo, 'episode-hub', 'data', 'channel_stats.json'), '{"schema_version":1}\n');
    return commitStats(orch).then((res) => {
      expect(res).toEqual({ ok: true, pushed: true });
      expect(g(repo, 'log', '--oneline', 'origin/main')).toContain('채널 통계');
    });
  });
  test('변경 없으면 nothing', () =>
    commitStats(orch).then((res) => expect(res).toEqual({ ok: false, reason: 'nothing' })));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/git-commitStats.test.ts`
Expected: FAIL — `commitStats` not exported

- [ ] **Step 3: Write minimal implementation**

`src/main/git.ts` 하단에 추가 (기존 `runGit`·`resolveGitRoot`·`CompleteResult` 재사용):

```typescript
const STATS_REL = 'episode-hub/data/channel_stats.json';

/** 통계 파일만 add→commit→push (completeEpisode의 파일 스코프 판). 비치명적 실패 반환. */
export async function commitStats(orchestratorRoot: string): Promise<CompleteResult> {
  const gitRoot = await resolveGitRoot(orchestratorRoot);
  const add = await runGit(gitRoot, ['add', '--', STATS_REL]);
  if (add.code !== 0) return { ok: false, reason: 'error', message: add.stderr.trim() };
  const staged = await runGit(gitRoot, ['diff', '--cached', '--quiet', '--', STATS_REL]);
  if (staged.code === 0) return { ok: false, reason: 'nothing' };
  const date = new Date().toISOString().slice(0, 10);
  const commit = await runGit(gitRoot, ['commit', '-m', `chore(episode-hub): 채널 통계 스냅샷 ${date}`, '--', STATS_REL]);
  if (commit.code !== 0) return { ok: false, reason: 'error', message: commit.stderr.trim() };
  const push = await runGit(gitRoot, ['push']);
  if (push.code !== 0) {
    const m = push.stderr || push.stdout;
    if (/rejected|fetch first|non-fast-forward/i.test(m)) return { ok: false, reason: 'needsUpdate', message: '원격이 앞서 있습니다.' };
    return { ok: false, reason: 'error', message: m.trim() };
  }
  return { ok: true, pushed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/git-commitStats.test.ts`
Expected: PASS (git 있을 때 2 tests, 없으면 skip)

- [ ] **Step 5: Commit**

```bash
git add src/main/git.ts tests/git-commitStats.test.ts
git commit -m "feat(episode-hub): 채널 통계 파일 전용 커밋+푸시(commitStats)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: IPC·preload·부팅 자동수집 배선

**Files:**
- Modify: `src/main/ipc.ts` (핸들러 2종 + videoIds 수집)
- Modify: `src/preload/index.ts` (stats 브리지)
- Modify: `src/main/index.ts` (부팅 훅)
- Test: 없음 (배선 — `npm run typecheck` + Task 10 e2e로 검증)

**Interfaces:**
- Consumes: `refreshStats`·`readStats`·`statsFilePath` (Task 4), `commitStats` (Task 5), `resolveGitRoot` (git.ts), `scanEpisodes` (scanner), `extractVideoId` (Task 1), `getRoot` (ipc)
- Produces:
  - IPC `stats:get` → `ChannelStats`
  - IPC `stats:refresh` → `ChannelStats`
  - preload `window.hub.stats.get()` / `window.hub.stats.refresh()`
  - `collectVideoIds(root: string): string[]` (ipc 내부 헬퍼)

- [ ] **Step 1: Write handlers in ipc.ts**

import 추가 (기존 git import 라인에 `resolveGitRoot`·`commitStats` 병합):

```typescript
import { readStats, refreshStats } from './statsFetcher';
import { completeEpisode, fetchStatus, pullFF, restoreIfNoTextDiff, syncStatus, resolveGitRoot, commitStats } from './git';
import { extractVideoId } from '@shared/stats';
```

`registerIpc` **밖(모듈 최상위)**에 `collectVideoIds`를 export 함수로 둔다 (index.ts가 재사용 — DRY):

```typescript
// 발행된 유튜브/쇼츠 URL → videoId 집합 (에피소드별 성과용). index.ts 부팅 수집과 공유.
export function collectVideoIds(root: string): string[] {
  const ids = new Set<string>();
  for (const ep of scanEpisodes(root)) {
    for (const p of ep.publications) {
      if ((p.platform === 'youtube' || p.platform === 'shorts') && p.url) {
        const id = extractVideoId(p.url);
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}
```

`registerIpc` 내부, `git:complete` 핸들러 뒤에 추가:

```typescript
  ipcMain.handle('stats:get', async () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return readStats(await resolveGitRoot(currentRoot));
  });

  ipcMain.handle('stats:refresh', async () => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    const gitRoot = await resolveGitRoot(currentRoot);
    const stats = await refreshStats(gitRoot, currentRoot, collectVideoIds(currentRoot));
    void commitStats(currentRoot).catch(() => {}); // 다기기 동기화 — 실패해도 로컬 보존
    return stats;
  });
```

- [ ] **Step 2: Add preload bridge**

`src/preload/index.ts`의 `api` 객체에 `git` 블록 뒤 추가 + import:

```typescript
import type { ChannelStats } from '../shared/stats';
```

```typescript
  stats: {
    get: (): Promise<ChannelStats> => ipcRenderer.invoke('stats:get'),
    refresh: (): Promise<ChannelStats> => ipcRenderer.invoke('stats:refresh'),
  },
```

- [ ] **Step 3: Add boot auto-collect in index.ts**

`src/main/index.ts`에서 `registerIpc(onRootChanged)` 호출 위치를 확인하고, 앱 준비 후(창 생성 뒤) 부팅 자동수집을 건다. Task 6 Step 1에서 export한 `collectVideoIds`를 재사용한다(DRY):

```typescript
import { getRoot, collectVideoIds } from './ipc';
import { resolveGitRoot, commitStats } from './git';
import { readStats, refreshStats } from './statsFetcher';
import { latestSnapshot } from '@shared/stats';

// 부팅 자동수집 — pull은 기존 store init의 git.sync(true)가 처리. 오늘 스냅샷 없을 때만 수집(스로틀·기기간 충돌 회피).
async function bootCollectStats(): Promise<void> {
  const root = getRoot();
  if (!root) return;
  try {
    const gitRoot = await resolveGitRoot(root);
    const today = new Date().toISOString().slice(0, 10);
    if (latestSnapshot(readStats(gitRoot))?.date === today) return; // 이미 오늘 수집됨
    await refreshStats(gitRoot, root, collectVideoIds(root));
    void commitStats(root).catch(() => {});
  } catch { /* 부팅 수집 실패는 비치명적 */ }
}
```

앱 `whenReady`에서 창 생성 뒤 `void bootCollectStats();` 호출을 추가한다.

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: 오류 없음 (exit 0)

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(episode-hub): 통계 IPC(get/refresh)+preload 브리지+부팅 자동수집

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: scanner 에피소드별 유튜브 조회수 조인

**Files:**
- Modify: `src/shared/types.ts` (`EpisodeSummary.youtubeViews?`)
- Modify: `src/main/scanner.ts` (`scanEpisodes`가 stats.videos 조인)
- Test: `tests/scanner-youtubeViews.test.ts`

**Interfaces:**
- Consumes: `extractVideoId`·`ChannelStats` (Task 1), `readStats`·`statsFilePath` (Task 4)
- Produces: `EpisodeSummary.youtubeViews?: number`; `summarize`가 옵션 `videos?: Record<string, VideoStat>`를 받아 publications URL과 조인.

> `scanEpisodes(root)`는 gitRoot를 모르므로, stats는 `resolveGitRoot` 대신 orchestratorRoot 기준으로는 못 읽는다. **주입 방식**: `scanEpisodes(root, videos?)` 시그니처에 videos 맵을 선택 인자로 추가하고, ipc `episodes:list` 핸들러가 `readStats(await resolveGitRoot(currentRoot)).videos`를 넘긴다. 단위 테스트는 videos를 직접 주입.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scanner-youtubeViews.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEpisodes } from '../src/main/scanner';

function makeEp(root: string, id: string, doc: object) {
  const dir = join(root, 'output', 'episodes', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'episode.json'), JSON.stringify(doc));
}

describe('scanEpisodes youtubeViews 조인', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hub-scan-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('발행 유튜브 URL의 조회수를 요약에 붙임', () => {
    makeEp(root, 'ep20260708_x', {
      schema_version: 1, title: 'T', stage: '', approvals: {},
      publications: [{ platform: 'youtube', date: '2026-07-08', url: 'https://youtu.be/aaaaaaaaaaa' }],
    });
    const videos = { aaaaaaaaaaa: { views: 32000, likes: 0, at: 'x' } };
    const eps = scanEpisodes(root, videos);
    expect(eps[0].youtubeViews).toBe(32000);
  });

  test('URL 없거나 매칭 없으면 undefined', () => {
    makeEp(root, 'ep20260708_y', { schema_version: 1, title: 'T', stage: '', approvals: {}, publications: [] });
    expect(scanEpisodes(root, {})[0].youtubeViews).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scanner-youtubeViews.test.ts`
Expected: FAIL — `scanEpisodes` 2번째 인자 미지원 / youtubeViews 없음

- [ ] **Step 3: Write minimal implementation**

`src/shared/types.ts` `EpisodeSummary`에 추가:

```typescript
  /** 발행된 유튜브 영상의 조회수 (stats.videos 조인, Phase D+) */
  youtubeViews?: number;
```

`src/main/scanner.ts`:

import 추가:
```typescript
import { extractVideoId, type VideoStat } from '@shared/stats';
```

`summarize` 시그니처·본문 수정 (videos 인자 추가):
```typescript
function summarize(root: string, id: string, files?: Record<GroupKey, FileEntry[]>, videos?: Record<string, VideoStat>): EpisodeSummary {
  const epDir = join(episodesDir(root), id);
  const { doc, error } = loadDoc(epDir);
  const groupCounts = files
    ? Object.fromEntries(GROUP_KEYS.map((g) => [g, files[g].length]))
    : Object.fromEntries(GROUP_KEYS.map((g) => [g, listGroupFiles(epDir, g).length]));
  const pubs = doc?.publications ?? [];
  let youtubeViews: number | undefined;
  if (videos) {
    for (const p of pubs) {
      if ((p.platform === 'youtube' || p.platform === 'shorts') && p.url) {
        const vid = extractVideoId(p.url);
        if (vid && videos[vid]) { youtubeViews = (youtubeViews ?? 0) + videos[vid].views; }
      }
    }
  }
  return {
    id,
    title: doc?.title || id,
    stage: doc?.stage || '',
    ...(error ? { error } : {}),
    groupCounts: groupCounts as Record<GroupKey, number>,
    publications: pubs,
    approvals: Object.fromEntries(
      Object.entries(doc?.approvals ?? {}).map(([k, v]) => [k, v?.approved === true]),
    ),
    ...(doc?.total_estimate?.low !== undefined ? { estimateLow: doc.total_estimate.low } : {}),
    ...(youtubeViews !== undefined ? { youtubeViews } : {}),
  };
}
```

`scanEpisodes` 시그니처·map 수정:
```typescript
export function scanEpisodes(root: string, videos?: Record<string, VideoStat>): EpisodeSummary[] {
  const dir = episodesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      try { return statSync(join(dir, name)).isDirectory(); } catch { return false; }
    })
    .sort((a, b) => b.localeCompare(a))
    .map((id) => summarize(root, id, undefined, videos));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scanner-youtubeViews.test.ts && npx vitest run tests/scanner.test.ts`
Expected: 둘 다 PASS (기존 scanner 테스트 회귀 없음 — videos 미지정 시 youtubeViews 생략)

- [ ] **Step 5: Wire ipc episodes:list to pass videos**

`src/main/ipc.ts`의 `episodes:list` 핸들러 수정:
```typescript
  ipcMain.handle('episodes:list', async () => {
    if (!currentRoot) return [];
    const videos = readStats(await resolveGitRoot(currentRoot)).videos;
    return scanEpisodes(currentRoot, videos);
  });
```

- [ ] **Step 6: Run typecheck + commit**

Run: `npm run typecheck`
Expected: exit 0

```bash
git add src/shared/types.ts src/main/scanner.ts src/main/ipc.ts tests/scanner-youtubeViews.test.ts
git commit -m "feat(episode-hub): 에피소드별 유튜브 조회수 조인(scanner)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: recharts 추가 + 차트 컴포넌트 2종

**Files:**
- Modify: `package.json` (recharts 의존성)
- Create: `src/renderer/components/charts/GrowthChart.tsx`
- Create: `src/renderer/components/charts/PublishTrendChart.tsx`
- Test: 없음 (renderer — build/typecheck + Task 10 e2e)

**Interfaces:**
- Consumes: `ChannelSnapshot` (Task 1), `PLATFORMS`·`Publication` (`shared/episode`)
- Produces:
  - `GrowthChart({ snapshots }: { snapshots: ChannelSnapshot[] })`
  - `PublishTrendChart({ publications }: { publications: Publication[] })`

- [ ] **Step 1: Install recharts**

Run: `npm install recharts@^2.12.0`
Expected: package.json dependencies에 recharts 추가, 설치 성공.

- [ ] **Step 2: Write GrowthChart**

```tsx
// src/renderer/components/charts/GrowthChart.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { PLATFORMS } from '@shared/episode';
import type { ChannelSnapshot } from '@shared/stats';

const YT = PLATFORMS.find((p) => p.key === 'youtube')!.color;   // ember
const BLOG = PLATFORMS.find((p) => p.key === 'blog')!.color;    // forest

/** 구독자·조회수·블로그이웃 시계열. 스냅샷 2개 미만이면 안내. */
export default function GrowthChart({ snapshots }: { snapshots: ChannelSnapshot[] }) {
  if (snapshots.length < 2) {
    return <div className="chart-empty">성장 데이터가 쌓이는 중이에요 (스냅샷 {snapshots.length}개)</div>;
  }
  const data = snapshots.map((s) => ({
    date: s.date.slice(5), // MM-DD
    구독자: s.youtube?.subscribers ?? null,
    블로그이웃: s.blog?.neighbors ?? null,
  }));
  return (
    <div className="chart-card">
      <h4 className="chart-title">성장 추이</h4>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="date" fontSize={11} />
          <YAxis fontSize={11} width={44} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="구독자" stroke={YT} strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="블로그이웃" stroke={BLOG} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Write PublishTrendChart**

```tsx
// src/renderer/components/charts/PublishTrendChart.tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { PLATFORMS, type Publication } from '@shared/episode';

/** ISO week 키 (YYYY-Www) — 주별 그룹핑 */
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export default function PublishTrendChart({ publications }: { publications: Publication[] }) {
  if (publications.length === 0) {
    return <div className="chart-empty">발행 기록이 아직 없어요</div>;
  }
  const byWeek: Record<string, Record<string, number>> = {};
  for (const p of publications) {
    const w = isoWeek(p.date);
    byWeek[w] = byWeek[w] || {};
    byWeek[w][p.platform] = (byWeek[w][p.platform] ?? 0) + 1;
  }
  const data = Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, counts]) => ({ week: week.slice(5), ...counts }));
  return (
    <div className="chart-card">
      <h4 className="chart-title">발행 추이 (주별)</h4>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="week" fontSize={11} />
          <YAxis fontSize={11} width={28} allowDecimals={false} />
          <Tooltip />
          <Legend />
          {PLATFORMS.map((p) => (
            <Bar key={p.key} dataKey={p.key} name={p.label} stackId="pub" fill={p.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Verify build + typecheck**

Run: `npm run typecheck && npm run build`
Expected: 둘 다 성공(exit 0). recharts 번들 포함 확인.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/components/charts/
git commit -m "feat(episode-hub): recharts + 성장/발행 추이 차트 컴포넌트

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: store 통계 상태 + Dashboard KPI·차트·배지 + brand.css

**Files:**
- Modify: `src/renderer/store/useHub.ts` (`stats` 상태 + `refreshStats`)
- Modify: `src/renderer/components/Dashboard.tsx` (KPI 강화 + 차트 2단 + 조회수 배지)
- Modify: `src/renderer/assets/brand.css` (차트/KPI 스타일)
- Test: 없음 (build/typecheck + Task 10 e2e)

**Interfaces:**
- Consumes: `ChannelStats`·`latestSnapshot`·`snapshotOnOrBefore`·`computeDelta` (Task 1), `GrowthChart`·`PublishTrendChart` (Task 8), `window.hub.stats` (Task 6)
- Produces: `useHub().stats: ChannelStats | null`, `useHub().refreshStats(): Promise<void>`

- [ ] **Step 1: Add stats to store**

`src/renderer/store/useHub.ts`:

import 추가:
```typescript
import type { ChannelStats } from '@shared/stats';
```

`HubState` 인터페이스에 추가:
```typescript
  stats: ChannelStats | null;
  loadStats: () => Promise<void>;
  refreshStats: () => Promise<void>;
```

초기값·액션 추가 (`page: 'dashboard',` 뒤):
```typescript
  stats: null,
  loadStats: async () => {
    try { set({ stats: await window.hub.stats.get() }); } catch { /* 무시 */ }
  },
  refreshStats: async () => {
    try { set({ stats: await window.hub.stats.refresh() }); } catch { /* 무시 */ }
  },
```

`init` 액션에서 root 있을 때 `void get().loadStats();` 호출 추가 (refresh 뒤).

- [ ] **Step 2: Expand Dashboard**

`src/renderer/components/Dashboard.tsx` 전체 교체:

```tsx
import { GROUPS } from '@shared/groups';
import { APPROVAL_GATES, PLATFORMS } from '@shared/episode';
import { latestSnapshot, snapshotOnOrBefore, computeDelta, type Delta } from '@shared/stats';
import PublishCalendar from './PublishCalendar';
import GrowthChart from './charts/GrowthChart';
import PublishTrendChart from './charts/PublishTrendChart';
import { useHub } from '../store/useHub';

function DeltaBadge({ d }: { d: Delta }) {
  if (d.sign === 'flat') return null;
  const sym = d.sign === 'up' ? '▲' : '▼';
  const color = d.sign === 'up' ? '#246d38' : '#ea4f23'; // forest/ember, 기호 병기(접근성)
  return <span className="kpi-delta" style={{ color }}>{sym}{Math.abs(d.value).toLocaleString()}</span>;
}

export default function Dashboard() {
  const { episodes, openEpisode, stats, refreshStats } = useHub();
  const pubs = episodes.flatMap((e) => e.publications);
  const countOf = (key: string) => pubs.filter((p) => p.platform === key).length;

  const snapshots = stats?.snapshots ?? [];
  const cur = latestSnapshot(stats ?? { schema_version: 1, snapshots: [], videos: {} });
  const base = cur ? snapshotOnOrBefore(stats!, prevWeek(cur.date)) : null;

  const budget = episodes.reduce((sum, e) => sum + (e.estimateLow ?? 0), 0);
  const totalGroups = GROUPS.length;
  const pipeline = episodes.length
    ? Math.round((episodes.reduce((s, e) => s + GROUPS.filter((g) => e.groupCounts[g.key] > 0).length, 0) / (episodes.length * totalGroups)) * 100)
    : 0;

  return (
    <div className="dashboard">
      <div className="dash-head">
        <h2 className="dash-title">대시보드</h2>
        <div className="dash-head-right">
          {cur && <span className="dash-updated">갱신 {relTime(cur.at)}</span>}
          <button className="refresh-btn" onClick={() => void refreshStats()}>🔄 새로고침</button>
        </div>
      </div>

      {/* ① KPI 요약 강화 */}
      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-num">{cur?.youtube ? cur.youtube.subscribers.toLocaleString() : '—'}
            {cur?.youtube && base?.youtube && <DeltaBadge d={computeDelta(cur.youtube.subscribers, base.youtube.subscribers)} />}</span>
          <span className="stat-label">구독자</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{cur?.youtube ? cur.youtube.views.toLocaleString() : '—'}
            {cur?.youtube && base?.youtube && <DeltaBadge d={computeDelta(cur.youtube.views, base.youtube.views)} />}</span>
          <span className="stat-label">총 조회수</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{cur?.blog ? cur.blog.neighbors.toLocaleString() : '—'}
            {cur?.blog && base?.blog && <DeltaBadge d={computeDelta(cur.blog.neighbors, base.blog.neighbors)} />}</span>
          <span className="stat-label">블로그 이웃</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">₩{budget.toLocaleString()}</span>
          <span className="stat-label">누적 예산</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{episodes.length}</span>
          <span className="stat-label">에피소드</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{pipeline}%</span>
          <span className="stat-label">파이프라인 진척</span>
        </div>
      </div>
      {cur && cur.sources.youtube === 'error' && (
        <div className="stat-note">⚠️ 유튜브 통계를 못 불러왔어요 — orchestrator/.env 의 YOUTUBE_API_KEY 를 확인해주세요.</div>
      )}
      {cur && cur.sources.blog !== 'ok' && (
        <div className="stat-note">⚠️ 블로그 통계가 최신이 아닐 수 있어요 (마지막값 표시).</div>
      )}

      {/* ②③ 그래프 2단 */}
      <div className="chart-row">
        <GrowthChart snapshots={snapshots} />
        <PublishTrendChart publications={pubs} />
      </div>

      {/* ④ 발행 달력 (기존) */}
      <PublishCalendar episodes={episodes} />

      {/* ⑤ 에피소드 현황 (기존 + 조회수 배지) */}
      <h3 className="dash-sub">에피소드 현황</h3>
      <div className="ep-cards">
        {episodes.map((ep) => (
          <button key={ep.id} className="ep-card" onClick={() => openEpisode(ep.id)}>
            <div className="ep-card-head">
              <span className="ep-card-title">{ep.title}</span>
              {ep.youtubeViews !== undefined && <span className="views-tag">▶ {ep.youtubeViews.toLocaleString()}</span>}
              {ep.estimateLow !== undefined && <span className="price-tag sm">₩{ep.estimateLow.toLocaleString()}</span>}
            </div>
            <div className="ep-card-gates">
              {APPROVAL_GATES.map((g) => (
                <span key={g.key} className={`gate-chip mini${ep.approvals[g.key] ? ' on' : ''}`}>
                  {ep.approvals[g.key] ? '✓ ' : ''}{g.label}
                </span>
              ))}
              {ep.error && <span className="chip error">{ep.error}</span>}
            </div>
            <div className="ep-card-groups">
              {GROUPS.map((g) => (
                <span key={g.key} className={`group-dot${ep.groupCounts[g.key] > 0 ? ' filled' : ''}`} title={`${g.label}: ${ep.groupCounts[g.key]}개`}>
                  {g.emoji}
                </span>
              ))}
            </div>
          </button>
        ))}
        {episodes.length === 0 && <div className="empty-state">에피소드가 아직 없어요</div>}
      </div>
    </div>
  );
}

/** date(YYYY-MM-DD)의 7일 전 */
function prevWeek(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/** ISO 시각 → "N시간 전" (Date.now는 렌더 시점 허용 — 표시용) */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return '방금';
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
```

- [ ] **Step 3: Add brand.css styles**

`src/renderer/assets/brand.css` 하단에 추가 (기존 토큰/클래스 네이밍 관례 따름):

```css
/* Phase D+ 대시보드 확장 */
.dash-head { display: flex; align-items: baseline; justify-content: space-between; }
.dash-head-right { display: flex; align-items: center; gap: 12px; }
.dash-updated { font-size: 12px; color: #888; }
.refresh-btn { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.refresh-btn:hover { background: #f5f5f5; }
.kpi-delta { font-size: 12px; margin-left: 6px; font-variant-numeric: tabular-nums; }
.stat-note { font-size: 12px; color: #a15; margin: 6px 0; }
.chart-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin: 16px 0; }
.chart-card { border: 1px solid #eee; border-radius: 12px; padding: 12px; background: #fff; }
.chart-title { margin: 0 0 8px; font-size: 14px; }
.chart-empty { border: 1px dashed #ddd; border-radius: 12px; padding: 24px; text-align: center; color: #999; font-size: 13px; }
.views-tag { font-size: 12px; color: #ea4f23; font-variant-numeric: tabular-nums; margin-left: auto; }
```

- [ ] **Step 4: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 둘 다 exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store/useHub.ts src/renderer/components/Dashboard.tsx src/renderer/assets/brand.css
git commit -m "feat(episode-hub): 대시보드 KPI 강화+성장/발행 그래프+조회수 배지

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: e2e — 대시보드 통계 흐름 (모킹 fetch)

**Files:**
- Modify: `src/main/statsFetcher.ts` (테스트 seam: `HUB_STATS_MOCK` env)
- Modify: `e2e/hub.e2e.ts` (통계 시나리오 추가) — 또는 Create: `e2e/stats.e2e.ts`
- Test: 본 태스크가 e2e 자체

**Interfaces:**
- Consumes: 전체 배선
- Produces: 실 API 호출 없이($0·결정성) 통계 흐름을 구동하는 e2e.

- [ ] **Step 1: Add mock seam to statsFetcher**

`collectSnapshot`의 `fetchFn` 기본값을 결정하는 헬퍼를 추가 — `HUB_STATS_MOCK`(JSON 파일 경로)가 있으면 네트워크 대신 그 픽스처로 응답:

```typescript
// statsFetcher.ts 내부 — getText 위에 추가
function mockFetch(fixturePath: string): typeof fetch {
  const fx = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<string, string>;
  return (async (input: string | URL) => {
    const url = String(input);
    const key = Object.keys(fx).find((k) => url.includes(k));
    const body = key ? fx[key] : '';
    return { ok: !!key, status: key ? 200 : 500, text: async () => body, json: async () => JSON.parse(body) } as Response;
  }) as typeof fetch;
}
```

`refreshStats`에서 fetchFn 결정:
```typescript
  const mock = process.env.HUB_STATS_MOCK;
  const fetchFn = mock ? mockFetch(mock) : undefined;
  ...
  const { snapshot, videos } = await collectSnapshot({ fetchFn, apiKey, videoIds, prev });
```
(collectSnapshot은 이미 `deps.fetchFn ?? fetch`)

- [ ] **Step 2: Add e2e scenario**

`e2e/hub.e2e.ts`에 시나리오 추가. fixture 생성 시 `<repo>/episode-hub/data/`는 commitStats/refreshStats가 만든다. mock fixture 파일을 하나 써두고 앱 실행 env에 `HUB_STATS_MOCK`을 주입한다:

```typescript
// beforeAll의 electron.launch 옵션 env에 추가 (기존 launch args 근처)
const mockFx = join(base, 'stats-mock.json');
writeFileSync(mockFx, JSON.stringify({
  '/channels': JSON.stringify({ items: [{ statistics: { subscriberCount: '12340', viewCount: '458200', videoCount: '42' } }] }),
  '/videos': JSON.stringify({ items: [] }),
  'NVisitorgp4Ajax': '<visitorcnts><visitorcnt id="20260708" cnt="210"/></visitorcnts>',
  'blog.naver.com/be_optimistic228': '<span>이웃 320명</span>',
}));
// electron.launch({ args:[MAIN, `--user-data-dir=${tempUserData}`], env: { ...process.env, HUB_STATS_MOCK: mockFx, YOUTUBE_API_KEY: 'TESTKEY' } })

test('대시보드: 새로고침 → 통계 표시', async () => {
  await page.getByRole('button', { name: /새로고침/ }).click();
  await expect(page.getByText('12,340')).toBeVisible();     // 구독자
  await expect(page.getByText('구독자')).toBeVisible();
});
```

> **주의:** 기존 `electron.launch(...)` 호출의 `env` 필드에 `HUB_STATS_MOCK`·`YOUTUBE_API_KEY`를 병합해야 한다. 현재 launch에 env가 없으면 `env: { ...process.env, ... }`를 추가한다.

- [ ] **Step 3: Run e2e**

Run: `npm run test:e2e`
Expected: 기존 시나리오 + 새 통계 시나리오 PASS. (git 없으면 git 시나리오만 skip, 통계 시나리오는 mock이라 통과)

- [ ] **Step 4: Run full test suite (회귀 확인)**

Run: `npm test`
Expected: 전체 vitest PASS (신규 + 기존).

- [ ] **Step 5: Commit**

```bash
git add src/main/statsFetcher.ts e2e/hub.e2e.ts
git commit -m "test(episode-hub): 대시보드 통계 흐름 e2e(모킹 fetch)+테스트 seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 최종 검증 (전체 완료 후)

- [ ] `npm run typecheck` — exit 0
- [ ] `npm test` — 전체 vitest PASS
- [ ] `npm run test:e2e` — PASS
- [ ] `npm run dev`로 실행 → 대시보드 육안 확인: KPI 타일·델타·그래프 2종(브랜드 색)·조회수 배지·새로고침·"갱신 N시간 전". 키 없을 때 ⚠️ 안내. (superpowers:verification-before-completion)
- [ ] **라이브 파서 검증**: 실제 `NVisitorgp4Ajax`/블로그 프로필 1회 fetch → `parseNaverVisitors`/`parseNaverNeighbors` 정규식을 실측 마크업에 맞춰 조정(격리 함수만 수정). 조정 시 Task 3 테스트 픽스처도 실측 형태로 갱신.
- [ ] CLAUDE.md episode-hub 설명에 Phase D+ (대시보드 확장) 한 줄 반영 여부 검토 (문서 동기화).

## 스펙 커버리지 매핑

| 스펙 섹션 | 구현 태스크 |
|---|---|
| §1 데이터 흐름 | Task 4·6 |
| §2 channel_stats.json + carry-forward | Task 1·4 |
| §2-1 git 동기화 | Task 5·6 |
| §3 statsFetcher(API키·크롤·degradation) | Task 2·3·4 |
| §4 IPC | Task 6 |
| §5 대시보드 UI(KPI·차트·달력·카드) | Task 8·9 |
| §6 에피소드↔영상 매핑 | Task 1·7 |
| §7 배선 요약 | Task 1~9 전반 |
| §8 검증 | Task 1~5·7 단위 + Task 10 e2e |
| §9 스코프/YAGNI(인스타 제외) | 전체 (인스타 통계 미구현) |
