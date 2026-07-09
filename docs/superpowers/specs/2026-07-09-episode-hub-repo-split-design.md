# Episode Hub 레포 분리 설계

- **작성일**: 2026-07-09
- **대상**: `episode-hub/` 앱을 `nakgwan-channel-infra`(콘텐츠 레포)에서 분리해 독립 레포로 이관
- **커밋 scope**: `episode-hub`(콘텐츠 레포 정리 커밋), 신규 레포는 자체 관리

## 1. 배경 · 목적

`episode-hub`는 코드상 이미 독립 Electron 앱(자체 `package.json`·tests·e2e·build·NSIS 배포)이며, CLAUDE.md도 "two-layer 모델 밖의 독립 앱"으로 명시한다. 하지만 지금은 콘텐츠 레포 안에 in-tree로 살아 있어 **소프트웨어의 릴리즈/버전/의존성 라이프사이클이 콘텐츠(헌법 자산·orchestrator) 히스토리와 섞인다** (예: `v0.2.0` 릴리즈 태그·`package-lock` churn·dist 산출물이 콘텐츠 레포에).

목적: 앱 코드를 **독립 레포로 분리**해 릴리즈·CI·버전을 깨끗하게 관리하고, 콘텐츠 레포는 채널 내용물에 집중하게 한다. 런타임 결합(앱이 콘텐츠 폴더를 가리켜 동작)은 유지되므로 동작은 불변이다.

## 2. 확정된 결정 (brainstorming)

1. **이번엔 episode-hub만** 분리. `interior-studio`는 나중에 **같은 방식**으로 (검증된 절차 재사용).
2. **채널 숫자 기록(`episode-hub/data/channel_stats.json`)은 콘텐츠 레포에 잔류.** 모든 PC에 clone되는 곳이라 다기기 동기가 유지되고, 숫자는 본질적으로 "채널" 데이터다.
3. **작업 이력 보존** — `git subtree split`으로 `episode-hub/` 커밋 역사째 이관 (filter-repo 미설치 → subtree 사용).
4. **지금 실행** — 설계 → 계획 → 실행까지 이번 사이클.
5. **신규 레포** = `github.com/beoptimistic0228-gif/episode-hub`, **public**.
6. **커밋 이메일** = 신규 레포의 새 커밋은 `beoptimistic0228@gmail.com`(이름 "낙관" 유지). 로컬 config로 설정.

## 3. 최종 상태 (분리 후)

- **콘텐츠 레포(`nakgwan-channel-infra`)**: 에피소드·헌법 자산·orchestrator + **`episode-hub/data/`(채널 숫자 기록 저장소)**. 모든 PC에 clone.
- **앱 레포(`episode-hub`)**: Electron 앱 코드만. 설치본(exe)은 **이 레포의 GitHub Releases**에서 배포.
- **런타임 관계(불변)**: 앱은 실행 중 "가리키는 콘텐츠 폴더"의 `output/episodes/`를 읽고, 그 폴더의 git에 커밋(Complete)하며, `episode-hub/data/channel_stats.json`에 숫자를 기록하고, 그 폴더 루트에 `.mcp.json`을 쓴다. 앱 코드 위치와 무관.
- **새 PC 셋업(변화 1개)**: exe를 **앱 레포 Releases**에서 받음. 나머지 동일(콘텐츠 레포 clone → 앱 실행 → 폴더 선택 → `claude`).

## 4. 신규 앱 레포 구성

- **이관**: 콘텐츠 레포에서 `git subtree split --prefix=episode-hub -b <split>` → 신규 레포 `main`으로 push. 경로가 루트로 승격(`episode-hub/src` → `src`), `episode-hub/` 하위 파일의 커밋 이력 보존.
- **신규 레포 정리**:
  - `data/channel_stats.json` 제거 (콘텐츠 레포 소유물 — 앱은 런타임에 콘텐츠 폴더의 경로에 씀). `data/`는 앱 코드가 아니므로 신규 레포에 불필요.
  - `release/`·`out/`·`test-results/`는 이미 gitignored — 신규 레포 `.gitignore` 그대로 승계(`episode-hub/.gitignore` 존재).
  - 앱 설계문서(현재 `docs/superpowers/**episode-hub**` 15개)의 **현재본을 신규 레포 `docs/superpowers/`로 복사** (역사는 콘텐츠 레포에 잔류).
  - **자체 `CLAUDE.md`** 신설 (앱 개발 지침: 하네스 팀 방식·게이트·MCP 브리지·런타임이 콘텐츠 폴더를 가리킨다는 사실).
  - **`package.json` `build.publish`** owner/repo를 신규 레포로 (`beoptimistic0228-gif/episode-hub`).
  - **로컬 git config**: `user.name=낙관`, `user.email=beoptimistic0228@gmail.com`.
- **독립성 검증**: 신규 레포 clone 상태에서 `npm install` → typecheck·build·unit·(선택) dist가 통과해야 함(콘텐츠 레포 없이도 코드가 서는지).

## 5. 콘텐츠 레포 정리

- `episode-hub/`의 **앱 코드 제거**(`src`·`tests`·`e2e`·config·`package*.json`·`build`·`index.html` 등)하되 **`episode-hub/data/channel_stats.json`은 유지.**
  - → 설치된 **v0.2.0 앱의 `commitStats`가 쓰는 경로(`episode-hub/data/channel_stats.json`)가 그대로 살아 있어 앱을 고칠 필요 없음.**
- **CLAUDE.md 갱신**: "Repo layout"의 `episode-hub/` 항목을 "외부 레포로 이전됨(링크) + `episode-hub/data/`는 외부 앱이 기록하는 채널 통계 저장소" 로 수정. episode-hub 관련 sync/커밋 스코프 설명 조정.
- 기존 `docs/superpowers/**episode-hub**` 설계문서는 **역사로 잔류**(제거하면 얻는 것 없음).
- `.gitignore`의 `.mcp.json` 규칙 유지(앱이 여전히 콘텐츠 루트에 `.mcp.json`을 씀).

## 6. 앱 코드 변경 — 최소

- **유일 변경**: `package.json build.publish` → 신규 레포. (릴리즈 발행 대상만.)
- **무변경**: 런타임 git 작업(`completeEpisode`·`commitStats`)은 `resolveGitRoot(콘텐츠 폴더)` 기반이라 레포 이름과 무관. `DEFAULT_ROOT`/sibling 기본값은 폴더 선택·저장 config로 이미 대체 가능 → 설치된 v0.2.0 포함 정상 동작.

## 7. 실행 순서 · 검증

1. 콘텐츠 레포에서 `subtree split` 브랜치 생성.
2. 신규 GitHub 레포 생성(`beoptimistic0228-gif/episode-hub`, public; REST API — gh 미설치).
3. split 브랜치를 신규 레포 `main`으로 push (이력 보존 확인).
4. 신규 레포 클론(별도 경로) → `data/` 제거·docs 복사·CLAUDE.md 추가·publish 대상 수정·로컬 이메일 설정 → 커밋.
5. **신규 레포 게이트**: `npm install`·typecheck 0·build OK·unit 그린 (독립 동작 확인).
6. 콘텐츠 레포: `episode-hub/` 앱 코드 제거(+`data/` 유지) + CLAUDE.md 갱신 커밋·푸시.
7. **양쪽 확인**: (a) 설치된 앱이 콘텐츠 폴더 가리켜 정상(브리지·통계 기록·Complete) (b) 신규 레포 빌드/테스트 OK.

## 8. 리스크 · 열린 질문

- **이관 이력의 작성자 이메일**: subtree는 원 작성자 보존 → 옛 커밋은 `cllisd3782@gmail.com`으로 남음. 새 커밋만 `beoptimistic0228@gmail.com`. 전체 재작성은 filter-repo 필요(미설치) — 기본은 재작성 안 함.
- **GitHub 커밋 귀속**: 새 커밋이 계정에 표시되려면 `beoptimistic0228@gmail.com`이 `beoptimistic0228-gif` 계정 이메일 목록에 등록돼야 함(Owner 1회 확인).
- **설계문서 이력 분할**: 신규 레포엔 현재본만(역사는 콘텐츠 레포). 허용.
- **기존 v0.2.0 릴리즈**: 콘텐츠 레포에 잔류(역사). 향후 릴리즈는 신규 레포에서. 새 PC 셋업 안내를 신규 레포 Releases로 갱신. (원하면 v0.2.0을 신규 레포에도 재발행 가능 — 선택.)
- **콘텐츠 레포 히스토리에 앱 파일이 남음**: 제거는 HEAD 이후만 정리(과거 커밋엔 앱 파일 존재). 정상 — 완전 삭제는 히스토리 재작성 필요, 불필요.
- **외부 액션(레포 생성·push·발행)**: 실행 계획에서 Owner 승인 게이트로 다룸.
