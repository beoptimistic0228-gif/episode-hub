import { GROUPS } from '@shared/groups';
import { APPROVAL_GATES, PLATFORMS } from '@shared/episode';
import PublishCalendar from './PublishCalendar';
import { useHub } from '../store/useHub';

/** 전역 대시보드 — 집계 타일 + 발행 달력 + 에피소드 현황판 (Phase D 스펙 §4) */
export default function Dashboard() {
  const { episodes, openEpisode } = useHub();
  const pubs = episodes.flatMap((e) => e.publications);
  const countOf = (key: string) => pubs.filter((p) => p.platform === key).length;

  return (
    <div className="dashboard">
      <h2 className="dash-title">대시보드</h2>

      {/* 집계 타일 — 스탯 타일(차트 아님), 숫자는 잉크·색은 플랫폼 칩만 */}
      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-num">{episodes.length}</span>
          <span className="stat-label">에피소드</span>
        </div>
        {PLATFORMS.map((p) => (
          <div key={p.key} className="stat-tile">
            <span className="stat-num">{countOf(p.key)}</span>
            <span className="stat-label">
              <span className="cal-dot" style={{ background: p.color }} /> {p.label}
            </span>
          </div>
        ))}
      </div>

      <PublishCalendar episodes={episodes} />

      <h3 className="dash-sub">에피소드 현황</h3>
      <div className="ep-cards">
        {episodes.map((ep) => (
          <button key={ep.id} className="ep-card" onClick={() => openEpisode(ep.id)}>
            <div className="ep-card-head">
              <span className="ep-card-title">{ep.title}</span>
              {ep.estimateLow !== undefined && (
                <span className="price-tag sm">₩{ep.estimateLow.toLocaleString()}</span>
              )}
            </div>
            <div className="ep-card-gates">
              {APPROVAL_GATES.map((g) => (
                <span key={g.key} className={`gate-chip mini${ep.approvals[g.key] ? ' on' : ''}`}>
                  {ep.approvals[g.key] ? '✓ ' : ''}{g.label}
                </span>
              ))}
              {ep.error && <span className="chip error">{ep.error}</span>}
            </div>
            {/* 10단계 채움 점 — 산출물 있는 단계는 진하게 */}
            <div className="ep-card-groups">
              {GROUPS.map((g) => (
                <span
                  key={g.key}
                  className={`group-dot${ep.groupCounts[g.key] > 0 ? ' filled' : ''}`}
                  title={`${g.label}: ${ep.groupCounts[g.key]}개`}
                >
                  {g.emoji}
                </span>
              ))}
            </div>
          </button>
        ))}
        {episodes.length === 0 && <div className="empty-state">에피소드가 아직 없어요</div>}
      </div>
    </div>
  );
}
