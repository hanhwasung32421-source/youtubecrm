// V4 분석 화면 5곳의 필터 정의 (주소 ⇄ 상태 규칙). 순수 데이터라 서버/클라이언트 어디서나 쓴다.
// 주소 예: /v4/ranking?period=7&sort=velocity&staff=<id>&q=삼성전자&dow=1&hour=15

import type { PeriodDays } from '@/lib/v4/analytics'
import { enumField, idField, intField, numberChoiceField, textField, type FilterSpec } from '@/lib/v4/filter-codec'

export const PERIODS = [7, 30, 90] as const
const periodField = numberChoiceField<PeriodDays>(30, PERIODS)

export const RANKING_SORTS = ['viewCount', 'likeCount', 'commentCount', 'daysSincePublished', 'velocity', 'likeRate'] as const
export type RankingSort = (typeof RANKING_SORTS)[number]

export type RankingFilters = {
  period: PeriodDays
  sort: RankingSort
  dir: 'asc' | 'desc'
  staff: string
  format: '' | 'longform' | 'shortform'
  q: string
  dow: number // 0=일 ~ 6=토, 없으면 -1 (한국 시간)
  hour: number // 0~23, 없으면 -1 (한국 시간)
}

export const RANKING_SPEC: FilterSpec<RankingFilters> = {
  period: periodField,
  sort: enumField<RankingSort>('viewCount', RANKING_SORTS),
  dir: enumField<'asc' | 'desc'>('desc', ['asc', 'desc']),
  staff: idField(),
  format: enumField<'' | 'longform' | 'shortform'>('', ['', 'longform', 'shortform']),
  q: textField(60),
  dow: intField(-1, 0, 6),
  hour: intField(-1, 0, 23)
}

export type StocksFilters = {
  period: PeriodDays
  sort: 'totalViews' | 'videoCount' | 'avgViews' | 'changeRatio'
  dir: 'asc' | 'desc'
  q: string
}

export const STOCKS_SPEC: FilterSpec<StocksFilters> = {
  period: periodField,
  sort: enumField<StocksFilters['sort']>('totalViews', ['totalViews', 'videoCount', 'avgViews', 'changeRatio']),
  dir: enumField<'asc' | 'desc'>('desc', ['asc', 'desc']),
  q: textField(60)
}

export type TimingFilters = { period: PeriodDays; mode: 'avg' | 'count' }

export const TIMING_SPEC: FilterSpec<TimingFilters> = {
  period: periodField,
  mode: enumField<'avg' | 'count'>('avg', ['avg', 'count'])
}

export type StaffFilters = { period: PeriodDays; metric: 'totalViews' | 'videoCount' | 'avgViews' }

export const STAFF_SPEC: FilterSpec<StaffFilters> = {
  period: periodField,
  metric: enumField<StaffFilters['metric']>('totalViews', ['totalViews', 'videoCount', 'avgViews'])
}

export type ExperimentsFilters = { status: 'all' | 'running' | 'done'; q: string }

export const EXPERIMENTS_SPEC: FilterSpec<ExperimentsFilters> = {
  status: enumField<ExperimentsFilters['status']>('all', ['all', 'running', 'done']),
  q: textField(60)
}

// 다른 화면으로 가는 링크 만들기 (종목 → 랭킹, 담당자 → 랭킹, 시간대 → 랭킹)
export function rankingHref(params: { period?: PeriodDays; q?: string; staff?: string; dow?: number; hour?: number; sort?: RankingSort }) {
  const parts: string[] = []
  const add = (key: string, value: string | number | undefined) => {
    if (value === undefined || value === '') return
    parts.push(`${key}=${encodeURIComponent(String(value))}`)
  }
  add('period', params.period)
  add('sort', params.sort)
  add('staff', params.staff)
  add('q', params.q?.trim().slice(0, 60))
  if (params.dow !== undefined && params.dow >= 0) add('dow', params.dow)
  if (params.hour !== undefined && params.hour >= 0) add('hour', params.hour)
  return `/v4/ranking${parts.length ? `?${parts.join('&')}` : ''}`
}
