// 이번 달 목표 달성률 계산 (순수 함수, React 의존 없음).
// 목표가 0(정하지 않음)인 쪽은 "0% 달성"이라고 보이지 않게 따로 걸러 낸다.

export type GoalNumbers = {
  scope: 'team' | 'user' | 'derived' | 'none'
  targetVideos: number
  targetViews: number
  actualVideos: number
  actualViews: number
}

export type GoalProgress = {
  hasVideoTarget: boolean
  hasViewTarget: boolean
  videoRatio: number // 목표가 없으면 0
  viewRatio: number
}

function ratio(actual: number, target: number) {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return 0
  const r = actual / target
  return Number.isFinite(r) && r > 0 ? r : 0
}

export function goalProgress(goal: GoalNumbers | null | undefined): GoalProgress {
  if (!goal || goal.scope === 'none') return { hasVideoTarget: false, hasViewTarget: false, videoRatio: 0, viewRatio: 0 }
  return {
    hasVideoTarget: goal.targetVideos > 0,
    hasViewTarget: goal.targetViews > 0,
    videoRatio: ratio(goal.actualVideos, goal.targetVideos),
    viewRatio: ratio(goal.actualViews, goal.targetViews)
  }
}

// 접어 둔 목표 칸 옆에 보이는 한 줄
export function goalSummaryText(goal: GoalNumbers | null | undefined): string {
  const p = goalProgress(goal)
  const parts: string[] = []
  if (p.hasVideoTarget) parts.push(`영상 ${Math.round(p.videoRatio * 100)}%`)
  if (p.hasViewTarget) parts.push(`조회수 ${Math.round(p.viewRatio * 100)}%`)
  if (parts.length > 0) return `${parts.join(' · ')} 달성`
  return goal && goal.scope !== 'none' ? '목표 숫자가 0이에요' : '아직 목표가 없어요'
}
