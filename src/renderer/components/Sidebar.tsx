import { useHub } from '../store/useHub';
import bannerImg from '../assets/brand-banner.png';

export default function Sidebar() {
  const { episodes, selectedId, select, pickRoot, root, gitStatus, gitPull } = useHub();
  const chip = (() => {
    const s = gitStatus;
    if (!s || s.state === 'error') return { cls: 'warn', text: s?.message ? 'git: ' + s.message : 'git 사용 불가' };
    if (s.fetchFailed) return { cls: 'warn', text: '오프라인' };
    if (s.state === 'diverged') return { cls: 'err', text: '🔴 충돌 — 수동 정리 필요' };
    if (s.state === 'behind') return { cls: 'info', text: `🔵 받을 것 ${s.behind}` };
    if (s.state === 'ahead') return { cls: 'ok', text: `🟡 올릴 것 ${s.ahead}` };
    return { cls: 'ok', text: '🟢 최신' };
  })();
  return (
    <aside className="sidebar">
      <h1 className="brand">
        <img className="brand-banner" src={bannerImg} alt="누구의 공간" />
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
        <div className={`git-chip ${chip.cls}`}>{chip.text}</div>
        <div className="root-path">{root ?? 'orchestrator 미연결'}</div>
        <div className="footer-actions">
          <button className="btn-pill secondary sm" onClick={pickRoot}>폴더 변경</button>
          <button
            className="btn-pill secondary sm"
            onClick={async () => {
              try {
                const r = await gitPull();
                if (!r.ok) alert('Update 실패: ' + r.message);
              } catch (e) {
                alert('Update 오류: ' + String(e));
              }
            }}
          >
            Update
          </button>
        </div>
      </div>
    </aside>
  );
}
