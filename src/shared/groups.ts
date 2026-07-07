export type GroupKey =
  | 'planning' | 'products' | 'prompts' | 'renders'
  | 'script' | 'publish' | 'validation' | 'manuscript'
  | 'final' | 'osmu';

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
  { key: 'final',      emoji: '🎞️', label: '최종 영상' },
  { key: 'osmu',       emoji: '📤', label: 'OSMU' },
] as const;

export const GROUP_KEYS = GROUPS.map((g) => g.key) as GroupKey[];
