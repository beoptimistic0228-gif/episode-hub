import { useState } from 'react';
import type { EpisodeDetail } from '@shared/types';
import { useHub } from '../store/useHub';

export default function EpisodeHeader({ detail }: { detail: EpisodeDetail }) {
  const est = detail.doc?.total_estimate;

  const { gitStatus, completeEpisode } = useHub();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const epChanged = (gitStatus?.changedPaths ?? []).some((p) => p.includes(`output/episodes/${detail.id}/`));

  const onComplete = async () => {
    setBusy(true); setNote(null);
    try {
      const res = await completeEpisode();
      if (res.ok) setNote('✓ 완료 — 커밋·푸시됨');
      else if (res.reason === 'nothing') setNote('커밋할 변경이 없어요');
      else if (res.reason === 'needsUpdate') setNote('원격이 앞서 있어요 — Update 먼저 눌러주세요');
      else setNote('실패: ' + (res.message ?? '알 수 없는 오류'));
    } catch (e) {
      // 방어적 처리 — IPC 예외가 unhandled rejection으로 새지 않도록 안내로 흡수
      setNote('실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="ep-header">
      {/* 한 줄 커맨드 바 — 제목·메타·액션 (2026-07-07 Owner 피드백: 헤더 압축) */}
      <div className="ep-heading">
        <h2>{detail.title}</h2>
        <div className="ep-meta">
          {/* 기획 견적만 강조 노출 (2026-07-07 Owner 피드백: id·단계·SKU 칩 제거) */}
          {est && <span className="price-tag">₩{est.low.toLocaleString()}</span>}
          {detail.error && <span className="chip error">{detail.error}</span>}
        </div>
      </div>
      {/* Complete — EP 산출물 변경이 있을 때만 활성 (스펙 §4-5 Complete 활성 조건) */}
      <button className="btn-pill primary sm" disabled={!epChanged || busy} onClick={onComplete} title={epChanged ? '이 에피소드 산출물 커밋·푸시' : '커밋할 변경 없음'}>
        {busy ? '처리 중…' : '✓ Complete'}
      </button>
      {note && <span className="complete-note">{note}</span>}
    </header>
  );
}
