'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { fmtCompact, fmtNumber, shortYmd } from '@/lib/v4/format'
import type { DailyPoint } from '@/lib/v4/analytics'

// 일별 그래프 전용. 큰 그림이라 대시보드가 늦게(화면에 가까워질 때) 내려받는다. 진행 링·비중 막대는 mini-charts.tsx.
const INDIGO = '#4f46e5'
const EMERALD = '#10b981'
const AMBER = '#f59e0b'

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
        <div className="empty-state">보여 줄 기간 데이터가 없어요.</div>
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
