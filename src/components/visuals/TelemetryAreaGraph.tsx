import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';

interface TelemetryAreaGraphProps {
  title: string;
  subtitle?: string;
  data: number[];
  unit: string;
  warningThreshold?: number;
  criticalThreshold?: number;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'indigo';
}

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
  color = 'blue'
}) => {
  const { theme } = useOps();
  const isDark = theme === 'dark';

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data, 100);
  const current = data[data.length - 1];
  const peak = Math.max(...data);
  const avg = +(data.reduce((a, b) => a + b, 0) / data.length).toFixed(1);

  // SVG dimensions
  const width = 360;
  const height = 90;
  const paddingX = 6;
  const paddingY = 10;
  const graphWidth = width - paddingX * 2;
  const graphHeight = height - paddingY * 2;

  // Calculate coordinates
  const points = data.map((val, idx) => {
    const x = paddingX + (idx / (data.length - 1)) * graphWidth;
    const y = height - paddingY - ((val - 0) / (max - 0 || 1)) * graphHeight;
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
    blue: {
      line: '#3B82F6',
      fill: isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.15)',
      gradientStart: '#3B82F6',
      text: 'text-blue-500'
    },
    emerald: {
      line: '#10B981',
      fill: isDark ? 'rgba(16, 185, 129, 0.3)' : 'rgba(16, 185, 129, 0.15)',
      gradientStart: '#10B981',
      text: 'text-emerald-500'
    },
    amber: {
      line: '#F59E0B',
      fill: isDark ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.15)',
      gradientStart: '#F59E0B',
      text: 'text-amber-500'
    },
    rose: {
      line: '#F43F5E',
      fill: isDark ? 'rgba(244, 63, 94, 0.3)' : 'rgba(244, 63, 94, 0.15)',
      gradientStart: '#F43F5E',
      text: 'text-rose-500'
    },
    indigo: {
      line: '#6366F1',
      fill: isDark ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.15)',
      gradientStart: '#6366F1',
      text: 'text-indigo-500'
    }
  };

  const scheme = colorMap[color];
  const uniqueGradId = `grad-${title.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className={`p-3 rounded-lg border font-mono transition-colors ${
      isDark ? 'bg-[#111726] border-[#1C273C]' : 'bg-white border-slate-200 shadow-xs'
    }`}>
      {/* Title & Current Stat Readouts */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="text-xs font-semibold">{title}</span>
          {subtitle && (
            <span className={`text-[10px] ml-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {subtitle}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span className={`text-sm font-bold ${scheme.text}`}>
            {hoveredIdx !== null ? data[hoveredIdx] : current}
          </span>
          <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{unit}</span>
        </div>
      </div>

      {/* SVG Time-Series Chart */}
      <div className="relative my-1">
        <svg 
          viewBox={`0 0 ${width} ${height}`} 
          className="w-full h-18 overflow-visible"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id={uniqueGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={scheme.gradientStart} stopOpacity={isDark ? "0.45" : "0.3"} />
              <stop offset="100%" stopColor={scheme.gradientStart} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Warning threshold line */}
          {warningThreshold && (
            <line
              x1={paddingX}
              y1={height - paddingY - (warningThreshold / max) * graphHeight}
              x2={width - paddingX}
              y2={height - paddingY - (warningThreshold / max) * graphHeight}
              stroke="#F59E0B"
              strokeWidth="1"
              strokeDasharray="3 3"
              strokeOpacity="0.65"
            />
          )}

          {/* Smooth Bezier Area Fill */}
          <path
            d={areaPath}
            fill={`url(#${uniqueGradId})`}
          />

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
        <span>Min: {min}{unit}</span>
        <span>Avg: {avg}{unit}</span>
        <span>Peak: {peak}{unit}</span>
        <span className={scheme.text}>Now: {current}{unit}</span>
      </div>
    </div>
  );
};
