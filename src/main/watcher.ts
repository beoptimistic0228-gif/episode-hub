import { watch, type FSWatcher } from 'chokidar';
import { join } from 'node:path';

/** output/episodes 감시 → 변경 시 notify (500ms debounce). 반환 = 정지 함수. */
export function startWatcher(root: string, notify: () => void): () => void {
  const target = join(root, 'output', 'episodes');
  const watcher: FSWatcher = watch(target, {
    ignoreInitial: true,
    depth: 4,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  watcher.on('all', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(notify, 500);
  });
  return () => { void watcher.close(); };
}
