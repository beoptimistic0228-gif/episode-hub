import type { GroupKey } from './groups';
import type { ApprovalRecord, Publication } from './episode';

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
  approvals: Record<string, ApprovalRecord>;
  total_estimate?: { low: number; high: number; label: string };
  products?: ProductItem[];
  publications?: Publication[];
}

export interface EpisodeSummary {
  id: string;
  title: string;
  stage: string;
  /** episode.json 파싱 실패·schema_version 불일치 시 사유 (카드에 오류 배지) */
  error?: string;
  groupCounts: Record<GroupKey, number>;
  /** 대시보드용 — 발행 기록·게이트 상태·견적 (Phase D) */
  publications: Publication[];
  approvals: Record<string, boolean>;
  estimateLow?: number;
  /** 발행된 유튜브 영상의 조회수 (stats.videos 조인, Phase D+) */
  youtubeViews?: number;
}

export interface FileEntry {
  name: string;
  /** episodes/<id>/ 기준 상대경로 (POSIX 구분자) */
  relPath: string;
  kind: 'md' | 'image' | 'json' | 'video' | 'other';
  mtimeMs: number;
}

export interface EpisodeDetail extends EpisodeSummary {
  doc: EpisodeDoc | null;
  files: Record<GroupKey, FileEntry[]>;
}
