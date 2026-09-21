// 업로드 계획 표의 계산(칸 상태, 다음 빈 시간, 주간 요약). 화면 코드와 분리해 단독으로 시험할 수 있다.

export type CellState = 'none' | 'future' | 'good' | 'bad' | 'pending'

// 칸의 상태: 지난 날에 계획보다 적게 올렸으면 bad, 오늘은 아직 진행 중(pending), 앞으로 올 날은 future.
export function cellState(day: string, today: string, planned: number, actual: number): CellState {
  if (planned === 0) return day > today ? 'future' : 'none'
  if (day > today) return 'future'
  if (actual >= planned) return 'good'
  return day === today ? 'pending' : 'bad'
}

// 색만으로 구분하지 않도록 상태마다 기호와 말을 함께 쓴다.
export const STATE_SYMBOL: Record<CellState, string> = { none: '', future: '', good: '✓', bad: '▼', pending: '…' }
export const STATE_WORD: Record<CellState, string> = {
  none: '',
  future: '아직 오지 않은 날',
  good: '계획대로 올렸어요',
  bad: '계획보다 적게 올렸어요',
  pending: '오늘 아직 진행 중'
}

function whole(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// 칸 아래 한 줄: "✓ 등록 2 / 계획 2", "3건 예정" 등
export function countLabel(state: CellState, day: string, today: string, planned: number, actual: number): string {
  const p = whole(planned)
  const a = whole(actual)
  if (day > today && a === 0) return p > 0 ? `${p}건 예정` : ''
  const symbol = STATE_SYMBOL[state]
  return `${symbol ? `${symbol} ` : ''}등록 ${a}${p > 0 ? ` / 계획 ${p}` : ''}`
}

// 이미 계획된 시간을 피해 from 시부터 다음으로 비어 있는 시간을 찾는다. 모두 차 있으면 from.
export function nextFreeHour(used: readonly number[], from: number): number {
  const start = Number.isFinite(from) ? ((Math.trunc(from) % 24) + 24) % 24 : 19
  for (let i = 0; i < 24; i += 1) {
    const h = (start + i) % 24
    if (!used.includes(h)) return h
  }
  return start
}

export type PlanSummary = { plannedAll: number; plannedDue: number; met: number; behind: number }

// 이번 주 요약: 지나간 날(오늘 포함) 계획 중 얼마나 지켰는지
export function summarizePlan(
  staffIds: readonly string[],
  days: readonly string[],
  planned: Record<string, Record<string, ArrayLike<unknown> | undefined> | undefined>,
  actual: Record<string, Record<string, number | undefined> | undefined>,
  today: string
): PlanSummary {
  let plannedAll = 0
  let plannedDue = 0
  let met = 0
  let behind = 0
  for (const id of staffIds) {
    for (const day of days) {
      const p = whole(planned[id]?.[day]?.length ?? 0)
      const a = whole(actual[id]?.[day] ?? 0)
      plannedAll += p
      if (p > 0 && day <= today) {
        plannedDue += p
        met += Math.min(a, p)
        if (day < today && a < p) behind += 1
      }
    }
  }
  return { plannedAll, plannedDue, met, behind }
}
