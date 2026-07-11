import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * md → 새니타이즈된 HTML. 렌더 직전 검역(XSS 차단) — pull로 받는 md는
 * 작성 주체가 늘 수 있어 신뢰 불가 입력으로 취급한다.
 * 모든 dangerouslySetInnerHTML은 이 함수를 거칠 것.
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}
