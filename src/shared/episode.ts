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

/** 카테고리 정규화 — 렌더 파일명·사진 매칭 공통 규칙 (공백→_ + trim) */
export function normCategory(s: string): string {
  return s.trim().replace(/\s+/g, '_');
}
