# Episode Hub — Claude 도킹 패널 개편 (AskClaude → 전역 우측 패널) 설계

- 날짜: 2026-07-12
- 선행: Phase E2 Q&A(`2026-07-11-…-e2-ask-ai-design.md`) · Phase E3 제안→승인→적용(`2026-07-12-…-e3-propose-apply-design.md`)
- 승인: Owner (2026-07-12 브레인스토밍 — 우측 도킹·에피소드별 보존·대시보드 유지·마스코트 아이콘)

## 1. 배경·목표

AskClaude 패널이 에피소드 화면 **본문 맨 아래** 붙어 있어 ① 탭 콘텐츠가 길면 매번 스크롤 끝까지 내려야 하고 ② 대시보드↔에피소드 이동 시 패널이 언마운트돼 대화가 통째로 사라지며 ③ 에피소드 전환 시에도 초기화된다. 이를 **ON/OFF 가능한 전역 우측 도킹 패널**로 옮기고 대화를 에피소드별로 보존한다.

## 2. 확정 요구사항 (브레인스토밍 결정)

| 결정 | 내용 |
|---|---|
| 형태 | **우측 도킹 패널(380px)** — 레이아웃 `사이드바 \| 본문 \| 패널` 3단. ON이면 본문 축소, OFF면 복원 |
| 대화 보존 | **에피소드별, 앱 실행 단위 메모리** — 에피소드·화면 전환에도 유지, 앱 종료 시 초기화(현행과 동일) |
| 대시보드 | **마지막 에피소드 대화 유지** — 패널 헤더에 대상 에피소드 제목 표시. 아직 연 에피소드 없으면 안내문 |
| 토글 | OFF: 우하단 원형 버튼 / ON: 패널 헤더 ✕. 상태 localStorage 기억, 첫 실행 기본 **ON** |
| 아이콘 | 🤖 이모지 대신 **낙관 마스코트** `src/renderer/assets/agents/claude-code.png` (07-Resources/Logo/claudecode-color.png와 동일 파일 — 이미 앱에 존재) |

## 3. 비목표

- 대화 디스크 영구 저장(껐다 켜면 초기화 유지) / 패널 폭 리사이즈 / 에피소드 횡단 전역 채팅 / main 프로세스·MCP·보안 구조 변경(순수 renderer 개편)

## 4. 기술 방식 선정

- **A(채택). 전역 패널 + zustand 대화 저장소**: 패널을 App 레이아웃에 1회 마운트, 대화 상태(스레드·스트림 버퍼·제안 수집)를 신설 `useChat` store로 분리. `onStream` 구독은 앱 레벨 1회 — 패널이 닫혀 있거나 다른 화면이어도 이벤트가 저장소에 쌓여 유실 없음.
- B(기각). 패널 컴포넌트 내부 Map 보관 + CSS 숨김 — "절대 언마운트 금지"라는 취약한 암묵 규칙, 상태가 컴포넌트에 갇힘.

## 5. 아키텍처

```
[App]
 ├─ onStream 구독(1회, App 레벨) ──▶ [useChat store]
 │                                   threads: episodeId → {bubbles, live, step, turnProposals}
 │                                   activeEpisodeId · busy · panelOpen(localStorage) · unread
 ├─ <Sidebar/> <main>…</main>
 └─ <ClaudePanel/>  (panelOpen ? 도킹 패널 : 우하단 토글 버튼)
[EpisodeView] — detail.id 변경 시 useChat.setActiveEpisode(id) 호출. 하단 AskClaude 제거.
```

### 5-1. `useChat` store (신설 `src/renderer/store/useChat.ts`)

- 상태: `threads: Record<episodeId, Thread>` (Thread = bubbles·live 스트림 버퍼·step·진행 턴의 propose 수집), `activeEpisodeId: string | null`, `busy: boolean`(전역 1건 — main과 동일 규칙), `panelOpen: boolean`(localStorage `hub-chat-panel` 승계), `unread: boolean`(패널 닫힘 중 done 도착 시 true, 열면 해제).
- 액션: `handleStream(ev)`(기존 AskClaude onStream 처리 로직 이관 — episodeId 스탬프 기준으로 해당 스레드 갱신, done 시 카드 확정·liveRef 캡처 규칙 보존), `ask(episodeId, q)`, `cancel()`, `newChat(episodeId)`(ai.reset + 스레드 비움), `setActiveEpisode(id)`(스레드 없으면 생성 + pending 제안 복원 `ai.proposals()` 1회), `togglePanel()`.
- App 레벨 `useEffect`에서 `window.hub.ai.onStream(useChat.getState().handleStream)` 1회 구독.

### 5-2. `ClaudePanel.tsx` (신설 — AskClaude 대체)

- `panelOpen=false`: 우하단 고정 원형 버튼(마스코트 이미지, unread면 알림 점 `.chat-fab-dot`).
- `panelOpen=true`: 우측 패널 — 헤더(마스코트 아이콘 + 대상 에피소드 제목 + "새 대화" + ✕) / 스레드(말풍선·ProposalCard 재사용) / 입력창. `activeEpisodeId` 없으면 "에피소드를 먼저 열어주세요" 안내. busy 중 다른 에피소드 스레드 보기 가능 — 입력창만 "다른 에피소드 답변 중" 비활성.
- 기존 CSS 클래스(`.ask-input`·`.ask-bubble`·`.ask-thread`·`.proposal-card` 등) 유지 — e2e 수정 최소화. 신규: `.chat-panel`, `.chat-fab`, `.chat-fab-dot`, `.chat-panel-head`.
- `claude` 미감지 PC(와이프): 패널 안 안내문(E2 문구 승계).

### 5-3. 레이아웃·정리

- `.layout`에 패널 칼럼 추가(open 시 `grid-template-columns: <사이드바> 1fr 380px`).
- `EpisodeView.tsx`: `<AskClaude…/>` 제거, `useChat.setActiveEpisode(detail.id)` useEffect 추가. `AskClaude.tsx` 삭제(로직은 store·ClaudePanel로 이관).

## 6. 에러·엣지

| 상황 | 처리 |
|---|---|
| 패널 닫힘 중 답변·제안 도착 | store에 정상 축적 + unread 점. 유실 없음 |
| busy 중 에피소드 전환 | 진행 스레드는 백그라운드에서 계속 갱신, 전환된 스레드는 열람만(입력 비활성) |
| 아직 연 에피소드 없음(첫 실행 대시보드) | 안내문 + 입력 비활성 |
| pending 제안 복원 | setActiveEpisode 시 1회 `ai.proposals()` — 중복 카드 방지 위해 스레드 최초 생성 시에만 |

## 7. 테스트 (게이트: unit · typecheck · build · e2e)

- 단위: `useChat` 상태 전이 — handleStream(text/result/error/done/propose 축적·에피소드 스코프·done 시 카드 확정), setActiveEpisode(스레드 생성·1회 복원), unread 규칙, panelOpen 승계.
- e2e: 기존 ⑩(질문)·⑪(제안→적용) 셀렉터 경로를 패널 기준으로 갱신 + **신규 1건: 질문 후 대시보드 이동→복귀 시 대화 유지**. 게이트 완주.

## 8. 대안 검토 (기각)

- 플로팅 챗 버블(본문 가림 — "보면서 고치기" 불가) · 하단 드로어(세로 공간 잠식) · 별도 BrowserWindow(과함) · 디스크 영구 저장(세션 만료와 어긋나는 반쪽 복원, v1 과함).
