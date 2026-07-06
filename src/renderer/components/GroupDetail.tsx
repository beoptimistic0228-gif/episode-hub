import type { GroupKey } from '@shared/groups';
import type { EpisodeDetail } from '@shared/types';

export default function GroupDetail({
  detail, group, onBack,
}: { detail: EpisodeDetail; group: GroupKey; onBack: () => void }) {
  return (
    <div>
      <button className="detail-back" onClick={onBack}>← 전체 보기</button>
      <p>{group}: {detail.files[group].length}개 파일 (Task 8에서 뷰어)</p>
    </div>
  );
}
