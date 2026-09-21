// "지난 기간 대비" 변화를 사람이 읽을 말로 바꾸는 순수 함수 (React 의존 없음).
// 색깔만으로 알려주지 않도록 화살표(▲▼―)와 글자, 화면 낭독용 문장을 함께 만든다.

export type DeltaKind = 'up' | 'down' | 'flat' | 'new' | 'none'

export type Delta = {
  kind: DeltaKind
  ratio: number // (이번 / 지난) - 1. 비교할 수 없으면 0
  pct: number // 반올림한 변화율(절댓값, %)
  label: string // 칩에 보이는 짧은 글자. 예: "▲ 12%"
  text: string // 풀어 쓴 문장 조각. 예: "지난 30일보다 12% 늘었어요"
}

export const FLAT_BELOW = 0.03 // 3% 미만은 "비슷해요"
const PCT_CAP = 999

const NONE: Delta = { kind: 'none', ratio: 0, pct: 0, label: '', text: '' }

// current, previous: 같은 지표의 이번/지난 기간 값. days: 기간 길이(일).
// previous 가 null/undefined 면 비교 자료가 없다는 뜻이라 'none' (칩을 아예 안 보여준다).
export function computeDelta(current: number | null | undefined, previous: number | null | undefined, days: number, flatBelow = FLAT_BELOW): Delta {
  if (previous === null || previous === undefined || current === null || current === undefined) return NONE
  const cur = Number(current)
  const prev = Number(previous)
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || cur < 0 || prev < 0) return NONE
  if (prev === 0) {
    if (cur === 0) return NONE
    return { kind: 'new', ratio: 0, pct: 0, label: '지난 기간 기록 없음', text: `지난 ${days}일에는 기록이 없었어요` }
  }
  const ratio = cur / prev - 1
  if (Math.abs(ratio) < flatBelow) {
    return { kind: 'flat', ratio, pct: Math.round(Math.abs(ratio) * 100), label: '― 비슷해요', text: `지난 ${days}일과 비슷해요` }
  }
  const rounded = Math.round(Math.abs(ratio) * 100)
  const pct = Math.min(rounded, PCT_CAP)
  const shown = rounded > PCT_CAP ? `${PCT_CAP}%+` : `${pct}%`
  if (ratio > 0) return { kind: 'up', ratio, pct, label: `▲ ${shown}`, text: `지난 ${days}일보다 ${shown} 늘었어요` }
  return { kind: 'down', ratio, pct, label: `▼ ${shown}`, text: `지난 ${days}일보다 ${shown} 줄었어요` }
}
