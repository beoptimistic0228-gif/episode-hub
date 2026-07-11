# Episode Hub Phase E2 — 앱→AI "에피소드에게 물어보기" (읽기 전용 Q&A) 설계

- 날짜: 2026-07-11
- 선행: Phase E1 MCP 브리지 (`2026-07-09-episode-hub-phase-e1-mcp-bridge-design.md`) — E1 spec §"E2 (다음 사이클)"의 후속.
- 승인: Owner (2026-07-11 브레인스토밍 — 방식 A 채택)

## 1. 배경·목표

E1(AI→앱)은 Claude Code가 앱 내장 HTTP MCP 서버(127.0.0.1:7801, Bearer 토큰)로 에피소드를 읽고 쓰는 방향을 완성했다. E2는 반대 방향(앱→AI): **부부가 터미널 없이 앱 안에서 Claude에게 질문**한다.

E1 spec의 Owner 동작 요구 중 **④ 앱에서 AI 질문**만 이번 v1으로 구현한다. ③ 앱에서 AI 실행(파이프라인 구동)은 쓰기·승인 게이트 설계가 필요해 **E3로 분리**한다.

## 2. 확정 요구사항 (브레인스토밍 결정)

| 결정 | 내용 |
|---|---|
| 범위 | **읽기 전용 Q&A만** — 스폰된 Claude는 어떤 파일도 수정 불가(도구 차단으로 구조적 보장) |
| 실행 환경 | **Owner PC만** — `claude` CLI 감지 시 활성, 미감지 PC(와이프)는 안내문만 |
| UI 위치 | **에피소드 상세 화면 안 패널** — 보고 있는 에피소드가 자동으로 질문 맥락 |
| 대화 방식 | **대화형(이어묻기)** — 헤드리스 세션 id를 `--resume`으로 승계 |
| 과금 | **$0** — SDK·API 키 없음. 이미 설치·로그인된 Claude Code CLI(Max 구독) 재사용 |

## 3. 비목표 (v1에서 안 함)

- 파이프라인 실행 버튼·작업 큐 (→ E3. 쓰기 발생 = 승인 게이트 필요)
- 대화 기록 영구 저장 (앱 세션 메모리만; 껐다 켜면 초기화)
- 전역(에피소드 횡단) 채팅, 와이프 PC 지원
- Anthropic SDK / API 키 경로 (종량 과금 — $0 위반)
- 메인 터미널 세션과의 연동 — 스폰 세션은 완전 격리(독립 headless 세션)

## 4. 아키텍처

```
[EpisodeView 질문 패널 (renderer)]
   ↓ IPC ai:ask {episodeId, question}
[main/aiBridge.ts (신설)]
   ↓ spawn: claude -p <prompt> --output-format stream-json
   |         --allowedTools <읽기 4종> --mcp-config <E1 접속정보> [--resume <sid>]
[claude (headless)] ──HTTP──▶ [E1 mcpServer :7801] ─▶ scanner/reader (기존)
   ↓ stdout stream-json 라인
[aiBridge 파싱] ─ webContents.send('ai:stream', ev) ─▶ [패널 실시간 표시]
```

### 4-1. `src/main/aiBridge.ts` (신설)

- **감지** `detectClaude()`: 기동 시 1회 `claude` 실행파일 존재 확인(PATH 조회). 결과는 `ai:status` IPC로 renderer에 노출.
- **실행** `ask({episodeId, question, sessionId?})`:
  - `claude -p <조립된 프롬프트> --output-format stream-json` spawn.
  - **도구 잠금**: `--allowedTools "mcp__episode-hub__list_episodes,mcp__episode-hub__read_episode,mcp__episode-hub__read_file,mcp__episode-hub__get_channel_stats"` — 쓰기 도구(write_file·patch_episode·save_render·git_complete)와 내장 Write/Edit/Bash는 **허용 목록에 없어 사용 불가**. 읽기 전용의 구조적 보장.
  - **MCP 접속 명시 주입**: E1의 `.mcp.json`(콘텐츠 레포 루트, cwd 의존)에 기대지 않고, `--mcp-config`로 `{mcpServers: {"episode-hub": {url, headers.Authorization}}}`를 직접 전달(+`--strict-mcp-config`로 그 외 서버 차단). 토큰·포트는 `mcpBridge.ts` 기존 값 재사용 — cwd·레포 위치와 무관하게 동작.
  - **동시 1건**: 진행 중이면 신규 요청 거부(패널이 입력 비활성으로 선반영).
- **이어묻기**: 첫 응답 stream-json의 `session_id`를 패널 대화 단위로 보관 → 후속 질문은 `--resume <sid>`. "새 대화" = sid 폐기.
- **스트림 파싱**: stdout 라인 단위 JSON 파싱 → 이벤트 정규화(`init`/`tool_use`(단계 표시용)/`text`/`result`/`error`) → renderer로 전달. 파싱은 **순수 함수로 분리**(테스트 대상).
- **수명 관리**: 취소=`kill`, 무출력 120초=타임아웃 kill+에러, 앱 종료(`before-quit`)=진행 프로세스 정리.

### 4-2. 프롬프트 조립 (상수 1곳)

`aiBridge.ts`의 `CONTEXT_PREAMBLE` 상수 — 새 대화의 첫 질문에만 접두:

```
당신은 "누구의 공간" 채널 Episode Hub 앱에서 부부의 질문에 답하는 도우미입니다.
지금 보고 있는 에피소드: <id> (<title>)
episode-hub MCP 도구(read_episode·read_file 등)로 실제 데이터를 읽고 답하세요.
- 제품·가격 숫자는 에피소드 데이터에서 인용만 하고, 추측으로 만들지 마세요.
- 비개발자 부부가 읽습니다. 쉬운 한국어로 답하세요.

질문: <사용자 입력>
```

이어묻기(`--resume`)는 사용자 입력만 전달(세션이 맥락 보유). 데이터 파일을 프롬프트에 욱여넣지 않는다 — Claude가 도구로 필요한 것만 읽는다.

### 4-3. preload / IPC 표면

`window.hub.ai` = `{ status(): {available}, ask(episodeId, question), cancel(), reset(), onStream(cb) }`. 기존 `window.hub.*` 네임스페이스·preload 패턴을 따른다.

### 4-4. 질문 패널 `src/renderer/components/AskClaude.tsx` (신설)

- EpisodeView 하단 섹션. 입력창 + 말풍선 목록(사용자/Claude) + "새 대화" + 진행 중 취소 버튼.
- 진행 단계 표시: `tool_use` 이벤트 → "에피소드 읽는 중…" 칩. 본문은 도착분부터 표시.
- Claude 답변 md 렌더는 **`renderMarkdown`(marked→DOMPurify, 2026-07-11 신설) 재사용** — AI 출력도 신뢰 불가 입력으로 취급.
- `claude` 미감지: 패널 자리에 "이 PC에는 Claude Code가 없어 질문 기능을 쓸 수 없어요" 안내.
- 대화 상태는 renderer 메모리(에피소드별 sid+말풍선) — 영구 저장 없음(비목표).

## 5. 에러 처리

| 상황 | 처리 |
|---|---|
| `claude` 미설치 | 패널 비활성 + 안내문 (기능 숨김 아닌 명시) |
| spawn 실패 / 비정상 종료(exit≠0) | 에러 말풍선(stderr 요약) + 입력 재활성 |
| 무출력 120초 | kill + "응답이 없어 중단했어요" |
| stream-json 파싱 불가 라인 | 해당 라인 무시(로그), 세션 지속 |
| `--resume` 실패(만료 세션) | 세션 폐기 — 에러 표시 후 다음 질문은 자동으로 새 세션 |

## 6. 테스트 (게이트: unit · typecheck · build · e2e)

- **단위 (순수 함수)**: `buildAskArgs`(allowedTools 잠금·resume·mcp-config 포함 검증), `parseStreamLine`(init/tool_use/text/result/error 정규화), `extractSessionId`, 프리앰블 조립(첫 질문만 접두).
- **단위 (spawn 통합)**: 고정 stream-json을 뱉는 **스텁 실행파일**로 aiBridge 전체 흐름(스트림→이벤트→세션 승계·타임아웃·취소) 검증. 실제 claude 미호출.
- **e2e 1건**: 스텁 claude를 PATH에 꽂고 "질문 입력 → 답변 말풍선 표시" 확인.
- 실제 claude 대상 검증은 수동 스모크(Owner PC) 1회 — 비결정적이라 게이트 제외.

## 7. 대안 검토 (기각)

- **B. 상주 인터랙티브 프로세스**: 응답 시동 빠르나 터미널 출력 파싱이 깨지기 쉽고 프로세스 수명 관리 복잡 — 기각.
- **C. Anthropic SDK 직접 호출**: API 키 종량 과금으로 $0 원칙 위반 — 기각.
- **A(채택)**: 질문마다 headless spawn + `--resume` 승계. E1 서버 재사용, CLI 도구 잠금으로 읽기 전용 구조 보장, Max 구독 $0 유지.
