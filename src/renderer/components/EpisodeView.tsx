import { useEffect, useState } from 'react';
import { GROUPS, type GroupKey } from '@shared/groups';
import { APPROVAL_GATES } from '@shared/episode';
import AgentCallout from './AgentCallout';
import EpisodeHeader from './EpisodeHeader';
import GroupDetail from './GroupDetail';
import PublicationStrip from './PublicationStrip';
import { useHub } from '../store/useHub';
import { useChat } from '../store/useChat';

export default function EpisodeView() {
  const { detail, patchEpisode } = useHub();
  const [tab, setTab] = useState<GroupKey>('planning');

  // 에피소드 전환 시 첫 탭(기획)으로 복귀 (Owner 결정 2026-07-07)
  useEffect(() => { setTab('planning'); }, [detail?.id]);

  // 패널의 대상 에피소드 갱신 — 대시보드로 나가도 마지막 에피소드 대화 유지(spec §2)
  useEffect(() => {
    if (detail?.id) void useChat.getState().setActiveEpisode(detail.id);
  }, [detail?.id]);

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
            </button>
          );
        })}
      </nav>
      <AgentCallout group={tab} />
      {tab === 'publish' && <PublicationStrip detail={detail} />}
      {/* key=tab — 탭 전환 시 리마운트로 그룹별 내부 상태(선택 md 등) 초기화 */}
      <GroupDetail key={tab} detail={detail} group={tab} />
    </>
  );
}
