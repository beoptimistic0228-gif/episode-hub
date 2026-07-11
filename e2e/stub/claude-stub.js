// 실제 claude 대역: stdin(프롬프트)을 읽고 고정 stream-json 3줄을 뱉는다.
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'system', subtype: 'init', session_id: 'stub-session-1' });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: '스텁 답변: 총 예산은 **667,250원**입니다.' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: '스텁 답변: 총 예산은 **667,250원**입니다.', session_id: 'stub-session-1' });
  process.exit(0);
});
