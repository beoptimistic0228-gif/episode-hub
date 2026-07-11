import { writeFileSync } from 'node:fs';
import { MCP_PATH } from './mcpBridge';

/** E2 읽기 전용 보장의 핵심 — 이 4종 외 도구는 스폰된 claude에 존재하지 않는다. */
export const READ_TOOLS = [
  'mcp__episode-hub__list_episodes',
  'mcp__episode-hub__read_episode',
  'mcp__episode-hub__read_file',
  'mcp__episode-hub__get_channel_stats',
] as const;

const DENY_TOOLS = 'Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch';

export interface AskEvent {
  kind: 'init' | 'text' | 'tool' | 'result' | 'error' | 'done';
  text?: string;
  tool?: string;
  sessionId?: string;
}

export function buildPrompt(episodeId: string, question: string, isNewSession: boolean): string {
  if (!isNewSession) return question;
  return [
    '당신은 "누구의 공간" 채널 Episode Hub 앱에서 부부의 질문에 답하는 도우미입니다.',
    `지금 보고 있는 에피소드: ${episodeId}`,
    'episode-hub MCP 도구(read_episode·read_file 등)로 실제 데이터를 읽고 답하세요.',
    '- 제품·가격 숫자는 에피소드 데이터에서 인용만 하고, 추측으로 만들지 마세요.',
    '- 비개발자 부부가 읽습니다. 쉬운 한국어로 답하세요.',
    '',
    `질문: ${question}`,
  ].join('\n');
}

/** 프롬프트는 argv가 아니라 stdin으로 넣는다(따옴표·개행 이스케이프 문제 원천 차단). */
export function buildAskArgs(opts: { mcpConfigPath: string; resumeSessionId?: string }): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose',
    '--mcp-config', opts.mcpConfigPath, '--strict-mcp-config',
    '--allowedTools', READ_TOOLS.join(','),
    '--disallowedTools', DENY_TOOLS,
  ];
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  return args;
}

export function parseStreamLine(line: string): AskEvent | null {
  const t = line.trim();
  if (!t) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(t); } catch { return null; }
  if (j.type === 'system' && j.subtype === 'init') return { kind: 'init', sessionId: String(j.session_id) };
  if (j.type === 'assistant') {
    const msg = j.message as { content?: Array<{ type: string; text?: string; name?: string }> } | undefined;
    const parts = msg?.content ?? [];
    const tool = parts.find((c) => c.type === 'tool_use');
    if (tool) return { kind: 'tool', tool: tool.name };
    const text = parts.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return text ? { kind: 'text', text } : null;
  }
  if (j.type === 'result') {
    const sessionId = j.session_id ? String(j.session_id) : undefined;
    if (j.is_error) return { kind: 'error', text: String(j.result ?? j.subtype ?? '알 수 없는 오류'), sessionId };
    return { kind: 'result', text: String(j.result ?? ''), sessionId };
  }
  return null;
}

/** 스폰된 claude에 줄 E1 접속 정보(mcp-config) 파일. userData에 기록(비밀 토큰 — 레포 밖). */
export function writeAiMcpConfig(file: string, port: number, token: string): string {
  const doc = {
    mcpServers: {
      'episode-hub': {
        type: 'http',
        url: `http://127.0.0.1:${port}${MCP_PATH}`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
  writeFileSync(file, JSON.stringify(doc, null, 2), 'utf-8');
  return file;
}
