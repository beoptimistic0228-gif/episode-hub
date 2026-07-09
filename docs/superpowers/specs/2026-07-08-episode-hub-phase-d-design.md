# Episode Hub Phase D — 대시보드·최종 영상·OSMU·발행 기록 (2026-07-08)

Owner 요청: ① 전역 대시보드(집계 타일 + 발행 달력 + 에피소드 현황판) ② 최종 영상 페이지 ③ OSMU 페이지 ④ SNS(유튜브·인스타·네이버 블로그) 상시 하이퍼링크.
Owner 결정: 최종 영상·OSMU는 **에피소드 탭(9·10번째)**, 대시보드만 전역 / 영상은 **앱 내 재생** / 발행 데이터는 **앱에서 수동 기록**(자동 추정 기각 — 준비본≠게시본, 날짜 부정확).

## 1. 내비게이션

- 스토어에 `page: 'dashboard' | 'episode'` 추가. **앱 첫 화면 = 대시보드.**
- 사이드바 배너 아래 "🏠 대시보드" 메뉴 버튼. 에피소드 클릭 시 `page='episode'` 전환(기존 화면 그대로).

## 2. 에피소드 탭 2종 신설

| 그룹 key | 라벨 | 폴더 | 내용 |
|---|---|---|---|
| `final` | 🎞️ 최종 영상 | `output/episodes/<ep>/final/` | 편집 완성본(유튜브 풀·릴스·썸네일 클립). mp4·mov·webm·m4v — **앱 내 `<video>` 재생**(기존 hub:// 프로토콜, stream 지원). **gitignore**(renders와 동일 정책). 파일명 자유 |
| `osmu` | 📤 OSMU | `output/episodes/<ep>/osmu/` | 블로그·쓰레드·인스타 캡션 등 변환 md. 초기엔 빈 폴더 — 파이프라인 OSMU 변환기 확장은 별도 후속 |

- `classifyKind`에 `video` 종 추가. `GroupDetail`이 video kind를 인라인 플레이어로 렌더.
- AgentCallout 2종 추가 (final = Owner 편집 완성본 보관함 / osmu = OSMU 변환 담당).
- 스캐너는 GROUP_KEYS 기반이라 그룹 정의 추가만으로 동작.

## 3. 발행 기록 (신규 데이터 — 대시보드의 원천)

- `episode.json`에 `publications: [{ platform, date(YYYY-MM-DD), url?, at(ISO) }]` 배열 신설. schema_version 1 유지(additive).
- 플랫폼 enum (`shared/episode.ts` `PLATFORMS`): `youtube`(본편)·`shorts`·`instagram`·`blog`·`threads` — 라벨·브랜드 색 매핑 포함.
- `writer.patchEpisode` 확장: `addPublication` / `removePublication(index)`. 기존 RMW·유령 dirty 복원 경로 재사용.
- UI: **발행 탭 상단 "발행 기록" 스트립** — 기록 목록(플랫폼 배지+날짜+URL 링크+삭제) + 추가 폼(플랫폼 select, 날짜 기본 오늘, URL 선택).

## 4. 대시보드 (전역 페이지)

위→아래 3단:
1. **집계 타일** — 총 에피소드 / 유튜브 본편 / 블로그 / 인스타 / 쇼츠·쓰레드 발행 수. publications 집계, 브랜드 색.
2. **발행 달력** — 월간 그리드(순수 React, 라이브러리 없음). 발행일에 플랫폼 색 점(ember=유튜브·forest=블로그·orchid=인스타·sun=쇼츠/쓰레드), hover 시 에피소드 제목(title), ◀▶ 월 이동, 오늘 강조.
3. **에피소드 현황판** — 카드: 제목·견적 배지·승인 게이트 칩·10그룹 채움 점 표시. 클릭 → 해당 에피소드로 이동.

데이터: `EpisodeSummary` 확장 — `publications`, `approvals`(게이트 boolean), `estimateLow`. IPC 신설 없음(episodes:list 재사용).

## 5. SNS 상시 링크

- 사이드바 footer에 로고 3개(`07-Resources/Logo/{youtube_logo,Instagram_logo,naver_blog}.png` → 앱 assets 복사) — 클릭 시 기본 브라우저.
- 보안: renderer가 임의 URL을 열 수 없게 **IPC `links:open(kind)`** — URL 맵은 main에 고정 (youtube 채널 / instagram @beoptimistic.official / blog be_optimistic228).

## 6. 검증

- 단위: classifyKind(video) · patchEpisode publications 추가/삭제 · scanner summary 확장 필드.
- e2e: 첫 화면=대시보드(타일 표시) → 카드 클릭 시 에피소드 전환 / final 탭 `<video>` 렌더 / 발행 기록 추가 → episode.json 반영 + 대시보드 집계 증가.
- 실행 스크린샷 육안 확인. SNS 열기는 shell 실호출이라 e2e 제외(수동 확인).
