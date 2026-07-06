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
