import type { FileEntry } from '@shared/types';
import { normCategory } from '@shared/episode';

export interface PromptBlock { label: string; text: string; row?: string; rowTitle?: string }
export interface SkuSection { index: number; category: string; model: string; blocks: PromptBlock[] }

const SKU_HEADING = /^##\s+(\d+)\.\s+\[([^\]]+)\]\s*(.*)$/;
const ROW_HEADING = /^###\s+Row\s+(\d+)\s*—\s*(.+)$/;

/** agent8 마스터시트 md → SKU 섹션별 프롬프트 블록 (## N. [카테고리] 모델 + ### Row + ```펜스```) */
export function parseMasterSheet(md: string): SkuSection[] {
  const lines = md.split(/\r?\n/);
  const sections: SkuSection[] = [];
  let cur: SkuSection | null = null;
  let label = '';
  let row: string | undefined;
  let rowTitle: string | undefined;
  let inFence = false;
  let fenceBuf: string[] = [];

  for (const line of lines) {
    if (inFence) {
      if (line.startsWith('```')) {
        inFence = false;
        cur?.blocks.push({
          label: label || `프롬프트 ${(cur?.blocks.length ?? 0) + 1}`,
          text: fenceBuf.join('\n').trim(),
          ...(row ? { row, rowTitle } : {}),
        });
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
      row = undefined; rowTitle = undefined;
      continue;
    }
    const rm = line.match(ROW_HEADING);
    if (rm) {
      row = `row${rm[1]}`;
      rowTitle = rm[2].trim().replace(/\s*\(.*\)$/, ''); // 괄호 부연 제거 → 짧은 제목
      continue;
    }
    if (line.startsWith('## ')) { cur = null; continue; } // SKU 아닌 섹션
    const lm = line.match(/^\*\*(.+?)\*\*/);
    if (lm) { label = lm[1].trim(); continue; }
    if (line.startsWith('```') && cur) { inFence = true; fenceBuf = []; }
  }
  return sections;
}

/** 카테고리 → products 이미지 매칭 (agent7 저장 규칙: p<phase>_<카테고리 공백→_>_<id>.<ext>) */
export function matchPhoto(category: string, images: FileEntry[]): FileEntry | null {
  const token = normCategory(category);
  return images.find((f) => f.name.includes(token)) ?? null;
}
