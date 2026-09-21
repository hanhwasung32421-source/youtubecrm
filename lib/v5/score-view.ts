// 점수판 화면용 순수 계산: 점수 구성(막대 조각), 구간 분포 문장. NaN/누락에 안전하다.

import { EARLY_NEUTRAL_SCORE } from '@/lib/v5/scoring'
import { SCORE_TIERS, SCORE_TIER_LABEL, type ScoreTier, type ScoreboardRow } from '@/lib/v5/types'

export type FactorKey = 'velocity' | 'engagement' | 'early'

export const SCORE_FACTORS: ReadonlyArray<{ key: FactorKey; label: string; short: string; max: number; meaning: string }> = [
  { key: 'velocity', label: '조회 속도', short: '조회', max: 45, meaning: '올라온 뒤 하루 평균 조회수가 다른 영상보다 얼마나 높은지' },
  { key: 'engagement', label: '참여율', short: '참여', max: 35, meaning: '본 사람 중 좋아요·댓글을 남긴 비율이 다른 영상보다 얼마나 높은지' },
  { key: 'early', label: '초기 성장', short: '초기', max: 20, meaning: '올린 뒤 48시간 안에 조회수가 얼마나 빨리 늘었는지' }
]

export const TIER_MIN: Record<ScoreTier, string> = {
  excellent: '80점 이상',
  good: '60~79점',
  fair: '40~59점',
  poor: '40점 미만'
}

export type ScorePart = {
  key: FactorKey
  label: string
  short: string
  max: number
  // 화면에 그리는 점수(0~max, NaN 이면 0 또는 초기 성장은 중립 10)
  value: number
  // 기록이 부족해서 기본값을 쓴 경우(초기 성장만 해당)
  pending: boolean
  // 막대 안에서 이 조각이 차지하는 비율(0~100, 전체 100점 기준)
  widthPct: number
  // 마우스를 올렸을 때/스크린리더용 문장
  tip: string
  meaning: string
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function scoreParts(row: Pick<ScoreboardRow, 'viewVelocityScore' | 'engagementScore' | 'earlyGrowthScore' | 'hasSnapshotData'>): ScorePart[] {
  return SCORE_FACTORS.map((f) => {
    const raw = f.key === 'velocity' ? row.viewVelocityScore : f.key === 'engagement' ? row.engagementScore : row.earlyGrowthScore
    const pending = f.key === 'early' && (!row.hasSnapshotData || !isNum(raw))
    const value = pending ? EARLY_NEUTRAL_SCORE : isNum(raw) ? clamp(Math.round(raw), 0, f.max) : 0
    const tip = pending ? `${f.label} ${value}/${f.max}점 · 기록 부족 (기본 ${EARLY_NEUTRAL_SCORE}점)` : `${f.label} ${value}/${f.max}점`
    return { key: f.key, label: f.label, short: f.short, max: f.max, value, pending, widthPct: value, tip, meaning: f.meaning }
  })
}

// 총점(합계). 넘어온 총점이 숫자가 아니면 조각을 더해서 만든다.
export function totalOf(row: Pick<ScoreboardRow, 'totalScore' | 'viewVelocityScore' | 'engagementScore' | 'earlyGrowthScore' | 'hasSnapshotData'>): number {
  if (isNum(row.totalScore)) return clamp(Math.round(row.totalScore), 0, 100)
  return clamp(scoreParts(row).reduce((s, p) => s + p.value, 0), 0, 100)
}

// 스크린리더용 한 문장: "총 72점. 조회 속도 30/45점, 참여율 20/35점, 초기 성장 10/20점 · 기록 부족 (기본 10점)"
export function scoreAriaLabel(row: Parameters<typeof scoreParts>[0] & { totalScore: number }): string {
  return `총 ${totalOf(row)}점. ${scoreParts(row)
    .map((p) => p.tip)
    .join(', ')}`
}

// 가장 강한/약한 요소(기록 부족한 초기 성장은 비교에서 뺀다).
export function strongestWeakest(row: Parameters<typeof scoreParts>[0]): { best: ScorePart | null; worst: ScorePart | null } {
  const usable = scoreParts(row).filter((p) => !p.pending)
  if (usable.length === 0) return { best: null, worst: null }
  const ranked = usable.map((p) => ({ p, ratio: p.value / p.max })).sort((a, b) => b.ratio - a.ratio)
  return { best: ranked[0].p, worst: ranked[ranked.length - 1].p }
}

export type TierSlice = { tier: ScoreTier; label: string; range: string; count: number; pct: number }

// 서버가 내려준 구간별 개수 → 화면용(퍼센트 포함). 합이 0이면 모두 0%.
export function tierSlices(distribution: Array<{ tier: ScoreTier; count: number }> | null | undefined): TierSlice[] {
  const map = new Map<ScoreTier, number>()
  for (const d of distribution || []) if (isNum(d.count) && d.count > 0) map.set(d.tier, d.count)
  const total = Array.from(map.values()).reduce((s, n) => s + n, 0)
  return SCORE_TIERS.map((tier) => {
    const count = map.get(tier) || 0
    return { tier, label: SCORE_TIER_LABEL[tier], range: TIER_MIN[tier], count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }
  })
}

// 도넛의 글자 설명: "전체 24개 중 매우 좋음 3개(13%), 좋음 8개(33%), ..."
export function tierSummaryText(slices: TierSlice[]): string {
  const total = slices.reduce((s, x) => s + x.count, 0)
  if (total === 0) return '점수가 매겨진 영상이 없어요.'
  return `전체 ${total.toLocaleString('ko-KR')}개 중 ${slices.map((s) => `${s.label} ${s.count.toLocaleString('ko-KR')}개(${s.pct}%)`).join(', ')}`
}

// 순위 표 정렬. rows 는 서버가 점수 높은 순으로 내려준 목록이다(그 순서가 "점수 순위").
// score: 점수 높은 순(그대로) · weak: 점수 낮은 순 · views: 조회수 많은 순 · recent: 최근 올린 순. 동률은 점수 순위를 따른다(안정 정렬).
export type ScoreSortMode = 'score' | 'views' | 'recent' | 'weak'

export function sortScoreRows<T extends ScoreboardRow>(rows: readonly T[], sort: ScoreSortMode): T[] {
  const indexed = rows.map((row, i) => ({ row, i }))
  const time = (r: T) => {
    const t = Date.parse(r.video.published_at || r.video.created_at || '')
    return Number.isFinite(t) ? t : 0
  }
  const views = (r: T) => (isNum(r.video.view_count) ? r.video.view_count : 0)
  if (sort === 'weak') return indexed.sort((a, b) => b.i - a.i).map((x) => x.row)
  if (sort === 'views') return indexed.sort((a, b) => views(b.row) - views(a.row) || a.i - b.i).map((x) => x.row)
  if (sort === 'recent') return indexed.sort((a, b) => time(b.row) - time(a.row) || a.i - b.i).map((x) => x.row)
  return indexed.map((x) => x.row)
}
