import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// 빌드된 앱(out/main)을 실제 Electron으로 띄워, 사람이 손으로 하던 Phase B 쓰기 3흐름을 자동 구동·단언한다.
// 흐름별로 "DOM 조작 → 디스크 산출" 정합을 검사한다 (interior-studio/e2e/app.e2e.ts 패턴).
//   ① md 편집→저장  ② 승인 게이트 토글 + stage 변경  ③ 렌더 드롭 저장(네이티브 드롭은 IPC 직접)
// 임시 fixture root를 앱에 물리기 위해:
//   electron 실행 시 --user-data-dir=<tempUserData> + 그 안에 hub-config.json={orchestratorRoot:<tempRoot>}
//   를 미리 써두면 discoverRoot()가 저장 config를 읽어 fixture를 가리킨다.

const MAIN = resolve(__dirname, '../out/main/index.js');
const EP_ID = 'ep20260101_e2e';

let app: ElectronApplication;
let page: Page;
let tempRoot: string;      // orchestrator 루트 (output/episodes/... fixture)
let tempUserData: string;  // --user-data-dir (hub-config.json 저장 위치)
let epDir: string;         // <tempRoot>/output/episodes/<id>
const pageErrors: string[] = [];
const consoleErrors: string[] = [];

const readEpisodeJson = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(epDir, 'episode.json'), 'utf-8'));

test.beforeAll(async () => {
  // ── fixture root 생성 ────────────────────────────────────────────
  tempRoot = mkdtempSync(join(tmpdir(), 'hub-e2e-root-'));
  tempUserData = mkdtempSync(join(tmpdir(), 'hub-e2e-ud-'));
  epDir = join(tempRoot, 'output', 'episodes', EP_ID);
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
    '## 1. [책상] X\n\n**Row1**\n\n```\nprompt text\n```\n',
  );
  writeFileSync(join(epDir, 'products', '책상_p.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  // 저장 config → discoverRoot()가 fixture root를 채택
  writeFileSync(join(tempUserData, 'hub-config.json'), JSON.stringify({ orchestratorRoot: tempRoot }));

  // ── 앱 실행 ─────────────────────────────────────────────────────
  app = await electron.launch({ args: [MAIN, `--user-data-dir=${tempUserData}`] });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.waitForSelector('text=Episode Hub');
});

test.afterAll(async () => {
  await app?.close();
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  if (tempUserData) rmSync(tempUserData, { recursive: true, force: true });
});

test('① 부팅: 페이지 에러 없이 뜨고 사이드바에 fixture 에피소드가 보인다', async () => {
  // 루트 연결 성공 시 사이드바에 episode.json title이 표시된다.
  await expect(page.locator('.sidebar')).toContainText('E2E 룸');
  expect(pageErrors, '시작 시 uncaught 에러').toEqual([]);
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

test('③ 승인 게이트 토글 + stage 변경: episode.json에 반영된다', async () => {
  // 무드보드 게이트 칩 클릭 → approvals.moodboard.approved === true
  await page.locator('.gate-chip', { hasText: '무드보드' }).click();
  await expect
    .poll(() => (readEpisodeJson().approvals as Record<string, { approved?: boolean }>)?.moodboard?.approved)
    .toBe(true);

  // stage select → '검수'
  await page.locator('.stage-select').selectOption('검수');
  await expect.poll(() => readEpisodeJson().stage).toBe('검수');
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

  // normCategory('책상')==='책상' → renders/책상__row1.png
  const renderFile = join(epDir, 'renders', '책상__row1.png');
  expect(existsSync(renderFile)).toBeTruthy();
  expect(readFileSync(renderFile)).toEqual(Buffer.from([1, 2, 3]));

  // IPC 직접 쓰기 후 DOM 갱신은 리로드로 확인(interior-studio 패턴) — 프롬프트 워크벤치에 ✓ 표시.
  await page.reload();
  await page.waitForSelector('.sidebar');
  await page.locator('nav.tab-bar button', { hasText: '렌더 프롬프트' }).click();
  await expect(page.locator('.dropzone.filled')).toContainText('row1 생성됨');

  await page.screenshot({ path: join(test.info().outputDir, 'phase-b-final.png') });
});
