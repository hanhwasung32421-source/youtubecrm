// 알고리즘 친화도 점수(0~100) 계산(순수 함수). 실데이터/샘플데이터 모두 같은 함수로 계산한다.
//
// 공식(가중치 합계 100점):
//  1) 조회 속도 점수  (0~45점) = 팀 내 "게시 후 일평균 조회수(view_count / max(경과일수,1))" 백분위 순위 × 45
//  2) 참여율 점수     (0~35점) = 팀 내 "참여율 (좋아요+댓글) / 조회수" 백분위 순위 × 35
//  3) 초기 성장 점수  (0~20점) = 게시 후 48시간 이내 스냅샷이 2개 이상 있으면
//                              "48시간 내 조회수 성장률" 백분위 순위 × 20,
//                              스냅샷이 부족해 판단할 수 없으면 중립값 10점(절반)을 준다.
// 총점 = 1)+2)+3), 구간: 80점 이상 우수 / 60점 이상 양호 / 40점 이상 보통 / 그 미만 저조.
// 숫자가 아닌 값(NaN/Infinity)이 섞여 있어도 점수가 NaN 이 되지 않는다(해당 항목은 중립 처리).

import type { ScoreTier, ScoreboardRow, VideoRef } from '@/lib/v5/types'

export type SnapshotRow = {
  video_id: string
  snapshot_at: string
  view_count: number | null
  like_count?: number | null
  comment_count?: number | null
}

export const EARLY_WINDOW_HOURS = 48
const HOUR_MS = 3_600_000
// 초기 성장 항목을 기록이 없을 때의 중립 점수
export const EARLY_NEUTRAL_SCORE = 10

// 초기 성장 점수를 낼 수 있는 영상인가? 스냅샷은 영상을 등록한 뒤에야 쌓이므로,
// 올린 지 48시간이 훨씬 지나서 등록한 영상은 48시간 안 스냅샷이 있을 수 없다(항상 중립 10점).
// 그런 영상은 스냅샷을 아예 조회하지 않아도 결과가 같다 → 서버가 조회량을 크게 줄일 수 있다.
export function isEarlyGrowthCandidate(publishedAt: string | null | undefined, createdAt: string | null | undefined): boolean {
  if (!publishedAt) return false
  const published = Date.parse(publishedAt)
  if (!Number.isFinite(published)) return false
  const created = createdAt ? Date.parse(createdAt) : NaN
  if (!Number.isFinite(created)) return true
  return published + EARLY_WINDOW_HOURS * HOUR_MS + HOUR_MS >= created
}

const finiteOr = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

// value가 배열 내에서 차지하는 백분위(0~1). 동률은 평균 순위 처리.
// 정렬해 두고 이분 탐색으로 계산한다(영상 수천 개에서도 빠르도록). 결과는 전수 비교와 같다.
export function makeRanker(values: number[]) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  const n = sorted.length
  const lowerBound = (x: number) => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < x) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const upperBound = (x: number) => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] <= x) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  return (value: number) => {
    if (n <= 1 || !Number.isFinite(value)) return 0.5
    const below = lowerBound(value)
    const equal = upperBound(value) - below
    return (below + equal / 2) / n
  }
}

export function scoreTierOf(totalScore: number): ScoreTier {
  if (!Number.isFinite(totalScore)) return 'poor'
  if (totalScore >= 80) return 'excellent'
  if (totalScore >= 60) return 'good'
  if (totalScore >= 40) return 'fair'
  return 'poor'
}

function hoursBetween(a: string, b: string) {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / HOUR_MS
}

export function earlyGrowthRate(video: Pick<VideoRef, 'published_at'>, snapshots: SnapshotRow[]): number | null {
  if (!video.published_at || snapshots.length < 2) return null
  const publishedAt = video.published_at
  const within = snapshots
    .filter((s) => s.view_count !== null && Number.isFinite(Number(s.view_count)) && hoursBetween(publishedAt, s.snapshot_at) <= EARLY_WINDOW_HOURS)
    .sort((a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime())
  if (within.length < 2) return null
  const first = finiteOr(within[0].view_count, 0)
  const last = finiteOr(within[within.length - 1].view_count, 0)
  if (first <= 0) return last > 0 ? 1 : 0
  const rate = (last - first) / first
  return Number.isFinite(rate) ? rate : null
}

export function computeScoreboard(videos: VideoRef[], snapshotsByVideoId: Map<string, SnapshotRow[]>): ScoreboardRow[] {
  const now = Date.now()
  const daysSincePublished = (v: VideoRef) => {
    if (!v.published_at) return 1
    const days = (now - new Date(v.published_at).getTime()) / 86_400_000
    return Number.isFinite(days) ? Math.max(days, 1) : 1
  }

  const viewsPerDay = videos.map((v) => finiteOr(v.view_count, 0) / daysSincePublished(v))
  const engagementRates = videos.map((v) => {
    const views = finiteOr(v.view_count, 0)
    if (views <= 0) return 0
    return (finiteOr(v.like_count, 0) + finiteOr(v.comment_count, 0)) / views
  })
  const earlyGrowthRates = videos.map((v) => earlyGrowthRate(v, snapshotsByVideoId.get(v.id) || []))
  const knownGrowthRates = earlyGrowthRates.filter((r): r is number => r !== null)

  const rankVelocity = makeRanker(viewsPerDay)
  const rankEngagement = makeRanker(engagementRates)
  const rankGrowth = makeRanker(knownGrowthRates)

  return videos.map((video, i) => {
    const viewVelocityScore = Math.round(rankVelocity(viewsPerDay[i]) * 45)
    const engagementScore = Math.round(rankEngagement(engagementRates[i]) * 35)
    const growth = earlyGrowthRates[i]
    const hasSnapshotData = growth !== null
    const earlyGrowthScore = hasSnapshotData ? Math.round(rankGrowth(growth as number) * 20) : EARLY_NEUTRAL_SCORE
    const totalScore = Math.min(viewVelocityScore + engagementScore + earlyGrowthScore, 100)
    return {
      video,
      viewVelocityScore,
      engagementScore,
      earlyGrowthScore,
      totalScore,
      tier: scoreTierOf(totalScore),
      hasSnapshotData
    }
  })
}
