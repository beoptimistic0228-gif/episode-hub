import { useEffect, useRef, useState } from 'react';
import botImg from '../assets/agents/claude-code.png';
import { renderMarkdown } from '../lib/markdown';
import { useChat } from '../store/useChat';
import { useHub } from '../store/useHub';
import ProposalCard from './ProposalCard';

/** 전역 우측 도킹 Claude 패널 — 대화 상태는 전부 useChat(store)에, 여기는 표시만. */
export default function ClaudePanel() {
  const {
    threads, activeEpisodeId, busy, busyEpisodeId, available,
    panelOpen, unread, ask, cancel, newChat, togglePanel,
  } = useChat();
  const title = useHub((s) => s.episodes.find((e) => e.id === activeEpisodeId)?.title);
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const thread = activeEpisodeId ? threads[activeEpisodeId] : undefined;
  const bubbleCount = thread?.bubbles.length ?? 0;

  // 새 말풍선·스트림 도착 시 항상 맨 아래로
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [bubbleCount, thread?.live, thread?.step]);

  if (!panelOpen) {
    return (
      <button className="chat-fab" onClick={togglePanel} title="Claude 열기">
        <img src={botImg} alt="Claude 열기" />
        {unread && <span className="chat-fab-dot" />}
      </button>
    );
  }

  const send = () => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft('');
    void ask(q);
  };
  const otherBusy = busy && busyEpisodeId !== null && busyEpisodeId !== activeEpisodeId;

  return (
    <aside className="chat-panel">
      <div className="chat-panel-head">
        <img src={botImg} alt="" aria-hidden />
        <span className="chat-panel-title">{title ? `💬 ${title}` : 'Claude'}</span>
        {activeEpisodeId && <button className="chip" onClick={() => void newChat()} disabled={busy}>새 대화</button>}
        <button className="chip" onClick={togglePanel} title="패널 닫기">✕</button>
      </div>

      {available === false ? (
        <div className="chat-panel-body">
          <p className="ask-unavailable">이 PC에는 Claude Code가 없어 질문 기능을 쓸 수 없어요.</p>
        </div>
      ) : !activeEpisodeId ? (
        <div className="chat-panel-body">
          <p className="ask-unavailable">에피소드를 먼저 열어주세요 — 그 에피소드에 대해 묻고 시킬 수 있어요.</p>
        </div>
      ) : (
        <>
          <div className="chat-panel-body" ref={bodyRef}>
            <div className="ask-thread">
              {(thread?.bubbles ?? []).map((b, i) =>
                b.role === 'proposal'
                  ? <ProposalCard key={i} episodeId={activeEpisodeId} items={b.items} />
                  : b.role === 'assistant'
                    ? <div key={i} className="ask-bubble assistant md-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text) }} />
                    : <div key={i} className={`ask-bubble ${b.role}`}>{b.text}</div>,
              )}
              {thread?.live && <div className="ask-bubble assistant md-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(thread.live) }} />}
              {thread?.step && <div className="ask-step">{thread.step}</div>}
            </div>
          </div>
          <div className="chat-panel-foot">
            <div className="ask-input-row">
              <input
                className="ask-input"
                placeholder={otherBusy ? '다른 에피소드 답변 중…' : '물어보거나 시켜보세요 (예: 3번 대사 더 유쾌하게 고쳐줘)'}
                value={draft}
                disabled={busy}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
              />
              {busy
                ? <button className="chip" onClick={cancel}>중단</button>
                : <button className="chip" onClick={send} disabled={!draft.trim()}>보내기</button>}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
