# episode-hub 배포 이식성 (어느 PC든 MCP 동작) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. ⚠️ Tasks 3–4 are controller-executed (수동 설치 스모크 + 외부 발행 승인 게이트) — not code subagent tasks.

**Goal:** 새 PC에서 빌드 없이 MCP 브리지를 동작시킨다 — NSIS 설치본을 1회 빌드해 GitHub Release로 배포하고, 패키지 첫 실행에서 폴더 선택 즉시(재시작 없이) `.mcp.json`이 생성되게 한다.

**Architecture:** `.mcp.json` 쓰기를 부팅 1회에서 **루트 확정 시점(부팅 해석·폴더 선택)마다** 실행하는 `syncMcpJson(root, token)`으로 옮긴다. 포트는 고정 `MCP_PORT`, 토큰은 idempotent라 브리지 상태와 무관하게 쓸 수 있다. 그 뒤 `npm run dist`로 exe를 만들고, 패키지 모드 스모크로 deps 포함을 실증한 뒤 GitHub Release로 발행한다(승인 게이트).

**Tech Stack:** Electron 31, electron-builder 26(NSIS), TypeScript, `@modelcontextprotocol/sdk`.

## Global Constraints

- `.mcp.json` 쓰기 포트 = `MCP_PORT`(7801 고정), 토큰 = `loadOrCreateToken`(idempotent). 브리지 실제 포트를 스레딩하지 않는다.
- `.mcp.json`·토큰은 PC별 독립·gitignored — 커밋 금지. 발행물(exe)은 `release/`(gitignored) — 커밋 금지.
- 브리지는 **앱 생존 중에만**(E1 접근 A 유지) — 독립 서버로 만들지 않는다.
- 외부 발행(GitHub Release)은 **빌드·스모크 후 Owner 명시적 승인 뒤에만**. 자동 발행 금지.
- 버전 `0.1.0 → 0.2.0`, 태그 `v0.2.0`. 커밋 scope=`episode-hub`.
- 게이트: typecheck 0 · build OK · 기존 unit 96 회귀 없음 · e2e(기존 ⑨ 1건은 알려진 pre-existing, E1/이 작업 무관).

---

## File Structure

- **Modify** `episode-hub/src/main/index.ts` — 토큰을 registerIpc 전에 로드, `syncMcpJson(root, token)` 헬퍼 추가, `onRootChanged`에서 호출, 부팅 IIFE의 `.mcp.json` 쓰기 제거(브리지 시작만).
- **Modify** `episode-hub/package.json` — `version` 0.2.0, `build.publish`(github provider) 추가.
- (빌드 산출물 `episode-hub/release/EpisodeHub-Setup-0.2.0.exe` — 커밋 안 함.)

---

## Task 1: `.mcp.json`을 루트 확정 시점에 기록 (+ 버전 bump)

**Files:**
- Modify: `episode-hub/src/main/index.ts` (whenReady 배선 + 모듈 함수)
- Modify: `episode-hub/package.json` (`version`)

**Interfaces:**
- Consumes (기존): `writeMcpJson`, `loadOrCreateToken`, `MCP_PORT` (`./mcpBridge`); `resolveGitRoot` (`./git`); `startMcpBridge`, `BridgeHandle` (`./mcpServer`); `registerIpc(onRootChanged)`, `getRoot` (`./ipc`). `ipc.ts`의 `config:pickRoot`와 부팅 `discoverRoot`는 이미 `onRootChanged(root)`를 호출한다 — 이 콜백에 `.mcp.json` 쓰기를 태운다.
- Produces: 모듈 함수 `syncMcpJson(root: string, token: string): Promise<void>`.

- [ ] **Step 1: 모듈 함수 `syncMcpJson` 추가**

`episode-hub/src/main/index.ts`에서 `bootCollectStats` 함수 아래(또는 import 아래 모듈 스코프)에 추가:
```ts
// 루트가 유효해질 때마다(.mcp.json은 부팅 해석·폴더 선택 양쪽 경로에서 갱신).
// 포트는 고정 MCP_PORT, 토큰은 idempotent라 브리지 기동과 무관하게 쓸 수 있다.
async function syncMcpJson(root: string, token: string): Promise<void> {
  try {
    writeMcpJson(await resolveGitRoot(root), MCP_PORT, token);
  } catch (e) {
    // 비-git 폴더·git 미설치 등 — .mcp.json만 스킵, 앱은 정상
    console.error('[mcp-bridge] .mcp.json write skipped:', e);
  }
}
```

- [ ] **Step 2: 토큰을 registerIpc 전에 로드하고 onRootChanged에서 syncMcpJson 호출**

`app.whenReady().then(() => { ... })` 안에서 현재 `registerIpc(...)` 블록(71–76행)을 다음으로 교체:
```ts
  const mcpToken = loadOrCreateToken(join(app.getPath('userData'), 'mcp-bridge.json'));

  registerIpc((root) => {
    stopWatcher?.();
    stopWatcher = startWatcher(root, () => {
      mainWin?.webContents.send('episodes:changed');
    });
    // 루트 확정(부팅 해석·폴더 선택) 즉시 .mcp.json 기록 — 패키지 첫 실행 재시작 불필요
    void syncMcpJson(root, mcpToken);
  });
```

- [ ] **Step 3: 부팅 IIFE는 브리지 시작만(.mcp.json 쓰기 제거)**

현재 부팅 IIFE(78–88행)를 다음으로 교체(이제 `.mcp.json`은 onRootChanged가 담당):
```ts
  void (async () => {
    try {
      bridge = await startMcpBridge({ getRoot, token: mcpToken, port: MCP_PORT });
    } catch (e) {
      // 포트 사용중 등 — 브리지만 스킵, 앱은 정상 (토큰은 e에 미포함)
      console.error('[mcp-bridge] start skipped:', e);
    }
  })();
```

- [ ] **Step 4: 버전 bump**

`episode-hub/package.json`의 `"version": "0.1.0"` → `"version": "0.2.0"`.

- [ ] **Step 5: 타입체크 + 빌드**

Run: `cd episode-hub && npm run typecheck && npm run build`
Expected: typecheck 0 에러, build 성공. (미사용 import 없음 — `writeMcpJson`/`loadOrCreateToken`/`MCP_PORT`/`resolveGitRoot` 모두 여전히 사용.)

- [ ] **Step 6: 단위 회귀**

Run: `cd episode-hub && npm run test`
Expected: 기존 96 그린(이 변경은 index.ts 배선만 — 단위 대상 아님, 회귀 없음 확인).

- [ ] **Step 7: dev 기능 스모크 — 부팅 자동 기록 무회귀**

브리지가 여전히 부팅 시 `.mcp.json`을 쓰는지(soure 실행, sibling `../orchestrator` 해석) 확인:
```bash
cd episode-hub && rm -f ../.mcp.json
# 앱을 백그라운드로 띄우고(예: npx electron .) ~10s 후 확인, 확인 뒤 종료
```
Run(확인): 앱 실행 ~10s 후 `test -f ../.mcp.json && grep -q '127.0.0.1:7801' ../.mcp.json && echo OK`
Expected: `OK` (부팅 해석 경로가 onRootChanged→syncMcpJson으로 `.mcp.json` 생성). 확인 후 `taskkill //F //IM electron.exe`.
Note: 폴더 선택(pickRoot) 경로는 동일 `onRootChanged` 콜백을 타므로 같은 코드가 처리 — 이 경로의 실증은 Task 3 패키지 스모크에서 수행(다이얼로그는 헤드리스 스크립트 불가).

- [ ] **Step 8: 커밋**

```bash
cd episode-hub && git add src/main/index.ts package.json
git commit -m "feat(episode-hub): 루트 확정 시 .mcp.json 기록 + v0.2.0

.mcp.json 쓰기를 부팅 1회→onRootChanged(부팅 해석·폴더 선택)로 이동.
패키지 첫 실행에서 orchestrator 폴더 선택 즉시 생성(재시작 불필요).
포트=MCP_PORT 고정·토큰 idempotent라 브리지 상태 무관. 배포 이식성 Task 1."
```

---

## Task 2: 설치본 빌드 (`npm run dist`) + publish 설정

**Files:**
- Modify: `episode-hub/package.json` (`build.publish`)

- [ ] **Step 1: publish provider 설정 추가**

`episode-hub/package.json`의 `build` 블록에 `publish` 추가(발행은 Task 4, 설정은 지금):
```json
"publish": {
  "provider": "github",
  "owner": "beoptimistic0228-gif",
  "repo": "nakgwan-channel-infra"
}
```
(`build` 블록 내 다른 필드는 그대로. JSON 유효성 확인.)

- [ ] **Step 2: 설치본 빌드**

Run: `cd episode-hub && npm run dist`
Expected: `electron-vite build` 후 `electron-builder`가 `release/EpisodeHub-Setup-0.2.0.exe` 생성. 빌드 로그에 nsis 타겟 성공.
Run(확인): `ls -la release/EpisodeHub-Setup-0.2.0.exe`
Expected: exe 존재, 크기 수십~수백 MB 범위(Electron 런타임 포함).

- [ ] **Step 3: 패키지에 런타임 deps 포함 확인**

main은 externalize라 `@modelcontextprotocol/sdk`·`zod`가 패키지에 있어야 한다. asar 내용 확인:
```bash
cd episode-hub && npx asar list "release/win-unpacked/resources/app.asar" | grep -E "@modelcontextprotocol/sdk/package.json|/zod/package.json" | head
```
Expected: 두 패키지 경로가 출력됨(포함 확인). 없으면 `build.files`에 `node_modules` 포함 규칙 조정 또는 `asarUnpack` 검토 후 재빌드.
(런타임 실증은 Task 3 스모크가 최종 확인.)

- [ ] **Step 4: 커밋 (publish 설정만 — exe는 gitignored)**

```bash
cd episode-hub && git add package.json
git commit -m "chore(episode-hub): electron-builder GitHub publish 설정

release/EpisodeHub-Setup-0.2.0.exe 산출 확인. 발행은 승인 후 Task 4. 이식성 Task 2."
```

---

## Task 3: 패키지 모드 스모크 (controller 수동 — 설치·실행·MCP 클라)

**Files:** 없음(검증 전용).

설치본이 소스 실행과 달리 실제로 동작하는지(asar 경로·deps 포함·git PATH) 실증한다. 컨트롤러가 수행하고 결과를 기록.

- [ ] **Step 1: 설치본 실행**

`release/win-unpacked/Episode Hub.exe`(설치 없이 unpacked 실행) 또는 설치본을 설치 후 실행. 백그라운드로 띄운다.

- [ ] **Step 2: 브리지 + 폴더 선택 + `.mcp.json`**

- 브리지 리슨: `netstat -ano | grep :7801` → LISTENING.
- 패키지 모드는 부팅 root=null일 수 있음 → 앱 UI에서 orchestrator 폴더(clone한 레포의 `orchestrator/`) 선택 → **재시작 없이** 레포 루트에 `.mcp.json` 생성 확인(`test -f <repo>/.mcp.json`).

- [ ] **Step 3: 실 MCP 클라이언트 접속**

Task로 만든 임시 클라이언트(또는 E1 스모크와 동일 패턴)로 `.mcp.json`의 url+토큰 접속 → `list_episodes`가 실 에피소드 반환 · `read_file` raw · 무토큰 거부 확인. 확인 후 임시 스크립트 삭제·앱 종료.
Expected: 8종 tool·실데이터·인증 전부 동작 → deps 패키징·asar 경로·git PATH 실증 완료.

스모크 실패 시(deps 누락 등) Task 2 Step 3의 `files`/`asarUnpack` 조정 후 재빌드·재스모크.

- [ ] **Step 4: 결과 기록**

스모크 결과(성공/실패 항목)를 진행 원장/보고에 기록. 실패 시 원인·조치.

---

## Task 4: GitHub Release 발행 (⚠️ Owner 승인 게이트 — 외부 발행)

**Files:** 없음(발행 ops). **실행 전 반드시 Owner 명시적 승인.**

- [ ] **Step 1: Owner 승인 확인**

"릴리즈를 GitHub에 발행할까요? (공개 저장소면 exe 공개)"에 대한 명시적 승인 없이는 이 Task를 실행하지 않는다.

- [ ] **Step 2: GH_TOKEN 획득**

gh CLI 없음 → git credential에서 토큰 획득(PR 때 사용한 패턴):
```bash
printf 'protocol=https\nhost=github.com\n\n' | git credential fill
```
출력의 `password`를 `GH_TOKEN`으로 사용(로그에 노출하지 않는다).

- [ ] **Step 3: 발행**

```bash
cd episode-hub && GH_TOKEN=<token> npx electron-builder --win --publish always
```
Expected: 태그 `v0.2.0` 릴리즈 생성 + `EpisodeHub-Setup-0.2.0.exe` 업로드. (실패 시 GitHub 웹에서 수동으로 릴리즈 생성 + exe 업로드 폴백.)

- [ ] **Step 4: 릴리즈 노트 + 새 PC 셋업 절차**

릴리즈 노트에 spec §7 절차 기재: 사전요건(Git·Claude Code CLI) → 레포 clone → exe 설치 → 앱 실행·폴더 선택 → `claude`로 브리지 tool 사용.

- [ ] **Step 5: 검증**

Release 페이지에 exe 자산 존재·다운로드 가능 확인. (가능하면 다른 경로/PC에서 다운로드·설치·실행으로 최종 확인 — Owner.)

---

## Self-Review (계획 작성자 확인)

- **Spec 커버리지**: §3 코드(syncMcpJson) → Task 1 ✓. §4 빌드 → Task 2 ✓. §5 패키지 스모크 → Task 3 ✓. §6 발행 승인 게이트 → Task 4(Step 1 승인) ✓. §7 셋업 문서 → Task 4 Step 4(릴리즈 노트) ✓. §2 비목표(독립서버·토큰공유·자동업뎃) 미침범 ✓.
- **플레이스홀더**: 없음. `<token>`/`<repo>`는 런타임 치환 값으로 명시(플레이스홀더 아님).
- **타입 일관성**: `syncMcpJson(root, token)`·`mcpToken`·`MCP_PORT`·`writeMcpJson`·`loadOrCreateToken`·`resolveGitRoot`·`startMcpBridge`/`BridgeHandle` 명칭이 index.ts 정의·소비처와 일치 ✓. 버전 0.2.0 ↔ 태그 v0.2.0 ↔ artifactName `EpisodeHub-Setup-0.2.0.exe` 정합 ✓.
- **테스트 비고**: Task 1은 index.ts 엔트리 배선이라 신규 단위 없음 — 기존과 동일하게 build+e2e/smoke로 검증(dev 스모크 Step 7 + 패키지 스모크 Task 3). writeMcpJson 자체는 E1에서 단위 커버됨.
- **실행 방식 비고**: Task 1만 코드 태스크(SDD 루프 적합), Task 2~4는 controller 실행 + Task 4 승인 게이트 → **인라인 실행 권장**.
