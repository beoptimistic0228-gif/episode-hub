# episode-hub 배포 이식성 (어느 PC든 MCP 동작) 설계

- **작성일**: 2026-07-09
- **대상 앱**: `episode-hub/` (Electron, two-layer 모델 밖 독립 앱)
- **커밋 scope**: `episode-hub`
- **선행**: Phase E1(MCP 브리지 AI→앱) main 머지(`9561138`). 이 문서는 E1의 배포 이식성 후속.

## 1. 배경 · 목적

Owner는 여러 PC(집·회사)에서 작업한다. Phase E1의 MCP 브리지는 **PC마다 이미 독립적으로 동작**한다 — 토큰은 `userData`에 PC별 자동 생성, `.mcp.json`은 앱 부팅 시 레포 루트에 자동 생성(gitignored), url은 `127.0.0.1:7801` 고정. 남은 마찰은 **새 PC마다 소스를 clone→`npm install`→`npm run build` 하는 빌드 단계**다.

목표: **빌드 단계 없이** 새 PC에서 MCP 브리지를 동작시킨다. 방법은 한 PC에서 설치본(NSIS exe)을 1회 빌드해 **GitHub Release로 배포**하고, 새 PC는 설치본만 내려받아 설치한다.

에피소드 **콘텐츠는 git 레포에 있으므로 clone은 여전히 필요**하다(제거 대상 아님). 제거하는 것은 빌드다.

### 성공 기준

새 PC에서: Git + Claude Code CLI 설치(사전요건) → 레포 clone → Release exe 설치 → 앱 실행 → orchestrator 폴더 1회 선택 → `.mcp.json` 자동 생성 → 레포에서 `claude` 실행 시 `episode-hub` 브리지 tool 8종이 붙는다. **앱 재시작 없이** 폴더 선택 즉시 `.mcp.json`이 생성된다.

## 2. 스코프

- **포함**: (§3) 루트 확정 시점에 `.mcp.json`을 쓰는 코드 1건 · (§4) `npm run dist`로 NSIS exe 빌드 · (§5) 패키지 모드 스모크 검증 · (§6) GitHub Release 발행(승인 게이트) · (§7) 새 PC 셋업 절차 문서화.
- **비목표**: 앱 없이 동작하는 독립 서버(E1 접근 A 유지 — 브리지는 앱 생존 중에만) · 토큰의 PC간 공유(보안상 PC별 독립 유지) · 자동 업데이트(electron-updater) · macOS/Linux 빌드(현재 `win` NSIS만) · orchestrator 루트 자동발견 고도화(1회 폴더 선택으로 충분).

## 3. 코드 변경 — 루트 확정 시 `.mcp.json` 기록

### 문제

패키지 모드에서 `app.getAppPath()`는 설치 폴더(asar) 내부라 `resolveOrchestratorRoot`의 sibling `../orchestrator`가 clone을 못 찾고, `DEFAULT_ROOT`(하드코딩 절대경로)도 새 PC엔 없어 부팅 시 `currentRoot = null`이 된다. 브리지(7801)는 뜨지만 `writeMcpJson`은 root 필요라 스킵된다. 사용자가 폴더를 선택하면 `currentRoot`는 갱신되나 **현재 `.mcp.json`은 부팅 IIFE에서 1회만 쓰므로** 재시작 전엔 생성되지 않는다.

### 변경

`.mcp.json` 쓰기를 **orchestrator 루트가 유효해지는 모든 시점**에 수행하는 헬퍼 `syncMcpJson(root)`로 분리한다:

```
syncMcpJson(root): writeMcpJson(await resolveGitRoot(root), MCP_PORT, loadOrCreateToken(tokenFile))
```

- 포트는 프로덕션 고정 `MCP_PORT`(7801) — 브리지 실제 바인드 포트를 스레딩할 필요 없음(테스트만 port 0).
- 토큰은 `loadOrCreateToken` idempotent — 같은 토큰 재사용.
- 호출 지점: (a) 부팅 시 root 유효하면, (b) `onRootChanged`(폴더 선택·저장 루트 로드로 root가 바뀔 때 — `index.ts`가 `registerIpc`에 넘기는 콜백, 이미 watcher 재시작에 쓰임). `resolveGitRoot` 실패(비-git 폴더)는 비치명적(`.mcp.json` 스킵, 로그).

이로써 폴더 선택 즉시 `.mcp.json`이 생성/갱신된다. 부팅 IIFE의 기존 write는 이 헬퍼로 대체한다(중복 로직 제거).

## 4. 설치본 빌드

- `package.json`의 `build` 블록은 이미 완비: appId `com.nakgwan.episode-hub`, NSIS 원클릭(`oneClick:true`, `perMachine:false`), 아이콘 `build/icon.png`, 산출 `release/EpisodeHub-Setup-${version}.exe`, `files: out/**`.
- `npm run dist`(= `electron-vite build && electron-builder --win`) 실행 → `release/`에 exe.
- **의존성 포함 확인**: main은 electron-vite `externalizeDepsPlugin`으로 deps를 번들 안 함 → 런타임에 `node_modules`에서 require. electron-builder가 프로덕션 `dependencies`(`@modelcontextprotocol/sdk`,`zod`)를 자동 패키징하는지 **패키지 모드 스모크(§5)에서 실증**한다.
- **버전 bump**: `0.1.0 → 0.2.0` (MCP 브리지 마일스톤 릴리즈). `package.json` version + 릴리즈 태그 `v0.2.0`.

## 5. 검증 — 패키지 모드 스모크

`npx electron .`(소스 실행)과 설치된 exe는 다르다(asar 경로·node_modules 포함·`git` PATH 의존). 설치본을 실제 설치·실행해 확인:

1. 설치본 실행 → 브리지 `127.0.0.1:7801` LISTENING.
2. orchestrator 폴더 선택 → 레포 루트에 `.mcp.json` 생성(재시작 없이).
3. 실 MCP 클라이언트로 `.mcp.json`의 url+토큰 접속 → `list_episodes`가 실 에피소드 반환, `read_file` raw, 무토큰 거부.
4. `@modelcontextprotocol/sdk`/`zod`가 패키지에 포함돼 main이 크래시 없이 브리지 기동(위 1이 곧 증거).

스모크 실패 시(예: deps 누락) electron-builder `files`/`asarUnpack` 조정.

## 6. GitHub Release 발행 — 승인 게이트

- gh CLI 없음. **electron-builder GitHub publisher** 사용: `build.publish`에 `github` provider 추가, `GH_TOKEN`은 `git credential fill`로 획득(PR 생성 때 검증된 패턴), `electron-builder --win --publish always`로 Release 생성 + exe 업로드. (대안: GitHub 웹 수동 업로드.)
- **외부 공개 발행**이다(공개 저장소면 exe·릴리즈가 공개). 빌드·스모크까지 마친 뒤 **실제 발행 직전 Owner 명시적 승인**을 받는다(자동 발행 금지).
- 태그 `v0.2.0`, 릴리즈 노트에 "새 PC 셋업" 절차 요약 + E1 브리지 요약.

## 7. 새 PC 셋업 절차 (문서)

셋업 절차는 이 spec + 릴리즈 노트에 명시한다(별도 문서는 구현 중 가독성상 필요하면 `episode-hub/setup/`에 추가 — 프로젝트 규칙상 README 임의생성 지양, 요청 시/필요 시만).

절차:
1. **사전요건**: Git for Windows, Claude Code CLI 설치.
2. 레포 clone (콘텐츠 + git 루트용).
3. GitHub Release에서 `EpisodeHub-Setup-<v>.exe` 다운로드·설치.
4. 앱 실행 → 최초 1회 orchestrator 폴더(clone한 레포의 `orchestrator/`) 선택 → `.mcp.json` 자동 생성.
5. 레포에서 `claude` 실행 → `episode-hub` 브리지 tool 8종 사용. (앱이 켜져 있는 동안 유효.)

## 8. 리스크 · 열린 질문

- **패키지 deps 포함**: electron-builder 기본이 프로덕션 deps를 포함하지만, externalize된 main에서 실패 시 `asarUnpack`/`files` 조정 필요 — §5 스모크로 실증.
- **`git` PATH 의존**: 브리지/앱이 `git`을 shell-out(git.ts). 새 PC에 Git 필수(사전요건 문서화). 없으면 git 관련 tool만 실패(비치명적).
- **`GH_TOKEN` 획득**: git credential에 GitHub 자격이 있어야 함(PR 때 사용됨). 없으면 웹 수동 업로드 폴백.
- **버전/태그 관리**: 이후 릴리즈마다 version bump + 태그 규칙(별도 정형화는 범위 밖).
