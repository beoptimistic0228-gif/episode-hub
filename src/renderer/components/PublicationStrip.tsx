import { useState } from 'react';
import { PLATFORMS, type PlatformKey, type Publication } from '@shared/episode';
import type { EpisodeDetail } from '@shared/types';
import { useHub } from '../store/useHub';

const platformOf = (key: string) => PLATFORMS.find((p) => p.key === key);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 발행 탭 상단 — 실제 게시 기록 (대시보드 집계·달력의 원천, Phase D 스펙 §3) */
export default function PublicationStrip({ detail }: { detail: EpisodeDetail }) {
  const { patchEpisode } = useHub();
  const [adding, setAdding] = useState(false);
  const [platform, setPlatform] = useState<PlatformKey>('youtube');
  const [date, setDate] = useState(todayStr());
  const [url, setUrl] = useState('');
  const pubs: Publication[] = detail.doc?.publications ?? [];

  const add = async () => {
    await patchEpisode({ addPublication: { platform, date, ...(url.trim() ? { url: url.trim() } : {}) } });
    setAdding(false);
    setUrl('');
    setDate(todayStr());
  };

  return (
    <div className="pub-strip">
      <div className="pub-head">
        <span className="pub-title">📌 발행 기록</span>
        {!adding && (
          <button className="btn-pill secondary sm" onClick={() => setAdding(true)}>+ 발행 기록</button>
        )}
      </div>
      {pubs.length === 0 && !adding && (
        <div className="pub-empty">아직 기록이 없어요 — 게시할 때마다 여기 남기면 대시보드 집계·달력에 반영돼요.</div>
      )}
      {pubs.map((p, i) => (
        <div key={i} className="pub-row">
          <span className="pub-badge" style={{ background: platformOf(p.platform)?.color }}>
            {platformOf(p.platform)?.label ?? p.platform}
          </span>
          <span className="pub-date">{p.date}</span>
          {p.url && <a className="pub-url" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>}
          <button
            className="btn-copy pub-del"
            onClick={() => { if (window.confirm('이 발행 기록을 삭제할까요?')) void patchEpisode({ removePublication: { index: i } }); }}
          >
            삭제
          </button>
        </div>
      ))}
      {adding && (
        <div className="pub-form">
          <select className="pub-input" value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey)}>
            {PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <input className="pub-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input
            className="pub-input pub-input-url" type="url" placeholder="URL (선택)"
            value={url} onChange={(e) => setUrl(e.target.value)}
          />
          <button className="btn-pill primary sm" onClick={() => void add()}>기록</button>
          <button className="btn-pill secondary sm" onClick={() => setAdding(false)}>취소</button>
        </div>
      )}
    </div>
  );
}
