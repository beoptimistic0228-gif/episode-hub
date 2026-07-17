import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { PLATFORMS, type Publication } from '@shared/episode';

/** ISO week 키 (YYYY-Www) — 주별 그룹핑 */
function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export default function PublishTrendChart({ publications }: { publications: Publication[] }) {
  if (publications.length === 0) {
    return <div className="chart-empty">발행 기록이 아직 없어요</div>;
  }
  const byWeek: Record<string, Record<string, number>> = {};
  for (const p of publications) {
    const w = isoWeek(p.date);
    byWeek[w] = byWeek[w] || {};
    byWeek[w][p.platform] = (byWeek[w][p.platform] ?? 0) + 1;
  }
  const data = Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, counts]) => ({ week: week.slice(5), ...counts }));
  return (
    <div className="chart-card">
      <h4 className="chart-title">발행 추이 (주별)</h4>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
          <XAxis dataKey="week" fontSize={11} />
          <YAxis fontSize={11} width={28} allowDecimals={false} />
          <Tooltip />
          <Legend />
          {PLATFORMS.map((p) => (
            <Bar key={p.key} dataKey={p.key} name={p.label} stackId="pub" fill={p.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
