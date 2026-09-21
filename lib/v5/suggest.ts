// 점수 결과 → "그래서 다음에 뭘 하지?" 제안(순수 함수).
// 점수가 낮은 영상은 가장 약한 요소 하나를 짚어 실험을 제안하고, 점수가 높은 영상은 성공 공식으로 남기게 한다.

import { scoreParts, totalOf, type FactorKey, type ScorePart } from '@/lib/v5/score-view'
import type { ExperimentDimension, ScoreTier, ScoreboardRow } from '@/lib/v5/types'

const FACTOR_ORDER: FactorKey[] = ['velocity', 'engagement', 'early']

const FACTOR_ADVICE: Record<FactorKey, { problem: string; todo: string; hypothesis: string; dimensions: ExperimentDimension[] }> = {
  velocity: {
    problem: '조회 속도가 낮아요',
    todo: '제목·썸네일 실험을 만들어 보세요',
    hypothesis: '제목과 썸네일을 눈에 띄게 바꾸면 하루 평균 조회수가 늘 것이다',
    dimensions: ['title', 'thumbnail']
  },
  engagement: {
    problem: '참여율이 낮아요',
    todo: '댓글을 부르는 질문 실험을 만들어 보세요',
    hypothesis: '영상 끝에 질문을 던지고 고정 댓글을 달면 좋아요·댓글이 늘 것이다',
    dimensions: ['format']
  },
  early: {
    problem: '초기 성장이 낮아요',
    todo: '올리는 시간 실험을 만들어 보세요',
    hypothesis: '시청자가 많은 시간대에 올리면 처음 48시간 조회수가 더 빨리 늘 것이다',
    dimensions: ['publish_time']
  }
}

export type WeakSuggestion = {
  key: FactorKey
  label: string
  value: number
  max: number
  // 만점 대비 %
  pct: number
  // "조회 속도가 낮아요 → 제목·썸네일 실험을 만들어 보세요"
  headline: string
  // "조회 속도 12/45점(만점의 27%) — 이 영상의 세 요소 중 가장 낮아요"
  reason: string
}

// 가장 약한 요소(만점 대비 비율이 가장 낮은 것). 기록이 부족해 기본점수를 준 초기 성장은 비교에서 뺀다.
// 동률이면 조회 속도 → 참여율 → 초기 성장 순으로 고른다.
export function weakestComponent(row: Parameters<typeof scoreParts>[0]): WeakSuggestion | null {
  const usable = scoreParts(row).filter((p) => !p.pending)
  if (usable.length === 0) return null
  const ratio = (p: ScorePart) => p.value / p.max
  let worst = usable[0]
  for (const p of usable) {
    const better = ratio(p) < ratio(worst) - 1e-9
    const tie = Math.abs(ratio(p) - ratio(worst)) <= 1e-9 && FACTOR_ORDER.indexOf(p.key) < FACTOR_ORDER.indexOf(worst.key)
    if (better || tie) worst = p
  }
  const tied = usable.filter((p) => Math.abs(ratio(p) - ratio(worst)) <= 1e-9).length > 1
  const pct = Math.round(ratio(worst) * 100)
  const advice = FACTOR_ADVICE[worst.key]
  const scope = usable.length >= 3 ? '세 요소' : usable.length === 2 ? '두 요소' : '요소'
  const where = tied ? `이 영상의 ${scope} 중 가장 낮은 쪽이에요` : `이 영상의 ${scope} 중 가장 낮아요`
  return {
    key: worst.key,
    label: worst.label,
    value: worst.value,
    max: worst.max,
    pct,
    headline: `${advice.problem} → ${advice.todo}`,
    reason: `${worst.label} ${worst.value}/${worst.max}점(만점의 ${pct}%) — ${where}`
  }
}

export type StrongSuggestion = { key: FactorKey; label: string; value: number; max: number; headline: string; reason: string; note: string }

// 잘 된 영상의 "가장 강한 요소"(기록 부족한 초기 성장은 제외). 성공 공식 메모에 쓴다.
export function strongestComponent(row: Parameters<typeof scoreParts>[0] & { totalScore: number }): StrongSuggestion | null {
  const usable = scoreParts(row).filter((p) => !p.pending)
  if (usable.length === 0) return null
  const ratio = (p: ScorePart) => p.value / p.max
  let best = usable[0]
  for (const p of usable) {
    const better = ratio(p) > ratio(best) + 1e-9
    const tie = Math.abs(ratio(p) - ratio(best)) <= 1e-9 && FACTOR_ORDER.indexOf(p.key) < FACTOR_ORDER.indexOf(best.key)
    if (better || tie) best = p
  }
  const total = totalOf(row)
  return {
    key: best.key,
    label: best.label,
    value: best.value,
    max: best.max,
    headline: `${best.label}이 특히 좋았어요 → 성공 공식으로 저장해 두세요`,
    reason: `반응 점수 ${total}점 · ${best.label} ${best.value}/${best.max}점이 가장 높아요`,
    note: `반응 점수 ${total}점 · 강점 ${best.label} ${best.value}/${best.max}점`
  }
}

export type NextStep = { kind: 'experiment'; suggestion: WeakSuggestion } | { kind: 'playbook'; suggestion: StrongSuggestion } | null

// 구간에 따른 다음 행동: 아쉬움 → 실험 만들기, 좋음 이상 → 성공 공식으로 저장, 보통 → 없음.
export function nextStepFor(row: ScoreboardRow): NextStep {
  return nextStepForTier(row.tier, row)
}

export function nextStepForTier(tier: ScoreTier, row: ScoreboardRow): NextStep {
  if (tier === 'poor') {
    const s = weakestComponent(row)
    return s ? { kind: 'experiment', suggestion: s } : null
  }
  if (tier === 'excellent' || tier === 'good') {
    const s = strongestComponent(row)
    return s ? { kind: 'playbook', suggestion: s } : null
  }
  return null
}

// ---------------------------------------------------------------------------
// 링크(다른 화면이 같은 규칙으로 읽는다)
// ---------------------------------------------------------------------------
export const FOCUS_KEYS: readonly FactorKey[] = FACTOR_ORDER

export function experimentLink(videoId: string, focus?: FactorKey): string {
  const q = new URLSearchParams({ new: '1', video: videoId })
  if (focus) q.set('focus', focus)
  return `/v5/canvas?${q.toString()}`
}

export function playbookLink(videoId: string, note?: string): string {
  const q = new URLSearchParams({ new: '1', video: videoId })
  if (note) q.set('note', note.slice(0, 80))
  return `/v5/playbook?${q.toString()}`
}

// 주소의 focus 값으로 실험 폼을 미리 채운다. 모르는 값이면 null.
export function experimentPrefill(focus: string | null | undefined): { dimensions: ExperimentDimension[]; hypothesis: string } | null {
  if (!focus || !(FOCUS_KEYS as readonly string[]).includes(focus)) return null
  const a = FACTOR_ADVICE[focus as FactorKey]
  return { dimensions: a.dimensions.slice(), hypothesis: a.hypothesis }
}

// 성공 공식 이름 제안: 영상 제목(없으면 종목명) 앞부분.
export function playbookTitleSuggestion(video: { title: string | null; stock_name: string }): string {
  const base = (video.title || video.stock_name || '').trim()
  if (!base) return ''
  const short = base.length > 50 ? `${base.slice(0, 50)}…` : base
  return `잘 된 방식: ${short}`
}
