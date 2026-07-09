import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { assertEpisodeId, resolveImagePath } from './pathGuard';

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** 레포 output/episodes/<id>/** 의 이미지들을 imageRoot/<id>/<rel> 로 1회 복사. 이미 있으면 건너뜀. */
export function migrateImagesToImageRoot(root: string, imageRoot: string): { copied: number } {
  const epsDir = join(root, 'output', 'episodes');
  if (!existsSync(epsDir)) return { copied: 0 };
  let copied = 0;
  let ids: string[];
  try { ids = readdirSync(epsDir); } catch { return { copied: 0 }; } // 권한·삭제 레이스 — 크래시 대신 0
  for (const id of ids) {
    const epDir = join(epsDir, id);
    let isDir = false;
    try { isDir = statSync(epDir).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    try { assertEpisodeId(id); } catch { continue; } // 규약 외 폴더 스킵
    const walk = (d: string) => {
      let entries: string[];
      try { entries = readdirSync(d); } catch { return; }
      for (const name of entries) {
        const full = join(d, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) {
          if (name === '_deprecated') continue;
          walk(full);
        } else if (IMAGE_EXT.test(name)) {
          const rel = relative(epDir, full).split(sep).join('/');
          const dest = resolveImagePath(imageRoot, id, rel);
          if (existsSync(dest)) continue;
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(full, dest);
          copied++;
        }
      }
    };
    walk(epDir);
  }
  return { copied };
}
