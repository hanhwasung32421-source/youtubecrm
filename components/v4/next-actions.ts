// 성장 현황 맨 위 "다음 할 일" 카드를 만드는 순수 함수 (React 의존 없음).
// 이미 받아 둔 값(대시보드 응답, 담당자 7일 표, 7일 상위 영상)만으로 "지금 뭘 하면 좋은지"를 최대 3개 고른다.
// 각 카드 = 제목 + 이유 한 문장 + 버튼 하나.

import { fmtCompact } from '@/lib/v4/format'

export const STALE_SYNC_HOURS = 24
export const MAX_CARDS = 3

export type NextAction = {
  id: 'behind-today' | 'stale-sync' | 'set-goal' | 'register-now' | 'top-video' | 'all-good'
  priority: number
  tone: 'warn' | 'info' | 'good'
  title: string
  reason: string
  action: { kind: 'link'; label: string; href: string } | { kind: 'sync'; label: string } | { kind: 'goal'; label: string }
}

export type StaffToday = { userId: string; name: string; today: number }

export type NextActionInput = {
  scope: 'admin' | 'staff'
  nowMs: number
  hasVideos: boolean
  lastSyncedAt: string | null
  goalScope: 'team' | 'user' | 'derived' | 'none'
  goalSample: boolean
  targetPerDay: number // 관리자: 팀 전체 하루 목표, 직원: 내 하루 목표
  staffCount: number
  todayUploads: number | null // 오늘 올라온 영상 수 (직원=내 것, 관리자=팀 전체). 모르면 null
  staffToday: StaffToday[] | null // 관리자만: 담당자별 오늘 등록 수. 모르면 null
  top: { title: string; stockName: string; viewCount: number } | null // 최근 7일 가장 많이 본 영상
}

// 한국 시간 기준 시각(0~23)
export function kstHour(nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(nowMs))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  return Number.isFinite(hour) ? hour % 24 : 0
}

export function staleHoursOf(lastSyncedAt: string | null | undefined, nowMs: number): number | null {
  if (!lastSyncedAt) return null
  const t = new Date(lastSyncedAt).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, (nowMs - t) / 3600000)
}

export function staleText(hours: number): string {
  if (hours < 48) return `${Math.max(1, Math.round(hours))}시간`
  return `${Math.floor(hours / 24)}일`
}

// 오늘 등록이 적은 담당자. 이른 시간에는 재촉하지 않는다.
//  - 낮 12시부터: 아직 한 개도 없는 사람
//  - 오후 3시부터: 하루 목표의 절반도 못 채운 사람
export function behindStaff(staffToday: StaffToday[] | null, perStaffTarget: number, hour: number): StaffToday[] {
  if (!staffToday || hour < 12) return []
  const half = Math.ceil(Math.max(perStaffTarget, 1) * 0.5)
  const behind = staffToday.filter((s) => (hour >= 15 ? s.today < half : s.today === 0))
  return behind.sort((a, b) => a.today - b.today || a.name.localeCompare(b.name, 'ko'))
}

function shorten(text: string, max = 28) {
  const t = (text || '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function deriveNextActions(input: NextActionInput): NextAction[] {
  // 영상이 아직 하나도 없으면 카드 대신 "시작하기" 체크리스트를 보여 준다.
  if (!input.hasVideos) return []
  const isAdmin = input.scope === 'admin'
  const cards: NextAction[] = []
  const hour = kstHour(input.nowMs)

  if (isAdmin) {
    const perStaff = input.staffCount > 0 ? Math.round(input.targetPerDay / input.staffCount) : input.targetPerDay
    const behind = behindStaff(input.staffToday, perStaff, hour)
    if (behind.length > 0) {
      const names = behind
        .slice(0, 3)
        .map((s) => `${s.name} ${s.today}개`)
        .join(' · ')
      const more = behind.length > 3 ? ` 외 ${behind.length - 3}명` : ''
      cards.push({
        id: 'behind-today',
        priority: 90,
        tone: 'warn',
        title: `오늘 등록이 적은 담당자가 ${behind.length}명 있어요`,
        reason: `지금까지 ${names}${more} 등록했어요. 하루 목표는 1인당 ${perStaff}개예요.`,
        action: { kind: 'link', label: '담당자별 현황 보기', href: '/v4/staff' }
      })
    }

    const hours = staleHoursOf(input.lastSyncedAt, input.nowMs)
    if (input.lastSyncedAt === null || (hours !== null && hours > STALE_SYNC_HOURS)) {
      cards.push({
        id: 'stale-sync',
        priority: 80,
        tone: 'warn',
        title: input.lastSyncedAt === null ? '아직 유튜브 조회수를 받은 적이 없어요' : '조회수가 오래 갱신되지 않았어요',
        reason:
          input.lastSyncedAt === null || hours === null
            ? '조회수를 받아야 숫자가 채워져요. 버튼 한 번이면 돼요.'
            : `마지막으로 받은 지 ${staleText(hours)}이 지났어요. 지금 보이는 조회수가 실제보다 낮을 수 있어요.`,
        action: { kind: 'sync', label: '지금 새로 받기' }
      })
    }

    if (input.goalScope === 'none' || input.goalSample) {
      cards.push({
        id: 'set-goal',
        priority: 60,
        tone: 'info',
        title: '이번 달 목표를 정해 주세요',
        reason: '목표가 있어야 얼마나 왔는지 달성률로 볼 수 있어요. 영상 수만 넣어도 돼요.',
        action: { kind: 'goal', label: '목표 정하기' }
      })
    }
  } else if (input.todayUploads !== null && input.targetPerDay > 0 && input.todayUploads < input.targetPerDay) {
    const remaining = input.targetPerDay - input.todayUploads
    cards.push({
      id: 'register-now',
      priority: 70,
      tone: 'info',
      title: `오늘 ${input.todayUploads}개 등록했어요`,
      reason: `하루 목표 ${input.targetPerDay}개까지 ${remaining}개 남았어요.`,
      action: { kind: 'link', label: '영상 등록하러 가기', href: '/v4/register' }
    })
  }

  if (input.top && input.top.viewCount > 0) {
    cards.push({
      id: 'top-video',
      priority: 40,
      tone: 'good',
      title: '최근 7일 가장 많이 본 영상',
      reason: `"${shorten(input.top.title)}" (${input.top.stockName}) 조회수 ${fmtCompact(input.top.viewCount)}회예요. 무엇이 통했는지 살펴보세요.`,
      action: { kind: 'link', label: '성과 순위에서 보기', href: '/v4/ranking' }
    })
  }

  if (cards.length === 0) {
    cards.push({
      id: 'all-good',
      priority: 0,
      tone: 'good',
      title: '지금 급하게 할 일은 없어요',
      reason: '등록도 조회수도 목표도 정리돼 있어요. 잘 된 영상의 공통점을 찾아보세요.',
      action: { kind: 'link', label: '성과 순위 보기', href: '/v4/ranking' }
    })
  }

  return cards.sort((a, b) => b.priority - a.priority).slice(0, MAX_CARDS)
}

export type ChecklistStep = { key: 'register' | 'sync' | 'goal'; label: string; done: boolean }

// 영상이 아직 없을 때 보여 주는 "시작하기 3단계". 각 단계의 체크는 실제 데이터로 계산된다.
export function setupChecklist(input: Pick<NextActionInput, 'hasVideos' | 'lastSyncedAt' | 'goalScope' | 'goalSample'>): { steps: ChecklistStep[]; doneCount: number } {
  const steps: ChecklistStep[] = [
    { key: 'register', label: '① 담당자가 영상 등록', done: input.hasVideos },
    { key: 'sync', label: '② 유튜브 조회수 받기', done: input.hasVideos && input.lastSyncedAt !== null },
    { key: 'goal', label: '③ 목표 정하기', done: input.goalScope !== 'none' && !input.goalSample }
  ]
  return { steps, doneCount: steps.filter((s) => s.done).length }
}
