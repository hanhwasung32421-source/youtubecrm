// "그래서 다음에 뭘 하면 되지?"를 계산하는 순수 함수 모음 (화면·서버 없이 단독으로 시험할 수 있다).
//  - 영상마다 고칠 점을 영향이 큰 순서로 늘어놓고, 가장 먼저 할 일 한 가지를 쉬운 말로 알려 준다.
//  - "고쳤어요" 표시는 기존 SEO 체크리스트 칸(seo-checklists)에 저장하므로, 칸이 대응되는 항목만 완료 처리할 수 있다.
//  - 유튜브 스튜디오 수정 주소와 성과 요약의 "다음 할 일" 링크도 여기서 만든다.
// (이 파일은 타입만 가져온다: import type 은 실행할 때 사라진다.)
import type { OptimizationRow, SeoChecklistField } from './types'

export type FixKey = 'title-missing' | 'no-stock' | 'thumb-low' | 'thumb-missing' | 'no-desc' | 'title-long'

export type Fix = {
  key: FixKey
  /** 검색에 미치는 영향의 크기 (클수록 먼저) */
  weight: number
  /** 심각한 문제(빨강)인지, 주의(노랑)인지 */
  bad: boolean
  /** 무엇이 문제인지 */
  problem: string
  /** 무엇을 하면 되는지 (쉬운 말 한 문장) */
  action: string
  /** "고쳤어요" 가 저장되는 체크리스트 칸. 없으면 유튜브에서 고친 뒤 정보가 새로 반영될 때 저절로 사라진다. */
  field: SeoChecklistField | null
  /** 이미 "고쳤어요" 로 표시했는가 */
  done: boolean
}

export const TITLE_MAX = 60

// 영향이 큰 순: 종목명 > 제목 없음 > 썸네일이 낮음 > 설명란 > 썸네일 평가 없음 > 제목 길이
export const FIX_WEIGHTS: Record<FixKey, number> = {
  'no-stock': 50,
  'title-missing': 40,
  'thumb-low': 35,
  'no-desc': 25,
  'thumb-missing': 20,
  'title-long': 15
}

// 이 영상의 고칠 점 전부 (영향이 큰 순). 문제가 없으면 빈 목록.
export function fixesOf(row: OptimizationRow): Fix[] {
  const list: Fix[] = []
  const stock = (row.video.stock_name || '').trim()
  const checked = (field: SeoChecklistField) => Boolean(row.checklist && row.checklist[field])

  if (row.titleLength === 0) {
    list.push({
      key: 'title-missing',
      weight: FIX_WEIGHTS['title-missing'],
      bad: true,
      problem: '제목을 아직 못 가져왔어요',
      action: '유튜브 주소가 맞는지 확인하고, 영상 제목이 비어 있지 않은지 살펴보기',
      field: null,
      done: false
    })
  } else if (!row.titleLengthOk) {
    const over = Math.max(1, row.titleLength - TITLE_MAX)
    list.push({
      key: 'title-long',
      weight: FIX_WEIGHTS['title-long'],
      bad: false,
      problem: `제목이 너무 길어요 (${row.titleLength}자, ${TITLE_MAX}자 이내 권장)`,
      action: `제목을 ${over}자 이상 줄여서 ${TITLE_MAX}자 안으로 만들기`,
      field: null,
      done: false
    })
  }

  if (!row.titleHasStock) {
    list.push({
      key: 'no-stock',
      weight: FIX_WEIGHTS['no-stock'],
      bad: true,
      problem: '제목에 종목명이 없어요',
      action: stock ? `제목 앞에 '${stock}' 넣기` : '제목 앞에 종목명 넣기',
      field: 'title_has_stock',
      done: checked('title_has_stock')
    })
  }

  if (!row.hasDescription) {
    list.push({
      key: 'no-desc',
      weight: FIX_WEIGHTS['no-desc'],
      bad: false,
      problem: '설명란이 비어 있어요',
      action: '설명란에 내용 요약과 시간대별 목차(예: 00:00 인트로) 쓰기',
      field: 'description_timestamps',
      done: checked('description_timestamps')
    })
  }

  if (!row.latestReview) {
    list.push({
      key: 'thumb-missing',
      weight: FIX_WEIGHTS['thumb-missing'],
      bad: false,
      problem: '썸네일 평가를 아직 안 했어요',
      action: '썸네일 글자가 잘 보이는지 확인하고, 아래에서 별점 남기기',
      field: 'thumbnail_text_checked',
      done: checked('thumbnail_text_checked')
    })
  } else if (row.latestReview.rating < 3) {
    list.push({
      key: 'thumb-low',
      weight: FIX_WEIGHTS['thumb-low'],
      bad: false,
      problem: `썸네일 평가가 낮아요 (${row.latestReview.rating}점)`,
      action: '썸네일 글자를 더 크게, 배경과 색 대비를 높여 다시 만들기',
      field: 'thumbnail_text_checked',
      done: checked('thumbnail_text_checked')
    })
  }

  return list.sort((a, b) => b.weight - a.weight)
}

export const remainingFixes = (row: OptimizationRow): Fix[] => fixesOf(row).filter((f) => !f.done)

// 아직 남은 고칠 점의 영향 합계 (정렬 기준)
export function impactOf(row: OptimizationRow): number {
  return remainingFixes(row).reduce((sum, f) => sum + f.weight, 0)
}

export type WorkState = 'ok' | 'todo' | 'done'

// ok = 처음부터 문제 없음, todo = 남은 고칠 점이 있음, done = 문제가 있었지만 전부 "고쳤어요" 처리됨
export function workStateOf(row: OptimizationRow): WorkState {
  const all = fixesOf(row)
  if (all.length === 0) return 'ok'
  return all.some((f) => !f.done) ? 'todo' : 'done'
}

// 가장 먼저 할 일 한 가지 (없으면 null)
export function nextActionOf(row: OptimizationRow): Fix | null {
  return remainingFixes(row)[0] ?? null
}

export type SortKey = 'impact' | 'views' | 'recent'

function viewsOf(row: OptimizationRow): number {
  const v = row.video.view_count
  return typeof v === 'number' && Number.isFinite(v) ? v : -1
}

function timeOf(row: OptimizationRow): number {
  const t = new Date(row.video.published_at || row.video.created_at).getTime()
  return Number.isNaN(t) ? 0 : t
}

// 영향 큰 순 → (같으면) 조회수 많은 순 → 최근 순. 원본은 바꾸지 않는다.
export function sortRows(rows: readonly OptimizationRow[], key: SortKey): OptimizationRow[] {
  const impact = new Map(rows.map((r) => [r, impactOf(r)] as const))
  const byImpact = (a: OptimizationRow, b: OptimizationRow) => (impact.get(b) ?? 0) - (impact.get(a) ?? 0)
  const byViews = (a: OptimizationRow, b: OptimizationRow) => viewsOf(b) - viewsOf(a)
  const byTime = (a: OptimizationRow, b: OptimizationRow) => timeOf(b) - timeOf(a)
  const order =
    key === 'views'
      ? [byViews, byImpact, byTime]
      : key === 'recent'
        ? [byTime, byImpact, byViews]
        : [byImpact, byViews, byTime]
  return [...rows].sort((a, b) => {
    for (const cmp of order) {
      const d = cmp(a, b)
      if (d !== 0) return d
    }
    return 0
  })
}

// 진행 상황: 고칠 점이 있던 영상 중 전부 끝낸 영상 수
export function progressOf(rows: readonly OptimizationRow[]): { total: number; done: number } {
  let total = 0
  let done = 0
  for (const row of rows) {
    const state = workStateOf(row)
    if (state === 'ok') continue
    total += 1
    if (state === 'done') done += 1
  }
  return { total, done }
}

// ---- 유튜브 스튜디오 ----
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

// 영상 주소에서 유튜브 영상 ID(11자)를 뽑는다. 알아볼 수 없으면 null.
export function youtubeIdFromUrl(input: string | null | undefined): string | null {
  const text = (input || '').trim()
  if (!text) return null
  if (VIDEO_ID.test(text)) return text
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  let candidate: string | null = null
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidate = url.pathname.split('/')[1] || null
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'watch') candidate = url.searchParams.get('v')
    else if (['shorts', 'live', 'embed', 'v'].includes(parts[0] || '')) candidate = parts[1] || null
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null
}

// 유튜브 스튜디오의 "영상 수정" 화면 주소. 영상 ID 를 알 수 없으면 null.
export function studioEditUrl(youtubeUrl: string | null | undefined): string | null {
  const id = youtubeIdFromUrl(youtubeUrl)
  return id ? `https://studio.youtube.com/video/${id}/edit` : null
}

// ---- 성과 요약의 "다음 할 일" ----
export type ActionTone = 'bad' | 'warn' | 'good'
export type NextLink = { key: string; tone: ActionTone; text: string; href: string; label: string }

export type ReportActionInput = {
  /** 반응 점수가 낮은(손봐야 할) 영상 수 */
  lowCount: number
  /** 검색 점검을 한 칸도 못 한 영상 수 */
  uncheckedCount: number
  /** 보는 기간에 등록·발행된 영상 수 */
  periodCount: number
  /** 담당자 필터 (없으면 '') */
  staff?: string
  /** 형식 필터 longform | shortform (없으면 '') */
  format?: string
  /** 기간 이름 (예: '최근 7일') */
  periodLabel: string
}

function link(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) query.set(k, v)
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export function reportActions(input: ReportActionInput): NextLink[] {
  const staff = input.staff || ''
  const format = input.format || ''
  const out: NextLink[] = []
  if (input.periodCount === 0) {
    out.push({
      key: 'no-videos',
      tone: 'warn',
      text: `${input.periodLabel} 등록된 영상이 없어요. 업로드 계획을 확인하고 새 영상을 올려 보세요.`,
      href: '/v2/planner',
      label: '업로드 계획 보기'
    })
    return out
  }
  if (input.lowCount > 0) {
    out.push({
      key: 'low',
      tone: 'bad',
      text: `반응 점수가 낮은 영상이 ${input.lowCount.toLocaleString('ko-KR')}개예요. 제목·설명·썸네일부터 고쳐 보세요.`,
      href: link('/v2/optimization', { view: 'todo', staff, format }),
      label: '영상 점검에서 고치기'
    })
  }
  if (input.uncheckedCount > 0) {
    out.push({
      key: 'unchecked',
      tone: 'warn',
      text: `검색 점검을 한 칸도 못 한 영상이 ${input.uncheckedCount.toLocaleString('ko-KR')}개예요.`,
      href: link('/v2/optimization', { view: 'todo', staff, format }),
      label: '점검하러 가기'
    })
  }
  if (out.length === 0) {
    out.push({
      key: 'good',
      tone: 'good',
      text: `${input.periodLabel} 영상은 모두 반응이 괜찮아요. 잘 된 영상의 제목 방식을 다음 영상에도 써 보세요.`,
      href: '/v2/keywords',
      label: '다음 키워드 고르기'
    })
  }
  return out.slice(0, 3)
}
