# Episode Hub — Claude 도킹 패널 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 본문 하단 고정 AskClaude를 ON/OFF 가능한 전역 우측 도킹 패널(380px)로 옮기고, 대화를 에피소드별로 앱 실행 단위 보존한다.

**Architecture:** 대화 상태(스레드·스트림 버퍼·제안 수집)를 신설 zustand `useChat` store로 분리하고 `onStream` 구독을 App 레벨 1회로 올린다 — 패널이 닫혀 있거나 다른 화면이어도 이벤트가 store에 쌓여 유실 없음. 패널(`ClaudePanel`)은 `.layout` 3번째 flex 칼럼, OFF 시 우하단 마스코트 FAB. main 프로세스·MCP·보안 구조는 무변경(순수 renderer).

**Tech Stack:** React 18 + zustand(기존 의존성) + vitest(jsdom) + Playwright-Electron. **신규 외부 의존성 없음.**

**Spec:** `docs/superpowers/specs/2026-07-12-episode-hub-claude-panel-design.md`

## Global Constraints

- 아이콘은 기존 자산 `src/renderer/assets/agents/claude-code.png` 재사용(신규 파일 추가 없음).
- 기존 CSS 클래스 `.ask-thread`·`.ask-bubble`·`.ask-step`·`.ask-unavailable`·`.ask-input-row`·`.ask-input` 및 `.proposal-card` 계열은 **그대로 유지**(e2e 셀렉터). 신규: `.chat-panel`·`.chat-panel-head`·`.chat-panel-title`·`.chat-panel-body`·`.chat-panel-foot`·`.chat-fab`·`.chat-fab-dot`.
- main 프로세스(`src/main/**`)·preload·MCP 파일은 **한 줄도 수정 금지**.
- 대화는 앱 메모리만(영구 저장 비목표). `panelOpen`만 localStorage 키 `hub-chat-panel` (기본 ON — 값이 `'off'`일 때만 닫힘).
- AI 출력 렌더는 기존 `renderMarkdown`(DOMPurify) 경로만, 제안/diff는 text children만(innerHTML 금지) — 기존 규칙 승계.
- UI 카피는 쉬운 한국어(비개발자 부부).
- 게이트: `npx vitest run` 그린 · `npm run typecheck` 0 · `npm run build` OK · `npm run test:e2e` 그린. 작업 디렉토리 `C:\GitHub\episode-hub`(main 직접).
- 커밋: `<type>(episode-hub): <subject>` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` 푸터.
- vitest globals 모드. jsdom이 필요한 테스트는 파일 첫 줄에 `// @vitest-environment jsdom`.

---

### Task 1: `useChat` store — 대화 저장소·스트림 라우팅

**Files:**
- Create: `src/renderer/store/useChat.ts`
- Test: `tests/useChat.test.ts`

**Interfaces:**
- Consumes: `window.hub.ai.{status, ask, cancel, reset, proposals}` (preload 기존), `AskEvent`(`src/main/aiBridge.ts` — kind `'init'|'text'|'tool'|'result'|'error'|'done'|'propose'`, propose 필드 `itemId/relPath/reason/isNew`, 모든 이벤트에 `episodeId` 스탬프), `ProposalCardItem`(`src/renderer/components/ProposalCard.tsx`).
- Produces (Task 2·3이 사용): `useChat` zustand hook — 상태 `threads: Record<string, ChatThread>`, `activeEpisodeId: string|null`, `busy: boolean`, `busyEpisodeId: string|null`, `available: boolean|null`, `panelOpen: boolean`, `unread: boolean`; 액션 `initAi(): Promise<void>`, `handleStream(ev: AskEvent): void`, `ask(q: string): Promise<void>`, `cancel(): void`, `newChat(): Promise<void>`, `setActiveEpisode(id: string): Promise<void>`, `togglePanel(): void`. 타입 `ChatBubble`, `ChatThread { bubbles: ChatBubble[]; live: string; step: string|null; turnProposals: ProposalCardItem[]; restored: boolean }`.

- [ ] **Step 1: Write the failing test**

`tests/useChat.test.ts`:

```ts
// @vitest-environment jsdom
import { useChat, type ChatThread } from '../src/renderer/store/useChat';
import type { AskEvent } from '../src/main/aiBridge';

const EP = 'ep20260101_chat';

function stubHub(over: Partial<Record<string, unknown>> = {}) {
  const ai = {
    status: vi.fn(async () => ({ available: true, busy: false })),
    ask: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true as const })),
    reset: vi.fn(async () => ({ ok: true as const })),
    proposals: vi.fn(async () => []),
    ...over,
  };
  vi.stubGlobal('window', Object.assign(globalThis.window ?? {}, { hub: { ai } }));
  return ai;
}

const fresh = () => useChat.setState({
  threads: {}, activeEpisodeId: null, busy: false, busyEpisodeId: null,
  available: null, panelOpen: true, unread: false,
});
const thread = (id = EP): ChatThread => useChat.getState().threads[id];
const ev = (e: Partial<AskEvent>): AskEvent => ({ kind: 'text', episodeId: EP, ...e } as AskEvent);

describe('useChat — 대화 저장소', () => {
  beforeEach(() => { localStorage.clear(); stubHub(); fresh(); });

  test('setActiveEpisode — 스레드 생성 + pending 제안 1회 복원', async () => {
    const ai = stubHub({ proposals: vi.fn(async () => [
      { itemId: 'p1', episodeId: EP, relPath: 'script/a.md', reason: 'r', status: 'pending', isNew: false },
    ]) });
    await useChat.getState().setActiveEpisode(EP);
    expect(useChat.getState().activeEpisodeId).toBe(EP);
    expect(thread().bubbles).toEqual([{ role: 'proposal', items: [
      { itemId: 'p1', relPath: 'script/a.md', reason: 'r', isNew: false, status: 'pending' },
    ] }]);
    await useChat.getState().setActiveEpisode(EP); // 재진입 — 복원 재실행 금지
    expect(ai.proposals).toHaveBeenCalledTimes(1);
    expect(thread().bubbles).toHaveLength(1);
  });

  test('ask — user 말풍선 + busy, 실패 시 error 말풍선 + busy 해제', async () => {
    await useChat.getState().setActiveEpisode(EP);
    await useChat.getState().ask('예산 얼마야?');
    expect(thread().bubbles.at(-1)).toEqual({ role: 'user', text: '예산 얼마야?' });
    expect(useChat.getState().busy).toBe(true);
    expect(useChat.getState().busyEpisodeId).toBe(EP);

    useChat.setState({ busy: false, busyEpisodeId: null });
    stubHub({ ask: vi.fn(async () => ({ ok: false, message: '거부' })) });
    await useChat.getState().ask('또?');
    expect(thread().bubbles.at(-1)).toEqual({ role: 'error', text: '거부' });
    expect(useChat.getState().busy).toBe(false);
  });

  test('handleStream — text 축적 → done 시 assistant 확정 + 제안 카드 확정', async () => {
    await useChat.getState().setActiveEpisode(EP);
    const h = useChat.getState().handleStream;
    h(ev({ kind: 'tool', tool: 'x' }));
    expect(thread().step).toBe('에피소드 읽는 중…');
    h(ev({ kind: 'text', text: '답변 ' }));
    h(ev({ kind: 'text', text: '조각' }));
    expect(thread().live).toBe('답변 조각');
    h(ev({ kind: 'propose', itemId: 'p1', relPath: 'script/a.md', reason: 'r', isNew: false }));
    expect(thread().step).toBe('수정안 접수 중…');
    h(ev({ kind: 'result', text: '최종 답변' }));
    h(ev({ kind: 'done' }));
    const t = thread();
    expect(t.live).toBe('');
    expect(t.step).toBeNull();
    expect(t.bubbles.at(-2)).toEqual({ role: 'assistant', text: '최종 답변' });
    expect(t.bubbles.at(-1)).toEqual({ role: 'proposal', items: [
      { itemId: 'p1', relPath: 'script/a.md', reason: 'r', isNew: false, status: 'pending' },
    ] });
    expect(useChat.getState().busy).toBe(false);
  });

  test('handleStream — 비활성 에피소드 이벤트도 자기 스레드에 쌓임(유실 없음)', async () => {
    await useChat.getState().setActiveEpisode(EP);
    await useChat.getState().setActiveEpisode('ep20260102_other');
    const h = useChat.getState().handleStream;
    h(ev({ kind: 'text', text: 'A 답변' }));   // EP 스레드로
    h(ev({ kind: 'done' }));
    expect(thread(EP).bubbles.at(-1)).toEqual({ role: 'assistant', text: 'A 답변' });
    expect(thread('ep20260102_other').bubbles).toHaveLength(0);
  });

  test('unread — 패널 닫힘 중 done 도착 시 켜지고, 패널 열면 꺼짐', async () => {
    await useChat.getState().setActiveEpisode(EP);
    useChat.setState({ panelOpen: false });
    const h = useChat.getState().handleStream;
    h(ev({ kind: 'text', text: 'x' }));
    h(ev({ kind: 'done' }));
    expect(useChat.getState().unread).toBe(true);
    useChat.getState().togglePanel(); // 열기
    expect(useChat.getState().panelOpen).toBe(true);
    expect(useChat.getState().unread).toBe(false);
  });

  test('togglePanel — localStorage hub-chat-panel 기억(off만 저장값으로 닫힘)', () => {
    useChat.getState().togglePanel(); // ON→OFF
    expect(localStorage.getItem('hub-chat-panel')).toBe('off');
    useChat.getState().togglePanel(); // OFF→ON
    expect(localStorage.getItem('hub-chat-panel')).toBe('on');
  });

  test('newChat — ai.reset 호출 + 활성 스레드 비움(복원 플래그 유지)', async () => {
    const ai = stubHub();
    await useChat.getState().setActiveEpisode(EP);
    useChat.getState().handleStream(ev({ kind: 'text', text: 'x' }));
    useChat.getState().handleStream(ev({ kind: 'done' }));
    await useChat.getState().newChat();
    expect(ai.reset).toHaveBeenCalledWith(EP);
    expect(thread().bubbles).toHaveLength(0);
    expect(thread().restored).toBe(true);
  });

  test('error 이벤트 — error 말풍선 + live 버림', async () => {
    await useChat.getState().setActiveEpisode(EP);
    const h = useChat.getState().handleStream;
    h(ev({ kind: 'text', text: '반쯤 온 답' }));
    h(ev({ kind: 'error', text: '실행 실패' }));
    expect(thread().bubbles.at(-1)).toEqual({ role: 'error', text: '실행 실패' });
    expect(thread().live).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/useChat.test.ts`
Expected: FAIL — `Cannot find module '../src/renderer/store/useChat'`

- [ ] **Step 3: Write minimal implementation**

`src/renderer/store/useChat.ts`:

```ts
import { create } from 'zustand';
import type { AskEvent } from '../../main/aiBridge';
import type { ProposalCardItem } from '../components/ProposalCard';

export type ChatBubble =
  | { role: 'user' | 'assistant' | 'error'; text: string }
  | { role: 'proposal'; items: ProposalCardItem[] };

export interface ChatThread {
  bubbles: ChatBubble[];
  live: string;                       // 스트리밍 중 답변 버퍼
  step: string | null;                // "에피소드 읽는 중…"
  turnProposals: ProposalCardItem[];  // 진행 턴의 propose 수집(done에 카드 확정)
  restored: boolean;                  // pending 제안 복원 1회 완료
}

const emptyThread = (): ChatThread =>
  ({ bubbles: [], live: '', step: null, turnProposals: [], restored: false });

const PANEL_KEY = 'hub-chat-panel';

interface ChatState {
  threads: Record<string, ChatThread>;
  activeEpisodeId: string | null;
  busy: boolean;                  // 전역 1건(main과 동일 규칙)
  busyEpisodeId: string | null;   // 진행 중 ask의 에피소드(다른 스레드 열람 시 안내용)
  available: boolean | null;      // claude CLI 감지
  panelOpen: boolean;
  unread: boolean;                // 패널 닫힘 중 done 도착
  initAi: () => Promise<void>;
  handleStream: (ev: AskEvent) => void;
  ask: (q: string) => Promise<void>;
  cancel: () => void;
  newChat: () => Promise<void>;
  setActiveEpisode: (id: string) => Promise<void>;
  togglePanel: () => void;
}

/** 해당 에피소드 스레드만 함수로 갱신(없으면 생성) — 이벤트 유실 방지의 핵심 */
const patchThread = (
  threads: Record<string, ChatThread>, id: string, fn: (t: ChatThread) => ChatThread,
): Record<string, ChatThread> => ({ ...threads, [id]: fn(threads[id] ?? emptyThread()) });

export const useChat = create<ChatState>((set, get) => ({
  threads: {},
  activeEpisodeId: null,
  busy: false,
  busyEpisodeId: null,
  available: null,
  panelOpen: localStorage.getItem(PANEL_KEY) !== 'off', // 기본 ON
  unread: false,

  initAi: async () => {
    try {
      const s = await window.hub.ai.status();
      set({ available: s.available, busy: s.busy });
    } catch { set({ available: false }); }
  },

  // App 레벨 onStream 1회 구독이 부르는 단일 라우터 — 기존 AskClaude 처리 규칙 이관.
  handleStream: (ev) => {
    if (ev.kind === 'done') set({ busy: false, busyEpisodeId: null }); // busy는 전역 — 스레드 갱신과 무관
    const id = ev.episodeId;
    if (!id) return;
    set((st) => {
      let { unread } = st;
      const threads = patchThread(st.threads, id, (t) => {
        if (ev.kind === 'propose') {
          return {
            ...t,
            step: '수정안 접수 중…',
            turnProposals: [...t.turnProposals, {
              itemId: ev.itemId ?? '', relPath: ev.relPath ?? '', reason: ev.reason ?? '',
              isNew: ev.isNew ?? false, status: 'pending' as const,
            }],
          };
        }
        if (ev.kind === 'tool') return { ...t, step: '에피소드 읽는 중…' };
        if (ev.kind === 'text') return { ...t, step: null, live: t.live + (ev.text ?? '') };
        if (ev.kind === 'result') return { ...t, live: ev.text || t.live };
        if (ev.kind === 'error') {
          return { ...t, live: '', bubbles: [...t.bubbles, { role: 'error' as const, text: ev.text ?? '오류가 났어요.' }] };
        }
        if (ev.kind === 'done') {
          const bubbles = [...t.bubbles];
          if (t.live) bubbles.push({ role: 'assistant', text: t.live });
          if (t.turnProposals.length) bubbles.push({ role: 'proposal', items: t.turnProposals });
          if (!st.panelOpen) unread = true;
          return { ...t, bubbles, live: '', step: null, turnProposals: [] };
        }
        return t;
      });
      return { threads, unread };
    });
  },

  ask: async (q) => {
    const { activeEpisodeId, busy } = get();
    const question = q.trim();
    if (!activeEpisodeId || !question || busy) return;
    set((st) => ({
      busy: true,
      busyEpisodeId: activeEpisodeId,
      threads: patchThread(st.threads, activeEpisodeId, (t) =>
        ({ ...t, bubbles: [...t.bubbles, { role: 'user' as const, text: question }] })),
    }));
    const r = await window.hub.ai.ask(activeEpisodeId, question);
    if (!r.ok) {
      set((st) => ({
        busy: false,
        busyEpisodeId: null,
        threads: patchThread(st.threads, activeEpisodeId, (t) =>
          ({ ...t, bubbles: [...t.bubbles, { role: 'error' as const, text: r.message ?? '요청이 거부됐어요.' }] })),
      }));
    }
  },

  cancel: () => { void window.hub.ai.cancel(); },

  newChat: async () => {
    const id = get().activeEpisodeId;
    if (!id) return;
    await window.hub.ai.reset(id);
    set((st) => ({
      threads: patchThread(st.threads, id, (t) =>
        ({ ...emptyThread(), restored: t.restored })), // 세션·말풍선 초기화, 복원 플래그만 유지
    }));
  },

  setActiveEpisode: async (id) => {
    set({ activeEpisodeId: id });
    if (get().threads[id]?.restored) return;
    // 스레드 최초 생성 시 1회만 pending 제안 복원(중복 카드 방지 — spec §6)
    set((st) => ({ threads: patchThread(st.threads, id, (t) => ({ ...t, restored: true })) }));
    try {
      const pend = await window.hub.ai.proposals(id);
      if (pend.length === 0) return;
      const items: ProposalCardItem[] = pend.map((p) => ({
        itemId: p.itemId, relPath: p.relPath, reason: p.reason, isNew: p.isNew, status: 'pending' as const,
      }));
      set((st) => ({
        threads: patchThread(st.threads, id, (t) =>
          ({ ...t, bubbles: [...t.bubbles, { role: 'proposal' as const, items }] })),
      }));
    } catch { /* 복원 실패는 비치명 — 새 지시로 재제안 가능 */ }
  },

  togglePanel: () => {
    const open = !get().panelOpen;
    localStorage.setItem(PANEL_KEY, open ? 'on' : 'off');
    set({ panelOpen: open, ...(open ? { unread: false } : {}) });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/useChat.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store/useChat.ts tests/useChat.test.ts
git commit -m "feat(episode-hub): useChat store — 에피소드별 대화 보존·스트림 라우팅(패널 분리 1/3)"
```

---

### Task 2: ClaudePanel UI + 배선 (AskClaude 대체)

**Files:**
- Create: `src/renderer/components/ClaudePanel.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/EpisodeView.tsx`, `src/renderer/brand.css`
- Delete: `src/renderer/components/AskClaude.tsx`
- Test: 게이트 = `npm run typecheck` 0 + `npm run build` 성공 + `npx vitest run` 무회귀 (동작 검증은 Task 3 e2e)

**Interfaces:**
- Consumes: Task 1 `useChat` 전부, `useHub`(`episodes`에서 제목 조회), `ProposalCard`, `renderMarkdown`, 아이콘 `../assets/agents/claude-code.png`.
- Produces: `<ClaudePanel/>`(App에서 1회 마운트). CSS: `.chat-panel`·`.chat-panel-head`·`.chat-panel-title`·`.chat-panel-body`·`.chat-panel-foot`·`.chat-fab`·`.chat-fab-dot`(Task 3 e2e 셀렉터).

- [ ] **Step 1: ClaudePanel 구현**

`src/renderer/components/ClaudePanel.tsx`:

```tsx
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
```

- [ ] **Step 2: App.tsx 배선**

`src/renderer/App.tsx` — import 추가:

```tsx
import ClaudePanel from './components/ClaudePanel';
import { useChat } from './store/useChat';
```

`useEffect` 안(기존 구독들 옆)에 스트림 1회 구독 + AI 상태 초기화 추가:

```tsx
    void useChat.getState().initAi();
    const offAi = window.hub.ai.onStream((ev) => useChat.getState().handleStream(ev));
```

cleanup에 `offAi();` 추가 (`return () => { offEpisodes(); offStats(); offAi(); };`).

JSX — `.layout` 안 `<main>…</main>` 다음에:

```tsx
      <ClaudePanel />
```

- [ ] **Step 3: EpisodeView.tsx — AskClaude 제거 + 활성 에피소드 통지**

`src/renderer/components/EpisodeView.tsx`:
1. `import AskClaude from './AskClaude';` 삭제, `import { useChat } from '../store/useChat';` 추가.
2. 기존 탭 복귀 effect 아래에 추가:

```tsx
  // 패널의 대상 에피소드 갱신 — 대시보드로 나가도 마지막 에피소드 대화 유지(spec §2)
  useEffect(() => {
    if (detail?.id) void useChat.getState().setActiveEpisode(detail.id);
  }, [detail?.id]);
```

3. `{/* key=id — … */}` 주석과 `<AskClaude key={`ask-${detail.id}`} episodeId={detail.id} />` 줄 삭제.
4. `src/renderer/components/AskClaude.tsx` 파일 삭제 (`git rm`).

- [ ] **Step 4: brand.css — 패널·FAB 스타일 + 죽은 규칙 정리**

`src/renderer/brand.css`에서 `.ask-panel`·`.ask-head` 두 규칙(473~474행 부근) 삭제(사용처 소멸). `.ask-thread`부터는 유지. 파일 끝에 추가:

```css
/* ── Claude 도킹 패널 ─────────────────────────── */
.chat-panel {
  width: 380px; flex-shrink: 0; height: 100vh;
  display: flex; flex-direction: column;
  border-left: 1px solid var(--hairline); background: var(--canvas, #fff);
}
.chat-panel-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid var(--hairline);
}
.chat-panel-head img { width: 28px; height: 28px; object-fit: contain; }
.chat-panel-title {
  flex: 1; font-weight: 700; font-size: 13.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chat-panel-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.chat-panel-foot { padding: 10px 14px; border-top: 1px solid var(--hairline); }
.chat-fab {
  position: fixed; right: 18px; bottom: 18px; z-index: 40;
  width: 52px; height: 52px; border-radius: 50%; padding: 7px;
  border: 1px solid var(--hairline); background: var(--canvas, #fff);
  box-shadow: var(--shadow-sm); cursor: pointer;
}
.chat-fab img { width: 100%; height: 100%; object-fit: contain; }
.chat-fab-dot {
  position: absolute; top: 2px; right: 2px;
  width: 11px; height: 11px; border-radius: 50%;
  background: var(--ember, #ea4f23); border: 2px solid var(--canvas, #fff);
}
```

- [ ] **Step 5: 게이트 확인**

Run: `npm run typecheck` → 0 에러, `npm run build` → 성공, `npx vitest run` → 전부 PASS (AskClaude를 참조하는 단위 테스트는 없음 — 실패 시 참조 잔재를 정리)
Expected: 전부 그린

- [ ] **Step 6: Commit**

```bash
git add -A src/renderer
git commit -m "feat(episode-hub): Claude 도킹 패널 — 전역 우측 패널·마스코트 FAB·AskClaude 대체(패널 분리 2/3)"
```

---

### Task 3: e2e 갱신 + 대화 보존 검증 + 문서

**Files:**
- Modify: `e2e/hub.e2e.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2 셀렉터(`.chat-panel`, `.ask-input`, `.ask-bubble`, `.proposal-card`, `새 대화` 버튼 — 패널 헤더로 이동), 기존 fixture(EP_ID `ep20260101_e2e`, 대시보드 진입 로케이터 `.sidebar .nav-page`).
- Produces: e2e ⑩·⑪ 패널 기준 동작 + 신규 ⑫(화면 왕복 대화 보존).

- [ ] **Step 1: 기존 ⑩·⑪ 확인·조정**

`e2e/hub.e2e.ts` — ⑩·⑪은 셀렉터가 유지되므로 원칙적으로 무수정 통과해야 한다. 단 두 가지를 점검·조정:
1. ⑩의 `.ask-input` 접근 전 패널 존재 단언을 추가(패널 기본 ON 검증 겸):

```ts
  await expect(page.locator('.chat-panel')).toBeVisible();
```

(⑩의 `const input = page.locator('.ask-input');` 바로 앞에 삽입.)
2. ⑪의 `새 대화` 버튼은 이제 패널 헤더에 있다 — `getByRole('button', { name: '새 대화' })` 그대로 동작하지만, 말풍선 유무와 무관하게 항상 표시되므로 대기 조건 변화 없음(무수정).

- [ ] **Step 2: 신규 ⑫ 대화 보존 테스트 추가 (⑪ 다음)**

```ts
// ── 패널 개편: 대시보드 왕복에도 대화가 유지된다 ────────────────────────────
test('⑫ 패널 보존: 대시보드 이동→복귀에도 말풍선·제안 카드 유지', async () => {
  // ⑪이 남긴 대화(user 말풍선 + 적용됨 카드)가 기준선.
  const userBubbles = await page.locator('.ask-bubble.user').count();
  expect(userBubbles).toBeGreaterThan(0);

  // 대시보드로 이동 — 패널은 전역이라 그대로, 대화도 그대로.
  await page.locator('.sidebar .nav-page').click();
  await expect(page.locator('.stat-tile').first()).toBeVisible();
  await expect(page.locator('.chat-panel')).toBeVisible();
  await expect(page.locator('.ask-bubble.user')).toHaveCount(userBubbles);
  await expect(page.locator('.proposal-card').last()).toContainText('적용됨');

  // 에피소드로 복귀해도 동일.
  await page.locator('.ep-card', { hasText: 'E2E 룸' }).click();
  await page.waitForSelector('nav.tab-bar');
  await expect(page.locator('.ask-bubble.user')).toHaveCount(userBubbles);

  // 패널 토글: 닫으면 FAB, 다시 열면 대화 그대로.
  await page.locator('.chat-panel-head button[title="패널 닫기"]').click();
  await expect(page.locator('.chat-fab')).toBeVisible();
  await page.locator('.chat-fab').click();
  await expect(page.locator('.ask-bubble.user')).toHaveCount(userBubbles);
});
```

- [ ] **Step 3: CLAUDE.md 한 줄 갱신**

`CLAUDE.md` §"MCP 브리지"의 E2 문단에서 `에피소드 화면 "Claude에게 물어보기" 패널` →
`전역 우측 도킹 Claude 패널(에피소드별 대화 보존·ON/OFF, 2026-07-12 개편)`로 교체. 다른 내용 무변경.

- [ ] **Step 4: 게이트 완주**

Run (순서대로): `npx vitest run` → PASS, `npm run typecheck` → 0, `npm run test:e2e` → ①~⑫ 전부 PASS
Expected: 전부 그린. ⑫ 실패 시 흔한 원인: 패널 기본 ON이 e2e userData(신규 tempdir)에서 보장되는지(localStorage 비어 있음 → 기본 ON이므로 보장됨).

- [ ] **Step 5: Commit**

```bash
git add e2e/hub.e2e.ts CLAUDE.md
git commit -m "test(episode-hub): 패널 e2e — 왕복 보존·토글 검증 + 문서 갱신(패널 분리 3/3)"
```

---

## Self-Review 체크 결과

- **Spec coverage**: §2 형태·토글·아이콘(Task 2) · §2 대화 보존 + §5-1 store(Task 1) · §2 대시보드 유지(Task 1 setActiveEpisode + Task 2 EpisodeView effect) · §5-2 패널·FAB·unread(Task 2) · §5-3 레이아웃·AskClaude 삭제(Task 2) · §6 엣지(Task 1 busyEpisodeId·복원 1회·unread) · §7 테스트(Task 1 단위 8건 + Task 3 e2e ⑫). 갭 없음.
- **Placeholder scan**: 통과.
- **Type consistency**: `ChatThread`/`ChatBubble`/액션 시그니처(Task 1 → Task 2), CSS 클래스(Task 2 → Task 3 셀렉터), `busyEpisodeId`(Task 1 정의 → Task 2 otherBusy) 일치 확인.
