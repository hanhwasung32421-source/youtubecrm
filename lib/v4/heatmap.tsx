'use client'

// 요일 × 시간대 히트맵 (업로드 타이밍 화면).
// - 표(grid)로 만들어 스크린리더가 칸마다 "월요일 오후 3시 · 평균 조회수 1.2만 · 영상 4개" 를 읽어 준다.
// - Tab 으로 표에 한 번 들어와 화살표 키/Home/End 로 칸을 옮긴다 (칸이 168개라 칸마다 Tab 을 멈추지 않는다).
// - 마우스를 올리거나 칸을 누르거나 키보드로 가면 아래 한 줄에 정확한 숫자가 나온다 (터치 화면 포함).
// - 색만으로 구분하지 않는다: 칸 안에 숫자, 추천 칸은 ★ + 테두리, 영상 1개뿐인 칸은 점선 테두리.
// - 화면이 좁으면 가로(24시간)가 아니라 세로로 24시간을 세워 7열로 보여준다 (가로 스크롤 없음).

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import type { HeatCell } from '@/lib/v4/analytics'
import { WEEKDAY_LABELS, fmtHourKo, fmtNumber, fmtShort } from '@/lib/v4/format'
import { WEEK_ORDER, cellAriaLabel, heatAlpha, heatSummary, heatTextColor, slotRangeName, type HeatMode } from '@/lib/v4/timing-view'

const NARROW_BELOW_PX = 860
const HOURS = Array.from({ length: 24 }, (_, h) => h)

type Slot = { weekday: number; hour: number }

function useNarrow(ref: RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setNarrow(el.clientWidth > 0 && el.clientWidth < NARROW_BELOW_PX)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return narrow
}

export function Heatmap({
  cells,
  mode,
  max,
  sampleCount,
  highlight
}: {
  cells: HeatCell[]
  mode: HeatMode
  max: number
  sampleCount: number
  highlight: Set<string>
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const narrow = useNarrow(rootRef)
  const uid = useId()
  const summaryId = `${uid}-sum`
  const [hover, setHover] = useState<Slot | null>(null)
  const [focused, setFocused] = useState<Slot | null>(null)
  // 표에서 Tab 이 멈추는 칸 (기본: 가장 먼저 추천된 칸, 없으면 월요일 오전 9시)
  const firstPick = useMemo(() => {
    const key = Array.from(highlight)[0]
    if (!key) return null
    const [w, h] = key.split('-').map(Number)
    return Number.isFinite(w) && Number.isFinite(h) ? { weekday: w, hour: h } : null
  }, [highlight])
  const [active, setActive] = useState<Slot | null>(null)
  const tabStop = active ?? firstPick ?? { weekday: 1, hour: 9 }

  // 화면 방향에 따라 행/열을 정한다 (평소: 행 = 요일, 열 = 시간 / 좁을 때: 행 = 시간, 열 = 요일)
  const rowKeys: number[] = narrow ? HOURS : [...WEEK_ORDER]
  const colKeys: number[] = narrow ? [...WEEK_ORDER] : HOURS
  const slotAt = (r: number, c: number): Slot => (narrow ? { weekday: colKeys[c], hour: rowKeys[r] } : { weekday: rowKeys[r], hour: colKeys[c] })
  const posOf = (slot: Slot) => (narrow ? { r: rowKeys.indexOf(slot.hour), c: colKeys.indexOf(slot.weekday) } : { r: rowKeys.indexOf(slot.weekday), c: colKeys.indexOf(slot.hour) })

  const rgb = mode === 'avg' ? '16, 185, 129' : '79, 70, 229'
  const summary = useMemo(() => heatSummary(cells, sampleCount, mode), [cells, sampleCount, mode])
  const shown = hover ?? focused
  const shownCell = shown ? cells[shown.weekday * 24 + shown.hour] : undefined

  const focusSlot = (slot: Slot) => {
    setActive(slot)
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-slot="${slot.weekday}-${slot.hour}"]`)
    el?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, slot: Slot) => {
    const { r, c } = posOf(slot)
    let nr = r
    let nc = c
    if (event.key === 'ArrowRight') nc = Math.min(colKeys.length - 1, c + 1)
    else if (event.key === 'ArrowLeft') nc = Math.max(0, c - 1)
    else if (event.key === 'ArrowDown') nr = Math.min(rowKeys.length - 1, r + 1)
    else if (event.key === 'ArrowUp') nr = Math.max(0, r - 1)
    else if (event.key === 'Home') nc = 0
    else if (event.key === 'End') nc = colKeys.length - 1
    else return
    event.preventDefault()
    if (nr !== r || nc !== c) focusSlot(slotAt(nr, nc))
  }

  const colHeader = (key: number) => (narrow ? `${WEEKDAY_LABELS[key]}` : key % 3 === 0 ? `${key}시` : '')
  const colHeaderLabel = (key: number) => (narrow ? `${WEEKDAY_LABELS[key]}요일` : `${key}시`)
  const rowHeader = (key: number) => (narrow ? fmtHourKo(key) : WEEKDAY_LABELS[key])
  const rowHeaderLabel = (key: number) => (narrow ? fmtHourKo(key) : `${WEEKDAY_LABELS[key]}요일`)

  const gridCols = narrow ? `58px repeat(${colKeys.length}, minmax(0, 1fr))` : `26px repeat(${colKeys.length}, minmax(0, 1fr))`

  return (
    <div className="v4p-heat" ref={rootRef}>
      <p className="v4p-sr" id={summaryId}>{summary}</p>
      <p className="v4p-axis-cap" aria-hidden="true">
        {narrow ? '세로: 올린 시각(한국 시간) · 가로: 요일' : '가로: 올린 시각(한국 시간, 시) · 세로: 요일'}
        {' · 칸 안 숫자: '}
        {mode === 'avg' ? '평균 조회수(회)' : '올린 영상 수(개)'}
      </p>
      <div
        className={`v4p-heat-grid ${narrow ? 'tall' : ''}`}
        role="grid"
        aria-label={mode === 'avg' ? '요일별 시간대별 평균 조회수' : '요일별 시간대별 올린 영상 수'}
        aria-describedby={summaryId}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(null)
        }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="v4p-heat-row head" role="row" style={{ gridTemplateColumns: gridCols }}>
          <div role="columnheader" aria-label={narrow ? '시간대' : '요일'} />
          {colKeys.map((key) => (
            <div className="v4p-heat-label" role="columnheader" aria-label={colHeaderLabel(key)} key={key}>
              {colHeader(key)}
            </div>
          ))}
        </div>
        {rowKeys.map((rowKey, r) => (
          <div className="v4p-heat-row" role="row" style={{ gridTemplateColumns: gridCols }} key={rowKey}>
            <div className="v4p-heat-label" role="rowheader" aria-label={rowHeaderLabel(rowKey)}>
              {rowHeader(rowKey)}
            </div>
            {colKeys.map((_, c) => {
              const slot = slotAt(r, c)
              const cell = cells[slot.weekday * 24 + slot.hour]
              const value = cell ? (mode === 'avg' ? cell.avgViews : cell.count) : 0
              const alpha = heatAlpha(value, max)
              const key = `${slot.weekday}-${slot.hour}`
              const rec = highlight.has(key)
              const thin = mode === 'avg' && Boolean(cell) && cell.count === 1
              const label = cellAriaLabel(cell, slot.weekday, slot.hour)
              const isStop = tabStop.weekday === slot.weekday && tabStop.hour === slot.hour
              return (
                <div
                  key={key}
                  role="gridcell"
                  data-slot={key}
                  tabIndex={isStop ? 0 : -1}
                  aria-label={rec ? `${label} · 추천 시간대` : label}
                  title={label}
                  className={`v4p-heat-cell ${rec ? 'rec' : ''} ${thin ? 'thin' : ''} ${value <= 0 ? 'empty' : ''}`}
                  style={{ background: alpha > 0 ? `rgba(${rgb}, ${alpha.toFixed(2)})` : undefined, color: alpha > 0 ? heatTextColor(mode, alpha) : undefined }}
                  onMouseEnter={() => setHover(slot)}
                  onFocus={() => {
                    setActive(slot)
                    setFocused(slot)
                  }}
                  onKeyDown={(e) => onKeyDown(e, slot)}
                >
                  {rec ? <span className="v4p-heat-star" aria-hidden="true">★</span> : null}
                  {value > 0 ? (mode === 'avg' ? fmtShort(value) : fmtNumber(value)) : ''}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="v4p-heat-readout" aria-live="off">
        {shown ? (
          <>
            <strong>{slotRangeName(shown.weekday, shown.hour)}</strong>
            {shownCell && shownCell.count > 0 ? (
              <>
                {' · '}영상 {fmtNumber(shownCell.count)}개 · 평균 조회수 {fmtNumber(shownCell.avgViews)}회
                {shownCell.count === 1 ? ' (영상 1개뿐이라 참고만)' : ''}
              </>
            ) : (
              ' · 올린 영상이 없어요'
            )}
          </>
        ) : (
          <span className="muted">칸에 마우스를 올리거나 눌러 보세요. 키보드는 표에 들어와 화살표 키로 옮길 수 있어요.</span>
        )}
      </div>

      <div className="v4p-legend">
        <span className="v4p-legend-item">
          {mode === 'avg' ? '낮음' : '적음'}
          <i className="v4p-legend-scale" style={{ background: `linear-gradient(to right, rgba(${rgb}, 0.12), rgba(${rgb}, 0.9))` }} />
          {mode === 'avg' ? `높음 (최고 ${fmtShort(max)}회)` : `많음 (최대 ${fmtNumber(max)}개)`}
        </span>
        <span className="v4p-legend-item"><i className="v4p-swatch" /> 올린 영상 없음</span>
        <span className="v4p-legend-item"><i className="v4p-swatch rec" /> ★ 추천 시간대</span>
        {mode === 'avg' ? <span className="v4p-legend-item"><i className="v4p-swatch thin" /> 점선 = 영상 1개뿐이라 참고만</span> : null}
      </div>
    </div>
  )
}
