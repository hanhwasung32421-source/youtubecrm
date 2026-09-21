// SQL(supabase/sql/v2/100_v2_seo.sql)을 아직 실행하지 않았을 때 API가 돌려주는 샘플.
// 실제 운영과 비슷한 종목/직원/시각으로 채워 화면 구성과 흐름을 미리 볼 수 있게 한다.
import { addDays, kstIsoAt, kstYmd, lastNDays, weekStartMonday } from './dates'
import { computeDiscoverability, computeTimingHint } from './server'
import {
  type ContentType,
  type DiscoverabilityRow,
  type KeywordRadarItem,
  type KeywordsPayload,
  type OptimizationPayload,
  type OptimizationRow,
  type PlannedSlot,
  type PlannerPayload,
  type Priority,
  type RecentStock,
  type ReportPayload,
  type SeoChecklist,
  type SeoChecklistsPayload,
  type StaffLite,
  type ThumbnailReview,
  type VideoLite
} from './types'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const SAMPLE_STAFF: StaffLite[] = [
  { id: uid(1), name: '김민준', roleType: 'staff' },
  { id: uid(2), name: '이서연', roleType: 'senior_staff' },
  { id: uid(3), name: '박지훈', roleType: 'staff' },
  { id: uid(4), name: '최수아', roleType: 'assistant_manager' },
  { id: uid(5), name: '정도윤', roleType: 'staff' },
  { id: uid(6), name: '강하은', roleType: 'manager' }
]

function at(ymd: string, hh: number, mm = 0): string {
  return kstIsoAt(ymd, hh, mm)
}

type VideoSeed = [
  n: number,
  title: string,
  hasDesc: boolean,
  stock: string,
  staffIndex: number,
  type: ContentType,
  dayOffset: number,
  hour: number,
  views: number,
  likes: number,
  comments: number
]

const VIDEO_SEEDS: VideoSeed[] = [
  [601, '삼성전자 실적 발표 총정리 — HBM4 양산 일정과 외국인 수급', true, '삼성전자', 0, 'longform', -1, 8, 18400, 612, 88],
  [602, 'SK하이닉스 목표주가 상향, 지금 사도 될까', true, 'SK하이닉스', 1, 'shortform', -1, 11, 9200, 340, 40],
  [603, '에코프로 전망 — 리튬 가격 반등은 진짜인가', false, '에코프로', 2, 'longform', -2, 16, 4100, 96, 15],
  [604, '오늘의 시장 브리핑', false, 'LS머트리얼즈', 3, 'shortform', -2, 10, 1200, 22, 3],
  [605, '현대차 관세 협상 이후 자동차주 반응 완전 분석 그리고 앞으로의 전략까지 총정리', true, '현대차', 0, 'longform', -3, 13, 7600, 210, 34],
  [606, '한미반도체 급등 이유 — TC본더 수주 해설', true, '한미반도체', 4, 'longform', -3, 15, 26800, 980, 152],
  [607, '알테오젠 매수 타이밍일까', false, '알테오젠', 5, 'shortform', -4, 9, 5400, 140, 19],
  [608, '삼성전자 오늘 주가 분석', true, '삼성전자', 0, 'shortform', -4, 7, 15200, 505, 61],
  [609, 'SK하이닉스 실적 프리뷰와 반도체 업황 점검', true, 'SK하이닉스', 1, 'longform', -5, 12, 3300, 55, 9],
  [610, '에코프로 급등 이유', false, '에코프로', 2, 'shortform', -6, 17, 2100, 34, 5]
]

const SAMPLE_CHECKLIST_STATE: Record<number, [boolean, boolean, boolean, boolean]> = {
  601: [true, true, true, true],
  602: [true, true, false, true],
  603: [false, false, false, false],
  604: [false, false, false, false],
  605: [true, false, true, false],
  606: [true, true, true, true],
  607: [false, false, false, true],
  608: [true, true, false, true],
  609: [false, false, false, false],
  610: [false, false, false, false]
}

export function sampleVideos(now = new Date()): VideoLite[] {
  const today = kstYmd(now)
  return VIDEO_SEEDS.map(([n, title, hasDesc, stock, staffIndex, type, dayOffset, hour, views, likes, comments]) => {
    const staff = SAMPLE_STAFF[staffIndex]
    const publishedAt = at(addDays(today, dayOffset), hour)
    return {
      id: uid(n),
      title,
      description: hasDesc ? `${stock} 관련 이슈 정리와 차트 분석, 참고 링크와 타임스탬프를 포함합니다.\n00:00 인트로\n00:30 핵심 요약` : null,
      stock_name: stock,
      content_type: type,
      youtube_url: `https://www.youtube.com/watch?v=sample${n}`,
      thumbnail_url: null,
      published_at: publishedAt,
      duration_seconds: type === 'longform' ? 620 : 58,
      view_count: views,
      like_count: likes,
      comment_count: comments,
      primary_owner_user_id: staff.id,
      owner_name: staff.name,
      created_at: publishedAt,
      last_synced_at: at(today, 9)
    }
  })
}

export function sampleChecklistMap(): Map<string, SeoChecklist> {
  const map = new Map<string, SeoChecklist>()
  for (const [n, [titleHasStock, thumb, desc, tags]] of Object.entries(SAMPLE_CHECKLIST_STATE)) {
    const videoId = uid(Number(n))
    map.set(videoId, {
      video_id: videoId,
      title_has_stock: titleHasStock,
      thumbnail_text_checked: thumb,
      description_timestamps: desc,
      tags_5plus: tags,
      updated_at: new Date().toISOString()
    })
  }
  return map
}

export function sampleSeoChecklistsPayload(videoIds: string[]): SeoChecklistsPayload {
  const map = sampleChecklistMap()
  const items = videoIds.map((id) => map.get(id) || { video_id: id, title_has_stock: false, thumbnail_text_checked: false, description_timestamps: false, tags_5plus: false, updated_at: new Date().toISOString() })
  return { items, sample: true }
}

const SAMPLE_REVIEWS: Record<number, { rating: number; note: string }> = {
  601: { rating: 5, note: '썸네일 대비 강함, 클릭률 좋음' },
  602: { rating: 4, note: '숫자 강조 굵게' },
  606: { rating: 5, note: '급등 키워드 반응 좋음' },
  608: { rating: 3, note: '텍스트가 다소 작음' }
}

export function sampleReviewMap(): Map<string, ThumbnailReview> {
  const map = new Map<string, ThumbnailReview>()
  for (const [n, { rating, note }] of Object.entries(SAMPLE_REVIEWS)) {
    const videoId = uid(Number(n))
    map.set(videoId, { id: uid(2000 + Number(n)), video_id: videoId, rating, note, reviewed_by: SAMPLE_STAFF[0].id, reviewed_by_name: SAMPLE_STAFF[0].name, created_at: new Date().toISOString() })
  }
  return map
}

export function sampleOptimizationPayload(): OptimizationPayload {
  const videos = sampleVideos()
  const checklistMap = sampleChecklistMap()
  const reviewMap = sampleReviewMap()
  const items: OptimizationRow[] = videos.map((video) => {
    const titleLength = (video.title || '').length
    const titleLengthOk = titleLength > 0 && titleLength <= 60
    const titleHasStock = Boolean(video.title && video.title.includes(video.stock_name))
    const hasDescription = Boolean(video.description && video.description.trim().length > 0)
    const checklist = checklistMap.get(video.id) || { video_id: video.id, title_has_stock: false, thumbnail_text_checked: false, description_timestamps: false, tags_5plus: false, updated_at: video.created_at }
    const latestReview = reviewMap.get(video.id) || null
    let improvementScore = 0
    if (!titleLengthOk) improvementScore += 1
    if (!titleHasStock) improvementScore += 1
    if (!hasDescription) improvementScore += 1
    if (!latestReview || latestReview.rating < 3) improvementScore += 1
    return { video, titleLength, titleLengthOk, titleHasStock, hasDescription, checklist, latestReview, improvementScore }
  })
  items.sort((a, b) => b.improvementScore - a.improvementScore)
  return { items, sample: true }
}

export function sampleRecentStocks(now = new Date()): RecentStock[] {
  const today = kstYmd(now)
  return [
    { stock_name: '삼성전자', count: 3, last_at: at(today, 8) },
    { stock_name: 'SK하이닉스', count: 2, last_at: at(addDays(today, -1), 11) },
    { stock_name: '한미반도체', count: 1, last_at: at(addDays(today, -3), 15) },
    { stock_name: '에코프로', count: 2, last_at: at(addDays(today, -2), 16) }
  ]
}

const KEYWORD_SEEDS: [number, string, string, string | null, Priority, KeywordRadarItem['status'], number, number, number][] = [
  [701, '삼성전자', '삼성전자 파운드리 수주', 'https://news.example.com/samsung-foundry', 'high', 'waiting', 0, 0, 9],
  [702, '에코프로', '에코프로 리튬 가격', 'https://news.example.com/lithium', 'normal', 'in_progress', 2, -1, 14],
  [703, 'LS머트리얼즈', '전력기기 데이터센터 수요', null, 'normal', 'waiting', 0, 0, 10],
  [704, '한미반도체', 'TC본더 신규 수주', 'https://dart.fss.or.kr', 'high', 'done', 4, -2, 9],
  [705, '현대차', '관세 협상 시나리오', null, 'low', 'waiting', 0, -1, 17]
]

export function sampleKeywordsPayload(now = new Date()): KeywordsPayload {
  const today = kstYmd(now)
  const items: KeywordRadarItem[] = KEYWORD_SEEDS.map(([n, stock, keyword, url, priority, status, staffIndex, dayOffset, hour]) => ({
    id: uid(n),
    stock_name: stock,
    keyword,
    source_url: url,
    priority,
    status,
    created_by: SAMPLE_STAFF[staffIndex].id,
    created_by_name: SAMPLE_STAFF[staffIndex].name,
    created_at: at(addDays(today, dayOffset), hour),
    updated_at: at(addDays(today, dayOffset), hour)
  }))
  return { items, recentStocks: sampleRecentStocks(now), sample: true }
}

export function samplePlannerPayload(weekStartYmd?: string): PlannerPayload {
  const weekStart = weekStartYmd || weekStartMonday(kstYmd())
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const staff = SAMPLE_STAFF
  const planned: PlannerPayload['planned'] = {}
  const actual: PlannerPayload['actual'] = {}
  const plannedHours = [9, 11, 14, 16, 19]
  staff.forEach((s, staffIndex) => {
    planned[s.id] = {}
    actual[s.id] = {}
    days.forEach((day, dayIndex) => {
      const slotCount = ((staffIndex + dayIndex) % 3) + 1
      planned[s.id][day] = Array.from({ length: slotCount }, (_, i) => ({
        id: uid(3000 + staffIndex * 10 + dayIndex * 2 + i),
        staff_user_id: s.id,
        planned_date: day,
        planned_hour: plannedHours[(staffIndex + i) % plannedHours.length],
        note: null,
        created_at: at(day, 8)
      }))
      actual[s.id][day] = Math.max(0, slotCount - ((staffIndex + dayIndex) % 2))
    })
  })
  const timingHint = computeTimingHint(sampleVideos())
  return { weekStart, days, staff, planned, actual, timingHint, sample: true }
}

export function sampleReportPayload(): ReportPayload {
  const videos = sampleVideos()
  const checklistMap = sampleChecklistMap()
  const items: DiscoverabilityRow[] = videos
    .map((video) => {
      const checklist = checklistMap.get(video.id)
      const metrics = computeDiscoverability(video, checklist)
      return { video, ownerName: video.owner_name || '-', ...metrics }
    })
    .sort((a, b) => b.score - a.score)
  const top = items[0]
  const insight = top
    ? `이번 주 반응이 가장 좋은 영상은 ${top.ownerName}님의 「${top.video.title}」 — 하루 평균 ${Math.round(top.viewsPerDay).toLocaleString('ko-KR')}회 조회, 반응 점수 ${top.score}점입니다.`
    : '표시할 영상이 없습니다.'
  return { items, insight, sample: true }
}
