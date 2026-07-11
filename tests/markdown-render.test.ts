// @vitest-environment jsdom
// DOMPurify는 DOM(window)이 필요 — 이 파일만 jsdom 환경으로 실행.
import { renderMarkdown } from '../src/renderer/lib/markdown';

describe('renderMarkdown — md → 새니타이즈된 HTML (XSS 검역)', () => {
  test('<script> 태그를 제거한다', () => {
    const html = renderMarkdown('안녕\n\n<script>alert("xss")</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('안녕');
  });

  test('인라인 이벤트 핸들러(onerror 등)를 제거한다', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  test('javascript: URL 링크를 무력화한다', () => {
    const html = renderMarkdown('[클릭](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  test('정상 마크다운(제목·굵게·표·링크)은 그대로 렌더된다', () => {
    const md = '# 제목\n\n**굵게** [링크](https://example.com)\n\n| 열 |\n|---|\n| 값 |';
    const html = renderMarkdown(md);
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>굵게</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<table>');
  });
});
