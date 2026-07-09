# Episode Hub 브랜딩 — 앱 아이콘 + 사이드바 배너 (2026-07-07)

Owner 요청: 기본 Electron 아이콘을 낙관(누구의 공간) 로고로 교체하고, 앱 UI에 브랜드 배너를 넣어 꾸민다. 위치는 **사이드바 최상단** (Owner 택1 — 본문 상단·하단 스트립 대비 본문 공간을 안 뺏고 항상 보임).

## 1. 앱 아이콘

- 원본: `07-Resources/Logo/Youtube_Logo.jpg` (2083² 정사각, 하늘색 배경 + 집 로고)
- 산출: `episode-hub/build/icon.png` (512², PNG). electron-builder의 기본 buildResources(`build/`) 규칙에 따라 설치 파일·exe·바로가기·작업표시줄 아이콘이 자동 생성된다.
- 개발 모드 창 아이콘: `BrowserWindow`에 `app.isPackaged`가 아닐 때만 `build/icon.png`를 지정 (패키징 후에는 exe 임베드 아이콘이 적용되므로 불필요, asar에 build/ 미포함).
- 배경 투명화는 하지 않는다 (원본 JPG — 하늘색 사각 아이콘으로 확정).

## 2. 사이드바 배너

- 원본: `07-Resources/Banner/Youtube_Banner.jpg` (10667×6000)에서 집+"누구의 공간" 워드마크 중심부만 크롭 → 약 3:1 PNG로 축소.
- 산출: `episode-hub/src/renderer/assets/brand-banner.png` — **레포 참조가 아닌 앱 내장 복사본** (단독 exe 동작 요건). 07-Resources 원본이 바뀌면 수동 재생성 (동기 의무 없음 — 장식 자산).
- UI: `Sidebar.tsx` 최상단, EP 목록 위에 모서리 둥근(`--r-lg`) 카드형 `<img>`. 딥퍼블 레일(`--brand-deep`) 위 하늘색 카드로 브랜드 대비. Vite 정적 import로 번들.
- 검증: e2e 스모크에 배너 표시 assertion 추가 (RED→GREEN), 기존 7종 무회귀, 실행 스크린샷 확인.

## 3. 산출·마무리

- `npm run dist` 재실행으로 아이콘·배너 반영된 `EpisodeHub-Setup-0.1.0.exe` 재산출.
- 커밋 scope: `episode-hub` (feat — 브랜딩).
