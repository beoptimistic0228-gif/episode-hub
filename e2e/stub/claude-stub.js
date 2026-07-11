// 실제 claude 대역. 기본: stdin(프롬프트)을 읽고 고정 stream-json을 뱉는다.
// 프롬프트에 '고쳐'가 있으면 argv의 --mcp-config 접속정보로 propose_edit를 실제 호출(E3 제안 흐름).
// require 해석은 이 파일 위치(e2e/stub/) 기준 상위 node_modules를 쓴다.
const { readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

let stdin = '';
process.stdin.resume();
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => { main().catch((e) => { process.stderr.write(String(e)); process.exit(1); }); });

async function main() {
  out({ type: 'system', subtype: 'init', session_id: 'stub-session-1' });
  if (stdin.includes('고쳐')) {
    const cfgFile = args[args.indexOf('--mcp-config') + 1];
    const cfg = JSON.parse(readFileSync(cfgFile, 'utf-8')).mcpServers['episode-hub'];
    const m = /지금 보고 있는 에피소드: (\S+)/.exec(stdin);
    if (!m) throw new Error('프리앰블에서 에피소드 id를 찾지 못함(새 대화가 아님?)');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'stub', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } }));
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__episode-hub__propose_edit', input: {} }] } });
    const res = await client.callTool({
      name: 'propose_edit',
      arguments: { id: m[1], relPath: 'script/콘티.md', newContent: '# 콘티\n\nE2E-PROPOSED\n', reason: '더 유쾌한 톤으로 정리' },
    });
    await client.close();
    if (res.isError) throw new Error('propose_edit 거절: ' + JSON.stringify(res.content));
    out({ type: 'result', subtype: 'success', is_error: false, result: '수정안을 제안했어요. 아래 카드에서 확인해 주세요.', session_id: 'stub-session-1' });
  } else {
    out({ type: 'assistant', message: { content: [{ type: 'text', text: '스텁 답변: 총 예산은 **667,250원**입니다.' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: '스텁 답변: 총 예산은 **667,250원**입니다.', session_id: 'stub-session-1' });
  }
  process.exit(0);
}
