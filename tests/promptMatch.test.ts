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
