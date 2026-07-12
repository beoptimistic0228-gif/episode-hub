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
