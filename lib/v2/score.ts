// 반응 점수(0~100) 구간 계산. 서버 계산식은 server.ts(computeDiscoverability), 여기는 화면 표시용 구간 나누기.

export type ScoreBand = 'good' | 'mid' | 'low'

export const SCORE_GOOD_MIN = 70
export const SCORE_LOW_MAX = 40 // 이 점수 미만이 '낮음'

export function scoreBand(score: number | null | undefined): ScoreBand {
  const s = typeof score === 'number' && Number.isFinite(score) ? score : 0
  if (s >= SCORE_GOOD_MIN) return 'good'
  if (s >= SCORE_LOW_MAX) return 'mid'
  return 'low'
}

export const BAND_WORD: Record<ScoreBand, string> = { good: '좋음', mid: '보통', low: '낮음' }
// 색만으로 구분하지 않도록 모양 기호를 함께 쓴다.
export const BAND_SYMBOL: Record<ScoreBand, string> = { good: '▲', mid: '●', low: '▼' }

// 점수를 10점 단위 10칸(0~9, 10~19, ... 90~100)으로 센다. 잘못된 값은 건너뛴다.
export function bucketScores(scores: readonly (number | null | undefined)[], size = 10): number[] {
  const count = Math.ceil(100 / size)
  const buckets = new Array<number>(count).fill(0)
  for (const raw of scores) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    const s = Math.max(0, Math.min(100, raw))
    buckets[Math.min(count - 1, Math.floor(s / size))] += 1
  }
  return buckets
}

export function bandCounts(scores: readonly (number | null | undefined)[]): Record<ScoreBand, number> {
  const out: Record<ScoreBand, number> = { good: 0, mid: 0, low: 0 }
  for (const s of scores) {
    if (typeof s !== 'number' || !Number.isFinite(s)) continue
    out[scoreBand(s)] += 1
  }
  return out
}
