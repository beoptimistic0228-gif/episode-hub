# Episode Hub — 산출물 에피소드별 재배치 + Electron 허브 앱 설계

- 날짜: 2026-07-05
- 상태: Owner(낙관) 설계 승인 완료 (§1~§3 대화 승인)
- 관련: `2026-06-06-review-studio-design.md`(텍스트 편집 역할 흡수 예정) · `2026-06-23-content-studio-harness-design.md`(보드) · 에피소드 자산 관리(2026-07-04, manifest.json)

## 1. 배경 (왜)

- 산출물이 **종류별 15개 폴더**(`output/titles/`·`scripts/`·`master_sheets/`…)로 흩어져 있어, 한 에피소드를 작업하려면 여러 폴더를 오가야 한다. 실사례: Gem 렌더 시 마스터시트 프롬프트(`output/master_sheets/`)와 제품 사진(`output/assets/<ep>/products/`)을 수동으로 오가며 매칭 — Owner가 "너무 불편"으로 보고.
- "프로젝트(콘텐츠)별 산출물 관리" 지시는 이미지(`assets/<ep>/`)에만 반영됐고 문서 산출물은 미반영이었다.
- 전 산출물에 `episode_id` 도장(2026-07-04, lib_episode)이 있어 에피소드 단위 재편의 기계적 기반은 이미 존재.
- 이 레포를 클론해 쓰는 **다른 사용자**(기본 경로 `C:\nakgwan-channel-infra\orchestrator`)도 같은 시스템을 설치·사용한다 — 배포와 git 동기화가 요구사항.

**목표**: ① 산출물을 에피소드 단위로 재배치하고 ② 그 구조를 한 화면에서 보고·작업하는 Electron 윈도우 앱(Episode Hub)을 만든다.

## 2. 프로젝트 분해 (2개 서브 프로젝트, 순차)

| # | 프로젝트 | 내용 | 순서 이유 |
|---|---|---|---|
| ① | **산출물 재배치** | `output/episodes/<ep>/` 신설 + 에이전트 저장 경로 수술 + 레거시 이사 | 앱이 깨끗한 구조 하나만 읽으면 되도록 선행 |
| ② | **Episode Hub 앱** | electron-vite + React 허브 앱 (뷰·편집·저장·승인·git 동기화) | ①의 구조 위에 구축 |

각 프로젝트는 별도 구현 계획(writing-plans)으로 진행한다.

## 3. 프로젝트 ① — 산출물 재배치

### 3-1. 새 구조 (폴더 = 앱 화면의 의미 단위, 1:1)

```
orchestrator/output/episodes/<episode_id>/
├── episode.json        # 에피소드 상태 파일 (기존 manifest.json 승계·확장)
├── planning/           # 📋 기획 — topic_picks 정리본
├── products/           # 🛋️ 제품 — product_sheet·confirmed_room 정리본 + 제품 사진(.jpg)
├── prompts/            # 🎨 렌더 프롬프트 — master_sheets_prompts.md + room_render_prompts.md
├── renders/            # 🖼️ 렌더 결과 — Owner가 Gem에서 생성해 저장 (이미지 gitignored)
├── script/             # 🎬 대본 — 콘티 draft / FINAL
├── publish/            # 📢 발행 — 제목·썸네일 프롬프트·썸네일 이미지·shorts
├── validation/         # ✅ 검증 리포트
└── manuscript/         # 📜 통합 원고
```

### 3-2. 규칙

- **범위 = 주간 파이프라인 산출물만.** 일일 분석(benchmark·patterns·insights)·BOARD·INDEX·weekly_reports는 현 위치 유지. `data/*.json`(에이전트 간 전달 작업 메모리)도 현 위치 유지.
- **경로 단일화**: `lib_output`에 `episode_dir(episode_id, group)` 공통 헬퍼 신설 — 산출물을 쓰는 전 에이전트(5·6·7·8·9·10·11·13·validator·osmu + `agent-prompt-engineer` 지침 .md)가 이 헬퍼(또는 지침 명시 경로)만 사용. 경로 정책 변경은 이후 한 곳 수정.
- **`assets/<ep>/` 흡수·폐지**: products·renders·thumbnails가 각자 그룹 폴더로. `manifest.json` → `episode.json` 개명·확장.
- **episode.json 스키마(v1)**: manifest 필드(제품·가격·좌표·리뷰·usage_rules) 승계 + `schema_version`·`title`·`stage`·`approvals{}`(무드보드·콘티 FINAL 등 Owner 게이트 기록) 추가. 진행률(렌더 n/24 등)은 저장하지 않고 앱이 파일 스캔으로 파생(이중 상태 방지).
- **레거시 이사**: 도장 있는 산출물(동물의 숲 ep20260628)은 마이그레이션 스크립트로 이사. 도장 없는 옛 산출물(6/11 등)은 `output/_archive/`로 격리(삭제 금지).
- **gitignore**: 이미지 제외 규칙을 새 경로(`output/episodes/*/renders/` 등)로 갱신. md·json은 추적.
- **INDEX.md**(Agent 13 생성)는 새 경로로 링크. BOARD 연동은 후속(§6).
- **문서 동기화**: 경로를 언급하는 문서(`orchestrator/CLAUDE.md` 레이아웃·`BUILD_SOP.md` 산출 경로·`.claude/agents/agent-prompt-engineer.md` 산출 경로·관련 스킬 SKILL.md)를 같은 커밋에서 갱신 — 산문과 코드의 경로 불일치가 곧 다음 사고(§C-4 sync 문화).

### 3-3. 검증

- 파이프라인 스모크: Agent 8→8B→9→10→11→validator→13을 동물의 숲 EP로 재실행해 전 산출물이 `output/episodes/ep20260628…/` 아래 생성되는지 확인.
- lib_episode 가드·에피소드 도장 정합 유지 확인.

## 4. 프로젝트 ② — Episode Hub 앱

### 4-1. 스택·위치 (A안 승인)

- 레포 최상위 `episode-hub/` (interior-studio와 나란한 독립 앱).
- **electron-vite + React + TypeScript + zustand** — interior-studio와 동일 스택(검증된 설정 복제).
- Electron 2-프로세스: `src/main/`(fs 읽기·쓰기·chokidar 감시·설정·git) / `src/preload/`(보안 브릿지 — renderer의 fs 직접 접근 금지) / `src/renderer/`(React UI).

### 4-2. 데이터 원칙

- **파일시스템 = 단일 진실, DB 없음.** 앱은 `output/episodes/`를 스캔해 그리고, watcher가 파일 변경을 감지해 자동 갱신. 앱 재시작에도 상태 손실 없음.
- 쓰기 3종(전부 main 프로세스): ① md 텍스트 편집 저장 ② 드래그된 렌더 이미지를 규칙명으로 `renders/` 저장 ③ 승인·상태를 `episode.json`에 기록.

### 4-3. 경로 발견·설치·배포 (다중 사용자)

- **orchestrator 루트 자동 발견** (첫 실행): ⓐ 앱이 레포 안이면 상대경로 `../orchestrator` → ⓑ 기본 `C:\nakgwan-channel-infra\orchestrator` → ⓒ 폴더 선택 다이얼로그. 결과는 `%APPDATA%` 사용자 설정에 저장.
- **설치 2트랙**: 개발자 = `npm install && npm run dev` / 일반 사용자 = `npm run dist`(electron-builder NSIS 설치 파일, GitHub Releases 배포 가능). 빌드 산출물 gitignore.
- **버전 독립**: 앱은 폴더 구조 + `episode.json`의 `schema_version`에만 의존 — 파이프라인과 앱이 서로를 깨지 않음.

### 4-4. Git 동기화 (앱 내장, simple-git — 시스템 git 호출)

| 동작 | 트리거 | 수행 |
|---|---|---|
| 자동 최신화 | 앱 실행 시 | `git fetch` → 원격이 앞서면 **fast-forward pull만** 자동 |
| Update 버튼 | 수동 | 동일 로직 + 결과 알림 |
| Complete 버튼 | 에피소드 완료 | 해당 EP 산출물만 `git add` → 컨벤션 커밋 → `git push` |

안전 규칙:
- pull은 fast-forward만 — 로컬 미커밋 변경·히스토리 분기 시 자동 병합 금지, 상태 배너 안내.
- Complete 커밋 범위 = `output/episodes/<ep>/` + `data/*.json` 중 **해당 EP 도장(episode_id)이 찍힌 파일만**. 메시지 자동 생성: `feat(orchestrator): <ep> 산출물 완료 (Episode Hub)`.
- push 충돌 시 "Update 먼저" 안내. 자동 머지·강제 푸시 절대 없음.
- 사이드바 하단 git 상태 칩: 🟢 최신 / 🔵 받을 것 / 🟡 올릴 것 / 🔴 충돌.
- 전제(설치 가이드 명시): git 설치 + GitHub 인증 구성. 미설치 시 안내 화면.

### 4-5. 화면 설계 — Slack 디자인 언어 (`DESIGN-slack.md` 토큰)

- **레이아웃 = Slack 문법**: 오베르진(`#4a154b`) 사이드바에 에피소드 목록(채널처럼 `#` 리스트, 선택 = `primary-press`, 보조 텍스트 = `on-aubergine-mute`) + 하단 git 칩·Update 버튼. 본문 = `canvas #fff`, 그룹 카드 `rounded-xl 16px` + `hairline` 보더, hover 시 `canvas-cream`.
- **에피소드 화면**: 헤더(제목·단계·견적·SKU + **Complete 오베르진 필 버튼** — 화면당 필 CTA 1개 룰 준수) + 8개 의미 그룹 카드(§3-1과 1:1, 각 카드에 개수·상태 요약).
- **버튼**: Complete = primary 필 / Update = 라벤더 세컨더리 필. 상태색 = `semantic-success`/`semantic-error`.
- **폰트**: Inter는 한글 미지원 → **Pretendard**(한글) + Inter(라틴·숫자) fallback 체인.
- **핵심 상세 — 🎨 프롬프트 그룹(렌더 작업대)**: SKU 단위로 [제품 사진 썸네일 | Row1/Row2 프롬프트 복사 버튼(en/ko 토글) | 생성본 드롭 존]을 한 줄에. 사진은 OS 네이티브 드래그 아웃(Gem 첨부용), 생성 이미지를 드롭하면 `renders/<카테고리>__<row>.png` 규칙명 자동 저장 → 진행률 갱신. 방 렌더(Phase 0~5)도 동일 패턴(이전 Phase 컷 드래그 → 생성 → 드롭).
- **🎬 대본 그룹**: 5-column 콘티 md를 표로 렌더 + 셀 직접 편집(저장 시 md 반영). draft→FINAL 전환 버튼 = `episode.json.approvals` 기록. (review-studio-builder의 편집 역할을 흡수 — `feat/review-studio-infra` 브랜치는 행방불명 상태로, 본 앱이 후속.)
- **Complete 활성 조건**: 그룹별 체크(렌더 전량·콘티 FINAL·검증 PASS 등) 충족 시.

### 4-6. 에러 처리

- orchestrator 경로 소실(폴더 이동·삭제) → 재선택 다이얼로그.
- episode.json 파싱 실패·schema_version 불일치 → 해당 EP 카드에 오류 배지, 앱 전체는 계속 동작.
- 파일 저장 충돌(외부에서 동시 수정) → watcher 감지 시 "디스크가 더 최신" 배너, 덮어쓰기 전 확인.
- git 오류(인증 실패·네트워크) → 사람 언어 안내, 원문 로그는 접기.

### 4-7. 테스트

- vitest 단위: 에피소드 스캐너(폴더→모델), 렌더 파일명 규칙, episode.json 읽기/쓰기, git 상태 판정 로직(mock).
- Playwright e2e(interior-studio 패턴): 픽스처 에피소드 폴더로 허브 렌더 → 그룹 카드 → 프롬프트 복사 → 이미지 드롭 저장 흐름.

## 5. 구현 순서

1. 프로젝트 ① 재배치 (파이프라인 수술 + 마이그레이션 + 스모크)
2. 프로젝트 ② 앱 — Phase A: 읽기 전용 허브(스캔·카드·상세) → Phase B: 쓰기(편집·드롭 저장·승인) → Phase C: git 동기화 → Phase D: 패키징(NSIS)·설치 가이드

## 6. 백로그 (이번 범위 아님)

- **이미지 공유**: 렌더 이미지는 gitignore라 Complete push로 공유되지 않음 — 팀 이미지 공유 필요 시 클라우드 폴더·Git LFS 등 별도 검토 (Owner 결정 2026-07-05).
- **studio/board.json 연동**: 현재 stale fixture. episode.json이 사실상 단일 진실 — 보드가 episode.json들을 파생 렌더하도록 후속 통합.
- **렌더 작업대 고도화**(1순위에서 밀림): Phase 연속성 가이드·생성 QA 연동 등.

## 7. 이 설계가 포기한 것

- **data/*.json 재배치**: 전 에이전트 입력 경로까지 바꾸는 초대형 수술 — output만 재배치(작업 메모리 vs 사람용 산출물 분리 유지).
- **자동 머지·자동 충돌 해결**: 비개발자 사용자의 레포를 앱이 임의로 병합하지 않는다.
- **웹/모바일 지원**: Electron 윈도우 데스크톱 전용(Owner 명시).
