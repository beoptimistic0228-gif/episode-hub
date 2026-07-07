import { useEffect, useMemo, useState } from 'react';
import type { EpisodeDetail, FileEntry } from '@shared/types';
import MarkdownView from './MarkdownView';
import { matchPhoto, parseMasterSheet, type SkuSection } from '../lib/promptMatch';
import { useHub } from '../store/useHub';
import { normCategory, RENDER_ROWS } from '@shared/episode';

const hubUrl = (id: string, relPath: string) =>
  `hub://${id}/${relPath.split('/').map(encodeURIComponent).join('/')}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '✓ 복사됨' : '📋 복사'}
    </button>
  );
}

export default function PromptsWorkbench({ detail }: { detail: EpisodeDetail }) {
  const master = detail.files.prompts.find((f) => f.name === 'master_sheets_prompts.md');
  const roomMd = detail.files.prompts.find((f) => f.name === 'room_render_prompts.md');
  const images = detail.files.products.filter((f) => f.kind === 'image');
  const [tab, setTab] = useState<'sku' | 'room'>('sku');
  const [sections, setSections] = useState<SkuSection[]>([]);

  const saveRender = useHub((s) => s.saveRender);
  const renderNames = new Set(detail.files.renders.map((f) => f.name));
  const hasRender = (category: string, row: string) =>
    renderNames.has(`${normCategory(category)}__${row}.png`);

  const onDrop = async (category: string, row: string, e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const bytes = await file.arrayBuffer();
    let res = await saveRender(category, row, bytes);
    if ('exists' in res) {
      if (!window.confirm(`${category} ${row} 렌더가 이미 있어요. 교체할까요?`)) return;
      res = await saveRender(category, row, bytes, true);
    }
  };

  useEffect(() => {
    if (!master) return;
    window.hub.files.readText(detail.id, master.relPath)
      .then((md) => setSections(parseMasterSheet(md)))
      .catch(() => setSections([]));
  }, [detail.id, master?.relPath]);

  const matched = useMemo(
    () => sections.map((s) => ({ s, photo: matchPhoto(s.category, images) })),
    [sections, images],
  );

  const doneCount = matched.filter(({ s }) =>
    RENDER_ROWS.some((r) => hasRender(s.category, r))).length;

  return (
    <div>
      <div className="seg">
        <button className={`seg-btn${tab === 'sku' ? ' active' : ''}`} onClick={() => setTab('sku')}>
          제품 마스터시트 ({doneCount}/{sections.length})
        </button>
        <button className={`seg-btn${tab === 'room' ? ' active' : ''}`} onClick={() => setTab('room')}>
          방 렌더 (Phase 0~5)
        </button>
      </div>

      {tab === 'sku' && matched.map(({ s, photo }) => (
        <div key={s.index} className="sku-card">
          {photo ? (
            <img className="sku-photo" src={hubUrl(detail.id, photo.relPath)} alt={s.category} />
          ) : (
            <div className="sku-photo placeholder">사진 없음</div>
          )}
          <div className="sku-body">
            <div className="sku-title">{s.index}. [{s.category}] {s.model}</div>
            {s.blocks.map((b, i) => (
              <div key={i} className="prompt-row">
                <span className="prompt-label">{b.label}</span>
                <CopyButton text={b.text} />
              </div>
            ))}
            <div className="drop-row">
              {RENDER_ROWS.map((r) => (
                <div
                  key={r}
                  className={`dropzone${hasRender(s.category, r) ? ' filled' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(s.category, r, e)}
                >
                  {hasRender(s.category, r) ? `✓ ${r} 생성됨` : `${r} 이미지 드롭`}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
      {tab === 'sku' && sections.length === 0 && (
        <div className="empty-state">마스터시트 프롬프트가 없어요 (Agent 8 실행 필요)</div>
      )}

      {tab === 'room' && (roomMd
        ? <MarkdownView id={detail.id} relPath={roomMd.relPath} />
        : <div className="empty-state">방 렌더 프롬프트가 없어요 (프롬프트팀 Phase 8B 실행 필요)</div>)}
    </div>
  );
}
