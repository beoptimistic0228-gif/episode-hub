import { useState } from 'react';
import type { GroupKey } from '@shared/groups';
import type { EpisodeDetail, FileEntry } from '@shared/types';
import MarkdownEditor from './MarkdownEditor';
import PromptsWorkbench from './PromptsWorkbench';
import Icon from './Icon';

const hubUrl = (id: string, relPath: string) =>
  `hub://${id}/${relPath.split('/').map(encodeURIComponent).join('/')}`;

function Thumb({ id, file }: { id: string; file: FileEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <figure className="thumb-missing">
        <div className="thumb-placeholder">⏳ 아직 동기 안 됨</div>
        <figcaption>{file.name}</figcaption>
      </figure>
    );
  }
  return (
    <figure>
      <img src={hubUrl(id, file.relPath)} alt={file.name} loading="lazy" onError={() => setFailed(true)} />
      <figcaption>{file.name}</figcaption>
    </figure>
  );
}

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
                  <Icon name="file" /> {f.name}
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
                <Thumb key={f.relPath} id={detail.id} file={f} />
              ))}
            </div>
          )}
          {files.length === 0 && <div className="empty-state">아직 산출물이 없어요</div>}
        </>
      )}
    </div>
  );
}
