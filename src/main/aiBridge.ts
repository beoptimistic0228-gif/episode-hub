import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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

export interface SpawnLike {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  on(ev: 'close', cb: (code: number | null) => void): unknown;
  kill(): void;
}

export interface AiBridgeDeps {
  mcpConfigPath: string;
  onEvent: (ev: AskEvent) => void;
  spawnImpl: (args: string[]) => SpawnLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class AiBridge {
  private child: SpawnLike | null = null;
  private sessions = new Map<string, string>();
  private killedByUs = false;
  constructor(private deps: AiBridgeDeps) {}

  busy(): boolean { return this.child !== null; }

  ask(episodeId: string, question: string): { ok: true } | { ok: false; message: string } {
    if (this.child) return { ok: false, message: '이미 답변 중이에요. 끝나면 다시 물어봐 주세요.' };
    const resume = this.sessions.get(episodeId);
    const args = buildAskArgs({ mcpConfigPath: this.deps.mcpConfigPath, resumeSessionId: resume });
    const child = this.deps.spawnImpl(args);
    this.child = child;
    this.killedByUs = false;

    const timeoutMs = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer = setTimeout(onTimeout, timeoutMs);
    const bump = () => { clearTimeout(timer); timer = setTimeout(onTimeout, timeoutMs); };
    const self = this;
    function onTimeout() {
      self.killedByUs = true;
      self.deps.onEvent({ kind: 'error', text: '응답이 없어 중단했어요. 다시 시도해 주세요.' });
      child.kill();
    }

    let sawResult = false;
    let stderrTail = '';
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      bump();
      buf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const ev = parseStreamLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (!ev) continue;
        if (ev.sessionId) this.sessions.set(episodeId, ev.sessionId);
        if (ev.kind === 'result' || ev.kind === 'error') sawResult = true;
        this.deps.onEvent(ev);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString('utf-8')).slice(-500); });
    child.on('close', (code) => {
      clearTimeout(timer);
      this.child = null;
      if (!sawResult && code !== 0 && !this.killedByUs) {
        // 만료 세션 resume 실패 등 — 세션 폐기해 다음 질문은 새 세션으로
        if (resume) this.sessions.delete(episodeId);
        this.deps.onEvent({ kind: 'error', text: `Claude 실행이 실패했어요. ${stderrTail || `(exit ${code})`}` });
      }
      this.deps.onEvent({ kind: 'done' });
    });
    child.stdin.end(buildPrompt(episodeId, question, !resume));
    return { ok: true };
  }

  cancel(): void {
    if (this.child) {
      this.killedByUs = true;
      this.child.kill();
    }
  }
  reset(episodeId: string): void { this.sessions.delete(episodeId); }
}

/** claude 실행 파일 탐지 — env HUB_CLAUDE_BIN 우선(테스트·스텁), 없으면 PATH 조회. */
export function resolveClaudeBin(): string | null {
  const envBin = process.env.HUB_CLAUDE_BIN;
  if (envBin) return existsSync(envBin) ? envBin : null;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf-8' });
  if (r.status !== 0) return null;
  const first = (r.stdout ?? '').split(/\r?\n/).find(Boolean);
  return first ?? null;
}

/** 실제 spawn. win32는 .cmd 셔임 대응으로 shell 경유 + 공백 인자만 쿼팅(프롬프트는 stdin이라 안전). */
export function spawnClaude(bin: string, args: string[]): SpawnLike {
  if (process.platform === 'win32') {
    const q = (s: string) => (/[ \t]/.test(s) ? `"${s}"` : s);
    return spawn(q(bin), args.map(q), { shell: true, windowsHide: true }) as unknown as SpawnLike;
  }
  return spawn(bin, args) as unknown as SpawnLike;
}
