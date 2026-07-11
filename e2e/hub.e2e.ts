import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// 빌드된 앱(out/main)을 실제 Electron으로 띄워, 사람이 손으로 하던 Phase B 쓰기 3흐름 +
// Phase C git 동기화 흐름을 자동 구동·단언한다 (interior-studio/e2e/app.e2e.ts 패턴).
//   Phase B  ① md 편집→저장  ② 승인 게이트 토글 + stage 변경  ③ 렌더 드롭 저장(네이티브 드롭은 IPC 직접)
//   Phase C  ⑤ git 상태 칩 표시  ⑥ Complete(IPC) → 커밋·푸시 → bare 원격 반영 확인
// fixture root를 앱에 물리기 위해:
//   electron 실행 시 --user-data-dir=<tempUserData> + 그 안에 hub-config.json={orchestratorRoot:<orchRoot>}
//   를 미리 써두면 discoverRoot()가 저장 config를 읽어 fixture를 가리킨다.
// Phase C git 테스트를 위해 fixture는 "git 작업본 + bare 원격 + orchestrator 서브디렉토리"로 구성한다
//   (tests/gitTestUtil.makeRepoWithRemote 방식 재현 — e2e는 tests/를 import하지 않고 인라인 execFileSync).
//   즉 gitRoot = <repo>, orchestratorRoot = <repo>/orchestrator (git 루트 ≠ orchestrator 루트).

const MAIN = resolve(__dirname, '../out/main/index.js');
const EP_ID = 'ep20260101_e2e';

// tests/gitTestUtil.g 재현 (import 금지 — e2e는 자체 헬퍼 인라인).
const g = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

const gitAvailable = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

let app: ElectronApplication;
let page: Page;
let base: string;          // 임시 베이스 (repo + remote를 담는 상위 폴더)
let remote: string;        // bare 원격 (git 모드에서만)
let repo: string;          // git 작업본 루트 (== gitRoot; git 모드에서만)
let orchRoot: string;      // orchestrator 루트 (output/episodes/... fixture)
let tempUserData: string;  // --user-data-dir (hub-config.json 저장 위치)
let imgRoot: string;       // 이미지 동기 폴더(imageRoot) — 렌더는 여기 <imgRoot>/<id>/renders/ 로 저장
let epDir: string;         // <orchRoot>/output/episodes/<id>
const pageErrors: string[] = [];
const consoleErrors: string[] = [];

const readEpisodeJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(epDir, 'episode.json'), 'utf-8'));

test.beforeAll(async () => {
  // ── fixture root 생성 ────────────────────────────────────────────
  base = mkdtempSync(join(tmpdir(), 'hub-e2e-'));
  tempUserData = mkdtempSync(join(tmpdir(), 'hub-e2e-ud-'));

  if (gitAvailable) {
    // git 작업본 + bare 원격 + orchestrator 서브디렉토리
    remote = join(base, 'remote.git');
    repo = join(base, 'work');
    orchRoot = join(repo, 'orchestrator');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
    g(repo, 'init', '-b', 'main');
    g(repo, 'config', 'user.email', 't@t.t');
    g(repo, 'config', 'user.name', 'tester');
    g(repo, 'config', 'commit.gpgsign', 'false');
  } else {
    // git 미설치 폴백 — Phase B는 계속 검증, Phase C git 테스트는 test.skip.
    orchRoot = join(base, 'root');
  }

  epDir = join(orchRoot, 'output', 'episodes', EP_ID);
  mkdirSync(join(epDir, 'script'), { recursive: true });
  mkdirSync(join(epDir, 'prompts'), { recursive: true });
  mkdirSync(join(epDir, 'products'), { recursive: true });

  writeFileSync(
    join(epDir, 'episode.json'),
    JSON.stringify({
      schema_version: 1,
      title: 'E2E 룸',
      stage: '렌더',
      approvals: {},
      products: [{ phase: 1, category: '책상', model: 'X', qty: 1, price_lowest: 1000 }],
    }, null, 2),
  );
  writeFileSync(join(epDir, 'script', '콘티.md'), '# 콘티\n\n본문\n');
  writeFileSync(
    join(epDir, 'prompts', 'master_sheets_prompts.md'),
    '## 1. [책상] X\n\n### Row 1 — 4각도 컷 (정면·45도·측면·탑뷰)\n\n**영문 (Gemini·ChatGPT·Higgsfield)**\n\n```\nprompt text\n```\n',
  );
  writeFileSync(join(epDir, 'products', '책상_p.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  // Phase D fixture — 최종 영상·OSMU
  mkdirSync(join(epDir, 'final'), { recursive: true });
  writeFileSync(join(epDir, 'final', 'full.mp4'), Buffer.from([0x00, 0x00, 0x00, 0x18]));
  mkdirSync(join(epDir, 'osmu'), { recursive: true });
  writeFileSync(join(epDir, 'osmu', 'blog_1.md'), '# 블로그 초안\n');

  if (gitAvailable) {
    // 렌더 이미지는 gitignore로 커밋 제외 (Complete가 이미지 제외함을 fixture에서도 반영).
    writeFileSync(join(repo, '.gitignore'), 'orchestrator/output/episodes/*/renders/*\n');
    g(repo, 'add', '-A');
    g(repo, 'commit', '-m', 'init');
    g(repo, 'remote', 'add', 'origin', remote);
    g(repo, 'push', '-u', 'origin', 'main');
  }

  // 이미지 동기 폴더(imageRoot) — 렌더 저장/이미지 표시 대상. 실사용처럼 per-PC 경로를 config에 심는다.
  // (base 하위라 afterAll의 rmSync(base)로 함께 정리된다.)
  imgRoot = join(base, 'images');
  mkdirSync(imgRoot, { recursive: true });

  // 저장 config → discoverRoot()가 fixture orchestrator 루트를 채택 + imageRoot 채택
  writeFileSync(join(tempUserData, 'hub-config.json'), JSON.stringify({ orchestratorRoot: orchRoot, imageRoot: imgRoot }));

  // 통계 mock 픽스처 — HUB_STATS_MOCK(URL 부분문자열→본문)로 실 API 없이($0·결정성) 수집 구동.
  const mockFx = join(base, 'stats-mock.json');
  writeFileSync(mockFx, JSON.stringify({
    '/channels': JSON.stringify({ items: [{ statistics: { subscriberCount: '12340', viewCount: '458200', videoCount: '42' } }] }),
    '/videos': JSON.stringify({ items: [] }),
    'm.blog.naver.com/api/blogs': JSON.stringify({ isSuccess: true, result: { dayVisitorCount: 210, totalVisitorCount: 45100, subscriberCount: 320 } }),
  }));

  // ── 앱 실행 ─────────────────────────────────────────────────────
  app = await electron.launch({
    args: [MAIN, `--user-data-dir=${tempUserData}`],
    env: { ...process.env, HUB_STATS_MOCK: mockFx, YOUTUBE_API_KEY: 'TESTKEY', HUB_CLAUDE_BIN: join(__dirname, 'stub', 'claude.cmd') },
  });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.waitForSelector('.sidebar .brand-banner');
});

test.afterAll(async () => {
  await app?.close();
  if (base) rmSync(base, { recursive: true, force: true });
  if (tempUserData) rmSync(tempUserData, { recursive: true, force: true });
});

test('① 부팅: 페이지 에러 없이 뜨고 사이드바에 fixture 에피소드가 보인다', async () => {
  // 루트 연결 성공 시 사이드바에 episode.json title이 표시된다.
  await expect(page.locator('.sidebar')).toContainText('E2E 룸');
  // 브랜드 배너가 사이드바 최상단에 실제 로드된다 (깨진 이미지 방지: naturalWidth > 0)
  await expect(page.locator('img.brand-banner')).toBeVisible();
  const bannerW = await page
    .locator('img.brand-banner')
    .evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(bannerW).toBeGreaterThan(0);
  expect(pageErrors, '시작 시 uncaught 에러').toEqual([]);
});

test('①-b 첫 화면=대시보드: 집계 타일·달력 표시 → 현황 카드 클릭으로 에피소드 진입', async () => {
  await expect(page.locator('.stat-tile').first()).toBeVisible();
  await expect(page.locator('.cal')).toBeVisible();
  await page.locator('.ep-card', { hasText: 'E2E 룸' }).click();
  await page.waitForSelector('nav.tab-bar'); // 에피소드 화면 진입
});

test('② md 편집→저장: 대본 .md 내용이 디스크에 반영된다', async () => {
  const NEW = '# 콘티\n\n수정본 E2E-EDIT\n';

  // 대본 탭 이동 → md 자동 오픈(mds[0]) → 편집 모드 → textarea 교체 → 저장
  await page.locator('nav.tab-bar button', { hasText: '대본' }).click();
  await page.waitForSelector('.md-editor');
  await page.getByRole('button', { name: '편집' }).click();
  await page.locator('.md-textarea').fill(NEW);
  await page.getByRole('button', { name: '저장', exact: true }).click();

  // 디스크 정합 — 저장이 비동기라 폴링.
  await expect
    .poll(() => readFileSync(join(epDir, 'script', '콘티.md'), 'utf-8'))
    .toBe(NEW);
});

test('③ 승인 게이트 토글: episode.json에 반영된다', async () => {
  // 무드보드 게이트 칩 클릭 → approvals.moodboard.approved === true
  await page.locator('.gate-chip', { hasText: '무드보드' }).click();
  await expect
    .poll(() => (readEpisodeJson().approvals as Record<string, { approved?: boolean }>)?.moodboard?.approved)
    .toBe(true);
});

test('④ 렌더 드롭 저장(IPC 직접): renders/책상__row1.png가 디스크에 생성된다', async () => {
  // 네이티브 파일 드롭은 자동화 곤란 → 드롭 핸들러가 부르는 IPC를 직접 호출(interior-studio 패턴).
  const res = await page.evaluate(async (id) => {
    const w = window as unknown as {
      hub: { renders: { save: (id: string, cat: string, row: string, buf: ArrayBuffer) => Promise<unknown> } };
    };
    return w.hub.renders.save(id, '책상', 'row1', new Uint8Array([1, 2, 3]).buffer);
  }, EP_ID);
  expect(res).toEqual({ ok: true, relPath: 'renders/책상__row1.png' });

  // 렌더는 이제 imageRoot 아래에 저장된다: <imgRoot>/<id>/renders/책상__row1.png (레포 아님).
  // normCategory('책상')==='책상' → renders/책상__row1.png
  const renderFile = join(imgRoot, EP_ID, 'renders', '책상__row1.png');
  expect(existsSync(renderFile)).toBeTruthy();
  expect(readFileSync(renderFile)).toEqual(Buffer.from([1, 2, 3]));

  // IPC 직접 쓰기 후 DOM 갱신은 리로드로 확인(interior-studio 패턴) — 프롬프트 워크벤치에 ✓ 표시.
  await page.reload();
  await page.waitForSelector('.sidebar');
  await page.locator('.sidebar nav .ep-item', { hasText: 'E2E 룸' }).click(); // 리로드 → 대시보드 → 재진입
  await page.locator('nav.tab-bar button', { hasText: '렌더 프롬프트' }).click();
  await expect(page.locator('.dropzone.filled')).toContainText('4각도 컷 이미지 저장됨');

  await page.screenshot({ path: join(test.info().outputDir, 'phase-b-final.png') });
});

test('④-b 최종 영상 탭: 비디오 플레이어가 렌더된다', async () => {
  await page.locator('nav.tab-bar button', { hasText: '최종 영상' }).click();
  await expect(page.locator('.video-card video')).toHaveCount(1);
  await expect(page.locator('.video-card figcaption')).toContainText('full.mp4');
});

test('④-c OSMU 탭: 변환 md가 목록에 보인다', async () => {
  await page.locator('nav.tab-bar button', { hasText: 'OSMU' }).click();
  await expect(page.locator('.file-item', { hasText: 'blog_1.md' })).toBeVisible();
});

// ── Phase C: git 동기화 스모크 ──────────────────────────────────────
// 네이티브 UI(드래그·다이얼로그) 대신 IPC 직접 호출 + fs/git 검증 (interior-studio 패턴).
test.describe('Phase C · git 동기화', () => {
  test.skip(!gitAvailable, 'git 미설치 환경 — git 스모크 건너뜀 (fake pass 금지)');

  test('⑤ git 상태 칩이 표시된다', async () => {
    await expect(page.locator('.git-chip')).toBeVisible();
  });

  test('⑥ Complete: EP 변경 → IPC로 커밋·푸시, bare 원격에 반영된다', async () => {
    // (1) EP script md를 하나 바꿔 변경 발생 (네이티브 편집 UI 대신 IPC 직접).
    const marker = `E2E-GIT-COMPLETE-${Date.now()}`;
    const wrote = await page.evaluate(async ({ id, marker }) => {
      const w = window as unknown as {
        hub: { files: { writeText: (id: string, rel: string, c: string) => Promise<{ ok: boolean }> } };
      };
      return w.hub.files.writeText(id, 'script/콘티.md', `# 콘티\n\n${marker}\n`);
    }, { id: EP_ID, marker });
    expect(wrote.ok).toBe(true);

    // (2) Complete IPC → { ok: true }.
    const res = await page.evaluate(async (id) =>
      (window as unknown as {
        hub: { git: { complete: (id: string) => Promise<{ ok: boolean }> } };
      }).hub.git.complete(id), EP_ID);
    expect(res.ok).toBe(true);

    // (3) 커밋이 bare 원격에 도달했는지 확인:
    //     로컬 HEAD == origin/main(로컬 추적) == bare 원격의 main.
    const localHead = g(repo, 'rev-parse', 'HEAD');
    const originMain = g(repo, 'rev-parse', 'origin/main');
    const bareMain = g(remote, 'rev-parse', 'main');
    expect(originMain).toBe(localHead);
    expect(bareMain).toBe(localHead);

    // (4) 커밋 메시지 + 커밋된 파일 내용(원격)에 marker가 반영됐는지 확인.
    const subject = g(repo, 'log', '-1', '--pretty=%s');
    expect(subject).toContain(EP_ID);
    const committed = g(repo, 'show', `HEAD:orchestrator/output/episodes/${EP_ID}/script/콘티.md`);
    expect(committed).toContain(marker);
  });

  test('⑦ 활성 게이트: 인앱 md 편집(store 경로) 후 Complete 버튼이 활성된다', async () => {
    // ⑥이 EP 폴더를 커밋했으므로 작업트리는 clean → 리로드로 store를 clean 상태로 리셋.
    // (⑥은 IPC 직접 호출이라 store gitStatus를 갱신하지 않았음 — 리로드가 init sync로 clean 재산출.)
    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.locator('.sidebar nav .ep-item', { hasText: 'E2E 룸' }).click(); // 대시보드 → 에피소드 재진입
    const complete = page.getByRole('button', { name: 'Complete' });
    // clean 시작 — Complete 비활성(epChanged=false). init sync가 clean을 물어도 계속 비활성.
    await expect(complete).toBeDisabled();

    // 실제 UI 편집 흐름(MarkdownEditor → store.writeText → refreshGitLocal). IPC 직접 우회 아님.
    await page.locator('nav.tab-bar button', { hasText: '대본' }).click();
    await page.waitForSelector('.md-editor');
    await page.getByRole('button', { name: '편집' }).click();
    await page.locator('.md-textarea').fill(`# 콘티\n\nE2E-GATE-${Date.now()}\n`);
    await page.getByRole('button', { name: '저장', exact: true }).click();

    // 리로드·Update 없이 refreshGitLocal(no-fetch git:status)만으로 게이트가 켜져야 한다.
    await expect(complete).toBeEnabled();
  });
});

// ── Phase D: 발행 기록 → 대시보드 집계 ─────────────────────────────────
test('⑧ 발행 기록 추가: episode.json 반영 + 대시보드 발행 달력 집계', async () => {
  await page.locator('nav.tab-bar button', { hasText: '발행' }).click();
  await page.getByRole('button', { name: '+ 발행 기록' }).click();
  await page.getByRole('button', { name: '기록', exact: true }).click(); // 기본값: 유튜브 본편·오늘

  await expect
    .poll(() => (readEpisodeJson().publications as unknown[] | undefined)?.length)
    .toBe(1);

  // 대시보드로 이동 → 발행 달력에 점 1개(발행 반영). '유튜브 본편' 집계 타일은
  // 대시보드 확장(Task 9 KPI 개편, commit 4550514)에서 외부채널 KPI 타일로 대체돼 제거됨 —
  // 발행 반영은 episode.json publications + 달력 점으로 검증(제거된 타일 단언은 삭제).
  await page.locator('.sidebar .nav-page').click();
  await expect(page.locator('.cal-cell .cal-dot')).toHaveCount(1);
  await page.screenshot({ path: join(test.info().outputDir, 'phase-d-dashboard.png') });
});

// ── 통계 흐름: 새로고침 → mock fetch로 구독자·조회수 집계 ($0·결정성) ──────────
test('⑨ 대시보드: 새로고침 → 통계(구독자) 표시', async () => {
  await page.locator('.sidebar .nav-page').click(); // 대시보드 보장
  await expect(page.locator('.stat-tile').first()).toBeVisible();
  await page.getByRole('button', { name: /새로고침/ }).click();
  await expect(page.getByText('12,340')).toBeVisible();     // 구독자 (mock subscriberCount)
  // '구독자'는 stat 타일 라벨과 차트 범례 양쪽에 있으므로 stat 타일 라벨로 스코프(strict-mode 위반 회피).
  await expect(page.locator('.stat-label', { hasText: '구독자' })).toBeVisible();
});

// ── E2 "에피소드에게 물어보기": 스텁 claude로 질문→답변 흐름 ─────────────────────
test('⑩ Claude 질문: 스텁 claude로 질문 → 답변 말풍선 표시', async () => {
  // ⑨는 대시보드에 머문다 → 에피소드 상세로 재진입(①-b와 동일 진입 로케이터).
  await page.locator('.ep-card', { hasText: 'E2E 룸' }).click();
  await page.waitForSelector('nav.tab-bar'); // 에피소드 화면 진입 → AskClaude 패널 마운트

  // HUB_CLAUDE_BIN이 스텁을 가리키므로 ai:status.available=true → 입력창이 뜬다(불가 안내 아님).
  const input = page.locator('.ask-input');
  await expect(input).toBeVisible();
  await input.fill('예산 얼마야?');
  await input.press('Enter');
  await expect(page.locator('.ask-bubble.user').last()).toHaveText('예산 얼마야?');
  await expect(page.locator('.ask-bubble.assistant').last()).toContainText('667,250원', { timeout: 15000 });
});
