# Episode Hub 앱 Phase A (읽기 전용 허브) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `output/episodes/` 구조를 읽어 에피소드별 산출물을 Slack 디자인의 한 화면에서 보는 Electron 앱(Episode Hub)의 읽기 전용 코어를 만든다.

**Architecture:** interior-studio와 동일한 electron-vite 3-프로세스(main=fs·스캐너·watcher / preload=contextBridge / renderer=React+zustand). 파일시스템이 단일 진실 — main이 `output/episodes/`를 스캔·감시해 IPC로 밀어주고, renderer는 fs 직접 접근 금지. 스펙: `docs/superpowers/specs/2026-07-05-episode-hub-design.md` §4 (Phase A = §5의 A단계).

**Tech Stack:** Electron ^31.7.7 · electron-vite ^2.3.0 · React ^18.3.1 · TypeScript ^5.5.4 · zustand ^4.5.4 · vitest ^2.0.5 (interior-studio와 동일 버전 고정) + chokidar ^3.6.0(감시) + marked ^12.0.0(md 렌더).

## Global Constraints

- **위치**: 레포 최상위 `episode-hub/` (interior-studio와 나란한 독립 앱).
- **그룹 8종 고정** (스펙 §3-1과 1:1, 순서 포함): `planning 📋 기획 · products 🛋️ 제품 · prompts 🎨 렌더 프롬프트 · renders 🖼️ 렌더 결과 · script 🎬 대본 · publish 📢 발행 · validation ✅ 검증 · manuscript 📜 통합 원고`.
- **경로 발견 우선순위** (스펙 §4-3 verbatim): ⓐ 앱이 레포 안이면 상대경로 `../orchestrator` → ⓑ 기본 `C:\nakgwan-channel-infra\orchestrator` → ⓒ 폴더 선택 다이얼로그. 결과는 userData 설정에 저장.
- **schema_version**: episode.json `schema_version: 1`만 정상. 파싱 실패·버전 불일치 → 해당 EP 카드에 오류 배지, **앱 전체는 계속 동작** (스펙 §4-6).
- **renderer는 fs 직접 접근 금지** — 모든 파일 접근은 preload IPC 경유 (스펙 §4-1). `nodeIntegration` 금지, `contextIsolation: true`.
- **Slack 디자인 토큰 verbatim** (`DESIGN-slack.md`): primary `#4a154b` · primary-press `#611f69` · canvas-cream `#f4ede4` · canvas-lavender `#f9f0ff` · hairline `#e6e6e6` · ink `#1d1d1d` · ink-mute `#696969` · on-aubergine-mute `#d9bdde` · semantic-error `#cc4117` · semantic-success `#007a5a` · 버튼 = pill(90px) · 카드 = 16px radius + hairline. 폰트 = **Pretendard(한글) + Inter(라틴) fallback 체인** (Inter는 한글 미지원).
- **Complete·Update 버튼은 Phase A에서 disabled placeholder** (쓰기=Phase B, git=Phase C).
- **orchestrator/의 git-추적 파일은 절대 수정하지 않는다** (읽기 전용 Phase). gitignored 경로(renders/ 등)의 일시 테스트 파일은 허용 — 검증 후 즉시 삭제. 실데이터 검증은 `ep20260628_ippool-g009`로 (⚠️ 실물 renders/에 이미 PNG 8장 존재 — 기대값에 반영).
- **커밋**: `feat(episode-hub): …`. scope `episode-hub`는 **Task 1에서** `COMMIT_CONVENTION.md`에 등재(첫 커밋부터 유효한 scope). 루트 `CLAUDE.md` Repo layout 등재는 Task 10.
- 커맨드 실행은 `C:\GitHub\nakgwan-channel-infra\episode-hub`에서 (Task 1 이후). Windows — bash 셸 사용 가능.
- `npm run dev`는 GUI를 띄우므로 검증 시 백그라운드 실행 후 로그 확인·종료(또는 사람 확인 요청). CI 없음 — vitest + typecheck가 기계 게이트.

---

### Task 1: 스캐폴드 — electron-vite + React 골격 (Hello Hub)

**Files:**
- Create: `episode-hub/package.json`, `episode-hub/electron.vite.config.ts`, `episode-hub/tsconfig.json`, `episode-hub/tsconfig.node.json`, `episode-hub/vitest.config.ts`, `episode-hub/index.html`, `episode-hub/.gitignore`
- Create: `episode-hub/src/main/index.ts`, `episode-hub/src/preload/index.ts`, `episode-hub/src/renderer/main.tsx`, `episode-hub/src/renderer/App.tsx`

**Interfaces:**
- Produces: 실행 가능한 빈 앱 + `npm run typecheck`·`npm test` 그린. 이후 태스크가 이 골격에 파일을 추가.

- [ ] **Step 1: 설정 파일 작성**

`episode-hub/package.json`:
```json
{
  "name": "episode-hub",
  "version": "0.1.0",
  "description": "Episode Hub — 누구의 공간 산출물 에피소드별 관리 데스크톱 앱",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "marked": "^12.0.0",
    "zustand": "^4.5.4"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.7.7",
    "electron-vite": "^2.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.3.4",
    "vitest": "^2.0.5"
  }
}
```

`episode-hub/electron.vite.config.ts` (interior-studio 패턴 + main 의존성(chokidar) 외부화 — 사전 검증 교정):
```ts
import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared }, build: { outDir: 'out/main' } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared }, build: { outDir: 'out/preload' } },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: { alias: shared },
    build: { outDir: 'out/renderer', rollupOptions: { input: resolve('index.html') } },
  },
});
```

`episode-hub/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node", "vitest/globals"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "tests"]
}
```

`episode-hub/tsconfig.node.json`:
```json
{ "extends": "./tsconfig.json", "include": ["electron.vite.config.ts", "vitest.config.ts"] }
```

`episode-hub/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@shared': resolve('src/shared') } },
});
```

`episode-hub/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>Episode Hub — 누구의 공간</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

`episode-hub/.gitignore`:
```gitignore
node_modules/
out/
dist/
*.local
```

- [ ] **Step 2: 최소 main/preload/renderer**

`episode-hub/src/main/index.ts`:
```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('ping', () => 'pong');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

`episode-hub/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
};

contextBridge.exposeInMainWorld('hub', api);
export type HubApi = typeof api;
```

`episode-hub/src/renderer/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`episode-hub/src/renderer/App.tsx`:
```tsx
export default function App() {
  return <h1>Episode Hub</h1>;
}
```

- [ ] **Step 3: 설치·검증**

Run: `cd episode-hub && npm install && npm run typecheck && npm test`
Expected: install 성공, typecheck 오류 0, vitest `--passWithNoTests` 그린.

- [ ] **Step 4: dev 스모크**

Run: `npm run dev` 백그라운드 실행 → 로그에 renderer dev 서버 기동 확인 후 종료 (GUI 검증은 사람 확인 요청으로 대체 가능).
Expected: 크래시 없이 기동, "Episode Hub" 창.

- [ ] **Step 5: scope 등재 + Commit**

`COMMIT_CONVENTION.md`의 scope 나열에 `episode-hub` 추가 (interior-studio 옆 — 첫 커밋부터 유효한 scope).

```bash
git add episode-hub/ COMMIT_CONVENTION.md
git commit -m "feat(episode-hub): electron-vite + React 스캐폴드 (Phase A 시작)"
```

---

### Task 2: shared 타입 + 그룹 8종 상수

**Files:**
- Create: `episode-hub/src/shared/groups.ts`, `episode-hub/src/shared/types.ts`
- Test: `episode-hub/tests/groups.test.ts`

**Interfaces:**
- Produces (이후 전 태스크가 사용):
  - `GROUPS: readonly GroupDef[]` — `{ key: GroupKey; emoji: string; label: string }` 8종, 스펙 순서 고정
  - `type GroupKey = 'planning'|'products'|'prompts'|'renders'|'script'|'publish'|'validation'|'manuscript'`
  - `interface HubConfig { orchestratorRoot: string }`
  - `interface EpisodeSummary { id: string; title: string; stage: string; error?: string; groupCounts: Record<GroupKey, number> }`
  - `interface EpisodeDetail extends EpisodeSummary { doc: EpisodeDoc | null; files: Record<GroupKey, FileEntry[]> }`
  - `interface FileEntry { name: string; relPath: string; kind: 'md'|'image'|'json'|'other'; mtimeMs: number }`
  - `interface EpisodeDoc { schema_version: number; title: string; stage: string; approvals: Record<string, unknown>; total_estimate?: { low: number; high: number; label: string }; products?: ProductItem[] }`
  - `interface ProductItem { phase: number; category: string; model: string; qty: number; price_lowest: number; image_local?: string }`

- [ ] **Step 1: 실패 테스트 작성**

`episode-hub/tests/groups.test.ts`:
```ts
import { GROUPS, GROUP_KEYS } from '@shared/groups';

test('그룹은 스펙 §3-1과 1:1 — 8종·순서 고정', () => {
  expect(GROUP_KEYS).toEqual([
    'planning', 'products', 'prompts', 'renders',
    'script', 'publish', 'validation', 'manuscript',
  ]);
  expect(GROUPS).toHaveLength(8);
  expect(GROUPS[0]).toEqual({ key: 'planning', emoji: '📋', label: '기획' });
  expect(GROUPS[7]).toEqual({ key: 'manuscript', emoji: '📜', label: '통합 원고' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/groups.test.ts`
Expected: FAIL — `@shared/groups` 모듈 없음.

- [ ] **Step 3: 구현**

`episode-hub/src/shared/groups.ts`:
```ts
export type GroupKey =
  | 'planning' | 'products' | 'prompts' | 'renders'
  | 'script' | 'publish' | 'validation' | 'manuscript';

export interface GroupDef { key: GroupKey; emoji: string; label: string }

// 스펙 §3-1 — 폴더 = 화면의 의미 단위 (1:1, 순서 고정)
export const GROUPS: readonly GroupDef[] = [
  { key: 'planning',   emoji: '📋', label: '기획' },
  { key: 'products',   emoji: '🛋️', label: '제품' },
  { key: 'prompts',    emoji: '🎨', label: '렌더 프롬프트' },
  { key: 'renders',    emoji: '🖼️', label: '렌더 결과' },
  { key: 'script',     emoji: '🎬', label: '대본' },
  { key: 'publish',    emoji: '📢', label: '발행' },
  { key: 'validation', emoji: '✅', label: '검증' },
  { key: 'manuscript', emoji: '📜', label: '통합 원고' },
] as const;

export const GROUP_KEYS = GROUPS.map((g) => g.key) as GroupKey[];
```

`episode-hub/src/shared/types.ts`:
```ts
import type { GroupKey } from './groups';

export interface HubConfig { orchestratorRoot: string }

export interface ProductItem {
  phase: number;
  category: string;
  model: string;
  qty: number;
  price_lowest: number;
  image_local?: string;
}

export interface EpisodeDoc {
  schema_version: number;
  title: string;
  stage: string;
  approvals: Record<string, unknown>;
  total_estimate?: { low: number; high: number; label: string };
  products?: ProductItem[];
}

export interface EpisodeSummary {
  id: string;
  title: string;
  stage: string;
  /** episode.json 파싱 실패·schema_version 불일치 시 사유 (카드에 오류 배지) */
  error?: string;
  groupCounts: Record<GroupKey, number>;
}

export interface FileEntry {
  name: string;
  /** episodes/<id>/ 기준 상대경로 (POSIX 구분자) */
  relPath: string;
  kind: 'md' | 'image' | 'json' | 'other';
  mtimeMs: number;
}

export interface EpisodeDetail extends EpisodeSummary {
  doc: EpisodeDoc | null;
  files: Record<GroupKey, FileEntry[]>;
}
```

- [ ] **Step 4: 통과 확인 + typecheck**

Run: `npx vitest run tests/groups.test.ts && npm run typecheck`
Expected: PASS + 오류 0.

- [ ] **Step 5: Commit**

```bash
git add episode-hub/src/shared episode-hub/tests/groups.test.ts
git commit -m "feat(episode-hub): 그룹 8종 상수 + 공유 타입"
```

---

### Task 3: orchestrator 루트 발견 + 설정 저장 (main/config)

**Files:**
- Create: `episode-hub/src/main/config.ts`
- Test: `episode-hub/tests/config.test.ts`

**Interfaces:**
- Consumes: `HubConfig` (Task 2)
- Produces:
  - `resolveOrchestratorRoot(appPath: string, defaultRoot: string, exists: (p: string) => boolean): string | null` — 순수 함수. ⓐ `appPath/../orchestrator`(레포 안) → ⓑ `defaultRoot` → 없으면 `null`(→ 호출측이 다이얼로그 ⓒ). **`output/episodes` 하위 존재까지 확인해야 유효 판정.**
  - `loadConfig(file: string): HubConfig | null` / `saveConfig(file: string, cfg: HubConfig): void`

- [ ] **Step 1: 실패 테스트 작성**

`episode-hub/tests/config.test.ts`:
```ts
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveOrchestratorRoot, loadConfig, saveConfig } from '../src/main/config';

function makeOrch(base: string, name: string): string {
  const root = join(base, name);
  mkdirSync(join(root, 'output', 'episodes'), { recursive: true });
  return root;
}

describe('resolveOrchestratorRoot — 스펙 §4-3 우선순위', () => {
  let base: string;
  beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'hub-')); });
  afterEach(() => { rmSync(base, { recursive: true, force: true }); });

  test('ⓐ 레포 안 상대경로 우선', () => {
    const orch = makeOrch(base, 'orchestrator');
    const appPath = join(base, 'episode-hub'); // 형제 폴더
    mkdirSync(appPath, { recursive: true });
    expect(resolveOrchestratorRoot(appPath, join(base, 'none'), existsSync)).toBe(orch);
  });

  test('ⓑ 상대경로 없으면 기본 경로', () => {
    const def = makeOrch(base, 'default-orch');
    expect(resolveOrchestratorRoot(join(base, 'app'), def, existsSync)).toBe(def);
  });

  test('둘 다 없으면 null (→ 다이얼로그 ⓒ)', () => {
    expect(resolveOrchestratorRoot(join(base, 'app'), join(base, 'none'), existsSync)).toBeNull();
  });

  test('output/episodes 없는 폴더는 무효', () => {
    mkdirSync(join(base, 'orchestrator'), { recursive: true }); // episodes 없음
    expect(resolveOrchestratorRoot(join(base, 'episode-hub'), join(base, 'none'), existsSync)).toBeNull();
  });
});

test('config save/load 라운드트립 + 없는 파일 null', () => {
  const base = mkdtempSync(join(tmpdir(), 'hub-cfg-'));
  const file = join(base, 'config.json');
  expect(loadConfig(file)).toBeNull();
  saveConfig(file, { orchestratorRoot: 'C:\\x\\orchestrator' });
  expect(loadConfig(file)).toEqual({ orchestratorRoot: 'C:\\x\\orchestrator' });
  rmSync(base, { recursive: true, force: true });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`episode-hub/src/main/config.ts`:
```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { HubConfig } from '@shared/types';

/** 유효한 orchestrator 루트인가 — output/episodes 하위까지 확인 */
function isValidRoot(p: string, exists: (p: string) => boolean): boolean {
  return exists(p) && exists(join(p, 'output', 'episodes'));
}

/**
 * 스펙 §4-3 발견 우선순위:
 * ⓐ 앱이 레포 안이면 상대경로 ../orchestrator → ⓑ 기본 경로 → null(호출측이 다이얼로그 ⓒ)
 */
export function resolveOrchestratorRoot(
  appPath: string,
  defaultRoot: string,
  exists: (p: string) => boolean,
): string | null {
  const sibling = resolve(appPath, '..', 'orchestrator');
  if (isValidRoot(sibling, exists)) return sibling;
  if (isValidRoot(defaultRoot, exists)) return defaultRoot;
  return null;
}

export function loadConfig(file: string): HubConfig | null {
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf-8'));
    return typeof cfg?.orchestratorRoot === 'string' ? { orchestratorRoot: cfg.orchestratorRoot } : null;
  } catch {
    return null;
  }
}

export function saveConfig(file: string, cfg: HubConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/config.test.ts && npm run typecheck`
Expected: 5 PASS + 오류 0.

- [ ] **Step 5: Commit**

```bash
git add episode-hub/src/main/config.ts episode-hub/tests/config.test.ts
git commit -m "feat(episode-hub): orchestrator 루트 발견 + 설정 저장 (스펙 §4-3)"
```

---

### Task 4: 에피소드 스캐너 (main/scanner)

**Files:**
- Create: `episode-hub/src/main/scanner.ts`
- Test: `episode-hub/tests/scanner.test.ts`

**Interfaces:**
- Consumes: `GROUP_KEYS`(T2), 타입(T2)
- Produces:
  - `scanEpisodes(root: string): EpisodeSummary[]` — `root/output/episodes/*/` 열거, 각각 episode.json 파싱(실패·버전 불일치 = `error` 채움, throw 금지), 그룹별 파일 수 집계. 최신(id 역순) 정렬.
  - `scanEpisodeDetail(root: string, id: string): EpisodeDetail` — 그룹별 `FileEntry[]`(md·이미지·json 분류, mtime 내림차순).
  - `classifyKind(name: string): FileEntry['kind']` — `.md`→md, `.png/.jpg/.jpeg/.webp`→image, `.json`→json, 그 외 other.

- [ ] **Step 1: 실패 테스트 작성**

`episode-hub/tests/scanner.test.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanEpisodes, scanEpisodeDetail, classifyKind } from '../src/main/scanner';

function makeEpisode(root: string, id: string, doc: object | string): string {
  const ep = join(root, 'output', 'episodes', id);
  mkdirSync(join(ep, 'prompts'), { recursive: true });
  mkdirSync(join(ep, 'products'), { recursive: true });
  writeFileSync(join(ep, 'episode.json'),
    typeof doc === 'string' ? doc : JSON.stringify(doc), 'utf-8');
  return ep;
}

const GOOD_DOC = {
  schema_version: 1, title: '코지 룸', stage: '렌더',
  approvals: { moodboard: { approved: true } },
  total_estimate: { low: 667250, high: 667250, label: '60만원대' },
  products: [{ phase: 1, category: '책상', model: 'X', qty: 2, price_lowest: 104800 }],
};

describe('scanEpisodes', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'scan-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('정상 EP — 요약·그룹 카운트', () => {
    const ep = makeEpisode(root, 'ep20260628_test', GOOD_DOC);
    writeFileSync(join(ep, 'prompts', 'master_sheets_prompts.md'), '# x');
    writeFileSync(join(ep, 'products', 'p1.jpg'), '');
    const list = scanEpisodes(root);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('ep20260628_test');
    expect(list[0].title).toBe('코지 룸');
    expect(list[0].stage).toBe('렌더');
    expect(list[0].error).toBeUndefined();
    expect(list[0].groupCounts.prompts).toBe(1);
    expect(list[0].groupCounts.products).toBe(1);
    expect(list[0].groupCounts.renders).toBe(0);
  });

  test('episode.json 깨짐 → error 배지, throw 안 함', () => {
    makeEpisode(root, 'ep20260601_bad', '{not json');
    const list = scanEpisodes(root);
    expect(list[0].error).toMatch(/파싱/);
    expect(list[0].title).toBe('ep20260601_bad'); // 폴백 = 폴더명
  });

  test('schema_version ≠ 1 → error 배지', () => {
    makeEpisode(root, 'ep20260602_v2', { ...GOOD_DOC, schema_version: 2 });
    expect(scanEpisodes(root)[0].error).toMatch(/schema_version/);
  });

  test('episode.json 자체가 없으면 폴더명 폴백 + error', () => {
    mkdirSync(join(root, 'output', 'episodes', 'ep20260603_noJson', 'script'), { recursive: true });
    const list = scanEpisodes(root);
    expect(list[0].id).toBe('ep20260603_noJson');
    expect(list[0].error).toBeTruthy();
  });

  test('id 역순(최신 먼저) 정렬', () => {
    makeEpisode(root, 'ep20260601_a', GOOD_DOC);
    makeEpisode(root, 'ep20260628_b', GOOD_DOC);
    expect(scanEpisodes(root).map((e) => e.id)).toEqual(['ep20260628_b', 'ep20260601_a']);
  });
});

test('scanEpisodeDetail — 그룹별 FileEntry + mtime 내림차순 + doc 포함', () => {
  const root = mkdtempSync(join(tmpdir(), 'scan-d-'));
  const ep = makeEpisode(root, 'ep20260628_test', GOOD_DOC);
  writeFileSync(join(ep, 'prompts', 'a.md'), '# a');
  writeFileSync(join(ep, 'products', 'p1.jpg'), '');
  const d = scanEpisodeDetail(root, 'ep20260628_test');
  expect(d.doc?.total_estimate?.low).toBe(667250);
  expect(d.files.prompts[0]).toMatchObject({ name: 'a.md', kind: 'md', relPath: 'prompts/a.md' });
  expect(d.files.products[0].kind).toBe('image');
  expect(d.files.renders).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});

test('classifyKind', () => {
  expect(classifyKind('a.md')).toBe('md');
  expect(classifyKind('B.PNG')).toBe('image');
  expect(classifyKind('c.json')).toBe('json');
  expect(classifyKind('d.txt')).toBe('other');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/scanner.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`episode-hub/src/main/scanner.ts`:
```ts
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_KEYS, type GroupKey } from '@shared/groups';
import type { EpisodeDetail, EpisodeDoc, EpisodeSummary, FileEntry } from '@shared/types';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

export function classifyKind(name: string): FileEntry['kind'] {
  if (/\.md$/i.test(name)) return 'md';
  if (IMAGE_EXT.test(name)) return 'image';
  if (/\.json$/i.test(name)) return 'json';
  return 'other';
}

function episodesDir(root: string): string {
  return join(root, 'output', 'episodes');
}

/** episode.json 로드 — 실패해도 throw하지 않고 (doc|null, error|undefined) 반환 (스펙 §4-6) */
function loadDoc(epDir: string): { doc: EpisodeDoc | null; error?: string } {
  const file = join(epDir, 'episode.json');
  if (!existsSync(file)) return { doc: null, error: 'episode.json 없음' };
  try {
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as EpisodeDoc;
    if (doc.schema_version !== 1) {
      return { doc, error: `지원하지 않는 schema_version: ${doc.schema_version}` };
    }
    return { doc };
  } catch (e) {
    return { doc: null, error: `episode.json 파싱 실패: ${(e as Error).message}` };
  }
}

/** 그룹 폴더의 파일 목록 (하위 폴더 1단계 포함 — publish/thumbnails 등), mtime 내림차순 */
function listGroupFiles(epDir: string, group: GroupKey): FileEntry[] {
  const dir = join(epDir, group);
  if (!existsSync(dir)) return [];
  const out: FileEntry[] = [];
  const walk = (d: string, prefix: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full, `${prefix}${name}/`);
      } else {
        out.push({
          name,
          relPath: `${group}/${prefix}${name}`,
          kind: classifyKind(name),
          mtimeMs: st.mtimeMs,
        });
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function summarize(root: string, id: string): EpisodeSummary {
  const epDir = join(episodesDir(root), id);
  const { doc, error } = loadDoc(epDir);
  const groupCounts = Object.fromEntries(
    GROUP_KEYS.map((g) => [g, listGroupFiles(epDir, g).length]),
  ) as Record<GroupKey, number>;
  return {
    id,
    title: doc?.title || id,
    stage: doc?.stage || '',
    ...(error ? { error } : {}),
    groupCounts,
  };
}

export function scanEpisodes(root: string): EpisodeSummary[] {
  const dir = episodesDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort((a, b) => b.localeCompare(a)) // ep<YYYYMMDD>_… → 최신 먼저
    .map((id) => summarize(root, id));
}

export function scanEpisodeDetail(root: string, id: string): EpisodeDetail {
  const epDir = join(episodesDir(root), id);
  const summary = summarize(root, id);
  const { doc } = loadDoc(epDir);
  const files = Object.fromEntries(
    GROUP_KEYS.map((g) => [g, listGroupFiles(epDir, g)]),
  ) as Record<GroupKey, FileEntry[]>;
  return { ...summary, doc, files };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/scanner.test.ts && npm run typecheck`
Expected: 8 PASS + 오류 0.

(실데이터 스모크는 Task 6 dev 실행에서 UI로 확인한다 — 스캐너 단독 실행 단계 없음.)

- [ ] **Step 5: Commit**

```bash
git add episode-hub/src/main/scanner.ts episode-hub/tests/scanner.test.ts
git commit -m "feat(episode-hub): 에피소드 스캐너 — episode.json 관용 파싱 + 그룹 파일 집계"
```

---

### Task 5: IPC 배선 + preload API + hub:// 이미지 프로토콜

**Files:**
- Create: `episode-hub/src/main/ipc.ts`
- Modify: `episode-hub/src/main/index.ts` (전면 교체 — 아래 코드)
- Modify: `episode-hub/src/preload/index.ts` (전면 교체)
- Create: `episode-hub/src/preload/api.d.ts`

**Interfaces:**
- Consumes: T3 config, T4 scanner
- Produces (renderer가 사용하는 `window.hub`):
  - `config.get(): Promise<{ root: string | null }>` — 저장된 설정 → 없으면 자동 발견 → 그래도 없으면 null
  - `config.pickRoot(): Promise<{ root: string | null }>` — 폴더 선택 다이얼로그(ⓒ), 유효하면 저장
  - `episodes.list(): Promise<EpisodeSummary[]>`
  - `episodes.detail(id: string): Promise<EpisodeDetail>`
  - `files.readText(id: string, relPath: string): Promise<string>` — episodes/<id>/ 밖 경로 차단
  - 이미지 URL: `hub://<id>/<relPath>` (renderer `<img src>`용)

- [ ] **Step 1: pathGuard + ipc.ts 작성**

`episode-hub/src/main/pathGuard.ts` (electron 비의존 — 단위 테스트 대상):
```ts
import { join, normalize, sep } from 'node:path';

/** episodes/<id>/ 안으로 경로 고정 — 상위 탈출 차단 */
export function safeEpisodePath(root: string, id: string, relPath: string): string {
  const base = join(root, 'output', 'episodes', id);
  const full = normalize(join(base, relPath));
  if (!full.startsWith(base + sep) && full !== base) {
    throw new Error(`경로 이탈 차단: ${relPath}`);
  }
  return full;
}
```

`episode-hub/src/main/ipc.ts`:
```ts
import { app, dialog, ipcMain } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveOrchestratorRoot, saveConfig } from './config';
import { safeEpisodePath } from './pathGuard';
import { scanEpisodeDetail, scanEpisodes } from './scanner';

const DEFAULT_ROOT = 'C:\\nakgwan-channel-infra\\orchestrator';

export const configFile = (): string => join(app.getPath('userData'), 'hub-config.json');

let currentRoot: string | null = null;
export const getRoot = (): string | null => currentRoot;

function discoverRoot(): string | null {
  const saved = loadConfig(configFile());
  if (saved && existsSync(join(saved.orchestratorRoot, 'output', 'episodes'))) {
    return saved.orchestratorRoot;
  }
  // ⓐ 앱이 레포 안: app.getAppPath() = episode-hub/ (dev 기준)
  return resolveOrchestratorRoot(app.getAppPath(), DEFAULT_ROOT, existsSync);
}

export function registerIpc(onRootChanged: (root: string) => void): void {
  currentRoot = discoverRoot();
  if (currentRoot) onRootChanged(currentRoot);

  ipcMain.handle('config:get', () => ({ root: currentRoot }));

  ipcMain.handle('config:pickRoot', async () => {
    const res = await dialog.showOpenDialog({
      title: 'orchestrator 폴더 선택',
      properties: ['openDirectory'],
    });
    const picked = res.filePaths[0];
    if (picked && existsSync(join(picked, 'output', 'episodes'))) {
      currentRoot = picked;
      saveConfig(configFile(), { orchestratorRoot: picked });
      onRootChanged(picked);
      return { root: picked };
    }
    return { root: currentRoot };
  });

  ipcMain.handle('episodes:list', () =>
    currentRoot ? scanEpisodes(currentRoot) : []);

  ipcMain.handle('episodes:detail', (_e, id: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return scanEpisodeDetail(currentRoot, id);
  });

  ipcMain.handle('files:readText', (_e, id: string, relPath: string) => {
    if (!currentRoot) throw new Error('orchestrator 루트 미설정');
    return readFileSync(safeEpisodePath(currentRoot, id, relPath), 'utf-8');
  });
}
```

- [ ] **Step 2: main/index.ts 교체 (hub:// 프로토콜 포함)**

`episode-hub/src/main/index.ts` 전체:
```ts
import { app, BrowserWindow, net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRoot, registerIpc } from './ipc';
import { safeEpisodePath } from './pathGuard';

// hub://<episodeId>/<relPath> → <root>/output/episodes/<id>/<relPath> (이미지 표시용)
protocol.registerSchemesAsPrivileged([
  { scheme: 'hub', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  protocol.handle('hub', (request) => {
    const root = getRoot();
    if (!root) return new Response('no root', { status: 404 });
    // hub://<id>/<relPath...>  (URL 표준화로 host=id)
    const u = new URL(request.url);
    const id = u.host;
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
    try {
      const filePath = safeEpisodePath(root, id, rel);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('forbidden', { status: 403 });
    }
  });

  registerIpc(() => { /* Phase A: watcher는 Task 10에서 이 훅에 연결 */ });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: preload 교체 + 타입 선언**

`episode-hub/src/preload/index.ts` 전체:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { EpisodeDetail, EpisodeSummary } from '../shared/types';

const api = {
  config: {
    get: (): Promise<{ root: string | null }> => ipcRenderer.invoke('config:get'),
    pickRoot: (): Promise<{ root: string | null }> => ipcRenderer.invoke('config:pickRoot'),
  },
  episodes: {
    list: (): Promise<EpisodeSummary[]> => ipcRenderer.invoke('episodes:list'),
    detail: (id: string): Promise<EpisodeDetail> => ipcRenderer.invoke('episodes:detail', id),
  },
  files: {
    readText: (id: string, relPath: string): Promise<string> =>
      ipcRenderer.invoke('files:readText', id, relPath),
  },
  events: {
    onEpisodesChanged: (cb: () => void): (() => void) => {
      const listener = () => cb();
      ipcRenderer.on('episodes:changed', listener);
      return () => ipcRenderer.removeListener('episodes:changed', listener);
    },
  },
};

contextBridge.exposeInMainWorld('hub', api);
export type HubApi = typeof api;
```

`episode-hub/src/preload/api.d.ts`:
```ts
import type { HubApi } from './index';

declare global {
  interface Window { hub: HubApi }
}
export {};
```

- [ ] **Step 4: 경로 이탈 차단 테스트 추가** (pathGuard는 electron 비의존 — 직접 단위 테스트)

`episode-hub/tests/safePath.test.ts`:
```ts
import { join } from 'node:path';
import { safeEpisodePath } from '../src/main/pathGuard';

const ROOT = join('C:', 'repo', 'orchestrator');

test('정상 상대경로 통과', () => {
  expect(safeEpisodePath(ROOT, 'ep1', 'prompts/a.md'))
    .toBe(join(ROOT, 'output', 'episodes', 'ep1', 'prompts', 'a.md'));
});

test('.. 탈출 차단', () => {
  expect(() => safeEpisodePath(ROOT, 'ep1', '../../data/secret.json')).toThrow(/이탈/);
});
```

- [ ] **Step 5: 검증**

Run: `npx vitest run && npm run typecheck`
Expected: 전체 PASS + 오류 0.

- [ ] **Step 6: Commit**

```bash
git add episode-hub/src episode-hub/tests/safePath.test.ts
git commit -m "feat(episode-hub): IPC + preload API + hub:// 이미지 프로토콜 + 경로 가드"
```

---

### Task 6: Slack 디자인 토큰 CSS + 앱 레이아웃 (사이드바 + 본문)

**Files:**
- Create: `episode-hub/src/renderer/slack.css`
- Create: `episode-hub/src/renderer/store/useHub.ts`
- Create: `episode-hub/src/renderer/components/Sidebar.tsx`
- Modify: `episode-hub/src/renderer/App.tsx`, `episode-hub/src/renderer/main.tsx`(css import)

**Interfaces:**
- Consumes: `window.hub`(T5), 타입(T2)
- Produces: `useHub` zustand 스토어 — `{ root, episodes, selectedId, detail, refresh(), select(id), pickRoot() }`. 이후 태스크 컴포넌트가 사용.

- [ ] **Step 1: 디자인 토큰 CSS**

`episode-hub/src/renderer/slack.css` (DESIGN-slack.md 토큰 verbatim):
```css
/* Slack 디자인 언어 — DESIGN-slack.md 토큰 (verbatim) */
:root {
  --primary: #4a154b;
  --primary-press: #611f69;
  --primary-tint: #592466;
  --on-primary: #ffffff;
  --on-aubergine-mute: #d9bdde;
  --ink: #1d1d1d;
  --ink-mute: #696969;
  --link-blue: #1264a3;
  --canvas: #ffffff;
  --canvas-cream: #f4ede4;
  --canvas-lavender: #f9f0ff;
  --hairline: #e6e6e6;
  --error: #cc4117;
  --success: #007a5a;
  --r-sm: 4px; --r-md: 8px; --r-lg: 12px; --r-xl: 16px; --r-pill: 90px;
}

* { box-sizing: border-box; margin: 0; }

body {
  font-family: 'Pretendard', 'Inter', system-ui, -apple-system, sans-serif;
  color: var(--ink);
  background: var(--canvas);
  font-size: 16px;
  line-height: 1.55;
}

.layout { display: flex; height: 100vh; }

/* ─ 사이드바: 오베르진 (Slack 문법) ─ */
.sidebar {
  width: 260px; flex-shrink: 0;
  background: var(--primary);
  color: var(--on-primary);
  display: flex; flex-direction: column;
  padding: 16px 0;
}
.sidebar h1 { font-size: 18px; font-weight: 700; padding: 0 16px 12px; letter-spacing: -0.02px; }
.sidebar .section-label {
  font-size: 12px; font-weight: 700; letter-spacing: 0.96px;
  text-transform: uppercase; color: var(--on-aubergine-mute);
  padding: 8px 16px 4px;
}
.ep-item {
  display: block; width: 100%; text-align: left; border: 0; cursor: pointer;
  background: transparent; color: var(--on-aubergine-mute);
  padding: 6px 16px; font-size: 15px; border-radius: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ep-item:hover { background: var(--primary-tint); color: var(--on-primary); }
.ep-item.selected { background: var(--primary-press); color: var(--on-primary); font-weight: 700; }
.ep-item .badge-error { color: #ffb59f; margin-left: 6px; }
.sidebar .footer { margin-top: auto; padding: 12px 16px; border-top: 1px solid var(--primary-tint); }

/* ─ 필 버튼 (rounded.pill 90px, over-padded) ─ */
.btn-pill {
  border-radius: var(--r-pill); border: 0; cursor: pointer;
  font-size: 16px; font-weight: 700; padding: 14px 28px;
}
.btn-pill.primary { background: var(--primary); color: var(--on-primary); }
.btn-pill.primary:active { background: var(--primary-press); }
.btn-pill.secondary { background: var(--canvas-lavender); color: var(--ink); padding: 10px 30px; }
.btn-pill:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-pill.sm { font-size: 14.4px; padding: 8px 20px; }

/* ─ 본문 ─ */
.main { flex: 1; overflow-y: auto; padding: 24px 32px; background: var(--canvas); }
.ep-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.ep-header h2 { font-size: 32px; font-weight: 700; line-height: 1.25; letter-spacing: -0.256px; }
.ep-meta { color: var(--ink-mute); font-size: 14px; margin-bottom: 24px; }
.chip {
  display: inline-block; background: var(--canvas-cream); color: var(--ink);
  font-size: 12px; font-weight: 700; letter-spacing: 0.96px;
  border-radius: var(--r-pill); padding: 4px 12px; margin-right: 8px;
}
.chip.success { background: var(--success); color: var(--on-primary); }
.chip.error { background: var(--error); color: var(--on-primary); }

/* ─ 그룹 카드 그리드 ─ */
.group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.group-card {
  background: var(--canvas); border: 1px solid var(--hairline); border-radius: var(--r-xl);
  padding: 20px; cursor: pointer; text-align: left;
}
.group-card:hover { background: var(--canvas-cream); }
.group-card .g-emoji { font-size: 24px; }
.group-card .g-label { font-size: 18px; font-weight: 600; margin: 6px 0 2px; }
.group-card .g-count { color: var(--ink-mute); font-size: 14px; }

/* ─ 상세(파일 목록·뷰어) ─ */
.detail-back { color: var(--link-blue); background: none; border: 0; cursor: pointer; font-size: 15px; padding: 0; margin-bottom: 12px; }
.file-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
.file-item {
  text-align: left; background: var(--canvas); border: 1px solid var(--hairline);
  border-radius: var(--r-md); padding: 10px 14px; cursor: pointer; font-size: 15px;
}
.file-item:hover { background: var(--canvas-lavender); }
.file-item.selected { border-color: var(--primary); font-weight: 700; }

.md-view {
  border: 1px solid var(--hairline); border-radius: var(--r-xl);
  padding: 24px 28px; background: var(--canvas); overflow-x: auto;
}
.md-view table { border-collapse: collapse; margin: 12px 0; }
.md-view th, .md-view td { border: 1px solid var(--hairline); padding: 6px 10px; font-size: 14px; }
.md-view pre { background: var(--canvas-cream); border-radius: var(--r-md); padding: 12px; overflow-x: auto; }
.md-view h1, .md-view h2, .md-view h3 { margin: 16px 0 8px; line-height: 1.3; }

.thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.thumb-grid figure { border: 1px solid var(--hairline); border-radius: var(--r-lg); overflow: hidden; }
.thumb-grid img { width: 100%; height: 140px; object-fit: cover; display: block; }
.thumb-grid figcaption { font-size: 12px; color: var(--ink-mute); padding: 6px 8px; word-break: break-all; }

.empty-state { color: var(--ink-mute); padding: 48px 0; text-align: center; }
```

- [ ] **Step 2: zustand 스토어**

`episode-hub/src/renderer/store/useHub.ts`:
```ts
import { create } from 'zustand';
import type { EpisodeDetail, EpisodeSummary } from '@shared/types';

interface HubState {
  root: string | null;
  episodes: EpisodeSummary[];
  selectedId: string | null;
  detail: EpisodeDetail | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  pickRoot: () => Promise<void>;
}

export const useHub = create<HubState>((set, get) => ({
  root: null,
  episodes: [],
  selectedId: null,
  detail: null,

  init: async () => {
    const { root } = await window.hub.config.get();
    set({ root });
    if (root) await get().refresh();
  },

  refresh: async () => {
    const episodes = await window.hub.episodes.list();
    set({ episodes });
    const { selectedId } = get();
    if (selectedId && episodes.some((e) => e.id === selectedId)) {
      set({ detail: await window.hub.episodes.detail(selectedId) });
    } else if (episodes.length > 0) {
      await get().select(episodes[0].id);
    } else {
      set({ selectedId: null, detail: null });
    }
  },

  select: async (id) => {
    set({ selectedId: id, detail: await window.hub.episodes.detail(id) });
  },

  pickRoot: async () => {
    const { root } = await window.hub.config.pickRoot();
    set({ root });
    if (root) await get().refresh();
  },
}));
```

- [ ] **Step 3: Sidebar + App 레이아웃**

`episode-hub/src/renderer/components/Sidebar.tsx`:
```tsx
import { useHub } from '../store/useHub';

export default function Sidebar() {
  const { episodes, selectedId, select, pickRoot, root } = useHub();
  return (
    <aside className="sidebar">
      <h1>누구의 공간 · Episode Hub</h1>
      <div className="section-label">Episodes</div>
      <nav>
        {episodes.map((ep) => (
          <button
            key={ep.id}
            className={`ep-item${ep.id === selectedId ? ' selected' : ''}`}
            onClick={() => select(ep.id)}
            title={ep.error ?? ep.title}
          >
            # {ep.title}
            {ep.error && <span className="badge-error">⚠</span>}
          </button>
        ))}
        {episodes.length === 0 && (
          <div className="ep-item" style={{ cursor: 'default' }}>에피소드 없음</div>
        )}
      </nav>
      <div className="footer">
        {/* Phase C에서 git 상태 칩으로 교체 — 지금은 루트 표시 + 변경 버튼 */}
        <div style={{ fontSize: 12, color: 'var(--on-aubergine-mute)', marginBottom: 8, wordBreak: 'break-all' }}>
          {root ?? 'orchestrator 미연결'}
        </div>
        <button className="btn-pill secondary sm" onClick={pickRoot}>폴더 변경</button>
        <button className="btn-pill secondary sm" disabled title="Phase C에서 활성화">Update</button>
      </div>
    </aside>
  );
}
```

`episode-hub/src/renderer/App.tsx` 전체 교체:
```tsx
import { useEffect } from 'react';
import Sidebar from './components/Sidebar';
import EpisodeView from './components/EpisodeView';
import { useHub } from './store/useHub';

export default function App() {
  const { init, root, pickRoot } = useHub();
  useEffect(() => { void init(); }, [init]);

  return (
    <div className="layout">
      <Sidebar />
      <main className="main">
        {root ? (
          <EpisodeView />
        ) : (
          <div className="empty-state">
            <p>orchestrator 폴더를 찾지 못했어요.</p>
            <p style={{ margin: '12px 0 20px' }}>레포를 클론한 위치의 <code>orchestrator</code> 폴더를 선택해 주세요.</p>
            <button className="btn-pill primary" onClick={pickRoot}>orchestrator 폴더 선택</button>
          </div>
        )}
      </main>
    </div>
  );
}
```

`episode-hub/src/renderer/main.tsx`에 `import './slack.css';` 추가 (App import 위).

임시 `episode-hub/src/renderer/components/EpisodeView.tsx` (Task 7에서 확장):
```tsx
import { useHub } from '../store/useHub';

export default function EpisodeView() {
  const { detail } = useHub();
  if (!detail) return <div className="empty-state">에피소드를 선택하세요</div>;
  return <h2>{detail.title}</h2>;
}
```

- [ ] **Step 4: dev 실행 검증 (실데이터)**

Run: `npm run typecheck && npm run dev` (백그라운드) — 사이드바에 `# 코지 빌리지, 우드 코어 룸 …` 항목, 본문에 제목 렌더 확인 후 종료. (레포 안에서 실행하므로 ⓐ 자동 발견돼야 함.)
Expected: 실제 에피소드 1개 표시, 콘솔 오류 0.

- [ ] **Step 5: Commit**

```bash
git add episode-hub/src episode-hub/index.html
git commit -m "feat(episode-hub): Slack 디자인 토큰 + 사이드바·레이아웃 + zustand 스토어"
```

---

### Task 7: 에피소드 화면 — 헤더 + 그룹 카드 8종

**Files:**
- Create: `episode-hub/src/renderer/components/EpisodeHeader.tsx`, `episode-hub/src/renderer/components/GroupGrid.tsx`
- Modify: `episode-hub/src/renderer/components/EpisodeView.tsx`

**Interfaces:**
- Consumes: `useHub().detail`, `GROUPS`(T2)
- Produces: `EpisodeView`가 `openGroup: GroupKey | null` 로컬 상태로 그리드↔상세(T8) 전환. `GroupGrid`는 `onOpen(key)` 콜백.

- [ ] **Step 1: 헤더 컴포넌트**

`episode-hub/src/renderer/components/EpisodeHeader.tsx`:
```tsx
import type { EpisodeDetail } from '@shared/types';

export default function EpisodeHeader({ detail }: { detail: EpisodeDetail }) {
  const est = detail.doc?.total_estimate;
  const skuCount = detail.doc?.products?.length ?? 0;
  const moodboard = detail.doc?.approvals?.['moodboard'] as { approved?: boolean } | undefined;
  return (
    <>
      <div className="ep-header">
        <h2>{detail.title}</h2>
        {/* Phase B에서 활성화 — 지금은 자리만 (스펙 §4-5 Complete 활성 조건) */}
        <button className="btn-pill primary" disabled title="Phase B·C에서 활성화">
          ✓ Complete
        </button>
      </div>
      <div className="ep-meta">
        <span className="chip">{detail.id}</span>
        {detail.stage && <span className="chip">{detail.stage} 단계</span>}
        {est && <span className="chip">₩{est.low.toLocaleString()}</span>}
        {skuCount > 0 && <span className="chip">{skuCount} SKU</span>}
        {moodboard?.approved && <span className="chip success">무드보드 승인</span>}
        {detail.error && <span className="chip error">{detail.error}</span>}
      </div>
    </>
  );
}
```

- [ ] **Step 2: 그룹 카드 그리드**

`episode-hub/src/renderer/components/GroupGrid.tsx`:
```tsx
import { GROUPS, type GroupKey } from '@shared/groups';
import type { EpisodeDetail } from '@shared/types';

export default function GroupGrid({
  detail, onOpen,
}: { detail: EpisodeDetail; onOpen: (key: GroupKey) => void }) {
  return (
    <div className="group-grid">
      {GROUPS.map((g) => {
        const count = detail.groupCounts[g.key];
        return (
          <button key={g.key} className="group-card" onClick={() => onOpen(g.key)}>
            <div className="g-emoji">{g.emoji}</div>
            <div className="g-label">{g.label}</div>
            <div className="g-count">{count > 0 ? `${count}개 파일` : '비어 있음'}</div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: EpisodeView 조립**

`episode-hub/src/renderer/components/EpisodeView.tsx` 전체 교체:
```tsx
import { useEffect, useState } from 'react';
import type { GroupKey } from '@shared/groups';
import EpisodeHeader from './EpisodeHeader';
import GroupGrid from './GroupGrid';
import GroupDetail from './GroupDetail';
import { useHub } from '../store/useHub';

export default function EpisodeView() {
  const { detail } = useHub();
  const [openGroup, setOpenGroup] = useState<GroupKey | null>(null);

  // 에피소드 전환 시 그리드로 복귀
  useEffect(() => { setOpenGroup(null); }, [detail?.id]);

  if (!detail) return <div className="empty-state">에피소드를 선택하세요</div>;
  return (
    <>
      <EpisodeHeader detail={detail} />
      {openGroup ? (
        <GroupDetail detail={detail} group={openGroup} onBack={() => setOpenGroup(null)} />
      ) : (
        <GroupGrid detail={detail} onOpen={setOpenGroup} />
      )}
    </>
  );
}
```

임시 `episode-hub/src/renderer/components/GroupDetail.tsx` (Task 8에서 완성):
```tsx
import type { GroupKey } from '@shared/groups';
import type { EpisodeDetail } from '@shared/types';

export default function GroupDetail({
  detail, group, onBack,
}: { detail: EpisodeDetail; group: GroupKey; onBack: () => void }) {
  return (
    <div>
      <button className="detail-back" onClick={onBack}>← 전체 보기</button>
      <p>{group}: {detail.files[group].length}개 파일 (Task 8에서 뷰어)</p>
    </div>
  );
}
```

- [ ] **Step 4: dev 검증**

Run: `npm run typecheck && npm run dev` — 헤더(제목·₩667,250·10 SKU·무드보드 승인 칩·disabled Complete 필 버튼) + 8개 카드(기획 1·제품 다수·렌더 프롬프트 2·**렌더 결과 8** — 실물 PNG 8장 존재) 표시, 카드 클릭→상세 자리→뒤로 확인.
Expected: 실데이터 정합, 콘솔 오류 0.

- [ ] **Step 5: Commit**

```bash
git add episode-hub/src/renderer
git commit -m "feat(episode-hub): 에피소드 헤더 + 그룹 카드 8종 대시보드"
```

---

### Task 8: 그룹 상세 — 파일 목록 + md 뷰어 + 이미지 썸네일

**Files:**
- Create: `episode-hub/src/renderer/components/MarkdownView.tsx`
- Modify: `episode-hub/src/renderer/components/GroupDetail.tsx` (전면 교체)

**Interfaces:**
- Consumes: `window.hub.files.readText`, `hub://` 프로토콜(T5), `FileEntry`(T2)
- Produces: `MarkdownView({ id, relPath })` — 이후 태스크(프롬프트 작업대)도 재사용.

- [ ] **Step 1: MarkdownView**

`episode-hub/src/renderer/components/MarkdownView.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { marked } from 'marked';

export default function MarkdownView({ id, relPath }: { id: string; relPath: string }) {
  const [html, setHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setHtml(''); setError(null);
    window.hub.files.readText(id, relPath)
      .then((text) => { if (alive) setHtml(marked.parse(text, { async: false }) as string); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [id, relPath]);

  if (error) return <div className="chip error">{error}</div>;
  // 로컬 신뢰 콘텐츠(자기 레포 md)만 렌더 — 외부 입력 아님
  return <div className="md-view" dangerouslySetInnerHTML={{ __html: html }} />;
}
```

- [ ] **Step 2: GroupDetail 완성**

`episode-hub/src/renderer/components/GroupDetail.tsx` 전체 교체:
```tsx
import { useState } from 'react';
import { GROUPS, type GroupKey } from '@shared/groups';
import type { EpisodeDetail, FileEntry } from '@shared/types';
import MarkdownView from './MarkdownView';
import PromptsWorkbench from './PromptsWorkbench';

const hubUrl = (id: string, relPath: string) =>
  `hub://${id}/${relPath.split('/').map(encodeURIComponent).join('/')}`;

export default function GroupDetail({
  detail, group, onBack,
}: { detail: EpisodeDetail; group: GroupKey; onBack: () => void }) {
  const files = detail.files[group];
  const mds = files.filter((f) => f.kind === 'md');
  const images = files.filter((f) => f.kind === 'image');
  const [openMd, setOpenMd] = useState<FileEntry | null>(mds[0] ?? null);
  const label = GROUPS.find((g) => g.key === group)!;

  return (
    <div>
      <button className="detail-back" onClick={onBack}>← 전체 보기</button>
      <h3 style={{ margin: '4px 0 16px' }}>{label.emoji} {label.label}</h3>

      {group === 'prompts' ? (
        <PromptsWorkbench detail={detail} />
      ) : (
        <>
          {mds.length > 0 && (
            <div className="file-list">
              {mds.map((f) => (
                <button
                  key={f.relPath}
                  className={`file-item${openMd?.relPath === f.relPath ? ' selected' : ''}`}
                  onClick={() => setOpenMd(f)}
                >
                  📄 {f.name}
                </button>
              ))}
            </div>
          )}
          {openMd && <MarkdownView id={detail.id} relPath={openMd.relPath} />}
          {images.length > 0 && (
            <div className="thumb-grid" style={{ marginTop: 20 }}>
              {images.map((f) => (
                <figure key={f.relPath}>
                  <img src={hubUrl(detail.id, f.relPath)} alt={f.name} loading="lazy" />
                  <figcaption>{f.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {files.length === 0 && <div className="empty-state">아직 산출물이 없어요</div>}
        </>
      )}
    </div>
  );
}
```

임시 `episode-hub/src/renderer/components/PromptsWorkbench.tsx` (Task 9에서 완성):
```tsx
import type { EpisodeDetail } from '@shared/types';

export default function PromptsWorkbench({ detail }: { detail: EpisodeDetail }) {
  return <p>렌더 작업대 (Task 9): {detail.files.prompts.length}개 프롬프트 문서</p>;
}
```

- [ ] **Step 3: dev 검증**

Run: `npm run typecheck && npm run dev` — 🛋️ 제품 카드 열어 confirmed_room md 렌더(표 포함) + 제품 사진 썸네일 그리드(hub:// 로드), 🎬 대본 카드에서 콘티 md 5-column 표 렌더 확인.
Expected: md 표·이미지 정상, 콘솔 오류 0.

- [ ] **Step 4: Commit**

```bash
git add episode-hub/src/renderer
git commit -m "feat(episode-hub): 그룹 상세 — md 뷰어(marked) + hub:// 이미지 썸네일"
```

---

### Task 9: 렌더 작업대 — 마스터시트 SKU ↔ 제품 사진 매칭 + 프롬프트 복사

**Files:**
- Create: `episode-hub/src/renderer/lib/promptMatch.ts`
- Modify: `episode-hub/src/renderer/components/PromptsWorkbench.tsx` (전면 교체)
- Test: `episode-hub/tests/promptMatch.test.ts`

**Interfaces:**
- Consumes: `files.readText`, `FileEntry`, `ProductItem`(T2)
- Produces:
  - `parseMasterSheet(md: string): SkuSection[]` — `interface SkuSection { index: number; category: string; model: string; blocks: PromptBlock[] }`, `interface PromptBlock { label: string; text: string }`. 마스터시트 md의 `## N. [카테고리] 모델명` 섹션과 그 안의 ```코드펜스``` 프롬프트 추출(직전 `**라벨**` 행이 라벨).
  - `matchPhoto(category: string, images: FileEntry[]): FileEntry | null` — products 이미지 파일명에 카테고리 토큰(공백→`_` 정규화, 예: `p1_책상_…jpg`)이 포함되면 매칭.

- [ ] **Step 1: 실패 테스트 작성**

`episode-hub/tests/promptMatch.test.ts`:
```ts
import { parseMasterSheet, matchPhoto } from '../src/renderer/lib/promptMatch';
import type { FileEntry } from '@shared/types';

const MD = `# 마스터시트

## 사용 흐름
1. 어쩌고

## 1. [책상] 직사각형 학생용 책상

**영문 (Midjourney·DALL-E)**

\`\`\`
Product reference sheet, four orthographic views
\`\`\`

**한글 (Imagen3 KO)**

\`\`\`
제품 레퍼런스 시트, 4각도
\`\`\`

## 2. [의자] LINGGA 사무용의자

**영문 (Midjourney·DALL-E)**

\`\`\`
Ergonomic chair sheet
\`\`\`
`;

test('parseMasterSheet — SKU 섹션·라벨·프롬프트 추출', () => {
  const secs = parseMasterSheet(MD);
  expect(secs).toHaveLength(2);
  expect(secs[0]).toMatchObject({ index: 1, category: '책상', model: '직사각형 학생용 책상' });
  expect(secs[0].blocks).toHaveLength(2);
  expect(secs[0].blocks[0].label).toContain('영문');
  expect(secs[0].blocks[0].text).toBe('Product reference sheet, four orthographic views');
  expect(secs[1].category).toBe('의자');
});

test('parseMasterSheet — SKU 패턴 없는 md는 빈 배열', () => {
  expect(parseMasterSheet('# 방 렌더\n\n본문')).toEqual([]);
});

const img = (name: string): FileEntry =>
  ({ name, relPath: `products/${name}`, kind: 'image', mtimeMs: 0 });

test('matchPhoto — 파일명 카테고리 토큰 매칭 (공백→_ 정규화)', () => {
  const images = [img('p1_책상_13389803700.jpg'), img('p2_라탄_수납함_5778.jpg')];
  expect(matchPhoto('책상', images)?.name).toBe('p1_책상_13389803700.jpg');
  expect(matchPhoto('라탄 수납함', images)?.name).toBe('p2_라탄_수납함_5778.jpg');
  expect(matchPhoto('없는것', images)).toBeNull();
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/promptMatch.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`episode-hub/src/renderer/lib/promptMatch.ts`:
```ts
import type { FileEntry } from '@shared/types';

export interface PromptBlock { label: string; text: string }
export interface SkuSection { index: number; category: string; model: string; blocks: PromptBlock[] }

const SKU_HEADING = /^##\s+(\d+)\.\s+\[([^\]]+)\]\s*(.*)$/;

/** agent8 마스터시트 md → SKU 섹션별 프롬프트 블록 (## N. [카테고리] 모델 + ```펜스```) */
export function parseMasterSheet(md: string): SkuSection[] {
  const lines = md.split(/\r?\n/);
  const sections: SkuSection[] = [];
  let cur: SkuSection | null = null;
  let label = '';
  let inFence = false;
  let fenceBuf: string[] = [];

  for (const line of lines) {
    if (inFence) {
      if (line.startsWith('```')) {
        inFence = false;
        cur?.blocks.push({ label: label || `프롬프트 ${(cur?.blocks.length ?? 0) + 1}`, text: fenceBuf.join('\n').trim() });
        fenceBuf = [];
      } else {
        fenceBuf.push(line);
      }
      continue;
    }
    const m = line.match(SKU_HEADING);
    if (m) {
      cur = { index: Number(m[1]), category: m[2].trim(), model: m[3].trim(), blocks: [] };
      sections.push(cur);
      label = '';
      continue;
    }
    if (line.startsWith('## ')) { cur = null; continue; } // SKU 아닌 섹션
    const lm = line.match(/^\*\*(.+?)\*\*/);
    if (lm) { label = lm[1].trim(); continue; }
    if (line.startsWith('```') && cur) { inFence = true; fenceBuf = []; }
  }
  return sections;
}

const norm = (s: string) => s.replace(/\s+/g, '_');

/** 카테고리 → products 이미지 매칭 (agent7 저장 규칙: p<phase>_<카테고리 공백→_>_<id>.<ext>) */
export function matchPhoto(category: string, images: FileEntry[]): FileEntry | null {
  const token = norm(category.trim());
  return images.find((f) => f.name.includes(token)) ?? null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/promptMatch.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: 작업대 컴포넌트**

`episode-hub/src/renderer/components/PromptsWorkbench.tsx` 전체 교체:
```tsx
import { useEffect, useMemo, useState } from 'react';
import type { EpisodeDetail, FileEntry } from '@shared/types';
import MarkdownView from './MarkdownView';
import { matchPhoto, parseMasterSheet, type SkuSection } from '../lib/promptMatch';

const hubUrl = (id: string, relPath: string) =>
  `hub://${id}/${relPath.split('/').map(encodeURIComponent).join('/')}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-pill secondary sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '✓ 복사됨' : '📋 복사'}
    </button>
  );
}

export default function PromptsWorkbench({ detail }: { detail: EpisodeDetail }) {
  const master = detail.files.prompts.find((f) => f.name === 'master_sheets_prompts.md');
  const roomMd = detail.files.prompts.find((f) => f.name === 'room_render_prompts.md');
  const images = detail.files.products.filter((f) => f.kind === 'image');
  const [tab, setTab] = useState<'sku' | 'room'>('sku');
  const [sections, setSections] = useState<SkuSection[]>([]);

  useEffect(() => {
    if (!master) return;
    window.hub.files.readText(detail.id, master.relPath)
      .then((md) => setSections(parseMasterSheet(md)))
      .catch(() => setSections([]));
  }, [detail.id, master?.relPath]);

  const matched = useMemo(
    () => sections.map((s) => ({ s, photo: matchPhoto(s.category, images) })),
    [sections, images],
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button className={`btn-pill sm ${tab === 'sku' ? 'primary' : 'secondary'}`} onClick={() => setTab('sku')}>
          제품 마스터시트 ({sections.length})
        </button>{' '}
        <button className={`btn-pill sm ${tab === 'room' ? 'primary' : 'secondary'}`} onClick={() => setTab('room')}>
          방 렌더 (Phase 0~5)
        </button>
      </div>

      {tab === 'sku' && matched.map(({ s, photo }) => (
        <div key={s.index} className="group-card" style={{ cursor: 'default', marginBottom: 16, display: 'flex', gap: 16 }}>
          {photo ? (
            <img src={hubUrl(detail.id, photo.relPath)} alt={s.category}
                 style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 'var(--r-lg)', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 120, height: 120, background: 'var(--canvas-cream)', borderRadius: 'var(--r-lg)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          color: 'var(--ink-mute)', fontSize: 12 }}>사진 없음</div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="g-label">{s.index}. [{s.category}] {s.model}</div>
            {s.blocks.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                <span style={{ fontSize: 13, color: 'var(--ink-mute)', flexShrink: 0 }}>{b.label}</span>
                <CopyButton text={b.text} />
              </div>
            ))}
          </div>
        </div>
      ))}
      {tab === 'sku' && sections.length === 0 && (
        <div className="empty-state">마스터시트 프롬프트가 없어요 (Agent 8 실행 필요)</div>
      )}

      {tab === 'room' && (roomMd
        ? <MarkdownView id={detail.id} relPath={roomMd.relPath} />
        : <div className="empty-state">방 렌더 프롬프트가 없어요 (프롬프트팀 Phase 8B 실행 필요)</div>)}
    </div>
  );
}
```

- [ ] **Step 6: dev 검증**

Run: `npm run typecheck && npm run dev` — 🎨 카드 열기: SKU 10행 각각 [제품 사진|라벨|복사 버튼] 확인, 복사 버튼 → 클립보드에 프롬프트, "방 렌더" 탭 → room_render_prompts.md 렌더.
Expected: 10 SKU 전부 사진 매칭(또는 "사진 없음" 자리), 복사 동작.

- [ ] **Step 7: Commit**

```bash
git add episode-hub/src/renderer episode-hub/tests/promptMatch.test.ts
git commit -m "feat(episode-hub): 렌더 작업대 — SKU·사진 매칭 + 프롬프트 원클릭 복사"
```

---

### Task 10: 파일 감시(watcher) + 자동 갱신 + 레포 문서 등재

**Files:**
- Create: `episode-hub/src/main/watcher.ts`
- Modify: `episode-hub/src/main/index.ts` (watcher 연결), `episode-hub/src/renderer/App.tsx` (이벤트 구독)
- Modify: `COMMIT_CONVENTION.md` (scope에 `episode-hub`), 루트 `CLAUDE.md` (Repo layout에 `episode-hub/` 1줄)

**Interfaces:**
- Consumes: chokidar, `episodes:changed` 이벤트 채널(T5 preload에 이미 정의)
- Produces: `startWatcher(root: string, notify: () => void): () => void` — debounce 500ms, stop 함수 반환.

- [ ] **Step 1: watcher 구현**

`episode-hub/src/main/watcher.ts`:
```ts
import { watch, type FSWatcher } from 'chokidar';
import { join } from 'node:path';

/** output/episodes 감시 → 변경 시 notify (500ms debounce). 반환 = 정지 함수. */
export function startWatcher(root: string, notify: () => void): () => void {
  const target = join(root, 'output', 'episodes');
  const watcher: FSWatcher = watch(target, {
    ignoreInitial: true,
    depth: 4,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  watcher.on('all', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(notify, 500);
  });
  return () => { void watcher.close(); };
}
```

- [ ] **Step 2: main 연결**

`episode-hub/src/main/index.ts`의 `app.whenReady()` 블록을 다음으로 교체 (창 참조·watcher 훅):
```ts
let stopWatcher: (() => void) | null = null;
let mainWin: BrowserWindow | null = null;

app.whenReady().then(() => {
  protocol.handle('hub', (request) => {
    const root = getRoot();
    if (!root) return new Response('no root', { status: 404 });
    const u = new URL(request.url);
    const id = u.host;
    const rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
    try {
      const filePath = safeEpisodePath(root, id, rel);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('forbidden', { status: 403 });
    }
  });

  registerIpc((root) => {
    stopWatcher?.();
    stopWatcher = startWatcher(root, () => {
      mainWin?.webContents.send('episodes:changed');
    });
  });

  mainWin = createWindow();
});
```
(상단 import에 `import { startWatcher } from './watcher';` 추가, `createWindow()`가 `win`을 반환하도록 이미 T5에서 작성됨.)

- [ ] **Step 3: renderer 구독**

`episode-hub/src/renderer/App.tsx`의 `useEffect`를:
```tsx
useEffect(() => {
  void init();
  const off = window.hub.events.onEpisodesChanged(() => { void useHub.getState().refresh(); });
  return off;
}, [init]);
```

- [ ] **Step 4: 라이브 검증 (읽기 전용 — orchestrator 밖 임시 파일로)**

Run: `npm run dev` 실행 상태에서 별도 셸로:
```bash
echo "# watch test" > ../orchestrator/output/episodes/ep20260628_ippool-g009/renders/_watch_test.md
```
→ 앱의 🖼️ 렌더 결과 카운트가 **8→9** 자동 갱신 확인 후 **즉시 삭제**:
```bash
rm ../orchestrator/output/episodes/ep20260628_ippool-g009/renders/_watch_test.md
```
→ 다시 8로 갱신 확인. (renders/는 gitignored라 git 오염 없음 — `git status --short`로 확인.)
Expected: 수동 새로고침 없이 양방향 반영.

- [ ] **Step 5: 레포 문서 등재** (scope는 Task 1에서 등재됨)

- 루트 `CLAUDE.md` "Repo layout" 코드블록의 `interior-studio/` 다음 줄에:
  `episode-hub/          Electron 에피소드 허브 앱 — output/episodes/를 한 화면에서 열람·작업 (Phase A 읽기 전용, 스펙 docs/superpowers/specs/2026-07-05-episode-hub-design.md). **two-layer 모델 밖의 독립 앱**.`

- [ ] **Step 6: 전체 게이트**

Run: `npx vitest run && npm run typecheck`
Expected: 전 테스트 PASS(약 15+) + 오류 0.

- [ ] **Step 7: Commit**

```bash
git add episode-hub/ COMMIT_CONVENTION.md CLAUDE.md
git commit -m "feat(episode-hub): chokidar 자동 갱신 + 레포 문서 등재 — Phase A 완성"
```

---

## Phase A가 하지 않는 것 (후속 플랜 — 스펙 §5)

- **Phase B**: md 편집 저장 · 렌더 이미지 드래그 저장(규칙명) · 승인 기록(episode.json 쓰기) · Complete 활성 조건
- **Phase C**: git 동기화 (fetch/pull·Update·Complete commit+push·상태 칩)
- **Phase D**: electron-builder NSIS 패키징 · 설치 가이드 · e2e(playwright)
