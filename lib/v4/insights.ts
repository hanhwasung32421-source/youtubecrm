// "그래서 뭘 하면 되지?" 를 쉬운 한 문장으로 바꿔 주는 순수 함수들 (React/DB 의존 없음).
// 종목: 더 올릴 종목 / 접어도 좋은 종목, 시간대: 추천 시간 한 곳, 담당자: 강점 한 문장.

import { fmtShort } from '@/lib/v4/format'
import { slotRangeName } from '@/lib/v4/timing-view'

// ---------------------------------------------------------------- 종목

export const NO_STOCK_NAME = '(종목 미지정)'

// 기준값 (화면의 "이 기준은 어떻게 정했나요?" 에도 그대로 보여준다)
export const STOCK_TOP_MIN_VIDEOS = 2 // 이 개수 이상 다룬 종목만 "더 올려 보세요" 로 추천
export const STOCK_TOP_MIN_MULTIPLE = 1.2 // 팀 평균의 1.2배 이상이면 반응이 좋다고 본다
export const STOCK_FOLD_MIN_VIDEOS = 3 // 이 개수 이상 다뤘는데도
export const STOCK_FOLD_MAX_MULTIPLE = 0.5 // 팀 평균의 절반 이하면 "접어도 좋아요"

export type StockLite = { stockName: string; videoCount: number; totalViews: number; avgViews: number }

export type StockNote = {
  stockName: string
  videoCount: number
  avgViews: number
  multiple: number // 팀 평균 대비 배수 (반응 점수)
  sentence: string
  reference: boolean // 영상이 1개뿐이라 참고만
}

export type StockAdvice = { teamAvg: number; top: StockNote[]; fold: StockNote[] }

// 팀 평균 = 모든 영상의 조회수 합 ÷ 영상 수 (종목별 평균의 평균이 아니다)
export function teamAverageViews(items: StockLite[]): number {
  let views = 0
  let videos = 0
  for (const s of items) {
    views += Number.isFinite(s.totalViews) ? s.totalViews : 0
    videos += Number.isFinite(s.videoCount) ? s.videoCount : 0
  }
  return videos > 0 ? views / videos : 0
}

export function fmtMultiple(x: number): string {
  if (!Number.isFinite(x)) return '-'
  return x >= 10 ? String(Math.round(x)) : x.toFixed(1)
}

export function buildStockAdvice(items: StockLite[]): StockAdvice {
  const teamAvg = teamAverageViews(items)
  if (!(teamAvg > 0)) return { teamAvg, top: [], fold: [] }
  const pool = items.filter((s) => s.stockName !== NO_STOCK_NAME && s.videoCount > 0)
  const withMultiple = pool.map((s) => ({ s, multiple: s.avgViews / teamAvg }))

  let topRaw = withMultiple
    .filter((x) => x.s.videoCount >= STOCK_TOP_MIN_VIDEOS && x.multiple >= STOCK_TOP_MIN_MULTIPLE)
    .sort((a, b) => b.s.avgViews - a.s.avgViews || b.s.totalViews - a.s.totalViews)
    .slice(0, 3)
  // 2개 이상 다룬 종목이 하나도 기준을 못 넘으면, 영상 1개짜리 중 가장 잘 나온 하나를 "참고용" 으로만 보여준다.
  if (topRaw.length === 0) {
    const single = withMultiple
      .filter((x) => x.s.videoCount === 1 && x.s.avgViews > 0)
      .sort((a, b) => b.s.avgViews - a.s.avgViews)
      .slice(0, 1)
    topRaw = single
  }
  const top: StockNote[] = topRaw.map(({ s, multiple }) => {
    const reference = s.videoCount < STOCK_TOP_MIN_VIDEOS
    return {
      stockName: s.stockName,
      videoCount: s.videoCount,
      avgViews: s.avgViews,
      multiple,
      reference,
      sentence: reference
        ? `${s.stockName}: 영상 1개가 ${fmtShort(s.avgViews)}회 나왔어요. 1개뿐이라 참고만 하고, 하나 더 올려서 비교해 보세요.`
        : `${s.stockName} 영상은 평균 ${fmtShort(s.avgViews)}회 — 팀 평균의 ${fmtMultiple(multiple)}배예요. 이번 주 1개 더 올려 보세요.`
    }
  })

  const fold: StockNote[] = withMultiple
    .filter((x) => x.s.videoCount >= STOCK_FOLD_MIN_VIDEOS && x.multiple <= STOCK_FOLD_MAX_MULTIPLE)
    .sort((a, b) => b.s.videoCount - a.s.videoCount || a.multiple - b.multiple)
    .slice(0, 5)
    .map(({ s, multiple }) => ({
      stockName: s.stockName,
      videoCount: s.videoCount,
      avgViews: s.avgViews,
      multiple,
      reference: false,
      sentence: `${s.stockName} 영상은 ${s.videoCount}개 올렸는데 평균 ${fmtShort(s.avgViews)}회 — 팀 평균의 ${Math.round(multiple * 100)}% 수준이에요. 당분간 쉬고 반응이 좋은 종목을 먼저 다뤄도 좋아요.`
    }))

  return { teamAvg, top, fold }
}

// ---------------------------------------------------------------- 업로드 시간대

export const TIMING_RELIABLE_MIN = 3 // 한 칸에 영상이 이 개수 미만이면 "영상이 적어요"

export type SlotCell = { weekday: number; hour: number; count: number; totalViews: number; avgViews: number }

export type SlotAdvice = {
  weekday: number
  hour: number
  count: number
  avgViews: number
  multiple: number | null // 전체 평균 대비 배수
  lowSample: boolean
  sentence: string // 추천 + 근거를 한 문장으로
  evidence: string // 근거 부분만 (제목에 이미 추천 시간대가 있을 때 이어서 쓴다)
  caveat: string
}

export function isThinCell(count: number): boolean {
  return count >= 1 && count < TIMING_RELIABLE_MIN
}

// 추천 시간대 딱 한 곳. 영상이 충분한(3개 이상) 칸 중 평균 조회수가 가장 높은 칸을 먼저 고르고,
// 그런 칸이 없으면 2개짜리 → 1개짜리 순으로 물러서되 "영상이 적어요" 를 함께 알린다.
export function buildTimingAdvice(cells: SlotCell[]): SlotAdvice | null {
  let totalViews = 0
  let totalCount = 0
  for (const c of cells) {
    totalViews += c.totalViews
    totalCount += c.count
  }
  const overallAvg = totalCount > 0 ? totalViews / totalCount : 0
  const best = (min: number) =>
    cells
      .filter((c) => c.count >= min && c.avgViews > 0)
      .sort((a, b) => b.avgViews - a.avgViews || b.count - a.count || a.weekday - b.weekday || a.hour - b.hour)[0]
  const pick = best(TIMING_RELIABLE_MIN) ?? best(2) ?? best(1)
  if (!pick) return null
  const lowSample = pick.count < TIMING_RELIABLE_MIN
  const multiple = overallAvg > 0 ? pick.avgViews / overallAvg : null
  const name = slotRangeName(pick.weekday, pick.hour)
  const compare = multiple !== null && multiple >= 1.05 ? ` (전체 평균의 ${fmtMultiple(multiple)}배)` : ''
  return {
    weekday: pick.weekday,
    hour: pick.hour,
    count: pick.count,
    avgViews: pick.avgViews,
    multiple,
    lowSample,
    sentence: `${name}에 올려 보세요. 이 시간대 영상 ${pick.count}개가 평균 ${fmtShort(pick.avgViews)}회 조회됐어요${compare}.`,
    evidence: `이 시간대에 올린 영상 ${pick.count}개가 평균 ${fmtShort(pick.avgViews)}회 조회됐어요${compare}.`,
    caveat: lowSample ? `영상이 적어요. ${pick.count}개뿐이라 우연일 수 있어요. 3개 이상 쌓이면 더 믿을 수 있어요.` : ''
  }
}

// ---------------------------------------------------------------- 담당자

export type StaffRowLite = {
  name: string
  videoCount: number
  totalViews: number
  avgViews: number
  likeRate: number
  longformShare: number
}

export type StaffTeamLite = { avgViews: number; likeRate: number; meanVideoCount: number }

export function buildStaffTeamLite(rows: StaffRowLite[], team: { avgViews: number; likeRate: number }): StaffTeamLite {
  const active = rows.filter((r) => r.videoCount > 0)
  const meanVideoCount = active.length > 0 ? active.reduce((s, r) => s + r.videoCount, 0) / active.length : 0
  return { avgViews: team.avgViews, likeRate: team.likeRate, meanVideoCount }
}

// 강점을 한 문장으로 (최대 2가지). 비교 대상은 "팀 평균" 이고, 못하는 점은 말하지 않는다.
export function staffStrength(row: StaffRowLite, team: StaffTeamLite): string {
  if (row.videoCount <= 0) return '이 기간에 등록한 영상이 없어요.'
  const strengths: string[] = []
  if (team.avgViews > 0 && row.avgViews / team.avgViews >= 1.2) {
    strengths.push(`영상당 평균 조회수가 팀 평균의 ${fmtMultiple(row.avgViews / team.avgViews)}배예요`)
  }
  if (team.likeRate > 0 && row.likeRate / team.likeRate >= 1.2) strengths.push('좋아요 비율이 팀 평균보다 높아요')
  if (team.meanVideoCount > 0 && row.videoCount / team.meanVideoCount >= 1.2) strengths.push('영상을 팀 평균보다 많이 올렸어요')
  if (strengths.length === 0) {
    if (row.longformShare >= 0.8) return '롱폼 위주로 올리고 있고, 조회수는 팀 평균과 비슷해요.'
    if (row.longformShare <= 0.2) return '숏폼 위주로 올리고 있고, 조회수는 팀 평균과 비슷해요.'
    return '롱폼과 숏폼을 고르게 올리고 있고, 조회수는 팀 평균과 비슷해요.'
  }
  return `${strengths.slice(0, 2).join(' · ')}.`
}
