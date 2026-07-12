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
  /** ProposalCard가 적용/거부 결과를 스레드 버블에 되새김 — 리마운트 시 상태 보존 */
  syncProposalStatus: (episodeId: string, items: ProposalCardItem[]) => void;
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

  syncProposalStatus: (episodeId, items) => {
    const byId = new Map(items.map((i) => [i.itemId, i]));
    set((st) => ({
      threads: patchThread(st.threads, episodeId, (t) => ({
        ...t,
        bubbles: t.bubbles.map((b) =>
          b.role === 'proposal'
            ? { ...b, items: b.items.map((it) => byId.get(it.itemId) ?? it) }
            : b),
      })),
    }));
  },
}));
