import { useEffect, useState } from 'react';
import { marked } from 'marked';

export default function MarkdownView({ id, relPath }: { id: string; relPath: string }) {
  const [html, setHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setHtml(''); setError(null);
    window.hub.files.readText(id, relPath)
      .then((text) => { if (alive) setHtml(marked.parse(text, { async: false }) as string); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [id, relPath]);

  if (error) return <div className="chip error">{error}</div>;
  // 로컬 신뢰 콘텐츠(자기 레포 md)만 렌더 — 외부 입력 아님
  return <div className="md-view" dangerouslySetInnerHTML={{ __html: html }} />;
}
