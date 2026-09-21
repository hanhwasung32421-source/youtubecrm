// 추천 업로드 시간의 계산과 근거 문장 (서버·브라우저 없이 단독으로 시험할 수 있다).
//  - 지난 30일에 올린 영상을 "요일 × 시간"으로 묶어, 하루당 평균 조회수가 가장 높은 시간대를 고른다.
//  - 오래 전에 올린 영상은 조회수가 쌓여 있어 유리하므로, 조회수를 올린 뒤 지난 날 수로 나눠 공평하게 비교한다.
//  - 영상이 너무 적은 시간대는 우연일 수 있어 제외한다.
import { WEEKDAY_LABELS, kstHourOfIso, kstWeekdayOfIso } from './dates'
import { formatCount } from './format'
import type { TimingHint, TimingSlot } from './types'

export const TIMING_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

// 영상 수가 많을수록 우연히 높게 나온 시간대가 늘어나므로 기준을 올린다.
export function minSampleFor(total: number): number {
  return total >= 150 ? 3 : 2
}

// 0~23시 → '저녁 7시'. 잘못된 값은 ''.
export function hourLabel(hour: number | null | undefined): string {
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return ''
  const part = hour < 6 ? '새벽' : hour < 12 ? '오전' : hour < 18 ? '오후' : hour < 22 ? '저녁' : '밤'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${part} ${h12}시`
}

// '화요일 저녁 7시'
export function slotLabel(weekday: number | null | undefined, hour: number | null | undefined): string {
  if (typeof weekday !== 'number' || weekday < 0 || weekday > 6 || !Number.isInteger(weekday)) return ''
  const time = hourLabel(hour)
  return time ? `${WEEKDAY_LABELS[weekday]}요일 ${time}` : ''
}

type Bucket = { weekday: number; hour: number; views: number; perDay: number; count: number }

export function computeTimingEvidence(
  videos: readonly { published_at: string | null; view_count: number | null }[],
  now: number = Date.now(),
  windowDays: number = TIMING_WINDOW_DAYS
): TimingHint {
  const since = now - windowDays * DAY_MS
  const buckets = new Map<string, Bucket>()
  let total = 0
  let sumViews = 0
  let sumPerDay = 0

  for (const v of videos) {
    if (!v.published_at) continue
    const t = new Date(v.published_at).getTime()
    if (Number.isNaN(t) || t > now || t < since) continue
    // 조회수를 아직 못 가져온 영상(null)은 0회와 다르므로 제외한다.
    if (typeof v.view_count !== 'number' || !Number.isFinite(v.view_count)) continue
    const weekday = kstWeekdayOfIso(v.published_at)
    const hour = kstHourOfIso(v.published_at)
    if (weekday === null || hour === null) continue
    const views = Math.max(0, v.view_count)
    const perDay = views / Math.max(1, (now - t) / DAY_MS)
    total += 1
    sumViews += views
    sumPerDay += perDay
    const key = `${weekday}-${hour}`
    const bucket = buckets.get(key) || { weekday, hour, views: 0, perDay: 0, count: 0 }
    bucket.views += views
    bucket.perDay += perDay
    bucket.count += 1
    buckets.set(key, bucket)
  }

  const base: TimingHint = {
    weekday: null,
    hour: null,
    avgViews: 0,
    sampleSize: 0,
    windowDays,
    totalVideos: total,
    overallAvgViews: total > 0 ? Math.round(sumViews / total) : 0,
    overallAvgViewsPerDay: total > 0 ? Math.round(sumPerDay / total) : 0
  }

  const minSample = minSampleFor(total)
  const slots: TimingSlot[] = [...buckets.values()]
    .filter((b) => b.count >= minSample)
    .map((b) => ({
      weekday: b.weekday,
      hour: b.hour,
      avgViews: Math.round(b.views / b.count),
      avgViewsPerDay: Math.round(b.perDay / b.count),
      sampleSize: b.count
    }))
    .sort((a, b) => b.avgViewsPerDay - a.avgViewsPerDay || b.sampleSize - a.sampleSize || a.weekday - b.weekday || a.hour - b.hour)

  const best = slots[0]
  if (!best) return base
  return {
    ...base,
    weekday: best.weekday,
    hour: best.hour,
    avgViews: best.avgViews,
    sampleSize: best.sampleSize,
    avgViewsPerDay: best.avgViewsPerDay,
    runnerUps: slots.slice(1, 3)
  }
}

// 전체 평균 대비 몇 % 높은지 (평균을 모르거나 0이면 null)
export function liftPercent(value: number | null | undefined, base: number | null | undefined): number | null {
  if (typeof value !== 'number' || typeof base !== 'number' || !Number.isFinite(value) || !Number.isFinite(base) || base <= 0) return null
  return Math.round((value / base - 1) * 100)
}

export type TimingText = {
  /** '화요일 저녁 7시' */
  headline: string
  /** '지난 30일 화요일 저녁 7시에 올린 영상 평균 조회수 1.2만, 영상 8개' */
  evidence: string
  /** '전체 평균보다 하루 조회가 38% 높았어요' (비교할 수 없으면 '') */
  compare: string
}

// 추천 시간과 그 근거를 쉬운 말로. 추천할 시간이 없으면 null.
export function describeTiming(hint: TimingHint): TimingText | null {
  const headline = slotLabel(hint.weekday, hint.hour)
  if (!headline || hint.sampleSize <= 0) return null
  const days = hint.windowDays ?? TIMING_WINDOW_DAYS
  const evidence = `지난 ${days}일 ${headline}에 올린 영상 평균 조회수 ${formatCount(hint.avgViews)}회, 영상 ${hint.sampleSize.toLocaleString('ko-KR')}개`
  const lift = liftPercent(hint.avgViewsPerDay, hint.overallAvgViewsPerDay)
  let compare = ''
  if (lift !== null) compare = lift >= 5 ? `전체 평균보다 하루 조회가 ${lift}% 높았어요` : '전체 평균과 큰 차이는 없어요'
  return { headline, evidence, compare }
}
