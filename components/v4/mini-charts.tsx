// 가벼운 그림 조각(진행 링 · 롱폼/숏폼 비중 막대). 큰 일별 그래프(charts.tsx)와 따로 두어서, 그래프를 늦게 내려받아도 이 조각은 바로 나온다.

import { fmtNumber } from '@/lib/v4/format'

const INDIGO = '#4f46e5'
const ROSE = '#f43f5e'

// ------------------------------------------------------------------ 진행 링

export function ProgressRing({
  value,
  label,
  sublabel,
  size = 132,
  stroke = 12,
  color = INDIGO
}: {
  value: number // 0~1 (초과 시 100%로 표시)
  label: string
  sublabel?: string
  size?: number
  stroke?: number
  color?: string
}) {
  const ratio = Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = circumference * ratio
  const percent = Number.isFinite(value) ? Math.round(value * 100) : 0
  return (
    <div className="v4-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${percent}%`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="v4-ring-value">
          {percent}%
        </text>
      </svg>
      <div className="v4-ring-label">{label}</div>
      {sublabel ? <div className="v4-ring-sub">{sublabel}</div> : null}
    </div>
  )
}

// ------------------------------------------------------------------ 비중 바 (롱폼 vs 숏폼)

export function ShareBar({ a, b, labelA = '롱폼', labelB = '숏폼' }: { a: number; b: number; labelA?: string; labelB?: string }) {
  const total = a + b
  const pa = total > 0 ? (a / total) * 100 : 0
  const pb = total > 0 ? (b / total) * 100 : 0
  return (
    <div className="v4-share">
      <div className="v4-share-track">
        <div className="v4-share-a" style={{ width: `${pa}%` }} />
        <div className="v4-share-b" style={{ width: `${pb}%` }} />
      </div>
      <div className="row-between small">
        <span>
          <i className="v4-dot" style={{ background: INDIGO }} /> {labelA} {fmtNumber(a)} ({Math.round(pa)}%)
        </span>
        <span>
          <i className="v4-dot" style={{ background: ROSE }} /> {labelB} {fmtNumber(b)} ({Math.round(pb)}%)
        </span>
      </div>
    </div>
  )
}
