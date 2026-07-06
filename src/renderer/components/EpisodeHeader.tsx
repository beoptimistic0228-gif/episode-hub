import type { EpisodeDetail } from '@shared/types';

export default function EpisodeHeader({ detail }: { detail: EpisodeDetail }) {
  const est = detail.doc?.total_estimate;
  const skuCount = detail.doc?.products?.length ?? 0;
  const moodboard = detail.doc?.approvals?.['moodboard'] as { approved?: boolean } | undefined;
  return (
    <>
      <div className="ep-header">
        <h2>{detail.title}</h2>
        {/* Phase B에서 활성화 — 지금은 자리만 (스펙 §4-5 Complete 활성 조건) */}
        <button className="btn-pill primary" disabled title="Phase B·C에서 활성화">
          ✓ Complete
        </button>
      </div>
      <div className="ep-meta">
        <span className="chip">{detail.id}</span>
        {detail.stage && <span className="chip">{detail.stage} 단계</span>}
        {est && <span className="chip">₩{est.low.toLocaleString()}</span>}
        {skuCount > 0 && <span className="chip">{skuCount} SKU</span>}
        {moodboard?.approved && <span className="chip success">무드보드 승인</span>}
        {detail.error && <span className="chip error">{detail.error}</span>}
      </div>
    </>
  );
}
