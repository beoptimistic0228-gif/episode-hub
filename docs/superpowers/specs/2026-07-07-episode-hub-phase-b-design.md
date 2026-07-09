# Episode Hub — Phase B: 쓰기(편집·드롭 저장·승인) 설계

- 날짜: 2026-07-07
- 상태: Owner(낙관) 설계 승인 완료 (A안)
- 상위 설계: `2026-07-05-episode-hub-design.md` §4 (프로젝트 ② 앱) · §5 구현 순서 Phase B
- 선행 완료: Phase A (읽기 전용 허브 — 스캔·카드·상세·렌더 작업대 프롬프트 복사)

## 1. 배경 (왜)

Phase A는 `output/episodes/`를 **읽기 전용**으로 스캔·표시한다(IPC: `config:*`, `episodes:list/detail`, `files:readText`, `episodes:changed` 이벤트). Phase B는 여기에 스펙 §4-2의 **쓰기 3종**을 얹는다 — 전부 main 프로세스에서, `safeEpisodePath` 가드를 통과해:

1. **md 텍스트 편집 저장** — 대본·문서 편집(`review-studio` 편집 역할 흡수).
2. **렌더 이미지 드롭 저장** — Gem에서 생성한 이미지를 규칙명으로 `renders/`에.
3. **승인·상태 기록** — Owner 게이트·단계를 `episode.json`에.

## 2. 범위 (Owner 확정 — 4개 스코프 질문)

| # | 결정 | 비고 |
|---|---|---|
| 쓰기 범위 | **3종 전부** | 공통 쓰기 인프라(안전 경로·원자적 저장·watcher 정합) 공유 |
| 대본 편집 | **raw md 편집기** | 5-column 표는 보기 모드 렌더 유지, 편집은 raw. **셀 직접 편집(양방향 파싱)은 백로그** |
| 승인 모델 | **고정 게이트 키 셋 + 토글** | `stage`는 수동 설정 셀렉트 |
| 드롭 범위 | **SKU 제품 렌더만** | `renders/<category>__<row>.png`. 방 렌더(Phase 0~5) 드롭은 백로그 |

## 3. 아키텍처 (A안 — 기존 패턴 최소 확장)

데이터 흐름:

```
renderer → preload(hub.*) → main writer (safeEpisodePath 가드) → fs
                                                                   ↓
                              store.refresh ← episodes:changed ← chokidar watcher
```

- **fs = 단일 진실**(Phase A 원칙 유지). 쓰기 핸들러는 상태를 반환하지 않고 fs만 변경 — 갱신은 watcher가 `episodes:changed`를 쏘면 store가 재스캔(이중 상태 없음).
- 신규 파일 `src/main/writer.ts`가 쓰기 3종을 담당. `src/main/ipc.ts`가 등록(기존 `getRoot()`·`safeEpisodePath` 재사용). 범용 `fs:write` 단일 핸들러는 채택하지 않음(타입·가드 명료성 우선).

### 3-1. 쓰기 IPC 3종

**① `files:writeText(id, relPath, content, expectedMtimeMs?)`**
- `safeEpisodePath(root, id, relPath)`로 경로 고정. `.md`만 허용(확장자 화이트리스트).
- **충돌 검사**(§4-6): `expectedMtimeMs`가 주어지고 디스크 현재 mtime과 다르면 저장하지 않고 `{ conflict: true, currentMtimeMs }` 반환 → renderer가 "디스크가 더 최신" 배너로 덮어쓰기 확인. 확인 시 `expectedMtimeMs` 없이 재호출(강제 저장).
- 원자적 저장: temp 파일 write 후 rename(부분 쓰기 방지).

**② `renders:save(id, category, row, bytes, overwrite?)`**
- 저장 경로 = `renders/<normCategory>__<row>.png` (`safeEpisodePath`로 `renders/` 안 고정).
  - `normCategory` = `promptMatch`의 `norm()`과 **동일 규칙**(공백→`_`) — 공유 유틸로 추출해 중복 정의 방지.
  - `row` ∈ `{ 'row1', 'row2' }` (2-row 마스터시트 대응). 화이트리스트 검증.
- `bytes` = renderer가 드롭 File을 `arrayBuffer()`로 읽어 전달한 `Uint8Array`. **`File.path`에 의존하지 않음**(Electron 버전 강건 + main이 경로 전량 검증). PNG로 저장(입력이 jpg/webp여도 확장자는 규칙 고정 — 필요 시 후속에서 원본 확장자 보존 검토).
- 동일명 존재 + `overwrite!==true` → `{ exists: true }` 반환 → renderer 확인 후 `overwrite:true`로 재호출.
- 원자적 저장(temp→rename).

**③ `episode:patch(id, patch)`**
- `episode.json`을 **read-modify-write**. `schema_version!==1`이면 throw(기존 스캐너 정책과 정합).
- `patch` 형태(부분 병합):
  - `{ approve: { key } }` / `{ unapprove: { key } }` → `approvals[key] = { by: 'owner', at: <ISO> }` 설정/삭제. `at`은 main이 찍음(renderer 시계 불신).
  - `{ stage }` → `stage` 문자열 교체(허용 값 화이트리스트 = STAGES 상수).
- 원자적 저장(temp→rename). 파일 없으면 최소 골격(`schema_version:1` + `title:id`) 생성 후 패치.

### 3-2. preload 확장 (`src/preload/index.ts` + `api.d.ts`)

```
hub.files.writeText(id, relPath, content, expectedMtimeMs?) → { ok } | { conflict, currentMtimeMs }
hub.renders.save(id, category, row, bytes, overwrite?)       → { ok } | { exists }
hub.episode.patch(id, patch)                                  → { ok, doc }
```

기존 `hub.config/episodes/files.readText/events`는 불변.

### 3-3. 공유 상수/타입 (`src/shared/`)

- `APPROVAL_GATES` = `['moodboard', 'script_final']` (고정, 확장 가능). 각 키의 한글 라벨 매핑.
- `STAGES` = 단계 화이트리스트(기존 board STAGES와 개념 정합 — planning/design/research/confirmed/render/production/review/done 등, episode.json `stage`용 최소 셋).
- `EpisodeDoc.approvals` 타입을 `Record<string, { by: string; at: string }>`로 구체화.
- `RenderRow` = `'row1' | 'row2'`.

### 3-4. 렌더러 변경

- **`MarkdownEditor`**(신규 or `MarkdownView` 확장): 보기/편집 토글. 편집 = raw md `<textarea>`(dirty 표시 + 저장 버튼). 저장 시 로드 시점 mtime을 `expectedMtimeMs`로 전달 → 충돌이면 배너. 대본 표는 **보기 모드에서만** 기존 렌더, 편집은 raw.
- **PromptsWorkbench SKU 카드**: 카드마다 `row1`/`row2` 드롭존. 드롭 → (존재 시 교체 확인) → `renders.save` → watcher 갱신 → 저장본 썸네일 + "생성됨" 배지. 카드 상단에 **진행률**(renders에 저장된 SKU 렌더 수 / 총 SKU) 표시.
- **승인 스트립**(`EpisodeView` 상단, 헤더 바로 아래): `APPROVAL_GATES` 각 키를 토글 칩(on = `semantic-success`, off = 중립) + `stage` 셀렉트. 헤더의 Complete 필 버튼은 Phase C에서 이 승인 상태를 활성 조건으로 참조(이번엔 기록만).
- **store**(`useHub`): `writeText`·`saveRender`·`patchEpisode` 액션 추가. 각 액션은 IPC 호출 후 watcher 갱신에 의존하되, 즉시성 위해 `select(selectedId)` 재조회 폴백.

## 4. 에러 처리 (스펙 §4-6 정합)

- 저장 충돌(외부 동시 수정) → mtime 검사 → "디스크가 더 최신" 배너, 덮어쓰기 전 확인.
- 이미지 재드롭(동일명 존재) → 교체 확인 다이얼로그.
- episode.json 파싱·schema 불일치 → 기존 카드 오류 배지 유지, 패치는 throw로 거부(무결성 우선).
- 경로 이탈 → `safeEpisodePath`가 throw(기존 가드).
- 잘못된 확장자/row/stage/gate 키 → 화이트리스트 위반 throw.

## 5. 테스트 (스펙 §4-7)

- **vitest 단위**(main):
  - `writer` 경로 가드 — `../` 이탈·비-episode 경로 차단.
  - `renders.save` 파일명 규칙 — category 정규화 + row 화이트리스트 + `<category>__<row>.png` 산출.
  - `files.writeText` 충돌 검사 — mtime 불일치 시 저장 안 함/`conflict` 반환, 일치·미지정 시 저장.
  - `episode:patch` read-modify-write — approve/unapprove 멱등성, stage 화이트리스트, schema_version 가드, 파일 부재 시 골격 생성.
- **e2e**(interior-studio/Phase A 패턴): 이번 범위에선 단위 중심. 드롭 저장 흐름 e2e는 여지만 남김(백로그).

## 6. 실행 방식 (하네스 팀)

콘텐츠 스튜디오 하네스 빌드와 동일 — **Opus 4.8 서브에이전트 구현자/리뷰어**, Task별 `구현→리뷰→픽스` 루프 + 전체 브랜치 최종 리뷰. `feat/episode-hub-phase-b` 브랜치에서 작업 후 main FF 머지·푸시. writing-plans로 Task 분해 후 subagent-driven-development로 집행.

## 7. 이 설계가 포기한 것 (백로그)

- **5-column 콘티 셀 직접 편집(양방향 md 파싱/직렬화)** — raw md로 먼저 출시.
- **방 렌더(Phase 0~5) 드롭 저장** — SKU 렌더 먼저. Phase 연속성(이전 Phase 컷 드래그) 포함.
- **드롭 저장 e2e** — 단위 테스트 먼저.
- **자동 저장(autosave)/undo 버퍼** — 명시적 저장 버튼으로.
- **Complete 버튼 동작(git)** — Phase C. Phase B는 활성 조건이 되는 승인 기록까지만.
- 원본 이미지 확장자 보존(현재 `.png` 고정).

## 8. 커밋·문서 동기화

- 스코프 `episode-hub`. 커밋 컨벤션 준수.
- Phase A 대비 IPC 표면 확장 → `episode-hub` README/주석에 쓰기 API 반영(있으면). `orchestrator`·헌법 자산은 이번 변경 대상 아님(앱 내부 한정).
