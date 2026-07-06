import { GROUPS, type GroupKey } from '@shared/groups';
import type { EpisodeDetail } from '@shared/types';

export default function GroupGrid({
  detail, onOpen,
}: { detail: EpisodeDetail; onOpen: (key: GroupKey) => void }) {
  return (
    <div className="group-grid">
      {GROUPS.map((g) => {
        const count = detail.groupCounts[g.key];
        return (
          <button key={g.key} className="group-card" onClick={() => onOpen(g.key)}>
            <div className="g-emoji">{g.emoji}</div>
            <div className="g-label">{g.label}</div>
            <div className="g-count">{count > 0 ? `${count}개 파일` : '비어 있음'}</div>
          </button>
        );
      })}
    </div>
  );
}
