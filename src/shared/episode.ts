export interface ApprovalRecord {
  approved?: boolean;
  by?: string;
  at?: string;
}

// 고정 Owner 게이트 (스펙 §2). 확장 시 이 배열만 수정.
export const APPROVAL_GATES = [
  { key: 'moodboard', label: '무드보드' },
  { key: 'script_final', label: '콘티 FINAL' },
] as const;

export type RenderRow = 'row1' | 'row2';
export const RENDER_ROWS: readonly RenderRow[] = ['row1', 'row2'];

// episode.json stage 허용 값 (스튜디오 보드 스테이지 체인과 정합)
export const STAGES = [
  '기획', '디자인', '리서치', '확정룸', '렌더',
  '생성', '제작', '검수', '발행대기', '완료',
] as const;

// 발행 플랫폼 (Phase D — 발행 기록·대시보드 집계·달력 색상의 단일 출처)
// 배열 순서 = 화면 렌더(인접) 순서 — dataviz 검증기 ALL PASS 조합 (CVD·대비, 2026-07-08)
export const PLATFORMS = [
  { key: 'youtube', label: '유튜브 본편', color: '#ea4f23' },
  { key: 'blog', label: '블로그', color: '#246d38' },
  { key: 'instagram', label: '인스타', color: '#b465a6' },
  { key: 'shorts', label: '쇼츠', color: '#8f8412' },
  { key: 'threads', label: '쓰레드', color: '#2e6fa7' },
] as const;
export type PlatformKey = (typeof PLATFORMS)[number]['key'];

export interface Publication {
  platform: PlatformKey;
  date: string; // YYYY-MM-DD
  url?: string;
  at?: string; // 기록 시각 (ISO)
}

/** 카테고리 정규화 — 렌더 파일명·사진 매칭 공통 규칙 (공백→_ + trim) */
export function normCategory(s: string): string {
  return s.trim().replace(/\s+/g, '_');
}
