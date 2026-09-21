// 알고리즘 친화도 점수(0~100) 계산(순수 함수). 실데이터/샘플데이터 모두 같은 함수로 계산한다.
//
// 공식(가중치 합계 100점):
//  1) 조회 속도 점수  (0~45점) = 팀 내 "게시 후 일평균 조회수(view_count / max(경과일수,1))" 백분위 순위 × 45
//  2) 참여율 점수     (0~35점) = 팀 내 "참여율 (좋아요+댓글) / 조회수" 백분위 순위 × 35
//  3) 초기 성장 점수  (0~20점) = 게시 후 48시간 이내 스냅샷이 2개 이상 있으면
//                              "48시간 내 조회수 성장률" 백분위 순위 × 20,
//                              스냅샷이 부족해 판단할 수 없으면 중립값 10점(절반)을 준다.
// 총점 = 1)+2)+3), 구간: 80점 이상 우수 / 60점 이상 양호 / 40점 이상 보통 / 그 미만 저조.

import type { ScoreTier, ScoreboardRow, VideoRef } from '@/lib/v5/types'

export type SnapshotRow = {
  video_id: string
  snapshot_at: string
  view_count: number | null
  like_count: number | null
  comment_count: number | null
}

const EARLY_WINDOW_HOURS = 48

// value가 배열 내에서 차지하는 백분위(0~1). 동률은 평균 순위 처리.
// 정렬해 두고 이분 탐색으로 계산한다(영상 수천 개에서도 빠르도록). 결과는 전수 비교와 같다.
function makeRanker(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b)
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
    if (n <= 1) return 0.5
    const below = lowerBound(value)
    const equal = upperBound(value) - below
    return (below + equal / 2) / n
  }
}

export function scoreTierOf(totalScore: number): ScoreTier {
  if (totalScore >= 80) return 'excellent'
  if (totalScore >= 60) return 'good'
  if (totalScore >= 40) return 'fair'
  return 'poor'
}

function hoursBetween(a: string, b: string) {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 3_600_000
}

function earlyGrowthRate(video: VideoRef, snapshots: SnapshotRow[]): number | null {
  if (!video.published_at || snapshots.length < 2) return null
  const publishedAt = video.published_at
  const within = snapshots
    .filter((s) => s.view_count !== null && hoursBetween(publishedAt, s.snapshot_at) <= EARLY_WINDOW_HOURS)
    .sort((a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime())
  if (within.length < 2) return null
  const first = within[0].view_count || 0
  const last = within[within.length - 1].view_count || 0
  if (first <= 0) return last > 0 ? 1 : 0
  return (last - first) / first
}

export function computeScoreboard(videos: VideoRef[], snapshotsByVideoId: Map<string, SnapshotRow[]>): ScoreboardRow[] {
  const now = Date.now()
  const daysSincePublished = (v: VideoRef) => {
    if (!v.published_at) return 1
    const days = (now - new Date(v.published_at).getTime()) / 86_400_000
    return Math.max(days, 1)
  }

  const viewsPerDay = videos.map((v) => (v.view_count || 0) / daysSincePublished(v))
  const engagementRates = videos.map((v) => {
    const views = v.view_count || 0
    if (views <= 0) return 0
    return ((v.like_count || 0) + (v.comment_count || 0)) / views
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
    const earlyGrowthScore = hasSnapshotData
      ? Math.round(rankGrowth(growth as number) * 20)
      : 10
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
