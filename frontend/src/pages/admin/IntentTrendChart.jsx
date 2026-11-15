import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const NUM_TO_INTENT = { 3: 'A', 2: 'B', 1: 'C', 0: '无' };

// Kept in its own file so the chart library loads only when this tab is opened.
export default function IntentTrendChart({ data, dark }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#374151' : '#e5e7eb'} />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }} />
        <YAxis
          domain={[0, 3]}
          ticks={[0, 1, 2, 3]}
          tickFormatter={(v) => NUM_TO_INTENT[v] || ''}
          tick={{ fontSize: 12, fill: dark ? '#9ca3af' : '#6b7280' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: dark ? '#1f2937' : '#fff',
            border: 'none',
            borderRadius: '8px',
            color: dark ? '#e5e7eb' : '#111827',
          }}
          formatter={(value) => [NUM_TO_INTENT[value] || '无', '意向等级']}
        />
        <Line type="stepAfter" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
