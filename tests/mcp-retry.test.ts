import { startMcpBridgeWithRetry, type BridgeHandle } from '../src/main/mcpServer';

const eaddr = () => Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
const handle: BridgeHandle = { port: 1, stop: async () => {} };
const opts = { getRoot: () => null, token: 't', port: 0 };

describe('startMcpBridgeWithRetry', () => {
  test('EADDRINUSE면 재시도 후 성공', async () => {
    const starter = vi.fn().mockRejectedValueOnce(eaddr()).mockRejectedValueOnce(eaddr()).mockResolvedValue(handle);
    const sleep = vi.fn(async () => {});
    await expect(startMcpBridgeWithRetry(opts, { starter, sleep, delayMs: 1 })).resolves.toBe(handle);
    expect(starter).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  test('tries 소진 시 마지막 에러 throw', async () => {
    const starter = vi.fn().mockRejectedValue(eaddr());
    const sleep = vi.fn(async () => {});
    await expect(startMcpBridgeWithRetry(opts, { starter, sleep, tries: 3 })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(starter).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  test('EADDRINUSE 외 원인은 즉시 throw(재시도 없음)', async () => {
    const starter = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(startMcpBridgeWithRetry(opts, { starter, sleep: async () => {} })).rejects.toThrow('boom');
    expect(starter).toHaveBeenCalledTimes(1);
  });
});
