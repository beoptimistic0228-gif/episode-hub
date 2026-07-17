import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { PLATFORMS } from '@shared/episode';
import type { ChannelSnapshot } from '@shared/stats';

const YT = PLATFORMS.find((p) => p.key === 'youtube')!.color;   // ember
const BLOG = PLATFORMS.find((p) => p.key === 'blog')!.color;    // forest

/** 구독자·블로그이웃 시계열. 스냅샷 0개면 안내, 1개면 점 하나로 현재값 표시, 2개+면 선. */
export default function GrowthChart({ snapshots }: { snapshots: ChannelSnapshot[] }) {
  if (snapshots.length === 0) {
    return <div className="chart-empty">성장 데이터가 쌓이는 중이에요</div>;
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hairline)" />
          <XAxis dataKey="date" fontSize={11} />
          {/* 구독자·블로그이웃은 스케일이 달라 각자 축을 둔다(한쪽이 눌려 보이지 않게) */}
          <YAxis yAxisId="left" fontSize={11} width={44} stroke={YT} />
          <YAxis yAxisId="right" orientation="right" fontSize={11} width={44} stroke={BLOG} />
          <Tooltip />
          <Legend />
          {/* 점 1~2개일 땐 dot을 찍어 첫날 값도 보이게, 선이 생기는 3개+부턴 dot 숨김 */}
          <Line yAxisId="left" type="monotone" dataKey="구독자" stroke={YT} strokeWidth={2} dot={data.length <= 2 ? { r: 3 } : false} connectNulls />
          <Line yAxisId="right" type="monotone" dataKey="블로그이웃" stroke={BLOG} strokeWidth={2} dot={data.length <= 2 ? { r: 3 } : false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
