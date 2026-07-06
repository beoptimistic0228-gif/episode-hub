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
