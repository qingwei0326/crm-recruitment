import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const COLORS = ['#22c55e', '#eab308', '#ef4444'];

export default function PredictionChart({ data }) {
  if (!data || !data.distribution || data.total === 0) {
    return <div className="text-center text-gray-400 py-8">暂无数据</div>;
  }

  return (
    <div>
      {/* 概率概览 */}
      <div className="flex items-center gap-4 mb-4 justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">
            {(data.avg_probability * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">平均转化概率</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-800 dark:text-gray-200">
            {data.total}
          </div>
          <div className="text-xs text-gray-500">活跃学生</div>
        </div>
      </div>

      {/* 饼图 */}
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data.distribution}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            label={({ name, value }) => `${name}: ${value}`}
          >
            {data.distribution.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [`${value} 人`, name]}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
