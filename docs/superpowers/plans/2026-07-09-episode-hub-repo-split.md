# Episode Hub 레포 분리 Implementation Plan

> **For agentic workers:** 대부분 controller 실행(git 이관 + 외부 레포 생성/푸시 + 신규 레포 빌드 검증)이라 **인라인 실행** 권장. 외부 액션(레포 생성·push)은 실행 직전 announce.

**Goal:** `episode-hub/` 앱을 콘텐츠 레포에서 이력 보존하며 독립 레포(`beoptimistic0228-gif/episode-hub`, public)로 분리하고, 콘텐츠 레포엔 `episode-hub/data/`(채널 통계)만 남긴다. 설치된 v0.2.0 앱은 무수정으로 계속 동작.

**Architecture:** `git subtree split --prefix=episode-hub`로 앱 폴더 커밋 이력을 추출 → 신규 GitHub 레포 main으로 push → 신규 레포에서 정리(불필요 data 제거·docs 복사·CLAUDE.md·publish 대상 변경·커밋 이메일)·독립 빌드 검증 → 콘텐츠 레포에서 앱 코드 제거(`data/` 유지)·CLAUDE.md 갱신. 런타임 결합(앱이 콘텐츠 폴더를 가리킴)은 코드 변경 없이 유지.

**Tech Stack:** git subtree(≈filter-repo 대체, 이 PC에 filter-repo 없음), GitHub REST API(gh CLI 없음), electron-vite/vitest.

## Global Constraints

- 신규 레포 = `github.com/beoptimistic0228-gif/episode-hub`, **public**. 소유 계정 = `beoptimistic0228-gif`(git credential 인증).
- **이력 보존**: subtree split(옛 커밋 작성자 그대로 = `낙관 <cllisd3782@gmail.com>`). 신규 레포 **새 커밋만** `user.email=beoptimistic0228@gmail.com`(name=낙관, 로컬 config).
- **콘텐츠 레포에 `episode-hub/data/channel_stats.json` 유지** — 설치된 v0.2.0 `commitStats` 경로. 이 파일 외 episode-hub 앱 코드는 제거.
- **앱 코드 변경은 신규 레포에서 `build.publish` repo명(`nakgwan-channel-infra`→`episode-hub`) 하나뿐.** 런타임 git 작업은 무변경.
- 신규 레포 클론 위치 = `D:\05_Project\episode-hub`.
- 외부 액션(레포 생성·push·정리 push)은 되돌리기 어렵거나 외부노출 → 각 직전 announce. 토큰은 로그에 출력 금지.

---

## File Structure

- 신규 레포(`D:\05_Project\episode-hub`): subtree 결과(루트로 승격된 `src/`·`tests/`·`e2e/`·config·`package.json`·`build/`·`index.html`·`.gitignore`) + 신규 `docs/superpowers/`(콘텐츠 레포에서 복사) + 신규 `CLAUDE.md`. `data/`는 제거.
- 콘텐츠 레포(`nakgwan-channel-infra`): `episode-hub/`는 `data/channel_stats.json`만 잔류. `CLAUDE.md` 갱신. 기존 `docs/superpowers/**episode*` 문서는 역사로 잔류.

---

## Task 1: subtree split + 신규 GitHub 레포 생성 + 이력 push

**Files:** 없음(콘텐츠 레포에 임시 브랜치 `episode-hub-split` 생성; 커밋 없음).

- [ ] **Step 1: 최신 main 확인**

Run: `cd "D:\03_Personal\99_Study\nakgwan-channel-infra" && git checkout main && git pull --ff-only && git status -sb | head -1`
Expected: main, clean, origin 동기.

- [ ] **Step 2: subtree split (이력 추출)**

Run: `git branch -D episode-hub-split 2>/dev/null; git subtree split --prefix=episode-hub -b episode-hub-split`
Expected: `episode-hub-split` 브랜치 생성, 마지막 줄에 split HEAD SHA 출력. (episode-hub/ 하위만, 경로 루트 승격.)
검증: `git ls-tree --name-only episode-hub-split | sort` → `src tests e2e build data index.html package.json package-lock.json .gitignore tsconfig.json tsconfig.node.json electron.vite.config.ts playwright.config.ts vitest.config.ts` 류가 **루트에** 보임(‘episode-hub/’ 접두어 없이).

- [ ] **Step 3: 신규 GitHub 레포 생성 (외부 액션 — announce 후)**

Run:
```bash
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
curl -s -X POST -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d '{"name":"episode-hub","private":false,"description":"누구의 공간 에피소드 허브 데스크톱 앱 (Electron). 콘텐츠 레포(nakgwan-channel-infra)를 가리켜 동작."}' \
  | grep -E '"full_name"|"html_url"|"clone_url"|"message"' | head -6
```
Expected: `"full_name": "beoptimistic0228-gif/episode-hub"` + `clone_url`. 이미 있으면 `"message":"...name already exists..."` → Step 4로(그 레포 사용).

- [ ] **Step 4: split 브랜치를 신규 레포 main으로 push (외부 액션)**

Run: `git push https://github.com/beoptimistic0228-gif/episode-hub.git episode-hub-split:main`
Expected: 신규 레포 main에 이력 푸시 성공(credential manager 인증). 실패 시 `https://<user>@github.com/...`로 재시도.
검증: `curl -s -H "Authorization: token $GH_TOKEN" https://api.github.com/repos/beoptimistic0228-gif/episode-hub/commits?per_page=1 | grep -c '"sha"'` → 1 이상.

- [ ] **Step 5: 임시 split 브랜치 정리**

Run: `git checkout main && git branch -D episode-hub-split`
Expected: 임시 브랜치 삭제(이미 원격에 push됨).

---

## Task 2: 신규 레포 정리 + 독립 빌드 검증

**Files (신규 레포 `D:\05_Project\episode-hub`):**
- 제거: `data/`(channel_stats.json)
- 생성: `docs/superpowers/**`(콘텐츠 레포에서 복사), `CLAUDE.md`
- 수정: `package.json`(`build.publish.repo`)

- [ ] **Step 1: 클론 + 로컬 커밋 신원**

```bash
git clone https://github.com/beoptimistic0228-gif/episode-hub.git "D:/05_Project/episode-hub"
cd "D:/05_Project/episode-hub"
git config user.name "낙관"
git config user.email "beoptimistic0228@gmail.com"
```
Expected: 클론 성공, 루트에 `src/ tests/ package.json ...`(episode-hub 접두어 없음). 로컬 email 설정.

- [ ] **Step 2: 불필요 `data/` 제거**

Run: `cd "D:/05_Project/episode-hub" && git rm -r data && echo removed`
Expected: `data/channel_stats.json` 제거(신규 레포는 런타임에 콘텐츠 레포 경로에 통계 기록 — 앱 코드 아님).

- [ ] **Step 3: episode-hub 설계문서 복사**

```bash
cd "D:/05_Project/episode-hub"
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp "D:/03_Personal/99_Study/nakgwan-channel-infra/docs/superpowers/specs/"*episode*  docs/superpowers/specs/
cp "D:/03_Personal/99_Study/nakgwan-channel-infra/docs/superpowers/plans/"*episode*  docs/superpowers/plans/
ls docs/superpowers/specs docs/superpowers/plans
```
Expected: 17개 문서(specs 10 + plans 7) 복사됨(현재본; 역사는 콘텐츠 레포 잔류).

- [ ] **Step 4: publish 대상 레포 변경**

`D:/05_Project/episode-hub/package.json`의 `build.publish.repo`를 `"nakgwan-channel-infra"` → `"episode-hub"`로 수정(owner `beoptimistic0228-gif` 유지).
검증: `node -e "const p=require('./package.json');console.log(p.build.publish)"` → `{provider:'github', owner:'beoptimistic0228-gif', repo:'episode-hub', releaseType:'release'}`.

- [ ] **Step 5: 신규 레포 CLAUDE.md 작성**

`D:/05_Project/episode-hub/CLAUDE.md` 생성:
```markdown
# CLAUDE.md — Episode Hub

## 무엇인가
**Episode Hub** = "누구의 공간" 채널 산출물(에피소드)을 열람·편집하는 독립 Electron 앱(electron-vite + React + TS + zustand). 원래 `nakgwan-channel-infra` 콘텐츠 레포 안에 있던 것을 2026-07-09 독립 레포로 분리(이력 보존). **채널 인프라(헌법 자산)가 아니라 그것을 소비하는 도구.**

## 콘텐츠와의 관계 (중요)
이 앱은 **자기 안에 콘텐츠를 갖지 않는다.** 실행 시 사용자가 고른 **orchestrator 폴더**(= `nakgwan-channel-infra`를 clone한 곳의 `orchestrator/`)를 가리켜 `output/episodes/`를 읽고, 그 폴더의 git에 커밋(Complete)하며, `episode-hub/data/channel_stats.json`(콘텐츠 레포)에 통계를 기록하고, 그 레포 루트에 `.mcp.json`을 쓴다. 즉 **콘텐츠 레포를 별도로 clone**해야 하고, 앱은 그 위치를 폴더 선택/저장 config로 안다.

## 개발
- `npm install` → `npm run dev`(electron-vite) / `npm run build` / `npm run test`(vitest) / `npm run test:e2e`(Playwright-Electron) / `npm run typecheck` / `npm run dist`(NSIS exe).
- 게이트: unit 그린 · typecheck 0 · build OK · e2e 그린.
- 개발 방식: 하네스 팀(서브에이전트 구현→리뷰→픽스) — 스펙은 `docs/superpowers/specs`, 계획은 `docs/superpowers/plans`.
- 배포: `npm run dist` → `release/EpisodeHub-Setup-<v>.exe` → GitHub Release(`build.publish`=이 레포).

## MCP 브리지 (AI→앱, v0.2.0)
앱 기동 시 `127.0.0.1:7801`에 HTTP MCP 서버(Bearer 토큰, gitignored `.mcp.json` 자동생성). tool 8종으로 Claude Code가 에피소드 읽기/쓰기. `src/main/mcpBridge.ts`·`mcpServer.ts`.

## 다음
- 이미지 공유(Google Drive 동기 폴더 — `imageRoot` per-PC 설정): `docs/superpowers/specs/2026-07-09-episode-hub-image-sync-design.md`.
- Phase E2(앱→AI).
```

- [ ] **Step 6: 독립 빌드·테스트 검증**

Run: `cd "D:/05_Project/episode-hub" && npm install > /dev/null 2>&1 && npm run typecheck && npm run build > /dev/null 2>&1 && echo BUILD_OK && npm run test 2>&1 | tail -4`
Expected: typecheck 0 · `BUILD_OK` · unit 그린(96). **콘텐츠 레포 없이 코드가 독립적으로 서는지 확인.**

- [ ] **Step 7: 커밋 + push**

```bash
cd "D:/05_Project/episode-hub" && git add -A
git commit -m "chore: 독립 레포로 분리 정리 — data 제거·docs 복사·CLAUDE.md·publish 대상

nakgwan-channel-infra에서 subtree split로 이력 보존 이관 후 정리.
publish 대상을 이 레포로. 채널 통계·콘텐츠는 콘텐츠 레포 소관."
git push origin main
```
Expected: 신규 레포에 정리 커밋 push(작성자 `낙관 <beoptimistic0228@gmail.com>`).

---

## Task 3: 콘텐츠 레포 정리 (앱 코드 제거, data 유지)

**Files (콘텐츠 레포):**
- 제거: `episode-hub/`의 앱 코드(src·tests·e2e·configs·package*·build·index.html·.gitignore)
- 유지: `episode-hub/data/channel_stats.json`
- 수정: `CLAUDE.md`(Repo layout의 episode-hub 항목)

- [ ] **Step 1: 앱 코드 제거하되 data 유지**

```bash
cd "D:/03_Personal/99_Study/nakgwan-channel-infra"
git rm -r episode-hub
git checkout HEAD -- episode-hub/data/channel_stats.json
git status --short | head
```
Expected: `episode-hub/` 대량 삭제 스테이지 + `episode-hub/data/channel_stats.json`은 삭제 취소되어 유지. 검증: `git ls-files episode-hub/` → `episode-hub/data/channel_stats.json` **한 줄만**.
Note: gitignored 잔여(`out/`·`release/`·`node_modules/`·`test-results/`)는 추적 대상 아님 → 디스크에 남아도 무해(원하면 수동 삭제).

- [ ] **Step 2: 콘텐츠 레포 CLAUDE.md 갱신**

`CLAUDE.md`의 "Repo layout" 내 `episode-hub/` 줄을 아래 취지로 교체:
```
episode-hub/          → 2026-07-09 독립 레포로 분리: github.com/beoptimistic0228-gif/episode-hub
                        (설치본 exe로 사용). 이 폴더엔 앱이 기록하는 채널 통계
                        data/channel_stats.json 만 잔류(다기기 git 동기용). 앱 코드·스펙은 외부 레포.
```
그리고 episode-hub를 "독립 앱"으로 서술한 다른 문단(two-layer 섹션 등)에 "외부 레포로 분리됨" 한 줄 주석 추가. QA 하네스(team-qa)가 episode-hub를 대상으로 한 서술은 "외부 레포에서 수행" 취지로 조정(전면 재작성 아님 — 포인터만).

- [ ] **Step 3: 커밋 + push**

```bash
cd "D:/03_Personal/99_Study/nakgwan-channel-infra" && git add -A
git commit -m "chore(episode-hub): 앱 코드 외부 레포로 분리 — data(통계)만 잔류

episode-hub 앱을 github.com/beoptimistic0228-gif/episode-hub로 분리(이력 보존).
콘텐츠 레포엔 앱이 기록하는 data/channel_stats.json만 남김(설치 앱 무수정 동작).
CLAUDE.md Repo layout 갱신.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin main
```
Expected: 콘텐츠 레포 정리 커밋 push. `episode-hub/data/channel_stats.json` 추적 유지 확인.

---

## Task 4: 양쪽 최종 검증

**Files:** 없음.

- [ ] **Step 1: 신규 레포 독립성**

Run: `cd "D:/05_Project/episode-hub" && git log --oneline -3 && npm run build > /dev/null 2>&1 && echo OK`
Expected: 이력에 Phase A~E1 옛 커밋 존재(보존) + 정리 커밋(HEAD) + `OK`.

- [ ] **Step 2: 콘텐츠 레포 통계 경로 생존**

Run: `cd "D:/03_Personal/99_Study/nakgwan-channel-infra" && git ls-files episode-hub/ && test -f episode-hub/data/channel_stats.json && echo STATS_OK`
Expected: `episode-hub/data/channel_stats.json` + `STATS_OK`. (설치된 v0.2.0 앱의 commitStats 경로 생존.)

- [ ] **Step 3: 설치 앱 동작 스모크 (선택 — Owner)**

설치된 v0.2.0 앱 실행 → orchestrator 폴더(콘텐츠 레포) 가리켜 브리지 7801·통계 기록·Complete 정상 확인. (코드 무변경이라 회귀 없음 예상.)

- [ ] **Step 4: 마무리**

메모리(`project_episode_hub`) 갱신: 분리 완료·신규 레포 URL·콘텐츠 레포 잔류물(data)·다음 이미지 공유는 신규 레포에서. `interior-studio` 분리는 동일 절차 재사용 가능하다고 기록.

---

## Self-Review (계획 작성자 확인)

- **Spec 커버리지**: 분리 spec §4(신규 레포 구성=subtree·data제거·docs복사·CLAUDE.md·publish·이메일) → Task 1·2 ✓. §5(콘텐츠 정리·data 유지·CLAUDE.md) → Task 3 ✓. §6(앱 변경=publish만) → Task 2 Step 4 ✓. §7(실행 순서) → Task 순서 ✓. §8(이력 작성자·GitHub 이메일 등록·외부 액션 게이트) 반영 ✓.
- **플레이스홀더**: 없음. `<v>`/`<user>`/`<token>`은 런타임 값.
- **일관성**: 신규 레포명 `episode-hub`·owner `beoptimistic0228-gif`·클론 `D:\05_Project\episode-hub`·유지 파일 `episode-hub/data/channel_stats.json`이 전 Task 동일 ✓.
- **되돌리기**: 신규 레포/푸시는 외부지만 삭제 가능. 콘텐츠 레포 정리는 커밋이라 revert 가능. 원 이력은 콘텐츠 레포에 그대로 남아 안전망.
- **실행 방식**: git 이관+외부 생성+검증 → **인라인 실행** 권장, 외부 액션 직전 announce.
