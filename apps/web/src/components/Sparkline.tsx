interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function Sparkline({ data, width = 120, height = 32, color = "#6366f1" }: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} />;
  }

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);

  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={areaPoints} fill={color} fillOpacity="0.12" stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
