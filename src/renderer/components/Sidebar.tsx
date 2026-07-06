import { useHub } from '../store/useHub';

export default function Sidebar() {
  const { episodes, selectedId, select, pickRoot, root } = useHub();
  return (
    <aside className="sidebar">
      <h1 className="brand">
        <span className="brand-name">누구의 공간</span>
        <span className="brand-sub">Episode Hub</span>
      </h1>
      <div className="section-label">Episodes</div>
      <nav>
        {episodes.map((ep) => (
          <button
            key={ep.id}
            className={`ep-item${ep.id === selectedId ? ' selected' : ''}`}
            onClick={() => select(ep.id)}
            title={ep.error ?? ep.title}
          >
            <span className="ep-hash">#</span> {ep.title}
            {ep.error && <span className="badge-error">⚠</span>}
          </button>
        ))}
        {episodes.length === 0 && (
          <div className="ep-item" style={{ cursor: 'default' }}>에피소드 없음</div>
        )}
      </nav>
      <div className="footer">
        {/* Phase C에서 git 상태 칩으로 교체 — 지금은 루트 표시 + 변경 버튼 */}
        <div className="root-path">{root ?? 'orchestrator 미연결'}</div>
        <div className="footer-actions">
          <button className="btn-pill secondary sm" onClick={pickRoot}>폴더 변경</button>
          <button className="btn-pill secondary sm" disabled title="Phase C에서 활성화">Update</button>
        </div>
      </div>
    </aside>
  );
}
