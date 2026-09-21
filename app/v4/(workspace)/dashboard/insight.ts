// 성장 현황 맨 위 "한 줄 요약"과 "다음에 볼 곳"을 만드는 순수 함수.
// 숫자를 그대로 나열하지 않고, 비전문가가 바로 이해할 문장으로 바꾼다.

import type { DailyPoint, Kpis } from '@/lib/v4/analytics'
import { fmtCompact, fmtNumber } from '@/lib/v4/format'

export type Insight = {
  headline: string
  detail: string
  tone: 'good' | 'warn' | 'neutral'
  next: { label: string; why: string; href: string }
}

type Input = {
  days: number
  scope: 'admin' | 'staff'
  kpis: Kpis
  daily: DailyPoint[]
  targetPerDay: number
  // API가 지난 기간 값을 내려주면 그것과 비교한다 (없으면 이번 기간의 앞·뒤 절반을 비교).
  previousKpis?: Kpis | null
}

function pctText(ratio: number) {
  const pct = Math.round(Math.abs(ratio) * 100)
  return `${pct}%`
}

function avgPerDay(points: DailyPoint[], key: 'uploads' | 'views') {
  if (points.length === 0) return 0
  return points.reduce((sum, p) => sum + p[key], 0) / points.length
}

export function buildInsight({ days, scope, kpis, daily, targetPerDay, previousKpis }: Input): Insight {
  const who = scope === 'admin' ? '팀 전체가' : '내가'
  const period = `최근 ${days}일`

  if (kpis.videoCount === 0) {
    return {
      headline: `${period} 동안 등록된 영상이 없어요.`,
      detail: '영상을 등록하면 조회수와 반응이 여기에 자동으로 모입니다.',
      tone: 'neutral',
      next: { label: '영상 등록하러 가기', why: '주소와 종목명만 넣으면 1분도 걸리지 않아요.', href: '/v4/register' }
    }
  }

  const headline = `${period} 동안 ${who} 영상 ${fmtNumber(kpis.videoCount)}개를 올렸고, 조회수는 모두 합쳐 ${fmtCompact(kpis.totalViews)}회예요.`

  // 1) 지난 기간과 비교 (있을 때)
  let trendSentence = ''
  let trendTone: Insight['tone'] = 'neutral'
  if (previousKpis && previousKpis.videoCount > 0 && previousKpis.totalViews > 0) {
    const change = kpis.totalViews / previousKpis.totalViews - 1
    if (Math.abs(change) < 0.03) {
      trendSentence = `지난 ${days}일과 비슷한 수준이에요.`
    } else if (change > 0) {
      trendSentence = `지난 ${days}일보다 조회수가 ${pctText(change)} 늘었어요.`
      trendTone = 'good'
    } else {
      trendSentence = `지난 ${days}일보다 조회수가 ${pctText(change)} 줄었어요.`
      trendTone = 'warn'
    }
  } else if (daily.length >= 6) {
    // 2) 이번 기간 안에서 앞 절반 vs 뒤 절반 업로드 속도 비교
    const mid = Math.floor(daily.length / 2)
    const first = avgPerDay(daily.slice(0, mid), 'uploads')
    const second = avgPerDay(daily.slice(mid), 'uploads')
    if (first > 0) {
      const change = second / first - 1
      if (Math.abs(change) < 0.1) {
        trendSentence = '업로드 속도는 기간 내내 꾸준했어요.'
      } else if (change > 0) {
        trendSentence = `기간 후반부에 업로드가 앞쪽보다 ${pctText(change)} 늘었어요.`
        trendTone = 'good'
      } else {
        trendSentence = `기간 후반부에 업로드가 앞쪽보다 ${pctText(change)} 줄었어요.`
        trendTone = 'warn'
      }
    }
  }

  // 3) 하루 목표 대비 업로드 속도 → 다음에 볼 곳
  const perDay = kpis.videoCount / Math.max(days, 1)
  const paceRatio = targetPerDay > 0 ? perDay / targetPerDay : 1
  const paceSentence =
    targetPerDay > 0 ? `하루 평균 ${perDay.toFixed(1)}개로, 하루 목표(${fmtNumber(targetPerDay)}개)의 ${Math.round(paceRatio * 100)}%예요.` : ''

  let tone: Insight['tone'] = trendTone
  let next: Insight['next']
  if (paceRatio < 0.7 && scope === 'admin') {
    tone = 'warn'
    next = { label: '담당자 비교 보기', why: '업로드가 목표보다 적어요. 누가 얼마나 올렸는지 확인해 보세요.', href: '/v4/staff' }
  } else if (paceRatio < 0.7) {
    tone = 'warn'
    next = { label: '영상 등록하러 가기', why: '하루 목표보다 적게 올렸어요. 오늘 영상부터 등록해 보세요.', href: '/v4/register' }
  } else if (trendTone === 'warn') {
    next = { label: '잘 된 영상 살펴보기', why: '조회수가 줄었어요. 반응이 좋았던 영상의 공통점을 찾아보세요.', href: '/v4/ranking' }
  } else {
    next = { label: '잘 된 영상 살펴보기', why: '어떤 영상과 종목이 반응이 좋았는지 확인하고 다음 영상에 반영하세요.', href: '/v4/ranking' }
  }

  return {
    headline,
    detail: [trendSentence, paceSentence].filter(Boolean).join(' '),
    tone,
    next
  }
}
