import { useEffect, useState } from 'react';
import { GROUPS, type GroupKey } from '@shared/groups';
import { APPROVAL_GATES, STAGES } from '@shared/episode';
import EpisodeHeader from './EpisodeHeader';
import GroupDetail from './GroupDetail';
import { useHub } from '../store/useHub';

export default function EpisodeView() {
  const { detail, patchEpisode } = useHub();
  const [tab, setTab] = useState<GroupKey>('planning');

  // 에피소드 전환 시 첫 탭(기획)으로 복귀 (Owner 결정 2026-07-07)
  useEffect(() => { setTab('planning'); }, [detail?.id]);

  if (!detail) return <div className="empty-state">에피소드를 선택하세요</div>;
  return (
    <>
      <EpisodeHeader key={detail.id} detail={detail} />
      <div className="approval-strip">
        {APPROVAL_GATES.map((g) => {
          const on = detail.doc?.approvals?.[g.key]?.approved === true;
          return (
            <button
              key={g.key}
              className={`gate-chip${on ? ' on' : ''}`}
              onClick={() => patchEpisode(on ? { unapprove: { key: g.key } } : { approve: { key: g.key } })}
            >
              {on ? '✓ ' : ''}{g.label}
            </button>
          );
        })}
        <select
          className="stage-select"
          value={detail.stage || ''}
          onChange={(e) => patchEpisode({ stage: e.target.value })}
        >
          <option value="" disabled>단계 선택</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <nav className="tab-bar">
        {GROUPS.map((g) => {
          const count = detail.groupCounts[g.key];
          return (
            <button
              key={g.key}
              className={`tab${tab === g.key ? ' active' : ''}${count === 0 ? ' empty' : ''}`}
              onClick={() => setTab(g.key)}
            >
              <span className="tab-emoji" aria-hidden>{g.emoji}</span>
              {g.label}
              <span className="tab-count">{count}</span>
            </button>
          );
        })}
      </nav>
      {/* key=tab — 탭 전환 시 리마운트로 그룹별 내부 상태(선택 md 등) 초기화 */}
      <GroupDetail key={tab} detail={detail} group={tab} />
    </>
  );
}
