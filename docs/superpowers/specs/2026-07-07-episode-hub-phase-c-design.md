# Episode Hub — Phase C: git 동기화 설계

- 날짜: 2026-07-07
- 상태: Owner(낙관) 설계 승인 완료
- 상위 설계: `2026-07-05-episode-hub-design.md` §4-4 (Git 동기화) · §5 구현 순서 Phase C
- 선행 완료: Phase A(읽기) · Phase B(쓰기 — md 편집·렌더 드롭·승인/stage), main 머지됨

## 1. 배경 (왜)

이 레포를 클론해 쓰는 다중 사용자(기본 경로 `C:\nakgwan-channel-infra\orchestrator`)가 같은 콘텐츠를 협업하려면 앱이 git 동기화를 내장해야 한다(상위 스펙 §1). Phase C는 앱 안에서 ① 실행 시 자동 최신화(FF-pull) ② 수동 Update ③ 에피소드 완료 커밋·푸시를 제공한다. 비개발자(부부)가 터미널 없이 동기화하도록 하는 것이 목표.

## 2. 범위 (Owner 확정)

| 결정 | 값 |
|---|---|
| git 연동 방식 | **시스템 git 직접 호출** (main `execFile`, 신규 런타임 의존성 0). simple-git 미도입 |
| Complete 커밋 범위 | **`output/episodes/<ep>/`만** (이미지는 gitignore로 자동 제외) |
| Complete 활성 조건 | 해당 EP 폴더에 **미커밋 변경**이 있을 때 (`status --porcelain` 필터) |
| 자동 pull | 실행 시 fetch 후 **behind>0 & ahead==0 & clean일 때만** `pull --ff-only` |

**백로그(이번 범위 아님):** data/*.json 도장 스캔 커밋 범위 · 그룹별 완료 게이트(렌더 전량·콘티 FINAL·검증 PASS) · board.json 연동 · 이미지 공유(gitignore라 push로 안 감).

## 3. 아키텍처

git 루트 ≠ orchestrator 루트: orchestrator 루트는 git 저장소의 **하위**(`<gitRoot>/orchestrator`)다. 모든 git 명령은 git 루트에서 실행하며, `git -C <orchestratorRoot> rev-parse --show-toplevel`로 발견·캐시한다.

데이터 흐름(Phase B와 동일 관용구): `renderer → preload(hub.git.*) → main git.ts(execFile 시스템 git) → 시스템 git`. 상태는 store가 보관하고 UI가 파생.

### 3-1. `src/main/git.ts` (신규 — 순수 함수, orchestratorRoot 인자)

- `resolveGitRoot(orchestratorRoot): string` — `git -C <root> rev-parse --show-toplevel`. 실패 시 throw(비-git 폴더). 모듈 캐시.
- `fetchStatus(orchestratorRoot): GitStatus` — `git fetch`(네트워크; 실패해도 로컬 상태는 반환) → `git rev-list --count --left-right @{upstream}...HEAD`로 `{ahead, behind}` → `git status --porcelain`로 `dirty` + 변경 경로 목록 → `git rev-parse --abbrev-ref HEAD`로 `branch`. 산출 `GitStatus`:
  - `state`: `'clean'`(0/0) | `'behind'`(behind>0,ahead==0) | `'ahead'`(ahead>0,behind==0) | `'diverged'`(둘 다>0) | `'error'`(git/upstream 없음·명령 실패)
  - `ahead`,`behind`,`dirty`,`branch`,`changedPaths: string[]`(git 루트 상대, POSIX), `message?`(에러/안내 사람 언어), `fetchFailed?: boolean`(오프라인 — 로컬 계산만).
- `pullFF(orchestratorRoot): { ok: true } | { ok: false; message: string }` — `git pull --ff-only`. dirty·분기면 git이 거부 → `{ok:false, message}`. **자동 병합·rebase 없음.**
- `completeEpisode(orchestratorRoot, episodeId): CompleteResult` — 순서:
  1. `assertEpisodeId(episodeId)`(pathGuard 재사용).
  2. `git add -- output/episodes/<episodeId>/` (git 루트 기준 경로; 이미지 gitignore로 자동 제외).
  3. `git diff --cached --quiet -- output/episodes/<episodeId>/` → 스테이지 비었으면 `{ ok:false, reason:'nothing' }`.
  4. `git commit -m "feat(orchestrator): <episodeId> 산출물 완료 (Episode Hub)"`.
  5. `git push`. 거부(non-FF, stderr에 `rejected`/`fetch first`) → 로컬 커밋은 유지하고 `{ ok:false, reason:'needsUpdate', message }`.
  - 성공 → `{ ok:true, pushed:true }`.
  - `CompleteResult = { ok:true; pushed:true } | { ok:false; reason:'nothing'|'needsUpdate'|'error'; message?:string }`.
- 모든 함수: `execFile('git', args, {cwd: gitRoot})` 래퍼로 stdout/stderr/exit 처리. **`--ff-only`·명시 add 경로 외 파괴적 옵션(`reset --hard`·`push --force`) 금지.**

### 3-2. IPC + preload

- `git:status` → `fetchStatus(currentRoot)` (currentRoot 미설정 시 `state:'error'`).
- `git:pull` → `pullFF(currentRoot)`.
- `git:complete(episodeId)` → `completeEpisode(currentRoot, episodeId)`.
- preload: `hub.git.status()` / `hub.git.pull()` / `hub.git.complete(id)`. 타입은 `import type`로 git.ts에서.
- `api.d.ts` 변경 불필요(HubApi 파생).

### 3-3. 자동 최신화 (main, 실행 시)

`registerIpc`의 `onRootChanged` 시점(루트 확정) 이후 1회: `fetchStatus` → `state==='behind' && !dirty`면 `pullFF` 자동 실행 → 결과와 함께 갱신된 status를 renderer로 이벤트(`git:changed`) 또는 최초 `git:status` 호출로 전달. 그 외 상태(diverged/ahead/dirty)는 **자동 조치 없이 칩만**. 네트워크 실패는 조용히 로컬 상태 표시(`fetchFailed`).

### 3-4. 렌더러

- **store**(`useHub`): `gitStatus: GitStatus | null` + 액션 `refreshGit()`(status) · `gitPull()` · `completeEpisode(id)`. 각 성공 후 `refreshGit()` + 관련 `select()` 재조회.
- **사이드바 하단**(`Sidebar.tsx`): git 상태 칩(상태별 이모지·색·텍스트 — 🟢 최신 / 🔵 받을 것 N / 🟡 올릴 것 N / 🔴 충돌·정리 필요 / ⚠️ git 없음·오프라인) + **Update 버튼**(라벤더 세컨더리; `gitPull()` → 결과 배너). git 루트 발견 실패·오프라인은 사람 언어 안내.
- **EpisodeHeader Complete 버튼**(현재 disabled 자리표시 활성화): `gitStatus.changedPaths`에 `output/episodes/<ep>/` 하위가 ≥1건이면 활성. 클릭 → `completeEpisode(id)` → 결과 배너(성공/`needsUpdate`="Update 먼저 눌러주세요"/`error`). 화면당 primary 필 CTA 1개 룰 유지(Complete가 그 하나).

### 3-5. 에러 처리 (스펙 §4-4·§4-6 정합)

- git 미설치/비-git 폴더 → `state:'error'`, 칩 "git 사용 불가" + 설치 안내(원문 접기).
- 오프라인(fetch 실패) → 로컬 ahead/dirty만 계산, 칩에 "오프라인" 표기, 파괴적 동작 없음.
- pull 비-FF/dirty → 자동 병합 금지, "로컬 변경/분기 — 수동 처리 필요" 안내.
- push 거부 → 로컬 커밋 보존 + "Update 먼저" 안내(강제 푸시 절대 없음).
- 인증 실패 → 사람 언어 + GitHub 인증 구성 안내.

## 4. 테스트

- **vitest 단위**(`git.ts`, 실제 임시 git 저장소 + 로컬 bare 원격으로 실동작):
  - `resolveGitRoot` — orchestrator 하위 루트에서 git 루트 발견 / 비-git 폴더 throw.
  - `fetchStatus` — clean/ahead/behind/diverged/dirty 각 상태 산출 + changedPaths가 EP 경로 포함.
  - `pullFF` — behind면 FF 성공 / dirty·diverged면 거부(작업트리 무변).
  - `completeEpisode` — EP 폴더만 스테이징(다른 EP·data 제외) · 이미지 제외(gitignore) · 커밋 메시지 정확 · bare 원격에 push 반영 · 원격이 앞서면 `needsUpdate`(로컬 커밋 보존) · 변경 없으면 `nothing`.
- **Playwright-Electron GUI 스모크 확장**(`e2e/hub.e2e.ts`): 픽스처 루트를 git init + bare 원격 연결로 구성 → 앱 부팅 후 사이드바 git 칩이 상태 표시 / Update 버튼 클릭 동작 / (가능하면) 미커밋 EP에서 Complete 활성·커밋 반영. GUI로 자동화 곤란한 부분은 IPC 직접 호출로 검증(interior-studio 패턴).

## 5. 실행 방식 (하네스 팀)

Phase B와 동일 — Opus 서브에이전트 구현자/리뷰어, Task별 구현→리뷰→픽스 루프 + 최종 전체브랜치 리뷰 + 실 Electron GUI 스모크. `feat/episode-hub-phase-c` 브랜치 → main FF 머지·푸시. subagent-driven-development로 집행. (⚠️ 이 환경 Agent model = opus/haiku만, sonnet 불가.)

## 6. 이 설계가 포기한 것 (백로그)

- **data/*.json 도장 스캔 커밋 범위** — 각 JSON을 읽어 episode_id 도장을 확인하는 복잡·오탐 위험. EP 폴더만 커밋.
- **그룹별 완료 게이트**(렌더 전량·콘티 FINAL·검증 PASS) — 주관적·불완전. 활성은 단순 "변경 있음"으로.
- **자동 머지·충돌 해결·rebase·force push** — 비개발자 레포를 앱이 임의 병합하지 않는다(스펙 §7 불변).
- **board.json 연동 / 이미지 공유(LFS·클라우드)** — 별도 후속.

## 7. 문서 동기화

- 스코프 `episode-hub`. 커밋 컨벤션 준수. Complete 커밋 메시지는 `orchestrator` 스코프(산출물 대상이 orchestrator 트리이므로) — 앱이 생성하는 자동 커밋 메시지 규약.
