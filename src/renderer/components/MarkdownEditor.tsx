import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { useHub } from '../store/useHub';

export default function MarkdownEditor({
  id, relPath, mtimeMs,
}: { id: string; relPath: string; mtimeMs: number }) {
  const writeText = useHub((s) => s.writeText);
  const [raw, setRaw] = useState('');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 인앱 저장 성공 시 writer가 돌려준 최신 mtime을 로컬 추적한다.
  // (openMd prop은 클릭 시점 값이라 연속 저장에서 stale → false conflict를 유발)
  const [curMtime, setCurMtime] = useState(mtimeMs);

  useEffect(() => {
    let alive = true;
    setError(null); setEditing(false); setDirty(false); setConflict(false);
    setCurMtime(mtimeMs);
    window.hub.files.readText(id, relPath)
      .then((t) => { if (alive) setRaw(t); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [id, relPath, mtimeMs]);

  const save = async (force = false) => {
    const res = await writeText(relPath, raw, force ? undefined : curMtime);
    if ('conflict' in res) { setConflict(true); return; }
    setCurMtime(res.mtimeMs);
    setDirty(false); setConflict(false);
  };

  if (error) return <div className="chip error">{error}</div>;

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        <button className={`seg-btn${!editing ? ' active' : ''}`} onClick={() => setEditing(false)}>미리보기</button>
        <button className={`seg-btn${editing ? ' active' : ''}`} onClick={() => setEditing(true)}>편집</button>
        {editing && (
          <button className="btn-pill primary sm" disabled={!dirty} onClick={() => save(false)}>
            {dirty ? '저장' : '저장됨'}
          </button>
        )}
      </div>
      {conflict && (
        <div className="banner warn">
          디스크가 더 최신입니다(외부에서 수정됨). 덮어쓰시겠어요?
          <button className="btn-pill sm" onClick={() => save(true)}>덮어쓰기</button>
        </div>
      )}
      {editing ? (
        <textarea
          className="md-textarea"
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setDirty(true); }}
        />
      ) : (
        <div className="md-view" dangerouslySetInnerHTML={{ __html: marked.parse(raw, { async: false }) as string }} />
      )}
    </div>
  );
}
