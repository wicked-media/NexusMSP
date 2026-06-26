/* Sparkline.jsx — minimal inline SVG sparkline. No deps. */
export default function Sparkline({ data = [], width = 60, height = 18, color = "#a78bfa", thickness = 1.4 }) {
  if (!data || data.length < 2) return <span style={{ width, height, display: "inline-block" }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = data[data.length - 1];
  const lastY = height - ((last - min) / span) * (height - 2) - 1;
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <polyline fill="none" stroke={color} strokeWidth={thickness} points={pts} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width - 0.5} cy={lastY} r={1.6} fill={color} />
    </svg>
  );
}
