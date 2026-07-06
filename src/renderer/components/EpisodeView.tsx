import { useEffect, useState } from 'react';
import type { GroupKey } from '@shared/groups';
import EpisodeHeader from './EpisodeHeader';
import GroupGrid from './GroupGrid';
import GroupDetail from './GroupDetail';
import { useHub } from '../store/useHub';

export default function EpisodeView() {
  const { detail } = useHub();
  const [openGroup, setOpenGroup] = useState<GroupKey | null>(null);

  // 에피소드 전환 시 그리드로 복귀
  useEffect(() => { setOpenGroup(null); }, [detail?.id]);

  if (!detail) return <div className="empty-state">에피소드를 선택하세요</div>;
  return (
    <>
      <EpisodeHeader detail={detail} />
      {openGroup ? (
        <GroupDetail detail={detail} group={openGroup} onBack={() => setOpenGroup(null)} />
      ) : (
        <GroupGrid detail={detail} onOpen={setOpenGroup} />
      )}
    </>
  );
}
