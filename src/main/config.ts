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
    if (typeof cfg?.orchestratorRoot !== 'string') return null;
    const out: HubConfig = { orchestratorRoot: cfg.orchestratorRoot };
    if (typeof cfg.imageRoot === 'string') out.imageRoot = cfg.imageRoot;
    return out;
  } catch {
    return null;
  }
}

export function saveConfig(file: string, cfg: HubConfig): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
}

/** 기존 config에 patch를 병합해 저장. orchestratorRoot가 없으면(신규+patch에도 없음) throw. */
export function updateConfig(file: string, patch: Partial<HubConfig>): HubConfig {
  const existing = loadConfig(file);
  const orchestratorRoot = patch.orchestratorRoot ?? existing?.orchestratorRoot;
  if (!orchestratorRoot) throw new Error('orchestratorRoot 미설정 상태에서 config 병합 불가');
  const merged: HubConfig = { ...existing, ...patch, orchestratorRoot };
  saveConfig(file, merged);
  return merged;
}

/**
 * orchestrator/.env 에서 키를 읽는다 (orchestrator lib_config.py와 동일 규칙).
 * YOUR_ 플레이스홀더·빈값·파일없음은 null. OS env 우선순위는 호출측(statsFetcher)에서.
 */
export function readEnvKey(orchestratorRoot: string, name: string): string | null {
  try {
    const raw = readFileSync(join(orchestratorRoot, '.env'), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      if (t.slice(0, i).trim() !== name) continue;
      const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!v || v.toUpperCase().startsWith('YOUR_')) return null;
      return v;
    }
    return null;
  } catch {
    return null;
  }
}
