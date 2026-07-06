import { useState } from 'react';
import { GROUPS, type GroupKey } from '@shared/groups';
import type { EpisodeDetail, FileEntry } from '@shared/types';
import MarkdownView from './MarkdownView';
import PromptsWorkbench from './PromptsWorkbench';

const hubUrl = (id: string, relPath: string) =>
  `hub://${id}/${relPath.split('/').map(encodeURIComponent).join('/')}`;

export default function GroupDetail({
  detail, group, onBack,
}: { detail: EpisodeDetail; group: GroupKey; onBack: () => void }) {
  const files = detail.files[group];
  const mds = files.filter((f) => f.kind === 'md');
  const images = files.filter((f) => f.kind === 'image');
  const [openMd, setOpenMd] = useState<FileEntry | null>(mds[0] ?? null);
  const label = GROUPS.find((g) => g.key === group)!;

  return (
    <div>
      <button className="detail-back" onClick={onBack}>← 전체 보기</button>
      <h3 style={{ margin: '4px 0 16px' }}>{label.emoji} {label.label}</h3>

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
          {openMd && <MarkdownView id={detail.id} relPath={openMd.relPath} />}
          {images.length > 0 && (
            <div className="thumb-grid" style={{ marginTop: 20 }}>
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
