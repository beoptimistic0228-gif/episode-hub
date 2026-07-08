import { GROUPS } from '@shared/groups';
import { APPROVAL_GATES, PLATFORMS } from '@shared/episode';
import { latestSnapshot, snapshotOnOrBefore, computeDelta, type Delta } from '@shared/stats';
import PublishCalendar from './PublishCalendar';
import GrowthChart from './charts/GrowthChart';
import PublishTrendChart from './charts/PublishTrendChart';
import { useHub } from '../store/useHub';

function DeltaBadge({ d }: { d: Delta }) {
  if (d.sign === 'flat') return null;
  const sym = d.sign === 'up' ? '▲' : '▼';
  const color = d.sign === 'up' ? '#246d38' : '#ea4f23'; // forest/ember, 기호 병기(접근성)
  return <span className="kpi-delta" style={{ color }}>{sym}{Math.abs(d.value).toLocaleString()}</span>;
}

export default function Dashboard() {
  const { episodes, openEpisode, stats, refreshStats } = useHub();
  const pubs = episodes.flatMap((e) => e.publications);
  const countOf = (key: string) => pubs.filter((p) => p.platform === key).length;

  const snapshots = stats?.snapshots ?? [];
  const cur = latestSnapshot(stats ?? { schema_version: 1, snapshots: [], videos: {} });
  const base = cur ? snapshotOnOrBefore(stats!, prevWeek(cur.date)) : null;

  const budget = episodes.reduce((sum, e) => sum + (e.estimateLow ?? 0), 0);
  const totalGroups = GROUPS.length;
  const pipeline = episodes.length
    ? Math.round((episodes.reduce((s, e) => s + GROUPS.filter((g) => e.groupCounts[g.key] > 0).length, 0) / (episodes.length * totalGroups)) * 100)
    : 0;

  return (
    <div className="dashboard">
      <div className="dash-head">
        <h2 className="dash-title">대시보드</h2>
        <div className="dash-head-right">
          {cur && <span className="dash-updated">갱신 {relTime(cur.at)}</span>}
          <button className="refresh-btn" onClick={() => void refreshStats()}>🔄 새로고침</button>
        </div>
      </div>

      {/* ① KPI 요약 강화 */}
      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-num">{cur?.youtube ? cur.youtube.subscribers.toLocaleString() : '—'}
            {cur?.youtube && base?.youtube && <DeltaBadge d={computeDelta(cur.youtube.subscribers, base.youtube.subscribers)} />}</span>
          <span className="stat-label">구독자</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{cur?.youtube ? cur.youtube.views.toLocaleString() : '—'}
            {cur?.youtube && base?.youtube && <DeltaBadge d={computeDelta(cur.youtube.views, base.youtube.views)} />}</span>
          <span className="stat-label">총 조회수</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{cur?.blog ? cur.blog.neighbors.toLocaleString() : '—'}
            {cur?.blog && base?.blog && <DeltaBadge d={computeDelta(cur.blog.neighbors, base.blog.neighbors)} />}</span>
          <span className="stat-label">블로그 이웃</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">₩{budget.toLocaleString()}</span>
          <span className="stat-label">누적 예산</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{episodes.length}</span>
          <span className="stat-label">에피소드</span>
        </div>
        <div className="stat-tile">
          <span className="stat-num">{pipeline}%</span>
          <span className="stat-label">파이프라인 진척</span>
        </div>
      </div>
      {cur && cur.sources.youtube === 'error' && (
        <div className="stat-note">⚠️ 유튜브 통계를 못 불러왔어요 — orchestrator/.env 의 YOUTUBE_API_KEY 를 확인해주세요.</div>
      )}
      {cur && cur.sources.blog !== 'ok' && (
        <div className="stat-note">⚠️ 블로그 통계가 최신이 아닐 수 있어요 (마지막값 표시).</div>
      )}

      {/* ②③ 그래프 2단 */}
      <div className="chart-row">
        <GrowthChart snapshots={snapshots} />
        <PublishTrendChart publications={pubs} />
      </div>

      {/* ④ 발행 달력 (기존) */}
      <PublishCalendar episodes={episodes} />

      {/* ⑤ 에피소드 현황 (기존 + 조회수 배지) */}
      <h3 className="dash-sub">에피소드 현황</h3>
      <div className="ep-cards">
        {episodes.map((ep) => (
          <button key={ep.id} className="ep-card" onClick={() => openEpisode(ep.id)}>
            <div className="ep-card-head">
              <span className="ep-card-title">{ep.title}</span>
              {ep.youtubeViews !== undefined && <span className="views-tag">▶ {ep.youtubeViews.toLocaleString()}</span>}
              {ep.estimateLow !== undefined && <span className="price-tag sm">₩{ep.estimateLow.toLocaleString()}</span>}
            </div>
            <div className="ep-card-gates">
              {APPROVAL_GATES.map((g) => (
                <span key={g.key} className={`gate-chip mini${ep.approvals[g.key] ? ' on' : ''}`}>
                  {ep.approvals[g.key] ? '✓ ' : ''}{g.label}
                </span>
              ))}
              {ep.error && <span className="chip error">{ep.error}</span>}
            </div>
            <div className="ep-card-groups">
              {GROUPS.map((g) => (
                <span key={g.key} className={`group-dot${ep.groupCounts[g.key] > 0 ? ' filled' : ''}`} title={`${g.label}: ${ep.groupCounts[g.key]}개`}>
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

/** date(YYYY-MM-DD)의 7일 전 */
function prevWeek(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/** ISO 시각 → "N시간 전" (Date.now는 렌더 시점 허용 — 표시용) */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return '방금';
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
