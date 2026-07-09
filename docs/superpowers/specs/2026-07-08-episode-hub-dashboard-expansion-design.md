# Episode Hub 대시보드 확장 (Phase D+) — 채널 통계·그래프 (2026-07-08)

Owner 요청: 대시보드가 부실해 보여 정보를 더 채우고 싶다. 특정 데이터는 **그래프**로, 그리고 **유튜브 구독자·조회수 + 네이버 블로그 구독자·조회수** 같은 외부 채널 데이터를 앱에 띄우고 싶다. (다음 단계 = Phase E MCP 브리지. 본 확장은 그 전 단계.)

## 확정 결정 (브레인스토밍)

| # | 결정 | 근거 |
|---|---|---|
| D1 | **외부 데이터 전부 자동 수집** (유튜브 API + 블로그 크롤) | Owner 선택. 크롤은 깨지기 쉬워 실패 시 마지막값/⚠️ 폴백 필수 |
| D2 | **수집 주체 = episode-hub 앱(Electron main)** | Owner 선택. `main/statsFetcher.ts`에서 직접 fetch |
| D3 | **수집 트리거 = 앱 실행(로딩) 시 자동 + 수동 새로고침** | Owner 선택. 자동은 하루 1회 스로틀 |
| D4 | **이력은 git-tracked (여러 기기 동기화)** | Owner 선택. gitignore 하지 않음 |
| D5 | **YouTube API 키 = `orchestrator/.env`의 `YOUTUBE_API_KEY` 재사용** | 이미 존재(Owner 채움). agent들이 쓰는 키와 동일 — 새 설정 필드 불필요 (DRY) |
| D6 | **차트 = Recharts (경량 라이브러리 추가)** | Owner 선택. 브랜드 색 테마 오버라이드 + dataviz 스킬 준수 |
| D7 | **콘텐츠 블록 4종 전부** — 성장 추이·발행 추이·에피소드별 성과·KPI 강화 | Owner 선택 |
| D8 | 인스타 통계는 범위 제외 (비공식 API·계정 위험) | YAGNI. 발행 기록/달력엔 인스타 유지 |

## 1. 데이터 흐름 (아키텍처)

```
앱 실행(로딩) ─▶ ① git FF-pull(기존 syncStatus auto)
              ─▶ ② channel_stats.json 읽기
                    └ 오늘 스냅샷 있음 → fetch 스킵(스로틀·기기간 충돌 회피)
                    └ 없음 → ③ statsFetcher 실행
[🔄 새로고침] ─────────────────────────▶ ③ statsFetcher 실행(오늘 행 덮어쓰기)

③ main/statsFetcher.ts ─┬─ YouTube Data API (channels/videos.list)
                        └─ 네이버 블로그 크롤 (방문자 위젯 + 이웃수)
   ─▶ channel_stats.json 에 "오늘 스냅샷" upsert (하루 1행)
   ─▶ git add/commit/push (전용 경로, D4 동기화)
   ─▶ IPC(stats:get) ─▶ renderer 대시보드 (Recharts + KPI)
```

- 수집은 **main 프로세스에서만** (CORS 회피·키 노출 방지). renderer는 IPC 결과만 소비.
- 기존 대시보드 3단(집계 타일·발행 달력·에피소드 카드)은 **유지** — 위/사이에 새 블록을 얹는다. 회귀 없음.

## 2. 새 데이터 — 채널 통계 이력 (`channel_stats.json`)

- **위치**: `episode-hub/data/channel_stats.json` — **git-tracked**(D4). `.gitignore`에 `episode-hub/data/` 예외 없음 확인(이미지·env만 무시). 없으면 앱이 최초 생성.
- **하루 1행 원칙**: 같은 `date`(로컬 날짜) 재수집 = 그 행 upsert(덮어쓰기). 성장 그래프의 시계열 소스.

```jsonc
{
  "schema_version": 1,
  "snapshots": [
    {
      "date": "2026-07-08",                    // 로컬 YYYY-MM-DD (행 키)
      "at": "2026-07-08T09:00:00Z",            // 수집 시각(ISO)
      "youtube": { "subscribers": 12340, "views": 458200, "videos": 42 },
      "blog":    { "neighbors": 320, "visitorsTotal": 45100, "visitorsToday": 210 },
      "sources": { "youtube": "ok", "blog": "stale" }  // ok | stale | error — 소스별 상태
    }
  ],
  "videos": {                                   // 에피소드별 성과(§6) — videoId → 최근 통계
    "dQw4w9WgXcQ": { "views": 32000, "likes": 1200, "at": "2026-07-08T09:00:00Z" }
  }
}
```

- **부분 실패**: 한 소스가 실패하면 그 소스만 `sources.<src>="error"`(값은 직전 스냅샷에서 carry-forward) — 다른 소스는 정상 기록. 앱은 절대 죽지 않는다.
- **shared 타입**: `shared/stats.ts` 신설 — `ChannelSnapshot`, `ChannelStats`, `SourceStatus`, `VideoStat`.

### 2-1. git 동기화 (D4)

기존 `completeEpisode`는 EP 폴더 스코프라 통계 파일을 안 집어간다 → **전용 함수 `commitStats(orchestratorRoot)`** 추가:
- `git add -- <statsRel>` → 변경 없으면 no-op → `git commit -m "chore(episode-hub): 채널 통계 스냅샷 <date>"` → `git push`.
- push 거부(원격 앞섬) 시 `completeEpisode`와 동일하게 `needsUpdate` 반환 — **로컬값 보존, 비치명적**(다음 실행 pull 후 재시도).
- **충돌 회피**: 실행 시 ① FF-pull 먼저 → ② 오늘 스냅샷이 이미 있으면(=다른 기기가 오늘 수집·push함) fetch·commit 스킵. same-day 이중 수집은 드물며 last-write-wins.
- `statsRel` = git-root 기준 `episode-hub/data/channel_stats.json` (POSIX). `resolveGitRoot` 재사용.

## 3. 수집기 (`main/statsFetcher.ts`)

| 소스 | 방법 | 파싱 결과 |
|---|---|---|
| 유튜브 채널 | Data API v3 `GET /channels?part=statistics&id=<CHANNEL_ID>&key=<KEY>` (1 unit) | `subscriberCount`·`viewCount`·`videoCount` |
| 유튜브 영상별 | `GET /videos?part=statistics&id=<id,id,...>` (배치, 최대 50/req) | 영상별 `viewCount`·`likeCount` → `videos` 맵 |
| 네이버 블로그 | 공개 위젯 HTTP GET + 정규식/HTML 파싱 | 방문자(오늘/총)·이웃수 |

- **CHANNEL_ID**: `UCqMBCXReIpCPa4PzWiT2grw` (main `ipc.ts` SNS_LINKS와 동일 — `shared/stats.ts` 상수로 단일화). **blogId**: `be_optimistic228`.
- **API 키 로딩(D5)**: `resolveOrchestratorRoot`로 orchestrator 루트 → `<root>/.env` 파싱(우선순위 OS env > .env, orchestrator `lib_config.py`와 동일 규칙) → `YOUTUBE_API_KEY`. 키 없거나 `YOUR_`로 시작 → 유튜브 소스 `error` + 대시보드 유튜브 블록 "API 키 설정 필요" 빈 상태(나머지는 정상).
- **네이버 크롤 취약성**: 파서는 격리된 순수 함수(`parseNaverBlog(html)`)로 두어 위젯 구조 변경 시 그 함수만 교체. 실패(HTTP 오류·파싱 0) → `blog="error"`, carry-forward.
- **$0 준수**: YouTube Data API 무료 쿼터(1일 10,000 units, 본 용도 ≪10) + 블로그 HTTP GET — 추가 과금 0. Node 내장 `fetch`(Electron 31/Node 20+)만 사용, 새 런타임 의존성 없음.
- **네트워크**: main 프로세스 `fetch`. 타임아웃 10s, 실패는 소스 단위 격리(Promise.allSettled).

## 4. IPC 표면 (`main/ipc.ts` + `preload`)

| 채널 | 방향 | 반환 |
|---|---|---|
| `stats:get` | renderer→main | 현재 `channel_stats.json`(읽기, 없으면 빈 구조) |
| `stats:refresh` | renderer→main | statsFetcher 실행 → upsert → commitStats → 갱신된 stats |

- 앱 실행 시 자동 수집(D3)은 main 부팅 시퀀스에서 pull→(오늘 없으면)refresh 호출. renderer는 `stats:get`으로 표시하고 최신 `at`을 "갱신 N시간 전"으로 렌더.
- `pathGuard`: stats 파일 경로는 orchestratorRoot 상위(episode-hub/data)라 기존 EP 가드와 별개 — 고정 경로 상수로 조작 불가.

## 5. 대시보드 UI (`renderer/components/Dashboard.tsx` 확장)

레이아웃 (위→아래, D7 순서 승인):

```
대시보드                                   [🔄 새로고침]  갱신 3시간 전
────────────────────────────────────────────────────────
① KPI 요약 강화 (stat-row 확장)
   구독자 12,340 ▲+240 | 총조회 458K ▲+18K | 블로그이웃 320 ▲+5
   누적예산 ₩5.4M | 에피소드 8 | 파이프라인 ▓▓▓░░ 62%
────────────────────────────────┬───────────────────────
② 성장 추이 (LineChart)          │ ③ 발행 추이 (BarChart)
   구독자·조회수 시계열           │ 주별 플랫폼 발행수(stacked)
────────────────────────────────┴───────────────────────
④ 발행 달력 (기존 PublishCalendar — 유지)
────────────────────────────────────────────────────────
⑤ 에피소드 현황 카드 (기존 + 발행 유튜브 조회수 배지 추가)
```

- ②③ 반응형: 넓으면 2열, 좁으면 세로 스택(CSS grid `minmax`).
- **차트(Recharts)**: `components/charts/GrowthChart.tsx`·`PublishTrendChart.tsx`. 색은 `PLATFORMS[].color` + `brand.css` 토큰만(하드코딩 금지). dataviz 스킬 팔레트/축/툴팁/CVD·대비 준수. 빈 데이터(스냅샷 <2) → "데이터가 쌓이는 중" 안내.
- **KPI 델타**: 최근 스냅샷 vs 7일 전(없으면 가장 오래된) 차이. `▲/▼` + 색(증가=forest·감소=ember, 접근성 위해 기호 병기).
- **파이프라인 진척률**: 에피소드별 10그룹 채움 + 승인 게이트 → 전체 평균 %.
- **누적 예산**: `episodes[].estimateLow` 합계.

## 6. 에피소드↔영상 매핑 (⑤ 조회수 배지)

- 발행 기록 `Publication`(platform=`youtube`, `url`)에서 videoId 추출(정규식: `v=`·`youtu.be/`·`/shorts/`). 
- statsFetcher가 수집한 videoId 집합 = 모든 에피소드 유튜브 발행 URL. `videos.list` 배치 조회 → `channel_stats.videos`.
- `EpisodeSummary`에 `youtubeViews?`(해당 EP 유튜브 발행의 조회수) 추가 — scanner가 publications.url ↔ stats.videos 조인. URL 없으면 배지 미표시(정직).

## 7. 배선 요약 (변경 파일)

| 파일 | 변경 |
|---|---|
| `shared/stats.ts` | **신규** — 타입 + CHANNEL_ID/BLOG_ID 상수 |
| `main/statsFetcher.ts` | **신규** — fetch + 파서 + upsert |
| `main/git.ts` | `commitStats()` 추가 |
| `main/config.ts` | `.env` 읽어 `YOUTUBE_API_KEY` 반환하는 `readEnvKey()` 추가 |
| `main/ipc.ts` | `stats:get`·`stats:refresh` 핸들러 + 부팅 자동수집 |
| `main/index.ts` | 부팅 시 pull→(throttle)refresh 훅 |
| `preload/*` | stats 브리지 노출 |
| `main/scanner.ts` | `youtubeViews` 조인 |
| `shared/types.ts` | `EpisodeSummary.youtubeViews?` |
| `renderer/store/useHub.ts` | `stats` 상태 + `refreshStats()` |
| `renderer/components/Dashboard.tsx` | KPI 확장 + 차트 2종 + 배지 |
| `renderer/components/charts/*` | **신규** GrowthChart·PublishTrendChart |
| `package.json` | `recharts` 추가 |
| `renderer/assets/brand.css` | 차트/KPI 델타 토큰 |

## 8. 검증

- **단위(vitest)**: 
  - `parseYouTubeChannel(json)`·`parseYouTubeVideos(json)`·`parseNaverBlog(html)` — 픽스처 입력→스냅샷.
  - `upsertSnapshot()` — 같은 날 덮어쓰기·새 날 append·carry-forward on error.
  - `extractVideoId(url)` — v=/youtu.be/shorts 케이스.
  - KPI 델타 계산(7일 전 없음 폴백).
- **e2e(Playwright-Electron)**: 
  - 첫 화면 대시보드에 KPI 타일 표시.
  - `stats:refresh`(모킹된 fetch) → 스냅샷 추가 → 그래프 렌더.
  - 키 없을 때 유튜브 블록 "키 설정 필요" + 앱 생존.
  - 크롤 실패 시 앱 생존 + 마지막값 유지.
  - fetch는 e2e에서 네트워크 모킹(실 API 호출 금지 — $0·결정성).
- **육안**: 실행 스크린샷으로 차트 색·대비·레이아웃 확인. git push는 e2e 제외(수동/CI 외 확인).

## 9. 스코프 · 리스크 · YAGNI

- **제외(YAGNI)**: 인스타 통계(D8), 시간대별 실시간, 목표선/알림, 다중 채널.
- **리스크**: 
  - 네이버 위젯 구조 변경 → 파서 교체(격리됨). 
  - same-day 이중 기기 수집 → last-write-wins(허용). 
  - git push 인증 프롬프트 → 비치명적 처리(로컬 보존). 
  - API 키 부재 → 빈 상태(비차단).
- **후속(Phase E 연계)**: MCP 브리지에서 통계 조회/수집을 Claude Code가 트리거하는 확장 여지(본 스펙의 IPC를 재사용).
