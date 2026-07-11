# Episode Hub Phase E3 — 앱에서 AI 실행 (자유 지시 → 제안 → 승인 → 적용) 설계

- 날짜: 2026-07-12
- 선행: Phase E2 앱→AI 읽기 전용 Q&A (`2026-07-11-episode-hub-phase-e2-ask-ai-design.md`) — E2 spec §1의 "③ 앱에서 AI 실행"의 후속.
- 승인: Owner (2026-07-12 브레인스토밍)

## 1. 배경·목표

E2로 부부가 앱 안에서 Claude에게 **묻기**가 가능해졌다(읽기 전용, 도구 차단으로 구조 보장). E3는 **시키기**: "3번 대사 더 유쾌하게 고쳐줘" 같은 자유 지시를 받아 Claude가 **수정안을 제안**하고, 부부가 파일별로 골라 승인하면 **그때 앱이 저장**한다. 핵심 설계 원칙: **Claude에게는 끝까지 쓰기 권한을 주지 않는다** — E2의 도구 잠금을 한 뼘도 허물지 않고, 쓰기는 승인 후 앱(main)이 수행한다.

## 2. 확정 요구사항 (브레인스토밍 결정)

| 결정 | 내용 |
|---|---|
| 일의 범위 | **자유 지시형** — E2 대화 패널에서 질문·지시 모두. 파이프라인 버튼·작업 큐는 후속 단계 |
| 승인 게이트 | **제안→승인→적용** — Claude는 제안(스테이징)만, 실제 저장은 승인 후 앱이 직접 |
| 수정 대상 | **보고 있는 에피소드 폴더 안의 `.md` 파일만** (기존 `writeText`가 md 전용 — 정합 유지) |
| 승인 단위 | **파일별 선택 적용** — 제안 카드에 파일별 체크박스, 일부만 수용 가능 |
| 실행 환경·과금 | E2와 동일 — Owner PC(`claude` CLI 감지)만, 와이프 PC는 안내문. $0(Max 구독 CLI 재사용) |

## 3. 비목표 (v1에서 안 함)

- 파이프라인 단계 구동 버튼·팀 실행·작업 큐 (와이프→Owner 큐 동기화 포함) — 후속 단계
- `episode.json`·이미지·에피소드 밖 파일 제안 (episode.json은 기존 `patch_episode`/앱 UI 담당)
- 제안의 영구 저장 (E2 대화와 동일하게 앱 메모리만 — 적용 전 데이터라 잃어도 파일 피해 없음)
- 적용 시 자동 git 커밋 (기존 Complete 버튼 흐름 유지)
- 부분(라인 단위) diff 승인 — 승인 단위는 파일

## 4. 기술 방식 선정

- **A(채택). MCP 제안 도구**: E1 mcpServer에 `propose_edit` 도구 신설. Claude가 수정안을 도구 호출로 제출 → 앱이 스테이징·표시 → 승인분만 main이 저장. 도구 스키마 검증이라 형식 파손 없음, E2 잠금 구조 유지.
- B(기각). 답변 텍스트에 JSON 블록으로 제안을 쓰고 앱이 파싱 — 형식이 조금만 틀려도 깨지는 취약 경로.
- C(기각). 에피소드 폴더 임시 복사본에 Claude가 직접 쓰고 사후 diff — 내장 쓰기 도구를 열어야 해서 "구조적 읽기 전용" 보장이 경로 검사 하나로 얇아지고, 복사·정리 수명 관리가 복잡.

## 5. 아키텍처

```
[AskClaude 패널 (E2 그대로 — 질문·지시 겸용)]
   ↓ IPC ai:ask {episodeId, question}          (E2 경로 재사용)
[main/aiBridge.ts] spawn: claude -p … --allowedTools <읽기4종 + propose_edit>
   ↓                                            (--disallowedTools E2 그대로)
[claude headless] ──HTTP──▶ [E1 mcpServer :7801]
                              propose_edit → [main/proposalStore.ts (신설, 메모리)]
                                                ↓ onEvent {kind:'propose', episodeId 스탬프}
[패널] 제안 카드(파일별 체크박스·변경 전/후 비교) 표시
   ↓ IPC ai:applyProposal {episodeId, itemIds}
[main] safeEpisodePath 재검증 → writeText(expectedMtimeMs 충돌 감지) → watcher가 화면 갱신
```

### 5-1. MCP 도구 `propose_edit` (mcpServer.ts에 9번째 도구로 등록)

- 입력: `{ id(에피소드), relPath(episodes/<id>/ 기준 상대경로), newContent(파일 전체의 새 내용), reason(한 줄 설명) }`
- 동작: **파일을 쓰지 않는다.** 검증 통과 시 proposalStore에 항목을 쌓고 renderer에 알린다.
- 검증 3중 (하나라도 실패 시 도구 에러 반환 — 카드에 안 나타남):
  1. `id`가 **현재 질문 진행 중인 에피소드**와 일치 — `getActiveAskEpisode()`(aiBridge가 ask 시작~done 사이 보유)를 registerEpisodeTools에 주입해 대조. 진행 중인 ask가 없으면 거절(외부 터미널 세션이 이 도구를 오용하는 것도 함께 차단).
  2. 경로가 그 에피소드 폴더 안 — 기존 `safeEpisodePath` 재사용(`..` 탈출 차단).
  3. `.md` 확장자만.
- 항목에는 제안 시점 대상 파일의 `mtimeMs`(신규 파일이면 null)를 캡처 — 적용 시 충돌 감지 기준. 신규 md 파일 제안 허용(에피소드 폴더 안 한정).
- mcpServer는 stateless(요청마다 새 McpServer)이므로 저장소는 main의 `proposalStore`(모듈 싱글턴)가 보유한다.

### 5-2. `src/main/proposalStore.ts` (신설, 순수 계층 — 테스트 대상)

- 항목: `{ itemId, episodeId, relPath, newContent, reason, baseMtimeMs|null, status: 'pending'|'applied'|'rejected'|'failed' }`
- 에피소드별 pending 목록 조회·상태 전이·전체 거부. 앱 메모리만(비영구).
- renderer 전달 시 `newContent` 전문 대신 요약(파일명·이유·크기)을 먼저 보내고, 비교 화면 열람 시 `ai:getProposalDiff`로 전문·diff를 조회(대용량 md 이벤트 폭주 방지).

### 5-3. aiBridge 확장 (E2 코드 최소 변경)

- `buildAskArgs`: `--allowedTools`에 `mcp__episode-hub__propose_edit` 1종 추가. `DENY_TOOLS`(내장 쓰기·셸·네트워크·로컬 읽기 차단)는 **변경 없음**.
- `buildPrompt` 프리앰블에 한 단락 추가: "수정 지시를 받으면 파일을 직접 고치지 말고 propose_edit로 제안하라. 파일 전체의 새 내용을 제출하라. 지시받지 않은 파일은 제안하지 마라."
- ask 시작~settle 사이 `activeAskEpisode`를 노출(§5-1 검증 ①). 이벤트 episodeId 스탬프·타임아웃·트리킬 등 기존 수명 관리는 그대로.
- propose 알림은 mcpServer 핸들러 → proposalStore → 기존 `onEvent` 경로로 `{kind:'propose', episodeId, item요약}` 방출(스트림 파싱이 아니라 서버 검증 통과분만 — 권위 경로).

### 5-4. preload / IPC 표면

`window.hub.ai`에 추가: `listProposals(episodeId)` · `getProposalDiff(itemId)` · `applyProposal(episodeId, itemIds[])` · `rejectProposal(episodeId, itemIds[])`. `onStream`은 `propose` kind를 그대로 통과. 기존 preload 패턴(채널 화이트리스트) 준수.

### 5-5. 제안 카드 UI (AskClaude.tsx 확장)

- 한 ask 턴(ask 시작~done) 동안 도착한 propose 항목들을 **하나의 제안 카드**로 묶어 대화 흐름 안에 표시: 파일명 + Claude의 한 줄 이유 + 체크박스(기본 전체 체크).
- 파일 클릭 → 변경 전/후 비교: `diff` 라이브러리로 계산한 라인 단위 빨강(삭제)/초록(추가) 하이라이트. 렌더는 기존 `renderMarkdown`(DOMPurify) 경로 재사용 — 제안 내용도 신뢰 불가 입력.
- 버튼: **선택한 파일 적용** / **모두 거부**. 처리 후 카드는 "적용됨 ✓(파일 목록)"/"거부됨"으로 고정. 부분 수용 후 재지시는 새 대화 턴 → 새 카드.
- 패널 마운트 시 `listProposals`로 pending 복원(진행 중 화면 이탈 대비).

### 5-6. 적용 실행 (main)

- `ai:applyProposal` → 항목별: `safeEpisodePath` **재검증**(제출 시 + 적용 시 이중) → `writeText(root, id, relPath, newContent, baseMtimeMs ?? undefined)` → 성공 시 `restoreIfNoTextDiff`(유령 dirty 정리, ipc.ts·mcpServer 기존 미러).
- `writeText`의 mtime 충돌 감지 활용: 제안 이후 원본이 바뀌었으면 conflict 반환 → 카드에 "파일이 그새 바뀌었어요" 경고 + **그래도 적용**(expectedMtimeMs 없이 재시도) 선택지.
- 결과는 파일별 성공/실패로 카드에 반영(성공분 유지). watcher가 파일 변화를 감지해 화면 자동 갱신 — 추가 배선 없음.

## 6. 에러 처리

| 상황 | 처리 |
|---|---|
| 에피소드 불일치·경로 탈출·비 md 제안 | propose_edit 도구 에러 반환(Claude가 정정 시도 가능), 카드 미생성 |
| 진행 중 ask 없는 propose 호출(외부 세션 오용) | 도구 에러 — "앱 질문 패널에서만 제안 가능" |
| 적용 시 mtime 충돌 | 경고 + "그래도 적용" 선택지 (§5-6) |
| 적용 중 일부 파일 실패 | 파일별 성공/실패 표시, 성공분 유지 |
| 세션 취소·타임아웃 | E2 처리 그대로 + 이미 접수된 propose 항목은 pending 유지(반쯤 온 제안도 검토 가능) |
| 앱 재시작 | 제안 소실(비영구 — 비목표 §3). 파일은 무피해 |

## 7. 테스트 (게이트: unit · typecheck · build · e2e)

- **단위 (순수)**: propose 검증 3중(불일치·탈출·확장자) · proposalStore 상태 전이(pending→applied/rejected/failed, 에피소드별 격리) · diff 계산 · `buildAskArgs`에 propose_edit 포함 + DENY_TOOLS 불변 · 프리앰블 확장(첫 질문만) · 적용 시 이중 검증·mtime 충돌 분기.
- **spawn 통합**: 스텁 실행파일이 propose_edit HTTP 호출을 흉내 → proposalStore 적재 → `propose` 이벤트 방출 → 적용 IPC까지 흐름 검증(실 claude 미호출).
- **e2e 1건**: 스텁 claude로 "지시 입력 → 제안 카드 표시 → 체크 → 적용 → 파일 내용 실제 변경" 확인.
- 실 claude 수동 스모크(Owner PC) 1회 — 비결정적이라 게이트 제외 (E2 관례).

## 8. 대안 검토 (기각 — §4 외)

- **건별 팝업 승인**(쓰기 도구를 열고 호출마다 승인 팝업): 다파일 수정 시 팝업 연타 — 비개발자 피로, 기각.
- **사후 git 되돌리기**(자유 쓰기 후 diff 검토·거부 시 revert): 작업 중 파일이 실제로 바뀌어 있는 순간이 존재 — watcher·파이프라인 오독 위험, 기각.
