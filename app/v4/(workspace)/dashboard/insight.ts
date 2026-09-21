// 성장 현황 맨 위 "한 줄 요약"과 "다음에 볼 곳"을 만드는 순수 함수.
// 숫자를 그대로 나열하지 않고, 비전문가가 바로 이해할 문장으로 바꾼다.
// 지난 기간 값(previousKpis)이 있으면 제목 문장 자체가 지난 기간과 비교한다.

import type { DailyPoint, Kpis } from '@/lib/v4/analytics'
import { fmtCompact, fmtNumber } from '@/lib/v4/format'
import { computeDelta, type Delta } from '@/components/v4/delta'

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

// 조회수 문장 조각: "조회수는 모두 합쳐 1.2만회예요" 를 지난 기간 비교와 함께 만든다.
function viewsClause(days: number, totalViews: number, delta: Delta) {
  const total = `${fmtCompact(totalViews)}회`
  if (delta.kind === 'up') return `조회수는 지난 ${days}일보다 ${delta.pct}% 늘어 모두 합쳐 ${total}예요.`
  if (delta.kind === 'down') return `조회수는 지난 ${days}일보다 ${delta.pct}% 줄어 모두 합쳐 ${total}예요.`
  if (delta.kind === 'flat') return `조회수는 모두 합쳐 ${total}로, 지난 ${days}일과 비슷해요.`
  return `조회수는 모두 합쳐 ${total}예요.`
}

function uploadsSentence(days: number, delta: Delta, previousCount: number) {
  if (delta.kind === 'up') return `올린 영상은 지난 ${days}일(${fmtNumber(previousCount)}개)보다 ${delta.pct}% 늘었어요.`
  if (delta.kind === 'down') return `올린 영상은 지난 ${days}일(${fmtNumber(previousCount)}개)보다 ${delta.pct}% 줄었어요.`
  if (delta.kind === 'flat') return `올린 영상 수는 지난 ${days}일(${fmtNumber(previousCount)}개)과 비슷해요.`
  return ''
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

  // 1) 지난 기간과 비교 (지난 기간에 영상이 있었을 때만 의미가 있다)
  const hasPrevious = Boolean(previousKpis && previousKpis.videoCount > 0)
  const viewsDelta = hasPrevious && previousKpis ? computeDelta(kpis.totalViews, previousKpis.totalViews, days) : computeDelta(null, null, days)
  const uploadsDelta = hasPrevious && previousKpis ? computeDelta(kpis.videoCount, previousKpis.videoCount, days) : computeDelta(null, null, days)
  const compared = viewsDelta.kind === 'up' || viewsDelta.kind === 'down' || viewsDelta.kind === 'flat'

  const headline = `${period} 동안 ${who} 영상 ${fmtNumber(kpis.videoCount)}개를 올렸고, ${viewsClause(days, kpis.totalViews, viewsDelta)}`

  let trendSentence = ''
  let trendTone: Insight['tone'] = 'neutral'
  if (compared) {
    trendSentence = uploadsSentence(days, uploadsDelta, previousKpis?.videoCount || 0)
    if (viewsDelta.kind === 'up') trendTone = 'good'
    else if (viewsDelta.kind === 'down') trendTone = 'warn'
    else if (uploadsDelta.kind === 'up') trendTone = 'good'
    else if (uploadsDelta.kind === 'down') trendTone = 'warn'
  } else if (daily.length >= 6) {
    // 2) 지난 기간 자료가 없으면 이번 기간 안에서 앞 절반 vs 뒤 절반 업로드 속도 비교
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
  } else if (viewsDelta.kind === 'down') {
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
