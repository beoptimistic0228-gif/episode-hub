import { useEffect, useMemo, useState } from 'react';
import type { EpisodeDetail, FileEntry } from '@shared/types';
import MarkdownView from './MarkdownView';
import { matchPhoto, parseMasterSheet, type SkuSection } from '../lib/promptMatch';

const hubUrl = (id: string, relPath: string) =>
  `hub://${id}/${relPath.split('/').map(encodeURIComponent).join('/')}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-pill secondary sm"
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

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <button className={`btn-pill sm ${tab === 'sku' ? 'primary' : 'secondary'}`} onClick={() => setTab('sku')}>
          제품 마스터시트 ({sections.length})
        </button>{' '}
        <button className={`btn-pill sm ${tab === 'room' ? 'primary' : 'secondary'}`} onClick={() => setTab('room')}>
          방 렌더 (Phase 0~5)
        </button>
      </div>

      {tab === 'sku' && matched.map(({ s, photo }) => (
        <div key={s.index} className="group-card" style={{ cursor: 'default', marginBottom: 16, display: 'flex', gap: 16 }}>
          {photo ? (
            <img src={hubUrl(detail.id, photo.relPath)} alt={s.category}
                 style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 'var(--r-lg)', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 120, height: 120, background: 'var(--canvas-cream)', borderRadius: 'var(--r-lg)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          color: 'var(--ink-mute)', fontSize: 12 }}>사진 없음</div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="g-label">{s.index}. [{s.category}] {s.model}</div>
            {s.blocks.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                <span style={{ fontSize: 13, color: 'var(--ink-mute)', flexShrink: 0 }}>{b.label}</span>
                <CopyButton text={b.text} />
              </div>
            ))}
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
