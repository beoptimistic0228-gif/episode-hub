import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { PLATFORMS } from '@shared/episode';
import type { ChannelSnapshot } from '@shared/stats';

const YT = PLATFORMS.find((p) => p.key === 'youtube')!.color;   // ember
const BLOG = PLATFORMS.find((p) => p.key === 'blog')!.color;    // forest

/** 구독자·블로그이웃 시계열. 스냅샷 2개 미만이면 안내. */
export default function GrowthChart({ snapshots }: { snapshots: ChannelSnapshot[] }) {
  if (snapshots.length < 2) {
    return <div className="chart-empty">성장 데이터가 쌓이는 중이에요 (스냅샷 {snapshots.length}개)</div>;
  }
  const data = snapshots.map((s) => ({
    date: s.date.slice(5), // MM-DD
    구독자: s.youtube?.subscribers ?? null,
    블로그이웃: s.blog?.neighbors ?? null,
  }));
  return (
    <div className="chart-card">
      <h4 className="chart-title">성장 추이</h4>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="date" fontSize={11} />
          <YAxis fontSize={11} width={44} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="구독자" stroke={YT} strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="블로그이웃" stroke={BLOG} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
