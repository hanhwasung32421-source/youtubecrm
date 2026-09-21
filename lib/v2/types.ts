// V2 (SEO·발견성 최적화) 공용 타입/상수. 서버(API)와 클라이언트(페이지)가 함께 쓴다.

export const CONTENT_TYPES = ['longform', 'shortform'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  longform: '롱폼',
  shortform: '숏폼'
}

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: '낮음',
  normal: '보통',
  high: '높음'
}

export const KEYWORD_STATUSES = ['waiting', 'in_progress', 'done'] as const
export type KeywordStatus = (typeof KEYWORD_STATUSES)[number]
export const KEYWORD_STATUS_LABELS: Record<KeywordStatus, string> = {
  waiting: '대기',
  in_progress: '작업중',
  done: '완료'
}

export type StaffLite = {
  id: string
  name: string
  roleType?: string
}

// ---- 등록 영상 (실 테이블 youtubeCRM_videos 를 읽어서 쓰는 형태) ----
export type VideoLite = {
  id: string
  title: string | null
  description: string | null
  stock_name: string
  content_type: ContentType
  youtube_url: string | null
  thumbnail_url: string | null
  published_at: string | null
  duration_seconds: number | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  primary_owner_user_id: string
  owner_name?: string | null
  created_at: string
  last_synced_at: string | null
}

// ---- SEO 체크리스트 (youtubeCRM_seo_checklists) ----
export type SeoChecklist = {
  video_id: string
  title_has_stock: boolean
  thumbnail_text_checked: boolean
  description_timestamps: boolean
  tags_5plus: boolean
  updated_at: string
}

export const SEO_CHECKLIST_FIELDS = ['title_has_stock', 'thumbnail_text_checked', 'description_timestamps', 'tags_5plus'] as const
export type SeoChecklistField = (typeof SEO_CHECKLIST_FIELDS)[number]

export const SEO_CHECKLIST_LABELS: Record<SeoChecklistField, string> = {
  title_has_stock: '제목에 종목명 포함',
  thumbnail_text_checked: '썸네일 텍스트 대비 확인',
  description_timestamps: '설명란에 타임스탬프',
  tags_5plus: '태그 5개 이상'
}

export function emptyChecklist(videoId: string): SeoChecklist {
  return {
    video_id: videoId,
    title_has_stock: false,
    thumbnail_text_checked: false,
    description_timestamps: false,
    tags_5plus: false,
    updated_at: new Date().toISOString()
  }
}

export function checklistDoneCount(checklist: SeoChecklist | null | undefined): number {
  if (!checklist) return 0
  return SEO_CHECKLIST_FIELDS.reduce((n, field) => n + (checklist[field] ? 1 : 0), 0)
}

// ---- 썸네일 클릭률 자가평가 (youtubeCRM_thumbnail_reviews) ----
export type ThumbnailReview = {
  id: string
  video_id: string
  rating: number
  note: string | null
  reviewed_by: string | null
  reviewed_by_name?: string | null
  created_at: string
}

// ---- 키워드·트렌드 레이더 (youtubeCRM_keyword_radar) ----
export type KeywordRadarItem = {
  id: string
  stock_name: string
  keyword: string
  source_url: string | null
  priority: Priority
  status: KeywordStatus
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type RecentStock = {
  stock_name: string
  count: number
  last_at: string
}

// ---- 발행 모멘텀 플래너 (youtubeCRM_planned_slots) ----
export type PlannedSlot = {
  id: string
  staff_user_id: string
  planned_date: string
  planned_hour: number
  note: string | null
  created_at: string
}

// 요일·시간대 하나의 성과 (추천 시간의 근거로 보여준다)
export type TimingSlot = {
  weekday: number
  hour: number
  avgViews: number // 그 시간대에 올린 영상의 평균 조회수
  avgViewsPerDay: number // 올린 뒤 하루당 평균 조회수 (오래된 영상과 새 영상을 공평하게 비교)
  sampleSize: number // 그 시간대에 올린 영상 수
}

export type TimingHint = {
  weekday: number | null
  hour: number | null
  avgViews: number
  sampleSize: number
  // ---- 라운드 4에서 더한 근거 값 (모두 선택: 옛 응답에도 화면이 그대로 동작) ----
  avgViewsPerDay?: number
  windowDays?: number // 며칠 치 영상을 봤는지 (예: 30)
  totalVideos?: number // 그 기간 전체 영상 수 (조회수를 아는 것만)
  overallAvgViews?: number // 그 기간 전체 평균 조회수
  overallAvgViewsPerDay?: number
  runnerUps?: TimingSlot[] // 그다음으로 좋았던 시간대
}

// ---- 제목·썸네일 최적화 스코어카드 ----
export type OptimizationRow = {
  video: VideoLite
  titleLength: number
  titleLengthOk: boolean
  titleHasStock: boolean
  hasDescription: boolean
  checklist: SeoChecklist
  latestReview: ThumbnailReview | null
  improvementScore: number // 0~4, 높을수록 개선 필요
}

// 고칠 곳 개수(0~4). 서버 정렬과 화면의 즉시 갱신이 같은 계산을 쓰도록 한 곳에 둔다.
export function improvementScoreOf(row: Pick<OptimizationRow, 'titleLengthOk' | 'titleHasStock' | 'hasDescription' | 'latestReview'>): number {
  let score = 0
  if (!row.titleLengthOk) score += 1
  if (!row.titleHasStock) score += 1
  if (!row.hasDescription) score += 1
  if (!row.latestReview || row.latestReview.rating < 3) score += 1
  return score
}

// ---- 검색 성과 리포트 ----
export type DiscoverabilityRow = {
  video: VideoLite
  ownerName: string
  viewsPerDay: number
  viewVelocityScore: number
  likeRateScore: number
  checklistScore: number
  score: number
  checklistDone: number
}

// ---- 응답 payload 타입 ----
export type SeoChecklistsPayload = { items: SeoChecklist[]; sample?: boolean; error?: string }
export type OptimizationPayload = { items: OptimizationRow[]; capped?: boolean; sample?: boolean; error?: string }
export type KeywordsPayload = {
  items: KeywordRadarItem[]
  recentStocks: RecentStock[]
  doneTotal?: number
  // 종목별로 지금까지 등록된 영상 수 (키워드 → 그 종목 영상 보기 링크의 근거). 옛 응답에는 없다.
  videoCounts?: Record<string, number>
  sample?: boolean
  error?: string
}
export type PlannerPayload = {
  weekStart: string
  days: string[]
  staff: StaffLite[]
  planned: Record<string, Record<string, PlannedSlot[]>> // staffId -> ymd -> slots
  actual: Record<string, Record<string, number>> // staffId -> ymd -> count
  timingHint: TimingHint
  sample?: boolean
  error?: string
}
export type ReportPayload = {
  items: DiscoverabilityRow[]
  insight: string
  capped?: boolean
  sample?: boolean
  error?: string
}

// ---- 공용 /api/videos/mine 응답 항목 (등록 직후 "내 등록 영상" 목록에 사용) ----
export type MineVideoItem = {
  id: string
  title: string | null
  stock_name: string
  content_type: ContentType
  published_at: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  youtube_url: string | null
  created_at: string
}

export type MineVideosPayload = {
  items: MineVideoItem[]
  pagination: { page: number; pageSize: number; totalCount: number }
  error?: string
}

// ---- 발견성 점수(Discoverability Score) 가중치/기준값 ----
// 40% 조회 속도(발행 후 하루 평균 조회수) + 30% 좋아요율 + 30% SEO 체크리스트 완료율.
// 목표값은 소규모 종목 분석 채널 벤치마크로 잡은 임의 기준(운영하며 조정 가능).
// 클라이언트 컴포넌트에서도 안전하게 import 할 수 있도록 서버 전용 코드가 없는 이 파일에 둔다.
export const VIEW_VELOCITY_TARGET_PER_DAY = 300
export const LIKE_RATE_TARGET = 0.05

// ---- 제목 키워드 템플릿 (정적 파생, 외부 API 없음) ----
export function titleKeywordSuggestions(stockName: string): string[] {
  const name = stockName.trim()
  if (!name) return []
  return [`${name} 실적`, `${name} 목표주가`, `${name} 전망`, `${name} 급등 이유`, `${name} 매수 타이밍`, `${name} 오늘 주가 분석`]
}
