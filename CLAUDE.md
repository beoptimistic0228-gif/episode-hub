# CLAUDE.md — Episode Hub

## 무엇인가
**Episode Hub** = "누구의 공간" 채널 산출물(에피소드)을 열람·편집하는 독립 Electron 앱(electron-vite + React + TS + zustand). 원래 `nakgwan-channel-infra` 콘텐츠 레포 안에 있던 것을 2026-07-09 독립 레포로 분리(이력 보존, `git subtree split`). **채널 인프라(헌법 자산)가 아니라 그것을 소비하는 도구.**

## 콘텐츠와의 관계 (중요)
이 앱은 **자기 안에 콘텐츠를 갖지 않는다.** 실행 시 사용자가 고른 **orchestrator 폴더**(= `nakgwan-channel-infra`를 clone한 곳의 `orchestrator/`)를 가리켜:
- `output/episodes/`를 읽고,
- 그 폴더의 git에 커밋(Complete 버튼)하며,
- `episode-hub/data/channel_stats.json`(콘텐츠 레포)에 채널 통계를 기록하고,
- 그 레포 루트에 `.mcp.json`을 쓴다.

즉 **콘텐츠 레포를 별도로 clone**해야 하고, 앱은 그 위치를 폴더 선택/저장 config(userData `hub-config.json`)로 안다. 앱 코드 위치(이 레포)와 콘텐츠 위치는 무관하다.

## 개발
- `npm install` → `npm run dev`(electron-vite) / `npm run build` / `npm run test`(vitest) / `npm run test:e2e`(Playwright-Electron) / `npm run typecheck` / `npm run dist`(NSIS exe).
- 게이트: unit 그린 · typecheck 0 · build OK · e2e 그린.
- 개발 방식: 하네스 팀(서브에이전트 구현→리뷰→픽스) — superpowers 스킬. 스펙은 `docs/superpowers/specs`, 계획은 `docs/superpowers/plans`. (Phase A~E1 스펙·계획은 분리 시 복사됨; 그 이전 역사는 콘텐츠 레포에도 있음.)
- Agent 모델 가용성은 PC/플랜마다 다름 — 특정 모델 제약을 이 문서에 박지 말고 디스패치 시점에 확인.
- 배포: `npm run dist` → `release/EpisodeHub-Setup-<v>.exe` → GitHub Release(`build.publish` = 이 레포 `beoptimistic0228-gif/episode-hub`).

## MCP 브리지 (AI→앱, v0.2.0)
앱 기동 시 `127.0.0.1:7801`에 HTTP MCP 서버(Bearer 토큰, 콘텐츠 레포 루트에 gitignored `.mcp.json` 자동생성). tool 9종(`list_episodes`·`read_episode`·`read_file`·`get_channel_stats`·`write_file`·`patch_episode`·`save_render`·`git_complete`·`propose_edit`)으로 Claude Code가 에피소드 읽기/쓰기. 핵심: `src/main/mcpBridge.ts`(토큰·`.mcp.json`)·`src/main/mcpServer.ts`(HTTP 서버·tool). `.mcp.json`은 루트 확정 시점(`onRootChanged`)마다 기록.

**E2(앱→AI, 읽기 전용 Q&A)**: 에피소드 화면 "Claude에게 물어보기" 패널 — `src/main/aiBridge.ts`가 headless `claude -p`를 spawn(읽기 4종 `--allowedTools` 잠금, `--resume` 이어묻기, Owner PC 전용 CLI 감지). 설계 `docs/superpowers/specs/2026-07-11-episode-hub-phase-e2-ask-ai-design.md`.

**E3(앱→AI 자유 지시, 제안→승인→적용)**: 같은 패널에서 수정 지시 — 스폰된 Claude는 `propose_edit`(스테이징)로 수정안만 제출하고(쓰기 권한 0, DENY_TOOLS 불변), 부부가 제안 카드에서 파일별로 골라 승인하면 main이 `writeText`(mtime 충돌 감지)로 저장한다. 대상은 보고 있는 에피소드의 `.md`만. 핵심: `src/main/proposalStore.ts`. 설계 `docs/superpowers/specs/2026-07-12-episode-hub-phase-e3-propose-apply-design.md`.

## 이미지 공유 (클라우드 드라이브 동기, v0.3)
글자는 콘텐츠 레포 git, **이미지만** per-PC `imageRoot`(Google Drive 등 동기 로컬 폴더)로 공유. 경로 구조 `<imageRoot>/<id>/<groupRel>`(레포보다 한 단계 얕음 — `output/episodes` 세그먼트 없음). 저장 `saveRender`·표시 `hub://`(imageRoot 우선, 레포 폴백)·상세 `scanEpisodeDetail`(imageRoot 이미지 병합)이 `imageRoot` 경유. **하위호환: `imageRoot` 미설정 시 레포 이미지 유지**(무중단 과도기). 핵심: `src/main/pathGuard.ts`(`resolveImagePath`)·`src/main/imageMigrate.ts`(레포→imageRoot 1회 이관). 설정은 사이드바 "이미지 폴더"/"이미지 이관" 버튼. 설계 `docs/superpowers/specs/2026-07-09-episode-hub-image-sync-design.md`, 계획 `docs/superpowers/plans/2026-07-09-episode-hub-image-sync.md`.

## 다음
- **파이프라인 구동·작업 큐**(E3 후속): 앱에서 팀/에이전트 단계 실행 버튼 + 와이프→Owner 작업 큐(PC 간 동기화 설계 필요). E3 제안 게이트·aiBridge 재사용.

## 커밋
- scope 예: `feat`/`fix`/`chore`/`docs`. 커밋 신원(이 레포 로컬) = `낙관 <beoptimistic0228@gmail.com>`.
- 커밋/푸시는 요청 시. 기본 브랜치 `main`.
