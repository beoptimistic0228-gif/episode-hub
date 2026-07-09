import { useHub } from '../store/useHub';
import bannerImg from '../assets/brand-banner.png';
import snsYoutube from '../assets/sns-youtube.png';
import snsInstagram from '../assets/sns-instagram.png';
import snsBlog from '../assets/sns-blog.png';

const SNS = [
  { kind: 'youtube' as const, icon: snsYoutube, label: '누구의 공간 유튜브' },
  { kind: 'instagram' as const, icon: snsInstagram, label: '인스타그램' },
  { kind: 'blog' as const, icon: snsBlog, label: '네이버 블로그' },
];

export default function Sidebar() {
  const { episodes, selectedId, openEpisode, pickRoot, pickImageRoot, migrateImages, root, imageRoot, gitStatus, gitPull, page, goDashboard } = useHub();
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
        <span className="brand-sub">누구의 공간</span>
      </h1>
      <button
        className={`ep-item nav-page${page === 'dashboard' ? ' selected' : ''}`}
        onClick={goDashboard}
      >
        🏠 대시보드
      </button>
      <div className="section-label">Episodes</div>
      <nav>
        {episodes.map((ep) => (
          <button
            key={ep.id}
            className={`ep-item${page === 'episode' && ep.id === selectedId ? ' selected' : ''}`}
            onClick={() => openEpisode(ep.id)}
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
          <button className="btn-pill secondary sm" onClick={pickImageRoot} title={imageRoot ?? '이미지 동기 폴더 미설정'}>
            {imageRoot ? '이미지 폴더 ✓' : '이미지 폴더'}
          </button>
          {imageRoot && (
            <button
              className="btn-pill secondary sm"
              title="레포의 기존 이미지를 이미지 폴더로 1회 복사"
              onClick={async () => {
                try {
                  const n = await migrateImages();
                  alert(`이미지 ${n}개를 이미지 폴더로 복사했어요.`);
                } catch (e) {
                  alert('이관 오류: ' + String(e));
                }
              }}
            >
              이미지 이관
            </button>
          )}
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
        <div className="sns-row">
          {SNS.map((s) => (
            <button key={s.kind} className="sns-btn" title={s.label} onClick={() => void window.hub.links.open(s.kind)}>
              <img src={s.icon} alt={s.label} />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
