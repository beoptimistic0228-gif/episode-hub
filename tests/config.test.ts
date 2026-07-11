import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveOrchestratorRoot, loadConfig, saveConfig, updateConfig } from '../src/main/config';

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

  test('ⓐ 레포 분리 후 형제 클론 ../nakgwan-channel-infra/orchestrator 최우선', () => {
    const orch = makeOrch(base, join('nakgwan-channel-infra', 'orchestrator'));
    makeOrch(base, 'orchestrator'); // 구 레이아웃도 있으면 신 레이아웃이 이김
    const appPath = join(base, 'episode-hub');
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

test('loadConfig — imageRoot 보존', () => {
  const base = mkdtempSync(join(tmpdir(), 'hub-img-'));
  const file = join(base, 'c.json');
  saveConfig(file, { orchestratorRoot: 'C:\\x\\orchestrator', imageRoot: 'G:\\Drive\\img' });
  expect(loadConfig(file)).toEqual({ orchestratorRoot: 'C:\\x\\orchestrator', imageRoot: 'G:\\Drive\\img' });
  rmSync(base, { recursive: true, force: true });
});

test('updateConfig — 기존 orchestratorRoot 보존하며 imageRoot 병합', () => {
  const base = mkdtempSync(join(tmpdir(), 'hub-upd-'));
  const file = join(base, 'c.json');
  saveConfig(file, { orchestratorRoot: 'C:\\x\\orchestrator' });
  const merged = updateConfig(file, { imageRoot: 'G:\\Drive\\img' });
  expect(merged).toEqual({ orchestratorRoot: 'C:\\x\\orchestrator', imageRoot: 'G:\\Drive\\img' });
  expect(loadConfig(file)).toEqual(merged); // 디스크에도 병합 저장
  rmSync(base, { recursive: true, force: true });
});
