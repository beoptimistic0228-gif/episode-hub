import { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import type { AskEvent } from '../../main/aiBridge';
import ProposalCard, { type ProposalCardItem } from './ProposalCard';

type Bubble =
  | { role: 'user' | 'assistant' | 'error'; text: string }
  | { role: 'proposal'; items: ProposalCardItem[] };

export default function AskClaude({ episodeId }: { episodeId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [live, setLive] = useState('');          // 스트리밍 중 답변 버퍼
  const [step, setStep] = useState<string | null>(null); // "에피소드 읽는 중…"
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const liveRef = useRef('');
  const turnProposalsRef = useRef<ProposalCardItem[]>([]);

  useEffect(() => {
    void window.hub.ai.status().then((s) => { setAvailable(s.available); setBusy(s.busy); });
    void window.hub.ai.proposals(episodeId).then((pend) => {
      if (pend.length === 0) return;
      const items = pend.map((p) => ({ itemId: p.itemId, relPath: p.relPath, reason: p.reason, isNew: p.isNew, status: 'pending' as const }));
      setBubbles((b) => [...b, { role: 'proposal', items }]);
    });
  }, [episodeId]);

  useEffect(() => window.hub.ai.onStream((ev: AskEvent) => {
    if (ev.kind === 'done') setBusy(false);        // busy는 전역 — 필터보다 먼저
    if (ev.episodeId !== episodeId) return; // 다른 에피소드의 진행 중 이벤트는 무시
    if (ev.kind === 'propose') {
      turnProposalsRef.current = [...turnProposalsRef.current, {
        itemId: ev.itemId ?? '', relPath: ev.relPath ?? '', reason: ev.reason ?? '',
        isNew: ev.isNew ?? false, status: 'pending',
      }];
      setStep('수정안 접수 중…');
    }
    if (ev.kind === 'tool') setStep('에피소드 읽는 중…');
    if (ev.kind === 'text') { setStep(null); liveRef.current += ev.text ?? ''; setLive(liveRef.current); }
    if (ev.kind === 'result') { liveRef.current = ev.text || liveRef.current; setLive(liveRef.current); }
    if (ev.kind === 'error') {
      setBubbles((b) => [...b, { role: 'error', text: ev.text ?? '오류가 났어요.' }]);
      liveRef.current = ''; setLive('');
    }
    if (ev.kind === 'done') {
      // setBubbles 업데이터는 나중에 실행됨 — liveRef를 지우기 전에 값을 먼저 캡처
      const finalText = liveRef.current;
      if (finalText) setBubbles((b) => [...b, { role: 'assistant', text: finalText }]);
      liveRef.current = ''; setLive(''); setStep(null); setBusy(false);
      const proposals = turnProposalsRef.current;
      turnProposalsRef.current = [];
      if (proposals.length) setBubbles((b) => [...b, { role: 'proposal', items: proposals }]);
    }
  }), [episodeId]);

  const send = async () => {
    const q = draft.trim();
    if (!q || busy) return;
    setBubbles((b) => [...b, { role: 'user', text: q }]);
    setDraft(''); setBusy(true);
    const r = await window.hub.ai.ask(episodeId, q);
    if (!r.ok) { setBubbles((b) => [...b, { role: 'error', text: r.message ?? '요청이 거부됐어요.' }]); setBusy(false); }
  };

  const newChat = async () => { await window.hub.ai.reset(episodeId); setBubbles([]); };

  if (available === false) {
    return (
      <section className="ask-panel">
        <h3>🤖 Claude에게 물어보기</h3>
        <p className="ask-unavailable">이 PC에는 Claude Code가 없어 질문 기능을 쓸 수 없어요.</p>
      </section>
    );
  }

  return (
    <section className="ask-panel">
      <div className="ask-head">
        <h3>🤖 Claude에게 물어보기</h3>
        {bubbles.length > 0 && <button className="chip" onClick={() => void newChat()} disabled={busy}>새 대화</button>}
      </div>
      <div className="ask-thread">
        {bubbles.map((b, i) =>
          b.role === 'proposal'
            ? <ProposalCard key={i} episodeId={episodeId} items={b.items} />
            : b.role === 'assistant'
              ? <div key={i} className="ask-bubble assistant md-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />
              : <div key={i} className={`ask-bubble ${b.role}`}>{b.text}</div>,
        )}
        {live && <div className="ask-bubble assistant md-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(live) }} />}
        {step && <div className="ask-step">{step}</div>}
      </div>
      <div className="ask-input-row">
        <input
          className="ask-input"
          placeholder="물어보거나 시켜보세요 (예: 3번 대사 더 유쾌하게 고쳐줘)"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(); }}
        />
        {busy
          ? <button className="chip" onClick={() => void window.hub.ai.cancel()}>중단</button>
          : <button className="chip" onClick={() => void send()} disabled={!draft.trim()}>보내기</button>}
      </div>
    </section>
  );
}
