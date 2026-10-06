import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';

interface TelemetryAreaGraphProps {
  title: string;
  subtitle?: string;
  /** Real samples, oldest first. Non-finite values are ignored. */
  data: number[];
  unit: string;
  warningThreshold?: number;
  criticalThreshold?: number;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'indigo';
  /** Optional per-point labels (e.g. sample timestamps) shown on hover */
  labels?: string[];
  /** Shown instead of the chart when there are no samples */
  emptyMessage?: string;
  /** Lower bound for the y-axis maximum (defaults to 100 for % units, otherwise the data peak) */
  minScaleMax?: number;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// Function to generate smooth cubic bezier curve through points
function getBezierPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    // Control points for cubic bezier (Catmull-Rom to Bezier conversion)
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }

  return path;
}

export const TelemetryAreaGraph: React.FC<TelemetryAreaGraphProps> = ({
  title,
  subtitle,
  data,
  unit,
  warningThreshold,
  criticalThreshold,
  color = 'blue',
  labels,
  emptyMessage = 'No samples recorded yet',
  minScaleMax,
}) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const series = (data ?? []).filter(v => Number.isFinite(v));

  const header = (valueNode: React.ReactNode) => (
    <div className="flex items-center justify-between mb-1">
      <div>
        <span className="text-xs font-semibold">{title}</span>
        {subtitle && (
          <span className={`text-[10px] ml-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {subtitle}
          </span>
        )}
      </div>
      {valueNode}
    </div>
  );

  const shellClass = `p-3 rounded-lg border font-mono transition-colors ${
    isDark ? 'bg-[#111726] border-[#1C273C]' : 'bg-white border-slate-200 shadow-xs'
  }`;

  if (series.length === 0) {
    return (
      <div className={shellClass}>
        {header(<span className={`text-sm font-bold ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>—</span>)}
        <div className={`h-18 my-1 flex items-center justify-center text-center px-2 rounded border border-dashed text-[10px] ${
          isDark ? 'border-[#1C273C] text-slate-500' : 'border-slate-200 text-slate-400'
        }`}>
          {emptyMessage}
        </div>
      </div>
    );
  }

  const min = Math.min(...series);
  const peak = Math.max(...series);
  const max = Math.max(
    peak,
    minScaleMax ?? (unit.trim() === '%' ? 100 : 0),
    warningThreshold ?? 0,
    criticalThreshold ?? 0,
  ) || 1;
  const current = series[series.length - 1];
  const avg = series.reduce((a, b) => a + b, 0) / series.length;

  // SVG dimensions
  const width = 360;
  const height = 90;
  const paddingX = 6;
  const paddingY = 10;
  const graphWidth = width - paddingX * 2;
  const graphHeight = height - paddingY * 2;

  // Calculate coordinates
  const points = series.map((val, idx) => {
    const x = paddingX + (series.length === 1 ? graphWidth / 2 : (idx / (series.length - 1)) * graphWidth);
    const y = height - paddingY - (Math.max(0, val) / max) * graphHeight;
    return { x, y, val };
  });

  // Smooth bezier curve for line
  const bezierLine = getBezierPath(points);

  // Closed area path
  const areaPath = `
    ${bezierLine}
    L ${points[points.length - 1].x},${height - paddingY}
    L ${points[0].x},${height - paddingY}
    Z
  `;

  const colorMap = {
    blue: { line: '#3B82F6', text: 'text-blue-500' },
    emerald: { line: '#10B981', text: 'text-emerald-500' },
    amber: { line: '#F59E0B', text: 'text-amber-500' },
    rose: { line: '#F43F5E', text: 'text-rose-500' },
    indigo: { line: '#6366F1', text: 'text-indigo-500' },
  };

  const scheme = colorMap[color];
  const uniqueGradId = `grad-${title.replace(/[^a-zA-Z0-9]/g, '')}`;
  const shown = hoveredIdx !== null && series[hoveredIdx] !== undefined ? series[hoveredIdx] : current;
  const thresholdY = (v: number) => height - paddingY - (v / max) * graphHeight;

  return (
    <div className={shellClass}>
      {/* Title & Current Stat Readouts */}
      {header(
        <div className="flex items-baseline gap-1">
          <span className={`text-sm font-bold ${scheme.text}`}>{fmt(shown)}</span>
          <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{unit}</span>
        </div>
      )}
      {hoveredIdx !== null && labels?.[hoveredIdx] && (
        <div className={`text-[9px] -mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{labels[hoveredIdx]}</div>
      )}

      {/* SVG Time-Series Chart */}
      <div className="relative my-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-18 overflow-visible"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id={uniqueGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={scheme.line} stopOpacity={isDark ? "0.45" : "0.3"} />
              <stop offset="100%" stopColor={scheme.line} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Warning threshold line */}
          {warningThreshold !== undefined && (
            <line
              x1={paddingX}
              y1={thresholdY(warningThreshold)}
              x2={width - paddingX}
              y2={thresholdY(warningThreshold)}
              stroke="#F59E0B"
              strokeWidth="1"
              strokeDasharray="3 3"
              strokeOpacity="0.65"
            />
          )}

          {/* Critical threshold line */}
          {criticalThreshold !== undefined && (
            <line
              x1={paddingX}
              y1={thresholdY(criticalThreshold)}
              x2={width - paddingX}
              y2={thresholdY(criticalThreshold)}
              stroke="#F43F5E"
              strokeWidth="1"
              strokeDasharray="3 3"
              strokeOpacity="0.65"
            />
          )}

          {/* Smooth Bezier Area Fill */}
          {points.length > 1 && <path d={areaPath} fill={`url(#${uniqueGradId})`} />}

          {/* Smooth Bezier Line Stroke */}
          <path
            d={bezierLine}
            fill="none"
            stroke={scheme.line}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Interactive Hover Point Markers */}
          {points.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r={hoveredIdx === idx ? 4.5 : 2}
              className="cursor-pointer transition-all"
              fill={hoveredIdx === idx ? '#FFFFFF' : scheme.line}
              stroke={scheme.line}
              strokeWidth="1.5"
              onMouseEnter={() => setHoveredIdx(idx)}
            />
          ))}
        </svg>
      </div>

      {/* Metric Summary Footer with Min / Avg / Peak / Current */}
      <div className={`flex items-center justify-between text-[10px] pt-1.5 border-t ${
        isDark ? 'border-[#1C273C] text-slate-400' : 'border-slate-100 text-slate-500'
      }`}>
        <span>Min: {fmt(min)}{unit}</span>
        <span>Avg: {fmt(avg)}{unit}</span>
        <span>Peak: {fmt(peak)}{unit}</span>
        <span className={scheme.text}>Now: {fmt(current)}{unit}</span>
      </div>
    </div>
  );
};
