'use client'

// V3 분석 화면용 차트. 모두 인라인 SVG(+HTML 툴팁)이고 차트 라이브러리를 쓰지 않는다.
// 공통 원칙
//   - 축 이름과 단위를 글자로 적는다(글자 11px 이상).
//   - 색만으로 구분하지 않는다: 점은 모양(● ◆)과 글자 설명을 함께 쓴다.
//   - 마우스를 올리거나 키보드(← →)로 점을 고르면 정확한 값이 뜬다. 화면을 못 보는 사람을 위한 요약 문장도 있다.
//   - viewBox 로 그려서 어떤 폭에서도 비율이 유지된다.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { downsample, nearestPoint, niceScale, scaleLinear } from '@/lib/v3/chart-math'
import { formatCompactNumber, formatKstDateTime, formatNumber, formatPct } from '@/lib/v3/format'
import { pickWinner } from '@/lib/v3/series-logic'

// 색맹에서도 구분되는 파랑/주황
const BLUE = '#3b6fe0'
const ORANGE = '#c76a12'

// 차트가 실제로 차지한 폭(px)을 재서 그 폭 그대로 그린다. 좁은 화면에서도 글자가 줄어들지 않고 늘 12px 로 보인다.
function useChartWidth(initial = 680): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth((prev) => (prev === w ? prev : w))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, Math.max(width, 260)]
}

function trimTick(n: number): string {
  return String(Number(n.toFixed(2)))
}

// ── 조회수 성장 곡선 ─────────────────────────────────────────────
export type GrowthPoint = { day: number; views: number; snapshotAt: string }

export function GrowthChart({ points }: { points: GrowthPoint[] }) {
  const [active, setActive] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const descId = useId()
  const [wrapRef, GW] = useChartWidth()
  const GH = Math.round(Math.min(Math.max(GW * 0.46, 236), 320))
  const G_PAD = GW < 480 ? { l: 54, r: 16, t: 24, b: 52 } : { l: 66, r: 24, t: 24, b: 52 }

  const model = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p.day) && Number.isFinite(p.views))
    const shown = downsample(clean, 150)
    const yScale = niceScale(Math.max(...shown.map((p) => p.views), 1), 4)
    const xScale = niceScale(Math.max(...shown.map((p) => p.day), 0.5), GW < 480 ? 4 : 6)
    const innerW = GW - G_PAD.l - G_PAD.r
    const innerH = GH - G_PAD.t - G_PAD.b
    const xOf = (day: number) => G_PAD.l + scaleLinear(day, xScale.max, 0, innerW)
    const yOf = (views: number) => scaleLinear(views, yScale.max, G_PAD.t + innerH, G_PAD.t)
    const coords = shown.map((p) => ({ x: xOf(p.day), y: yOf(p.views) }))
    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    const area = coords.length > 1 ? `${path} L${coords[coords.length - 1].x.toFixed(1)},${G_PAD.t + innerH} L${coords[0].x.toFixed(1)},${G_PAD.t + innerH} Z` : ''
    return { shown, yScale, xScale, innerW, innerH, coords, path, area, xOf, yOf }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, GW, GH])

  const { shown, yScale, xScale, coords, path, area, innerH } = model
  const act = active !== null && active < shown.length ? active : null

  if (shown.length === 0) {
    return (
      <div ref={wrapRef}>
        <div className="v3a-chart-empty">그릴 조회수 기록이 아직 없어요.</div>
      </div>
    )
  }

  const first = shown[0]
  const last = shown[shown.length - 1]
  const summary = `조회수 성장 그래프. 기록 ${formatNumber(shown.length)}번. 올린 뒤 ${trimTick(first.day)}일째 조회수 ${formatNumber(first.views)}회에서 ${trimTick(last.day)}일째 ${formatNumber(last.views)}회로 늘었어요.`

  const activePoint = act !== null ? shown[act] : null
  const prevOfActive = act !== null && act > 0 ? shown[act - 1] : null
  const gain = activePoint && prevOfActive ? Math.max(activePoint.views - prevOfActive.views, 0) : null

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0) return
    const px = ((e.clientX - rect.left) / rect.width) * GW
    const idx = nearestPoint(
      coords.map((c) => ({ x: c.x, y: 0 })),
      px,
      0,
      GW
    )
    setActive(idx >= 0 ? idx : null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = shown.length
    if (e.key === 'ArrowRight') setActive((a) => (a === null ? n - 1 : Math.min(a + 1, n - 1)))
    else if (e.key === 'ArrowLeft') setActive((a) => (a === null ? n - 1 : Math.max(a - 1, 0)))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(n - 1)
    else if (e.key === 'Escape') setActive(null)
    else return
    e.preventDefault()
  }

  const showDots = shown.length <= 60
  const labelLeft = coords[coords.length - 1].x > GW - 90

  return (
    <div ref={wrapRef}>
    <figure className="v3a-figure">
      <div
        className="v3a-chart"
        tabIndex={0}
        role="group"
        aria-label="조회수 성장 그래프. 화살표 왼쪽·오른쪽 키로 기록을 하나씩 살펴볼 수 있어요."
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => (a === null ? shown.length - 1 : a))}
        onBlur={() => setActive(null)}
      >
        <svg ref={svgRef} viewBox={`0 0 ${GW} ${GH}`} role="img" aria-label={summary} onPointerMove={onPointerMove} onPointerLeave={() => setActive(null)}>
          {yScale.ticks.map((tick) => {
            const y = model.yOf(tick)
            return (
              <g key={`y${tick}`}>
                <line x1={G_PAD.l} x2={GW - G_PAD.r} y1={y} y2={y} className="v3a-gridline" />
                <text x={G_PAD.l - 8} y={y + 4} textAnchor="end" className="v3a-axis-text">
                  {formatCompactNumber(tick)}
                </text>
              </g>
            )
          })}
          {xScale.ticks.map((tick) => {
            const x = model.xOf(tick)
            return (
              <g key={`x${tick}`}>
                <line x1={x} x2={x} y1={G_PAD.t + innerH} y2={G_PAD.t + innerH + 5} className="v3a-axisline" />
                <text x={x} y={G_PAD.t + innerH + 19} textAnchor="middle" className="v3a-axis-text">
                  {trimTick(tick)}
                </text>
              </g>
            )
          })}
          <line x1={G_PAD.l} x2={GW - G_PAD.r} y1={G_PAD.t + innerH} y2={G_PAD.t + innerH} className="v3a-axisline" />
          <text x={G_PAD.l + model.innerW / 2} y={GH - 8} textAnchor="middle" className="v3a-axis-title">
            올린 뒤 지난 날짜 (일)
          </text>
          <text transform={`translate(15 ${G_PAD.t + innerH / 2}) rotate(-90)`} textAnchor="middle" className="v3a-axis-title">
            조회수 (회)
          </text>

          {area ? <path d={area} fill={BLUE} fillOpacity={0.08} /> : null}
          {shown.length > 1 ? <path d={path} fill="none" stroke={BLUE} strokeWidth={2.5} strokeLinejoin="round" /> : null}
          {showDots
            ? shown.map((p, i) => (
                <circle key={`${p.snapshotAt}-${i}`} cx={coords[i].x} cy={coords[i].y} r={act === i ? 6 : 4} fill={BLUE} stroke="#fff" strokeWidth={1.5}>
                  <title>{`올린 뒤 ${trimTick(p.day)}일 · ${formatKstDateTime(p.snapshotAt)} · 조회수 ${formatNumber(p.views)}회`}</title>
                </circle>
              ))
            : null}
          {/* 가장 최근 값은 그래프 위에 바로 적어 준다 */}
          <text x={coords[coords.length - 1].x + (labelLeft ? -8 : 8)} y={coords[coords.length - 1].y - 10} textAnchor={labelLeft ? 'end' : 'start'} className="v3a-point-label">
            {formatCompactNumber(last.views)}회
          </text>
          {act !== null ? (
            <g pointerEvents="none">
              <line x1={coords[act].x} x2={coords[act].x} y1={G_PAD.t} y2={G_PAD.t + innerH} className="v3a-guide" />
              <circle cx={coords[act].x} cy={coords[act].y} r={7} fill="none" stroke={BLUE} strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {activePoint ? (
          <Tooltip left={(coords[act as number].x / GW) * 100} top={(coords[act as number].y / GH) * 100}>
            <strong>{formatNumber(activePoint.views)}회</strong>
            <span>
              올린 뒤 {trimTick(activePoint.day)}일 · {formatKstDateTime(activePoint.snapshotAt)}
            </span>
            {gain !== null ? <span>이전 기록보다 {gain > 0 ? `▲ ${formatNumber(gain)}회` : '변화 없음'}</span> : null}
          </Tooltip>
        ) : null}
      </div>
      <div className="v3a-sr" id={descId} aria-live="polite">
        {activePoint ? `${trimTick(activePoint.day)}일째, 조회수 ${formatNumber(activePoint.views)}회` : summary}
      </div>
      <figcaption className="v3a-legend">
        <span>
          <i className="v3a-key dot" aria-hidden /> 점 하나 = ‘새로고침’으로 기록한 한 번
        </span>
        <span>가로: 올린 뒤 지난 날짜(일) · 세로: 그때의 조회수(회)</span>
        {shown.length < points.length ? <span>기록이 많아 {formatNumber(shown.length)}개만 골라 그렸어요</span> : null}
      </figcaption>
    </figure>
    </div>
  )
}

function Tooltip({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  // 왼쪽·오른쪽 끝에서 잘리지 않도록 가장자리 근처에서는 정렬을 바꾼다.
  const shift = left < 22 ? '0%' : left > 78 ? '-100%' : '-50%'
  // 점이 차트 맨 위쪽이면 말풍선이 잘리지 않게 점 아래에 띄운다.
  const lift = top < 30 ? '12px' : 'calc(-100% - 12px)'
  return (
    <div className="v3a-tip" role="presentation" style={{ left: `${left}%`, top: `${top}%`, transform: `translate(${shift}, ${lift})` }}>
      {children}
    </div>
  )
}

// ── 참여율 구간별 영상 수(가로 막대) ─────────────────────────────
export type HistBucket = { key: string; label: string; count: number }

export function HistogramChart({ buckets }: { buckets: HistBucket[] }) {
  const total = buckets.reduce((sum, b) => sum + (Number.isFinite(b.count) ? b.count : 0), 0)
  if (total === 0) {
    return <div className="v3a-chart-empty">구간별로 보여드릴 영상이 아직 없어요.</div>
  }
  const max = Math.max(...buckets.map((b) => b.count), 1)
  const topKey = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]).key
  const summary = buckets.map((b) => `${b.label} ${formatNumber(b.count)}개`).join(', ')

  return (
    <figure className="v3a-figure">
      <ul className="v3a-hist" aria-label={`참여율 구간별 영상 수. 전체 ${formatNumber(total)}개. ${summary}`}>
        {buckets.map((b) => {
          const pct = total > 0 ? (b.count / total) * 100 : 0
          const isTop = b.key === topKey
          return (
            <li key={b.key} className={isTop ? 'top' : undefined} title={`${b.label}: 영상 ${formatNumber(b.count)}개 (전체의 ${formatPct(pct, 0)})`}>
              <span className="v3a-hist-label">{b.label}</span>
              <span className="v3a-hist-track" aria-hidden>
                <span className="v3a-hist-fill" style={{ width: `${b.count > 0 ? Math.max((b.count / max) * 100, 3) : 0}%` }} />
              </span>
              <span className="v3a-hist-value">
                {formatNumber(b.count)}개 <em>{formatPct(pct, 0)}</em>
                {isTop ? <b className="v3a-hist-top">가장 많아요</b> : null}
              </span>
            </li>
          )
        })}
      </ul>
      <figcaption className="v3a-legend">
        <span>
          <i className="v3a-key bar" aria-hidden /> 막대 길이 = 영상 수(개)
        </span>
        <span>진한 막대 = 영상이 가장 많이 모인 구간</span>
        <span>참여율 = (좋아요 + 댓글) ÷ 조회수</span>
      </figcaption>
    </figure>
  )
}

// ── 좋아요 vs 댓글 지형도(산점도) ────────────────────────────────
export type ScatterDot = { id: string; label: string; sub?: string; like: number; comment: number; tone?: string }

export function ScatterChart({ points }: { points: ScatterDot[] }) {
  const [active, setActive] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const descId = useId()
  const [wrapRef, SW] = useChartWidth()
  const SH = Math.round(Math.min(Math.max(SW * 0.62, 280), 400))
  const S_PAD = SW < 480 ? { l: 54, r: 14, t: 24, b: 56 } : { l: 66, r: 24, t: 24, b: 56 }

  const model = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p.like) && Number.isFinite(p.comment))
    const xScale = niceScale(Math.max(...clean.map((p) => p.like), 0.5), 4)
    const yScale = niceScale(Math.max(...clean.map((p) => p.comment), 0.2), 4)
    const innerW = SW - S_PAD.l - S_PAD.r
    const innerH = SH - S_PAD.t - S_PAD.b
    const xOf = (v: number) => S_PAD.l + scaleLinear(v, xScale.max, 0, innerW)
    const yOf = (v: number) => scaleLinear(v, yScale.max, S_PAD.t + innerH, S_PAD.t)
    const coords = clean.map((p) => ({ x: xOf(p.like), y: yOf(p.comment) }))
    // 왼쪽→오른쪽 순서(키보드 이동용)
    const order = clean.map((_, i) => i).sort((a, b) => coords[a].x - coords[b].x || coords[a].y - coords[b].y)
    return { clean, xScale, yScale, innerW, innerH, xOf, yOf, coords, order }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, SW, SH])

  const { clean, xScale, yScale, coords, order, innerH, innerW } = model
  const act = active !== null && active < clean.length ? active : null

  if (clean.length === 0) {
    return (
      <div ref={wrapRef}>
        <div className="v3a-chart-empty">표시할 영상이 없어요. 조회수가 있는 영상이 생기면 나타나요.</div>
      </div>
    )
  }

  const maxLike = Math.max(...clean.map((p) => p.like))
  const maxComment = Math.max(...clean.map((p) => p.comment))
  const commentHeavy = clean.filter((p) => p.tone === 'violet').length
  const summary = `좋아요 비율과 댓글 비율 산점도. 영상 ${formatNumber(clean.length)}개. 좋아요 비율은 최대 ${formatPct(maxLike, 2)}, 댓글 비율은 최대 ${formatPct(maxComment, 2)}. 그중 ${formatNumber(commentHeavy)}개는 좋아요보다 댓글이 상대적으로 활발해요.`

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const px = ((e.clientX - rect.left) / rect.width) * SW
    const py = ((e.clientY - rect.top) / rect.height) * SH
    const idx = nearestPoint(coords, px, py, 26)
    setActive(idx >= 0 ? idx : null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = order.length
    const pos = act === null ? -1 : order.indexOf(act)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setActive(order[pos < 0 ? 0 : Math.min(pos + 1, n - 1)])
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setActive(order[pos < 0 ? n - 1 : Math.max(pos - 1, 0)])
    else if (e.key === 'Home') setActive(order[0])
    else if (e.key === 'End') setActive(order[n - 1])
    else if (e.key === 'Escape') setActive(null)
    else return
    e.preventDefault()
  }

  const activeDot = act !== null ? clean[act] : null
  // 파랑 동그라미를 먼저, 주황 마름모를 나중에 그려서 눈에 띄는 쪽이 위에 오게 한다.
  const drawOrder = Array.from(clean.keys()).sort((a, b) => Number(clean[a].tone === 'violet') - Number(clean[b].tone === 'violet'))

  return (
    <div ref={wrapRef}>
    <figure className="v3a-figure">
      <div
        className="v3a-chart"
        tabIndex={0}
        role="group"
        aria-label="좋아요와 댓글 산점도. 화살표 키로 영상을 하나씩 살펴볼 수 있어요."
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => (a === null ? order[0] : a))}
        onBlur={() => setActive(null)}
      >
        <svg ref={svgRef} viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={summary} onPointerMove={onPointerMove} onPointerLeave={() => setActive(null)}>
          {yScale.ticks.map((tick) => {
            const y = model.yOf(tick)
            return (
              <g key={`y${tick}`}>
                <line x1={S_PAD.l} x2={SW - S_PAD.r} y1={y} y2={y} className="v3a-gridline" />
                <text x={S_PAD.l - 8} y={y + 4} textAnchor="end" className="v3a-axis-text">
                  {trimTick(tick)}%
                </text>
              </g>
            )
          })}
          {xScale.ticks.map((tick) => {
            const x = model.xOf(tick)
            return (
              <g key={`x${tick}`}>
                <line x1={x} x2={x} y1={S_PAD.t} y2={S_PAD.t + innerH} className="v3a-gridline" />
                <text x={x} y={S_PAD.t + innerH + 19} textAnchor="middle" className="v3a-axis-text">
                  {trimTick(tick)}%
                </text>
              </g>
            )
          })}
          <line x1={S_PAD.l} x2={SW - S_PAD.r} y1={S_PAD.t + innerH} y2={S_PAD.t + innerH} className="v3a-axisline" />
          <line x1={S_PAD.l} x2={S_PAD.l} y1={S_PAD.t} y2={S_PAD.t + innerH} className="v3a-axisline" />
          <text x={S_PAD.l + innerW / 2} y={SH - 10} textAnchor="middle" className="v3a-axis-title">
            좋아요 ÷ 조회수 (%) →
          </text>
          <text transform={`translate(15 ${S_PAD.t + innerH / 2}) rotate(-90)`} textAnchor="middle" className="v3a-axis-title">
            댓글 ÷ 조회수 (%) →
          </text>
          {drawOrder.map((i) => {
            const c = coords[i]
            const heavy = clean[i].tone === 'violet'
            return heavy ? (
              <path key={clean[i].id} d={`M${c.x},${c.y - 6.5} L${c.x + 6.5},${c.y} L${c.x},${c.y + 6.5} L${c.x - 6.5},${c.y} Z`} fill={ORANGE} fillOpacity={0.85} stroke="#fff" strokeWidth={1.2} />
            ) : (
              <circle key={clean[i].id} cx={c.x} cy={c.y} r={5} fill={BLUE} fillOpacity={0.75} stroke="#fff" strokeWidth={1.2} />
            )
          })}
          {act !== null ? <circle cx={coords[act].x} cy={coords[act].y} r={11} fill="none" stroke="#37352f" strokeWidth={2} pointerEvents="none" /> : null}
        </svg>
        {activeDot && act !== null ? (
          <Tooltip left={(coords[act].x / SW) * 100} top={(coords[act].y / SH) * 100}>
            <strong className="v3a-tip-title">{activeDot.label}</strong>
            <span>
              좋아요 {formatPct(activeDot.like, 2)} · 댓글 {formatPct(activeDot.comment, 3)}
            </span>
            <span>{activeDot.tone === 'violet' ? '◆ 댓글이 상대적으로 활발해요' : '● 좋아요가 상대적으로 더 많아요'}</span>
          </Tooltip>
        ) : null}
      </div>
      <div className="v3a-sr" id={descId} aria-live="polite">
        {activeDot ? `${activeDot.label}. 좋아요 ${formatPct(activeDot.like, 2)}, 댓글 ${formatPct(activeDot.comment, 3)}` : summary}
      </div>
      <figcaption className="v3a-legend">
        <span>
          <svg className="v3a-key-svg" viewBox="0 0 12 12" aria-hidden>
            <circle cx="6" cy="6" r="5" fill={BLUE} />
          </svg>{' '}
          좋아요가 상대적으로 더 많은 영상
        </span>
        <span>
          <svg className="v3a-key-svg" viewBox="0 0 12 12" aria-hidden>
            <path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z" fill={ORANGE} />
          </svg>{' '}
          댓글이 상대적으로 활발한 영상
        </span>
        <span>점 하나 = 영상 하나 · 영상 {formatNumber(clean.length)}개</span>
      </figcaption>
    </figure>
    </div>
  )
}

// ── 롱폼 vs 숏폼 비교 표(막대 + 글자) ────────────────────────────
export type CompareCell = { text: string; value: number | null; title?: string }
export type CompareRowData = { key: string; label: string; hint: string; long: CompareCell; short: CompareCell; compare: boolean }

export function CompareTable({ rows }: { rows: CompareRowData[] }) {
  return (
    <table className="v3a-compare v3a-stackable">
      <thead>
        <tr>
          <th scope="col">
            <span className="v3a-sr">항목</span>
          </th>
          <th scope="col">롱폼</th>
          <th scope="col">숏폼</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const l = row.long.value
          const s = row.short.value
          const both = row.compare && l !== null && s !== null && Number.isFinite(l) && Number.isFinite(s)
          const max = both ? Math.max(l as number, s as number) : 0
          // 5% 넘게 차이 날 때만 ‘더 높아요’를 붙인다. (위쪽 한 문장 답과 같은 기준)
          const winnerSide = both ? pickWinner(l as number, s as number) : null
          const winner = winnerSide === 'longform' ? 'long' : winnerSide === 'shortform' ? 'short' : null
          const cell = (side: 'long' | 'short', data: CompareCell, value: number | null, label: string) => {
            const isWin = winner === side
            const width = both && max > 0 && value !== null ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0
            return (
              <td data-label={label} className={isWin ? 'win' : undefined} title={data.title}>
                <span className="v3a-cmp-val">
                  {data.text}
                  {isWin ? (
                    <span className="v3a-win-mark">
                      <span aria-hidden>▲ </span>더 높아요
                    </span>
                  ) : null}
                </span>
                {both ? (
                  <span className="v3a-cmp-bar" aria-hidden>
                    <span className={`v3a-cmp-fill ${isWin ? 'win' : ''}`} style={{ width: `${width}%` }} />
                  </span>
                ) : null}
              </td>
            )
          }
          return (
            <tr key={row.key}>
              <th scope="row">
                {row.label}
                {row.hint ? <small>{row.hint}</small> : null}
              </th>
              {cell('long', row.long, l, '롱폼')}
              {cell('short', row.short, s, '숏폼')}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
