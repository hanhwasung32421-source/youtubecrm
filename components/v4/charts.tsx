'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { fmtCompact, fmtNumber, shortYmd } from '@/lib/v4/format'
import type { DailyPoint } from '@/lib/v4/analytics'

const INDIGO = '#4f46e5'
const EMERALD = '#10b981'
const AMBER = '#f59e0b'
const ROSE = '#f43f5e'
const SLATE = '#94a3b8'

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

// ------------------------------------------------------------------ 일별 타임라인 (업로드 막대 + 조회수 영역 + 목표선)

// 차트 상자의 실제 너비를 따라 viewBox 폭을 맞춘다 → 좁은 화면(360px)에서도 글자가 1:1 크기로 읽힌다.
function useChartWidth(max = 760, min = 300) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(max)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth(Math.max(min, Math.min(max, w)))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [max, min])
  return { ref, width }
}

export function TimelineChart({ points, target }: { points: DailyPoint[]; target: number }) {
  const gradientId = useId()
  const { ref, width } = useChartWidth()
  const narrow = width < 520
  const height = narrow ? 240 : 260
  const pad = narrow ? { top: 16, right: 40, bottom: 30, left: 30 } : { top: 18, right: 52, bottom: 34, left: 40 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const n = points.length

  const model = useMemo(() => {
    const maxUploads = Math.max(target, ...points.map((p) => p.uploads), 1)
    const maxViews = Math.max(...points.map((p) => p.views), 1)
    const slot = n > 0 ? innerW / n : innerW
    const barW = Math.max(2, Math.min(28, slot * 0.6))
    const xOf = (i: number) => pad.left + slot * i + slot / 2
    const yUploads = (v: number) => pad.top + innerH - (v / maxUploads) * innerH
    const yViews = (v: number) => pad.top + innerH - (v / maxViews) * innerH
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)} ${yViews(p.views).toFixed(1)}`).join(' ')
    const areaPath =
      n > 0
        ? `${linePath} L ${xOf(n - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${xOf(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`
        : ''
    const labelEvery = narrow ? (n > 45 ? 15 : n > 20 ? 7 : n > 10 ? 3 : 1) : n > 45 ? 10 : n > 20 ? 5 : n > 10 ? 2 : 1
    return { maxUploads, maxViews, slot, barW, xOf, yUploads, yViews, linePath, areaPath, labelEvery }
  }, [points, target, n, innerW, innerH, pad.left, pad.top, narrow])

  if (n === 0) {
    return (
      <div className="v4-chart-wrap" ref={ref}>
        <div className="empty-state">표시할 기간 데이터가 없습니다.</div>
      </div>
    )
  }

  const targetY = model.yUploads(target)
  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="v4-chart-wrap" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} className="v4-chart" role="img" aria-label="일별 업로드 수와 조회수 추이">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={EMERALD} stopOpacity="0.35" />
            <stop offset="100%" stopColor={EMERALD} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridLines.map((g) => {
          const y = pad.top + innerH - g * innerH
          return (
            <g key={g}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="2 4" />
              <text x={pad.left - 8} y={y + 4} textAnchor="end" className="v4-axis">
                {Math.round(model.maxUploads * g)}
              </text>
              <text x={width - pad.right + 8} y={y + 4} textAnchor="start" className="v4-axis emerald">
                {fmtCompact(model.maxViews * g)}
              </text>
            </g>
          )
        })}
        <path d={model.areaPath} fill={`url(#${gradientId})`} />
        <path d={model.linePath} fill="none" stroke={EMERALD} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => {
          const x = model.xOf(i)
          const y = model.yUploads(p.uploads)
          const h = pad.top + innerH - y
          const hit = p.uploads >= target
          return (
            <g key={p.ymd}>
              <rect
                x={x - model.barW / 2}
                y={y}
                width={model.barW}
                height={Math.max(h, p.uploads > 0 ? 2 : 0)}
                rx={3}
                fill={hit ? INDIGO : '#a5b4fc'}
              >
                <title>{`${p.ymd} · 업로드 ${fmtNumber(p.uploads)}개 · 조회수 ${fmtNumber(p.views)}`}</title>
              </rect>
              <circle cx={x} cy={model.yViews(p.views)} r={2.5} fill={EMERALD}>
                <title>{`${p.ymd} 조회수 ${fmtNumber(p.views)}`}</title>
              </circle>
              {i % model.labelEvery === 0 ? (
                <text x={x} y={height - 12} textAnchor="middle" className="v4-axis">
                  {shortYmd(p.ymd)}
                </text>
              ) : null}
            </g>
          )
        })}
        <line x1={pad.left} x2={width - pad.right} y1={targetY} y2={targetY} stroke={AMBER} strokeWidth={1.5} strokeDasharray="6 4" />
        <text x={width - pad.right - 4} y={targetY - 6} textAnchor="end" className="v4-axis amber">
          목표 {fmtNumber(target)}개/일
        </text>
      </svg>
      <div className="v4-legend">
        <span className="v4-legend-item"><i style={{ background: INDIGO }} /> 업로드 수(좌)</span>
        <span className="v4-legend-item"><i style={{ background: EMERALD }} /> 조회수(우)</span>
        <span className="v4-legend-item"><i style={{ background: AMBER }} /> 일일 목표</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 스파크라인

export function Sparkline({ values, color = INDIGO, width = 120, height = 32 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length === 0) return <svg width={width} height={height} />
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="v4-spark" role="img" aria-label="최근 7일 추이">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={i * step} cy={height - 3 - (v / max) * (height - 6)} r={2} fill={color}>
          <title>{fmtNumber(v)}</title>
        </circle>
      ))}
    </svg>
  )
}

// ------------------------------------------------------------------ 가로 막대 비교

export function HBarList({
  items,
  color = INDIGO,
  format = fmtNumber
}: {
  items: Array<{ label: string; value: number; hint?: string }>
  color?: string
  format?: (v: number) => string
}) {
  const max = Math.max(...items.map((i) => i.value), 0)
  if (items.length === 0) return <div className="empty-state">표시할 데이터가 없습니다.</div>
  return (
    <div className="v4-hbars">
      {items.map((item) => {
        const w = max > 0 ? Math.max((item.value / max) * 100, 2) : 0
        return (
          <div className="v4-hbar" key={item.label}>
            <div className="v4-hbar-label" title={item.label}>
              {item.label}
            </div>
            <div className="v4-hbar-track">
              <div className="v4-hbar-fill" style={{ width: `${w}%`, background: color }} />
            </div>
            <div className="v4-hbar-value">
              {format(item.value)}
              {item.hint ? <span className="muted small"> {item.hint}</span> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ 요일 × 시간 히트맵

export function Heatmap({
  cells,
  max,
  valueOf,
  color = 'indigo',
  weekdayLabels,
  format = fmtNumber,
  highlight
}: {
  cells: Array<{ weekday: number; hour: number; count: number; avgViews: number }>
  max: number
  valueOf: (cell: { count: number; avgViews: number }) => number
  color?: 'indigo' | 'emerald'
  weekdayLabels: readonly string[]
  format?: (v: number) => string
  highlight?: Set<string>
}) {
  const rgb = color === 'emerald' ? '16, 185, 129' : '79, 70, 229'
  return (
    <div className="v4-heatmap-wrap">
      <div className="v4-heatmap">
        <div className="v4-heatmap-corner" />
        {Array.from({ length: 24 }, (_, hour) => (
          <div className="v4-heatmap-hour" key={hour}>
            {hour % 3 === 0 ? `${hour}시` : ''}
          </div>
        ))}
        {Array.from({ length: 7 }, (_, weekday) => (
          <div className="v4-heatmap-row" key={weekday}>
            <div className="v4-heatmap-day">{weekdayLabels[weekday]}</div>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = cells[weekday * 24 + hour]
              const value = cell ? valueOf(cell) : 0
              const alpha = max > 0 && value > 0 ? 0.12 + (value / max) * 0.78 : 0
              const key = `${weekday}-${hour}`
              return (
                <div
                  key={key}
                  className={`v4-heatmap-cell ${highlight?.has(key) ? 'highlight' : ''}`}
                  style={{ background: alpha > 0 ? `rgba(${rgb}, ${alpha.toFixed(2)})` : undefined }}
                  title={`${weekdayLabels[weekday]}요일 ${hour}시 · 업로드 ${fmtNumber(cell?.count || 0)}개 · 평균 조회수 ${fmtNumber(cell?.avgViews || 0)}`}
                >
                  {value > 0 ? <span>{format(value)}</span> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
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
        <span><i className="v4-dot" style={{ background: INDIGO }} /> {labelA} {fmtNumber(a)} ({Math.round(pa)}%)</span>
        <span><i className="v4-dot" style={{ background: ROSE }} /> {labelB} {fmtNumber(b)} ({Math.round(pb)}%)</span>
      </div>
    </div>
  )
}

export const CHART_COLORS = { INDIGO, EMERALD, AMBER, ROSE, SLATE }
