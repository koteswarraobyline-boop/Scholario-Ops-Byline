import React, { useState } from 'react';
import { useOps } from '../../context/OpsContext';

interface TelemetryPoint {
  time: string;
  value: number;
}

interface TelemetryAreaGraphProps {
  title: string;
  subtitle?: string;
  data: number[];
  unit: string;
  warningThreshold?: number;
  criticalThreshold?: number;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'indigo';
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
  const avg = Math.round(data.reduce((a, b) => a + b, 0) / data.length);

  // SVG dimensions
  const width = 360;
  const height = 90;
  const paddingX = 5;
  const paddingY = 10;
  const graphWidth = width - paddingX * 2;
  const graphHeight = height - paddingY * 2;

  // Calculate coordinates
  const points = data.map((val, idx) => {
    const x = paddingX + (idx / (data.length - 1)) * graphWidth;
    const y = height - paddingY - ((val - 0) / (max - 0 || 1)) * graphHeight;
    return { x, y, val };
  });

  // SVG Area path
  const areaPath = `
    M ${points[0].x},${height - paddingY}
    L ${points[0].x},${points[0].y}
    ${points.slice(1).map(p => `L ${p.x},${p.y}`).join(' ')}
    L ${points[points.length - 1].x},${height - paddingY}
    Z
  `;

  // SVG Line path
  const linePath = `
    M ${points[0].x},${points[0].y}
    ${points.slice(1).map(p => `L ${p.x},${p.y}`).join(' ')}
  `;

  const colorMap = {
    blue: {
      line: '#3B82F6',
      fill: isDark ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.15)',
      gradientStart: '#3B82F6',
      text: 'text-blue-500'
    },
    emerald: {
      line: '#10B981',
      fill: isDark ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.15)',
      gradientStart: '#10B981',
      text: 'text-emerald-500'
    },
    amber: {
      line: '#F59E0B',
      fill: isDark ? 'rgba(245, 158, 11, 0.25)' : 'rgba(245, 158, 11, 0.15)',
      gradientStart: '#F59E0B',
      text: 'text-amber-500'
    },
    rose: {
      line: '#F43F5E',
      fill: isDark ? 'rgba(244, 63, 94, 0.25)' : 'rgba(244, 63, 94, 0.15)',
      gradientStart: '#F43F5E',
      text: 'text-rose-500'
    },
    indigo: {
      line: '#6366F1',
      fill: isDark ? 'rgba(99, 102, 241, 0.25)' : 'rgba(99, 102, 241, 0.15)',
      gradientStart: '#6366F1',
      text: 'text-indigo-500'
    }
  };

  const scheme = colorMap[color];

  return (
    <div className={`p-3 rounded-lg border font-mono ${
      isDark ? 'bg-[#0E1626] border-[#1C273C]' : 'bg-white border-slate-200 shadow-xs'
    }`}>
      {/* Title & Current Stat */}
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
            <linearGradient id={`grad-${title.replace(/\s+/g, '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
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
              strokeOpacity="0.6"
            />
          )}

          {/* Area Fill */}
          <path
            d={areaPath}
            fill={`url(#grad-${title.replace(/\s+/g, '')})`}
          />

          {/* Line Stroke */}
          <path
            d={linePath}
            fill="none"
            stroke={scheme.line}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover tracker */}
          {points.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r={hoveredIdx === idx ? 4 : 2}
              className="cursor-pointer transition-all"
              fill={hoveredIdx === idx ? '#FFFFFF' : scheme.line}
              stroke={scheme.line}
              strokeWidth="1"
              onMouseEnter={() => setHoveredIdx(idx)}
            />
          ))}
        </svg>
      </div>

      {/* Metric summary footer */}
      <div className={`flex items-center justify-between text-[10px] pt-1 border-t ${
        isDark ? 'border-[#1C273C] text-slate-400' : 'border-slate-100 text-slate-500'
      }`}>
        <span>Min: {min}{unit}</span>
        <span>Avg: {avg}{unit}</span>
        <span>Peak: {max === 100 ? Math.max(...data) : max}{unit}</span>
      </div>
    </div>
  );
};
