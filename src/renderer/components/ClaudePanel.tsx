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
  // 사용자가 위로 스크롤해 과거 대화를 보는 중이면 스트리밍이 강제로 끌어내리지 않도록 "하단 근처" 여부를 추적
  const stickRef = useRef(true);
  const prevEpRef = useRef<string | null>(null);

  const thread = activeEpisodeId ? threads[activeEpisodeId] : undefined;
  const bubbleCount = thread?.bubbles.length ?? 0;

  // 새 말풍선·스트림 도착 시: 에피소드 전환 직후이거나 사용자가 하단 근처에 있을 때만 맨 아래로
  useEffect(() => {
    const switched = prevEpRef.current !== activeEpisodeId;
    prevEpRef.current = activeEpisodeId;
    if (switched) stickRef.current = true;
    if (stickRef.current) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [activeEpisodeId, bubbleCount, thread?.live, thread?.step]);

  // 에피소드 전환 시 쓰다 만 초안은 버린다 — 다른 에피소드로 오전송 방지
  useEffect(() => { setDraft(''); }, [activeEpisodeId]);

  if (!panelOpen) {
    return (
      <button
        className="chat-fab"
        onClick={togglePanel}
        title="Claude 열기"
        aria-label={unread ? 'Claude 열기 — 새 답변 있음' : 'Claude 열기'}
      >
        <img src={botImg} alt="Claude 열기" />
        {unread && <span className="chat-fab-dot" aria-hidden />}
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
        {activeEpisodeId && available !== false && <button className="chip" onClick={() => void newChat()} disabled={busy}>새 대화</button>}
        <button className="chip" onClick={togglePanel} title="패널 닫기" aria-label="패널 닫기">✕</button>
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
          <div
            className="chat-panel-body"
            ref={bodyRef}
            onScroll={() => {
              const el = bodyRef.current;
              if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
          >
            <div className="ask-thread">
              {(thread?.bubbles ?? []).map((b, i) =>
                b.role === 'proposal'
                  ? <ProposalCard
                      key={i}
                      episodeId={activeEpisodeId}
                      items={b.items}
                      onItemsChange={(items) => useChat.getState().syncProposalStatus(activeEpisodeId, items)}
                    />
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
                aria-label="Claude에게 보낼 메시지"
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
