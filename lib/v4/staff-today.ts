// 담당자별 "오늘 등록한 영상 수" 와 하루 목표 대비 진행 (순수 함수, 서버·화면 공용).
// 목표(12개)는 참고용 숫자일 뿐이라 부족해도 나무라는 말투를 쓰지 않는다.

export const DAILY_TARGET = 12

// 하루 일과를 10시~20시로 보고, 지금 시각까지 보통 몇 개쯤 올렸어야 하는지 계산한다 (그 전에는 아무도 "뒤처짐" 이 아님).
export const WORK_START_HOUR = 10
export const WORK_END_HOUR = 20

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function kstYmdOfIso(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
}

// 한국 시간 기준 현재 시각 (0~23)
export function kstHourOf(nowMs: number): number {
  return new Date(nowMs + KST_OFFSET_MS).getUTCHours()
}

// ymd(한국 날짜)에 등록한(created_at 기준) 영상을 담당자별로 센다. 담당자가 없는 영상은 건너뛴다.
export function countByOwnerOnDay(rows: Array<{ primary_owner_user_id: string | null; created_at: string }>, ymd: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const owner = row.primary_owner_user_id
    if (!owner) continue
    if (kstYmdOfIso(row.created_at) !== ymd) continue
    counts.set(owner, (counts.get(owner) || 0) + 1)
  }
  return counts
}

// 지금 시각까지 보통 올렸을 개수 (내림). 10시 이전 0, 20시 이후 목표 전체.
export function expectedByHour(target: number, hourKst: number): number {
  if (!(target > 0)) return 0
  const progress = Math.min(1, Math.max(0, (hourKst - WORK_START_HOUR) / (WORK_END_HOUR - WORK_START_HOUR)))
  return Math.floor(target * progress)
}

export type TodayState = 'none' | 'done' | 'on-track' | 'behind'

export type TodayStatus = {
  state: TodayState
  count: number
  target: number
  remaining: number
  expected: number
  text: string
}

// target 이 0 이하면(퇴사자 등 목표가 없는 사람) state 'none'.
export function todayStatus(count: number, target: number, hourKst: number): TodayStatus {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (!(target > 0)) return { state: 'none', count: safeCount, target: 0, remaining: 0, expected: 0, text: `오늘 ${safeCount}개 등록` }
  const remaining = Math.max(0, target - safeCount)
  const expected = expectedByHour(target, hourKst)
  if (remaining === 0) return { state: 'done', count: safeCount, target, remaining, expected, text: `오늘 ${safeCount}개 등록 · 오늘 목표 ${target}개를 채웠어요` }
  if (safeCount < expected) {
    return { state: 'behind', count: safeCount, target, remaining, expected, text: `오늘 ${safeCount}개 등록 · 목표까지 ${remaining}개 남았어요 (이 시간엔 ${expected}개쯤이 보통이에요)` }
  }
  return { state: 'on-track', count: safeCount, target, remaining, expected, text: `오늘 ${safeCount}개 등록 · 목표까지 ${remaining}개 남았어요` }
}
