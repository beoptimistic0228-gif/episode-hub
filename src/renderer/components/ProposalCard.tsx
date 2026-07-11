import { useRef, useState } from 'react';
import { lineDiff, type DiffRow } from '../lib/lineDiff';

export type ProposalCardItem = {
  itemId: string;
  relPath: string;
  reason: string;
  isNew: boolean;
  status: 'pending' | 'applied' | 'rejected' | 'failed' | 'conflict';
};

const STATUS_LABEL: Record<ProposalCardItem['status'], string> = {
  pending: '', applied: '적용됨 ✓', rejected: '거부됨', failed: '실패',
  conflict: '파일이 그새 바뀌었어요 ⚠',
};

/** E3 제안 카드 — 파일별 체크박스로 골라 적용. diff 행은 textContent로만 렌더(innerHTML 금지). */
export default function ProposalCard({ episodeId, items: initial }: { episodeId: string; items: ProposalCardItem[] }) {
  const [items, setItems] = useState(initial);
  const [checked, setChecked] = useState<Set<string>>(new Set(initial.map((i) => i.itemId))); // 기본 전체 체크
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [busy, setBusy] = useState(false);
  const diffReqRef = useRef(0);

  const selectable = (it: ProposalCardItem) => it.status === 'pending' || it.status === 'conflict';
  const openItems = items.filter(selectable);
  const hasConflict = items.some((i) => i.status === 'conflict');

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const showDiff = async (id: string) => {
    if (open === id) { diffReqRef.current++; setOpen(null); return; }
    const req = ++diffReqRef.current;
    const d = await window.hub.ai.proposalDiff(id);
    if (req !== diffReqRef.current) return;
    if (!d) return;
    setRows(lineDiff(d.oldText, d.newText));
    setOpen(id);
  };

  const applyStatuses = (rs: Awaited<ReturnType<typeof window.hub.ai.applyProposal>>) =>
    setItems((prev) => prev.map((it) => {
      const r = rs.find((x) => x.itemId === it.itemId);
      if (!r) return it;
      if ('ok' in r) return { ...it, status: 'applied' as const };
      if ('conflict' in r) return { ...it, status: 'conflict' as const };
      return { ...it, status: 'failed' as const };
    }));

  const apply = async (force: boolean) => {
    const ids = items.filter((it) => selectable(it) && checked.has(it.itemId)).map((it) => it.itemId);
    if (!ids.length) return;
    setBusy(true);
    try { applyStatuses(await window.hub.ai.applyProposal(episodeId, ids, force)); }
    catch { setItems((prev) => prev.map((it) => (checked.has(it.itemId) && selectable(it) ? { ...it, status: 'failed' } : it))); }
    setBusy(false);
  };

  const rejectAll = async () => {
    setBusy(true);
    try {
      await window.hub.ai.rejectProposal(episodeId, openItems.map((i) => i.itemId));
      setItems((prev) => prev.map((it) => (selectable(it) ? { ...it, status: 'rejected' } : it)));
    } catch { /* 거부 실패 — 상태 유지 */ }
    setBusy(false);
  };

  return (
    <div className="proposal-card">
      <div className="proposal-head">📝 수정 제안 — 적용할 파일을 골라주세요</div>
      {items.map((it) => (
        <div key={it.itemId}>
          <div className={`proposal-row ${it.status}`}>
            {selectable(it) && (
              <input type="checkbox" checked={checked.has(it.itemId)} disabled={busy} onChange={() => toggle(it.itemId)} />
            )}
            <button className="proposal-file" onClick={() => void showDiff(it.itemId)}>
              {it.relPath}{it.isNew ? ' (새 파일)' : ''}
            </button>
            <span className="proposal-reason">{it.reason}</span>
            {STATUS_LABEL[it.status] && <span className={`proposal-status ${it.status}`}>{STATUS_LABEL[it.status]}</span>}
          </div>
          {open === it.itemId && (
            <div className="diff-view">
              {rows.map((r, i) => <div key={i} className={`diff-row ${r.type}`}>{r.text || ' '}</div>)}
            </div>
          )}
        </div>
      ))}
      {openItems.length > 0 && (
        <div className="proposal-actions">
          <button className="chip" disabled={busy || !openItems.some((i) => checked.has(i.itemId))} onClick={() => void apply(false)}>
            선택한 파일 적용
          </button>
          {hasConflict && (
            <button className="chip" disabled={busy} onClick={() => void apply(true)}>그래도 적용</button>
          )}
          <button className="chip" disabled={busy} onClick={() => void rejectAll()}>모두 거부</button>
        </div>
      )}
    </div>
  );
}
