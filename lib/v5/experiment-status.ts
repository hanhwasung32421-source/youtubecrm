// 성장 실험 카드 판단(순수 함수): 며칠째인지(D+N), 결과를 기록할 때가 됐는지, 지금 해야 할 일 한 줄.
// 날짜는 모두 한국 시간(KST) 기준 YYYY-MM-DD 로 계산한다(서버 UTC/브라우저 시간대와 무관).

import { diffDays, todayYmd } from '@/lib/v5/format'
import type { ExperimentStatus } from '@/lib/v5/types'

// 종료일을 안 정했을 때 "이만큼 지났으면 결과를 볼 때"로 보는 기본 기간
export const DEFAULT_PLANNED_DAYS = 14

type ExperimentLike = {
  status: ExperimentStatus
  started_on: string
  ended_on: string | null
  next_action?: string | null
}

// 계획한 기간(일). 종료일이 있으면 시작~종료일(최소 1일), 없으면 기본 14일.
export function plannedDays(exp: Pick<ExperimentLike, 'started_on' | 'ended_on'>): number {
  if (exp.ended_on && exp.started_on) return Math.max(diffDays(exp.started_on, exp.ended_on), 1)
  return DEFAULT_PLANNED_DAYS
}

// 시작일 당일이 D+0. 시작일이 미래거나 형식이 틀리면 0.
export function runningDays(startedOn: string, today: string = todayYmd()): number {
  return Math.max(diffDays(startedOn, today), 0)
}

// 카드에 붙이는 D+N: 진행중/보류는 오늘까지, 끝난 실험(성공/실패)은 종료일까지(종료일이 없으면 오늘까지).
export function elapsedDays(exp: ExperimentLike, today: string = todayYmd()): number {
  if ((exp.status === 'won' || exp.status === 'lost') && exp.ended_on) return runningDays(exp.started_on, exp.ended_on)
  return runningDays(exp.started_on, today)
}

export type Timing = {
  run: number
  planned: number
  // 진행 중이고 계획한 기간이 다 지나서 결과를 남길 때가 됐다
  needsResult: boolean
  // 계획 기간을 넘긴 일수(needsResult 일 때만 0 이상, 아니면 0)
  overdueDays: number
  // 결과 볼 날까지 남은 일수(이미 지났으면 0)
  daysLeft: number
}

export function experimentTiming(exp: ExperimentLike, today: string = todayYmd()): Timing {
  const run = runningDays(exp.started_on, today)
  const planned = plannedDays(exp)
  const needsResult = exp.status === 'running' && run >= planned
  return { run, planned, needsResult, overdueDays: needsResult ? run - planned : 0, daysLeft: Math.max(planned - run, 0) }
}

export type RequiredAction = { text: string; tone: 'due' | 'wait' | 'idle' | 'done' }

// "지금 해야 할 일" 한 줄. 결과 기록이 필요하면 글자로도 분명히 알린다(색만으로 구분하지 않는다).
export function nextRequiredAction(exp: ExperimentLike, today: string = todayYmd()): RequiredAction {
  if (exp.status === 'running') {
    const t = experimentTiming(exp, today)
    if (t.needsResult) return { text: t.overdueDays > 0 ? `결과 기록 필요 · ${t.overdueDays}일 지났어요` : '결과 기록 필요 · 오늘이 결과 보는 날이에요', tone: 'due' }
    return { text: `${t.daysLeft}일 뒤 결과 확인`, tone: 'wait' }
  }
  if (exp.status === 'won') return { text: '잘 됐어요 · 성공 공식으로 남기기', tone: 'done' }
  if (exp.status === 'lost') return { text: '왜 안 됐는지 적고 다음 실험 정하기', tone: 'idle' }
  return { text: '다시 할지, 접을지 정하기', tone: 'idle' }
}

// 진행 중 칸 정렬: 결과 기록이 필요한 것 먼저, 그다음 오래된 것부터.
export function compareRunning(a: ExperimentLike, b: ExperimentLike, today: string = todayYmd()): number {
  const na = experimentTiming(a, today).needsResult ? 0 : 1
  const nb = experimentTiming(b, today).needsResult ? 0 : 1
  if (na !== nb) return na - nb
  return a.started_on.localeCompare(b.started_on)
}
