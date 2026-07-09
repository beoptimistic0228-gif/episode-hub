# episode-hub Phase E1 — MCP 브리지 (AI→앱) 설계

- **작성일**: 2026-07-09
- **대상 앱**: `episode-hub/` (Electron, two-layer 모델 밖 독립 앱)
- **커밋 scope**: `episode-hub`
- **선행**: Phase A~D+ 완료 (main 머지). 이 spec은 Phase E의 첫 하위 시스템(E1).

## 1. 배경 · 목적

episode-hub와 Claude Code는 현재 **파일을 통해서만** 간접 결합돼 있다 — Claude Code가 `output/episodes/<ep>/`에 파일을 쓰면 앱이 chokidar로 감지해 갱신한다. AI가 앱의 상태를 **직접** 읽거나 앱의 검증된 쓰기 경로(승인 게이트·git Complete 등)를 **직접** 호출할 수단은 없다.

Phase E는 발표자료(`08-lecture/nakgwan-system/` 슬라이드 2-2)가 프레이밍한 **"MCP = AI와 앱을 잇는 다리"** 서사를 실제 동작으로 구현한다. Owner가 택한 최종 방향은 **진짜 양방향**(AI→앱 + 앱→AI)이며, 이 spec은 그중 **E1 = AI→앱**만 다룬다.

### 성공 기준

터미널에서 실행한 Claude Code가 episode-hub가 켜진 상태에서:
1. 현재 에피소드 목록·단계·상세를 **직접 조회**하고,
2. 스테이지 전진·승인 게이트·파일 저장·git Complete를 **직접 수행**하며,
3. 그 결과가 앱 UI에 **자동 반영**된다 (기존 watcher 경유).

## 2. 스코프 · 분할

양방향은 두 독립 시스템이므로 한 spec에 담지 않는다.

- **E1 (이 spec) — AI→앱**: episode-hub가 HTTP MCP 서버를 내장해 tool을 노출. Claude Code가 MCP 클라이언트로 접속. Owner 동작 요구 중 **①읽기 · ②쓰기/승인**을 커버.
- **E2 (다음 사이클 · 별도 spec) — 앱→AI**: 앱이 headless `claude`를 spawn해 파이프라인/질의를 구동하고 결과를 UI에 스트리밍. Owner 동작 요구 중 **③앱에서 AI 실행 · ④앱에서 AI 질문**을 커버. **E1의 HTTP 서버를 토대로 재사용**한다 (앱이 spawn한 Claude Code도 같은 서버에 붙어 앱 상태를 읽고 쓴다).

접근 A(앱 내장 HTTP 서버)를 택한 핵심 이유가 이 분할을 가능하게 한다 — E1 서버 하나가 양방향 모두의 뼈대가 된다.

### 명시적 비목표 (E1)

- 앱이 AI를 구동하는 기능 (→ E2).
- AI가 외부 네트워크 API를 호출하는 tool (예: `stats:refresh`의 유튜브/네이버 수집). $0 제약·서사 밖. 채널 통계 **수집**은 앱 수동 갱신으로 유지하고, tool은 **읽기(`readStats`)만** 노출.
- 5-column 콘티 셀 직접 편집·방 렌더 Phase 드롭 등 기존 코드 백로그 (무관).

## 3. 아키텍처

### 배치

```
┌───────────────────────────┐
│ episode-hub (Electron)     │
│  ├ renderer (UI)           │
│  ├ main/ipc.ts   ─┐        │
│  └ main/mcpServer.ts ─┼─▶ scanner/writer/git/statsFetcher (pure fn + 가드)
│         ▲          ─┘        │
└─────────┼───────────────────┘
          │ HTTP 127.0.0.1:PORT (Bearer token)
          │
   claude (터미널)  ── .mcp.json ──┘
```

- **`src/main/mcpServer.ts`** 신설. MCP TypeScript SDK(`@modelcontextprotocol/sdk`)의 **Streamable HTTP transport**로 `127.0.0.1:PORT`에 서버를 띄운다. 신규 런타임 의존성 1개.
- tool 핸들러는 **IPC 핸들러(`ipc.ts`)와 병렬로 동일한 순수 함수를 호출**한다 — `scanEpisodes` / `scanEpisodeDetail` / `readFileSync(safeEpisodePath)` / `readStats` / `writeText` / `patchEpisode` / `saveRender` / `completeEpisode` / `fetchStatus`. 루트는 `ipc.ts`의 `getRoot()`를 공유(단일 출처). **새 도메인 로직 0.**
- 모든 tool은 IPC가 이미 경유하는 **동일 가드**(`assertEpisodeId`, `safeEpisodePath`)를 지난다 → **새 공격면 0** (IPC가 허용하는 범위와 정확히 동일).

### UI 동기화

AI가 write tool을 실행하면 파일이 바뀌고, **기존 chokidar watcher(`main/watcher.ts`)가 감지해 renderer를 자동 갱신**한다. 추가 이벤트 배선 불필요 (YAGNI). `episode.json` 변경 → 대시보드/스테이지 갱신, md 변경 → 뷰어 갱신 모두 기존 경로 재사용.

### 생명주기

- `main/index.ts`에서 `registerIpc(...)` 직후 `startMcpServer(getRoot)` 호출, `app.on('will-quit')`에서 stop.
- 포트가 이미 사용 중이면 **비치명적**: 에러 로그 + 서버 스킵. 앱 UI·IPC·watcher는 정상 동작 (브리지만 비활성). 다리는 "앱이 켜져 있을 때만" 존재 — 채널 서사와 정합.

## 4. Tool 표면 (8종)

기존 IPC 핸들러에 1:1 매핑. 모두 `getRoot()` 미설정 시 명확한 에러 반환.

| Tool | 입력 | 매핑 함수 | 방향 | 비고 |
|---|---|---|---|---|
| `list_episodes` | — | `scanEpisodes(root, videos)` | 읽기 | 통계 videoId 병합(`readStats`) 포함 |
| `read_episode` | `id` | `scanEpisodeDetail` | 읽기 | `assertEpisodeId` |
| `read_file` | `id`, `relPath` | `readFileSync(safeEpisodePath)` | 읽기 | 경로 탈출 차단 |
| `get_channel_stats` | — | `readStats(gitRoot)` | 읽기 | 로컬 캐시만, 네트워크 없음 |
| `write_file` | `id`, `relPath`, `content`, `expectedMtimeMs?` | `writeText` (+`restoreIfNoTextDiff`) | 쓰기 | mtime 충돌 감지, 유령 dirty 정리 |
| `patch_episode` | `id`, `patch` | `patchEpisode` (+`restoreIfNoTextDiff`) | 쓰기 | 스테이지 전진·승인 게이트(moodboard/script_final) |
| `save_render` | `id`, `category`, `row`, `bytes`, `overwrite?` | `saveRender` | 쓰기 | SKU 렌더 저장 |
| `git_complete` | `id` | `completeEpisode` (+상태는 `fetchStatus`) | git | 해당 EP 폴더만 add→commit→push, 이미지 제외 |

각 tool은 MCP 관례대로 명확한 description·JSON Schema 입력 정의를 가진다. 반환은 기존 함수의 반환형(예: `writeText`의 `{ok}` / `{conflict}` 판별 유니온)을 MCP 응답으로 그대로 직렬화.

## 5. 보안 · 셋업

- **바인드**: `127.0.0.1`만. 외부 인터페이스 노출 금지.
- **인증**: 모든 요청에 `Authorization: Bearer <token>` 필수. 누락/오토큰 → 401. write/git tool이 있으므로 로컬 웹페이지·타 프로세스의 무단 호출을 막는 토큰 게이트는 필수.
- **토큰 저장**: 최초 1회 생성(암호학적 난수) → gitignored `hub-config.json`(Electron `userData`)에 저장. 레포에 커밋되지 않음. 기기마다 다름.
- **셋업 마찰 최소화**: 서버 기동 시 앱이 **레포 루트에 gitignored `.mcp.json`**을 자동 생성/갱신한다 — `type: http`, `url: http://127.0.0.1:PORT/…`, `headers.Authorization: Bearer <token>`. Owner는 레포에서 `claude`를 실행하면 브리지 tool이 자동으로 붙는다.
  - `.mcp.json`을 `.gitignore`에 추가 (토큰·기기별 URL 포함이므로 절대 커밋 금지).
  - 기존 `.mcp.json`이 있으면 **덮어쓰지 않고 병합 or 별도 파일 + 안내**로 처리 (정확한 병합 규칙은 구현 계획에서 확정).
- **포트**: 기본 `7801`, 환경변수 `HUB_MCP_PORT` 오버라이드.

## 6. 테스트 · 게이트

- **단위(vitest)**: tool 핸들러 — 픽스처 루트로 `list_episodes`/`read_episode`/`read_file`/`write_file`/`patch_episode`/`git_complete` 결과 및 가드(경로 탈출 거부·`assertEpisodeId`) 검증. 기존 writer/scanner 테스트 픽스처 재사용. 토큰 인증(누락/오토큰 401, 정상 통과).
- **통합**: `mcpServer` 모듈을 픽스처 루트로 부팅 → MCP SDK 클라이언트로 HTTP 접속(정상 토큰) → `list_episodes`·`write_file` 호출·결과 검증. Electron UI 불필요, 경량.
- **회귀**: 기존 e2e 12 그린 유지.
- **게이트**: 단위 그린 · typecheck 0 · build OK · e2e 그린 · 최종 전체브랜치 리뷰.

## 7. 개발 방식

[[project_content_studio_harness]]·기존 episode-hub Phase와 동일 하네스 팀 — Opus 서브에이전트 구현자/리뷰어가 Task별 구현→리뷰→픽스 루프 + 최종 전체브랜치 리뷰 + feat 브랜치 머지. `subagent-driven-development` 스킬. ⚠️ 이 환경 Agent model은 `opus`/`haiku`만 (sonnet 불가). `.superpowers/sdd/`는 gitignore 스크래치 원장.

## 8. 리스크 · 열린 질문

- **MCP SDK HTTP transport 세부**: Streamable HTTP 세션 관리(단일 세션 vs stateless)·SDK 버전은 구현 계획에서 Context7/공식 문서로 확정.
- **`.mcp.json` 병합**: 기존 파일 존재 시 안전 병합 규칙 — 계획 단계에서 확정.
- **동시 쓰기**: AI가 MCP로, Owner가 UI로 동시 편집 → 기존 mtime 충돌 감지(`writeText`)가 처리. 신규 위험 없음.
