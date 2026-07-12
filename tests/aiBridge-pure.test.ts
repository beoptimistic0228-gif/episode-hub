import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASK_TOOLS, buildPrompt, buildAskArgs, parseStreamLine, writeAiMcpConfig,
} from '../src/main/aiBridge';

describe('buildPrompt', () => {
  test('새 세션 첫 질문에는 에피소드 맥락 프리앰블을 접두한다', () => {
    const p = buildPrompt('ep20260628_ippool-g009', '예산 왜 이렇게 나왔어?', true);
    expect(p).toContain('ep20260628_ippool-g009');
    expect(p).toContain('episode-hub MCP 도구');
    expect(p).toContain('추측으로 만들지 마세요');
    expect(p.endsWith('질문: 예산 왜 이렇게 나왔어?')).toBe(true);
  });
  test('이어묻기(resume)는 질문만 그대로 보낸다', () => {
    expect(buildPrompt('ep-x', '더 싼 대안은?', false)).toBe('더 싼 대안은?');
  });
  test('프리앰블에 propose_edit 제안 지침 포함(직접 쓰기 금지)', () => {
    const p = buildPrompt('ep-x', '콘티 고쳐줘', true);
    expect(p).toContain('propose_edit');
    expect(p).toContain('직접 고치지 말고');
  });
});

describe('buildAskArgs', () => {
  test('읽기 4종 + 제안 도구(E3) 잠금 + 쓰기·셸 도구 차단 + strict mcp-config', () => {
    const args = buildAskArgs({ mcpConfigPath: 'C:/x/ai-mcp.json' });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--include-partial-messages'); // E3 — 긴 propose 생성 중 무출력 타임아웃 방지
    expect(args).toContain('--strict-mcp-config');
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toBe(ASK_TOOLS.join(','));
    expect(allowed).toContain('mcp__episode-hub__propose_edit'); // E3 — 제안 1종만 추가
    expect(allowed).not.toMatch(/write_file|patch_episode|save_render|git_complete/);
    const denied = args[args.indexOf('--disallowedTools') + 1];
    expect(denied).toContain('Bash');
    expect(denied).toContain('Write');
    expect(denied).toContain('Read'); // 내장 읽기 도구도 차단 — MCP 밖 로컬 파일 접근 금지
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('C:/x/ai-mcp.json');
    expect(args).not.toContain('--resume');
  });
  test('resumeSessionId가 있으면 --resume을 붙인다', () => {
    const args = buildAskArgs({ mcpConfigPath: 'x.json', resumeSessionId: 's-123' });
    expect(args[args.indexOf('--resume') + 1]).toBe('s-123');
  });
  test('resumeSessionId가 형식에 안 맞으면 --resume을 생략한다(argv 방어)', () => {
    const bad = buildAskArgs({ mcpConfigPath: 'x.json', resumeSessionId: 's 1; rm -rf /' });
    expect(bad).not.toContain('--resume');
    const ok = buildAskArgs({ mcpConfigPath: 'x.json', resumeSessionId: 'abc-123_DEF' });
    expect(ok[ok.indexOf('--resume') + 1]).toBe('abc-123_DEF');
  });
});

describe('parseStreamLine', () => {
  test('system/init → init + session_id', () => {
    const ev = parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }));
    expect(ev).toEqual({ kind: 'init', sessionId: 's-1' });
  });
  test('assistant tool_use → tool 이벤트(단계 표시용)', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__episode-hub__read_episode', input: {} }] } });
    expect(parseStreamLine(line)).toEqual({ kind: 'tool', tool: 'mcp__episode-hub__read_episode' });
  });
  test('assistant text → text 이벤트', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '총 예산은 ' }] } });
    expect(parseStreamLine(line)).toEqual({ kind: 'text', text: '총 예산은 ' });
  });
  test('result 성공 → result + 전체 답변 + session_id', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '답변 전문', session_id: 's-1' });
    expect(parseStreamLine(line)).toEqual({ kind: 'result', text: '답변 전문', sessionId: 's-1' });
  });
  test('result is_error → error 이벤트', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '실패 사유', session_id: 's-1' });
    expect(parseStreamLine(line)).toEqual({ kind: 'error', text: '실패 사유', sessionId: 's-1' });
  });
  test('빈 줄·JSON 아님·모르는 타입 → null(무시)', () => {
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('not-json')).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: 'user' }))).toBeNull();
  });
});

test('writeAiMcpConfig — episode-hub http 엔트리 + Bearer 토큰', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-mcp-'));
  const file = writeAiMcpConfig(join(dir, 'ai-mcp.json'), 7801, 'tok123');
  const doc = JSON.parse(readFileSync(file, 'utf-8'));
  expect(doc.mcpServers['episode-hub'].url).toBe('http://127.0.0.1:7801/mcp');
  expect(doc.mcpServers['episode-hub'].headers.Authorization).toBe('Bearer tok123');
  rmSync(dir, { recursive: true, force: true });
});
