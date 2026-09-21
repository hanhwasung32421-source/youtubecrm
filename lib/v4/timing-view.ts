// 업로드 타이밍 화면의 계산: 요일/시간대 묶기, 히트맵 색 농도, 칸 설명문(스크린리더용). 순수 함수.

import type { HeatCell } from '@/lib/v4/analytics'
import { WEEKDAY_LABELS, fmtHourKo, fmtHourRangeKo, fmtNumber, fmtShort } from '@/lib/v4/format'

// 월요일부터 보여준다 (일 = 0)
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export type HeatMode = 'avg' | 'count'
export type Bucket = { count: number; avg: number; totalViews: number }

// 한 번 훑어서 요일별(0=일) / 시간대별(0~23) 영상 수와 평균 조회수를 만든다.
export function bucketize(cells: HeatCell[]) {
  const byWeekday: Array<Bucket & { weekday: number }> = Array.from({ length: 7 }, (_, weekday) => ({ weekday, count: 0, avg: 0, totalViews: 0 }))
  const byHour: Array<Bucket & { hour: number }> = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, avg: 0, totalViews: 0 }))
  for (const c of cells) {
    const d = byWeekday[c.weekday]
    const h = byHour[c.hour]
    if (!d || !h) continue
    d.count += c.count
    d.totalViews += c.totalViews
    h.count += c.count
    h.totalViews += c.totalViews
  }
  for (const b of byWeekday) b.avg = b.count > 0 ? Math.round(b.totalViews / b.count) : 0
  for (const b of byHour) b.avg = b.count > 0 ? Math.round(b.totalViews / b.count) : 0
  return { byWeekday, byHour }
}

// 칸 색의 진하기 (0 이면 칠하지 않음). 0.12 ~ 0.9
export function heatAlpha(value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0) return 0
  return Math.min(0.9, 0.12 + Math.min(value / max, 1) * 0.78)
}

// 진한 남색 칸에서는 흰 글씨, 그 밖에는 진한 글씨 (글자가 항상 읽히게)
export function heatTextColor(mode: HeatMode, alpha: number) {
  return mode === 'count' && alpha >= 0.5 ? '#ffffff' : '#0f172a'
}

export function slotName(weekday: number, hour: number) {
  return `${WEEKDAY_LABELS[weekday] ?? '?'}요일 ${fmtHourKo(hour)}`
}

export function slotRangeName(weekday: number, hour: number) {
  return `${WEEKDAY_LABELS[weekday] ?? '?'}요일 ${fmtHourRangeKo(hour)}`
}

// 칸 하나의 설명문. 예: "월요일 오후 3시 · 평균 조회수 1.2만 · 영상 4개"
export function cellAriaLabel(cell: { count: number; avgViews: number } | undefined, weekday: number, hour: number) {
  const name = slotName(weekday, hour)
  if (!cell || cell.count <= 0) return `${name} · 올린 영상 없음`
  return `${name} · 평균 조회수 ${fmtShort(cell.avgViews)} · 영상 ${fmtNumber(cell.count)}개`
}

// 표 전체를 한 문단으로 (스크린리더용)
export function heatSummary(cells: HeatCell[], sampleCount: number, mode: HeatMode) {
  const withVideos = cells.filter((c) => c.count > 0)
  if (withVideos.length === 0) return '올린 영상이 없어서 표시할 값이 없어요.'
  const best =
    mode === 'avg'
      ? [...withVideos].sort((a, b) => b.avgViews - a.avgViews || b.count - a.count)[0]
      : [...withVideos].sort((a, b) => b.count - a.count || b.avgViews - a.avgViews)[0]
  const head = mode === 'avg' ? '요일과 시간대별 평균 조회수 표예요.' : '요일과 시간대별로 올린 영상 수 표예요.'
  const tail =
    mode === 'avg'
      ? `평균 조회수가 가장 높은 칸은 ${slotName(best.weekday, best.hour)}이고 ${fmtShort(best.avgViews)}회예요.`
      : `가장 많이 올린 칸은 ${slotName(best.weekday, best.hour)}이고 영상 ${fmtNumber(best.count)}개예요.`
  return `${head} 영상 ${fmtNumber(sampleCount)}개 기준이에요. ${tail} 화살표 키로 칸을 옮기며 값을 들을 수 있어요.`
}
