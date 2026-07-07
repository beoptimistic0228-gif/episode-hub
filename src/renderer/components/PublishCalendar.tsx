import { useState } from 'react';
import { PLATFORMS, type Publication } from '@shared/episode';
import type { EpisodeSummary } from '@shared/types';

const platformOf = (key: string) => PLATFORMS.find((p) => p.key === key);

/** 월간 발행 달력 — 발행일마다 플랫폼 색 점 (색 단독 식별 금지: hover 제목 + 하단 범례) */
export default function PublishCalendar({ episodes }: { episodes: EpisodeSummary[] }) {
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() }); // m: 0-11

  // date(YYYY-MM-DD) → [{platform, title}] — 렌더 순서는 PLATFORMS 순서(검증된 인접 순서)
  const byDate = new Map<string, { platform: string; title: string }[]>();
  for (const ep of episodes) {
    for (const pub of ep.publications as Publication[]) {
      const list = byDate.get(pub.date) ?? [];
      list.push({ platform: pub.platform, title: ep.title });
      byDate.set(pub.date, list);
    }
  }
  const order = PLATFORMS.map((p) => p.key as string);
  for (const list of byDate.values()) {
    list.sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
  }

  const first = new Date(ym.y, ym.m, 1);
  const startPad = first.getDay(); // 일요일 시작
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const dateStr = (d: number) => `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const isToday = (d: number) =>
    ym.y === today.getFullYear() && ym.m === today.getMonth() && d === today.getDate();
  const move = (delta: number) => {
    const dt = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: dt.getFullYear(), m: dt.getMonth() });
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <span className="cal-title">{ym.y}년 {ym.m + 1}월 발행</span>
        <span className="cal-nav">
          <button className="btn-pill secondary sm" onClick={() => move(-1)} aria-label="이전 달">◀</button>
          <button className="btn-pill secondary sm" onClick={() => move(1)} aria-label="다음 달">▶</button>
        </span>
      </div>
      <div className="cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
          <div key={w} className="cal-dow">{w}</div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className={`cal-cell${d && isToday(d) ? ' today' : ''}${d ? '' : ' blank'}`}>
            {d && (
              <>
                <span className="cal-day">{d}</span>
                <span className="cal-dots">
                  {(byDate.get(dateStr(d)) ?? []).map((e, j) => (
                    <span
                      key={j}
                      className="cal-dot"
                      style={{ background: platformOf(e.platform)?.color }}
                      title={`${platformOf(e.platform)?.label} — ${e.title}`}
                    />
                  ))}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="cal-legend">
        {PLATFORMS.map((p) => (
          <span key={p.key} className="cal-legend-item">
            <span className="cal-dot" style={{ background: p.color }} /> {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
