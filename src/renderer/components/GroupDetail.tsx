import { useState } from 'react';
import type { GroupKey } from '@shared/groups';
import type { EpisodeDetail, FileEntry } from '@shared/types';
import MarkdownEditor from './MarkdownEditor';
import PromptsWorkbench from './PromptsWorkbench';

const hubUrl = (id: string, relPath: string) =>
  `hub://${id}/${relPath.split('/').map(encodeURIComponent).join('/')}`;

export default function GroupDetail({
  detail, group,
}: { detail: EpisodeDetail; group: GroupKey }) {
  const files = detail.files[group];
  const mds = files.filter((f) => f.kind === 'md');
  const images = files.filter((f) => f.kind === 'image');
  const videos = files.filter((f) => f.kind === 'video');
  const [openMd, setOpenMd] = useState<FileEntry | null>(mds[0] ?? null);

  return (
    <div>
      {group === 'prompts' ? (
        <PromptsWorkbench detail={detail} />
      ) : (
        <>
          {mds.length > 0 && (
            <div className="file-list">
              {mds.map((f) => (
                <button
                  key={f.relPath}
                  className={`file-item${openMd?.relPath === f.relPath ? ' selected' : ''}`}
                  onClick={() => setOpenMd(f)}
                >
                  📄 {f.name}
                </button>
              ))}
            </div>
          )}
          {openMd && <MarkdownEditor id={detail.id} relPath={openMd.relPath} mtimeMs={openMd.mtimeMs} />}
          {videos.length > 0 && (
            <div className="video-grid">
              {videos.map((f) => (
                <figure key={f.relPath} className="video-card">
                  {/* hub:// 프로토콜(stream) 경유 — 앱 내 재생 (Phase D 스펙 §2) */}
                  <video controls preload="metadata" src={hubUrl(detail.id, f.relPath)} />
                  <figcaption>{f.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className="thumb-grid">
              {images.map((f) => (
                <figure key={f.relPath}>
                  <img src={hubUrl(detail.id, f.relPath)} alt={f.name} loading="lazy" />
                  <figcaption>{f.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {files.length === 0 && <div className="empty-state">아직 산출물이 없어요</div>}
        </>
      )}
    </div>
  );
}
