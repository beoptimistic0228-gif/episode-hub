import { useEffect, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';

export default function MarkdownView({ id, relPath }: { id: string; relPath: string }) {
  const [html, setHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setHtml(''); setError(null);
    window.hub.files.readText(id, relPath)
      .then((text) => { if (alive) setHtml(renderMarkdown(text)); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [id, relPath]);

  if (error) return <div className="chip error">{error}</div>;
  return <div className="md-view" dangerouslySetInnerHTML={{ __html: html }} />;
}
