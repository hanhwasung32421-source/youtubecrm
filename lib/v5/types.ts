// V5 도메인 타입 + 한글 라벨. 서버(API)와 클라이언트(페이지)가 함께 쓴다.

export type StaffUser = {
  id: string
  name: string
  role_type: string
}

// ---------------------------------------------------------------------------
// 공용으로 참조하는 실데이터 영상(youtubeCRM_videos) — 필요한 컬럼만.
// ---------------------------------------------------------------------------
export type VideoRef = {
  id: string
  title: string | null
  stock_name: string
  content_type: string
  published_at: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  youtube_url: string
  thumbnail_url: string | null
  primary_owner_user_id: string | null
  owner_name?: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// 2) 성장 실험 캔버스
// ---------------------------------------------------------------------------
export const EXPERIMENT_DIMENSIONS = ['title', 'thumbnail', 'publish_time', 'format', 'length'] as const
export type ExperimentDimension = (typeof EXPERIMENT_DIMENSIONS)[number]
export const EXPERIMENT_DIMENSION_LABEL: Record<ExperimentDimension, string> = {
  title: '제목',
  thumbnail: '썸네일',
  publish_time: '발행시간',
  format: '형식',
  length: '길이'
}

export const EXPERIMENT_STATUSES = ['running', 'won', 'lost', 'paused'] as const
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number]
export const EXPERIMENT_STATUS_LABEL: Record<ExperimentStatus, string> = {
  running: '진행중',
  won: '성공',
  lost: '실패',
  paused: '보류'
}
// 칸반에 그리는 순서
export const EXPERIMENT_STATUS_ORDER: ExperimentStatus[] = ['running', 'won', 'lost', 'paused']

export type GrowthExperiment = {
  id: string
  dimensions: ExperimentDimension[]
  video_ids: string[] | null
  hypothesis: string
  metric_definition: string
  started_on: string
  ended_on: string | null
  status: ExperimentStatus
  effect_size: number | null
  next_action: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // 서버에서 붙이는 값
  author_name?: string | null
  videos?: Array<{ id: string; title: string | null; stock_name: string }>
  // 지워졌거나 찾을 수 없는 대상 영상 수
  missing_videos?: number
  // 지금 로그인한 사람이 고치거나 지울 수 있는지(작성자 본인 또는 관리자)
  can_edit?: boolean
}

// ---------------------------------------------------------------------------
// 3) 알고리즘 친화도 스코어보드
// ---------------------------------------------------------------------------
export const SCORE_TIERS = ['excellent', 'good', 'fair', 'poor'] as const
export type ScoreTier = (typeof SCORE_TIERS)[number]
export const SCORE_TIER_LABEL: Record<ScoreTier, string> = {
  excellent: '매우 좋음',
  good: '좋음',
  fair: '보통',
  poor: '아쉬움'
}

export type ScoreboardRow = {
  video: VideoRef
  viewVelocityScore: number // 0-45: 팀 내 조회 속도(일평균 조회수) 백분위
  engagementScore: number // 0-35: 참여율((좋아요+댓글)/조회수) 백분위
  earlyGrowthScore: number // 0-20: 게시 후 초기 48시간 성장 여부(스냅샷 있으면 계산, 없으면 중립 10)
  totalScore: number // 0-100
  tier: ScoreTier
  hasSnapshotData: boolean
}

// ---------------------------------------------------------------------------
// 4) 발행 전략 플레이북
// ---------------------------------------------------------------------------
export type PlaybookEntry = {
  id: string
  title: string
  when_to_use: string
  example_video_id: string | null
  tags: string[]
  effect_note: string | null
  usage_count: number
  created_by: string | null
  created_at: string
  // 서버에서 붙이는 값
  author_name?: string | null
  example_video_title?: string | null
  can_edit?: boolean
}

// ---------------------------------------------------------------------------
// 5) 성장 회고 노트
// ---------------------------------------------------------------------------
export type RetroActionItem = { text: string; done: boolean }
export type RetroKpiSnapshot = {
  totalViews: number
  totalVideos: number
  avgViewsPerVideo: number
  // 아래는 2차 개선 이후 저장분부터 들어 있다(이전 회고에는 없을 수 있음).
  totalLikes?: number
  totalComments?: number
  weekStart?: string // 그 주 월요일(KST)
  weekEnd?: string // 그 주 일요일(KST)
  capturedAt?: string
  unsyncedVideos?: number // 조회수를 아직 못 가져온 영상 수
  truncated?: boolean // 영상이 너무 많아 일부만 집계했는지
}

export type WeeklyRetro = {
  id: string
  week_label: string
  went_well: string | null
  to_improve: string | null
  action_items: RetroActionItem[]
  kpi_snapshot: RetroKpiSnapshot
  created_by: string | null
  created_at: string
  author_name?: string | null
}
