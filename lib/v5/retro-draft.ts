// 주간 회고: 주 넘기기 · 그 주 숫자 모으기 · 자동 초안 만들기(순수 함수, 서버/브라우저 공용).
// 주는 ISO-8601(월~일), 날짜는 한국 시간(KST) 기준이다.

import { addDays, formatCount, isoWeekLabelFromYmd, isoWeekRangeText, isoWeekRangeYmd } from '@/lib/v5/format'

const WEEK_RE = /^\d{4}-W\d{2}$/
const MIN_YEAR = 2020
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export const isValidWeek = (label: string | null | undefined): label is string => Boolean(label && WEEK_RE.test(label) && isoWeekRangeYmd(label))

// 바로 앞 주 / 바로 다음 주 (해가 바뀌는 곳: 2026-W53 → 2027-W01 도 맞게). 잘못된 값이면 null.
export function shiftWeek(label: string, weeks: number): string | null {
  const range = isoWeekRangeYmd(label)
  if (!range) return null
  return isoWeekLabelFromYmd(addDays(range.start, weeks * 7)) || null
}

export const prevWeekLabel = (label: string) => shiftWeek(label, -1)
export const nextWeekLabel = (label: string) => shiftWeek(label, 1)

// 보고 있는 주를 안전한 값으로: 형식이 틀리거나 이번 주보다 미래면 이번 주로.
export function clampWeek(label: string | null | undefined, thisWeek: string): string {
  if (!isValidWeek(label)) return thisWeek
  return label > thisWeek ? thisWeek : label
}

export type WeekSwitch = {
  current: string
  prev: string | null
  // 이번 주보다 미래로는 넘길 수 없다(null = 버튼 비활성)
  next: string | null
  isThisWeek: boolean
}

export function weekSwitch(label: string, thisWeek: string): WeekSwitch {
  const current = clampWeek(label, thisWeek)
  const prev = prevWeekLabel(current)
  const nextRaw = nextWeekLabel(current)
  const next = nextRaw && nextRaw <= thisWeek ? nextRaw : null
  const prevOk = prev && Number(prev.slice(0, 4)) >= MIN_YEAR ? prev : null
  return { current, prev: prevOk, next, isThisWeek: current === thisWeek }
}

// "이번 주" / "지난주" / "9월 14일 ~ 9월 20일 주"
export function weekWord(label: string, thisWeek: string): string {
  if (label === thisWeek) return '이번 주'
  if (label === prevWeekLabel(thisWeek)) return '지난주'
  return `${isoWeekRangeText(label)} 주`
}

// ---------------------------------------------------------------------------
// 그 주 숫자
// ---------------------------------------------------------------------------
export type DraftVideo = {
  id: string
  title: string | null
  stock_name: string
  view_count: number | null
  created_at: string
  last_synced_at: string | null
  owner_name?: string | null
}

export type BestVideo = { id: string; title: string | null; stock_name: string; view_count: number; owner_name: string | null }

export type WeekStats = {
  videoCount: number
  totalViews: number
  // 조회수를 아직 못 가져온 영상 수
  unsynced: number
  best: BestVideo | null
}

export type RetroDraftData = {
  week: string
  weekStart: string
  weekEnd: string
  previousWeek: string
  current: WeekStats
  previous: WeekStats
  // 영상이 너무 많아 일부만 셌다
  truncated?: boolean
}

// 영상 목록(등록 시각 created_at)을 KST 날짜 구간(시작~끝, 양끝 포함)으로 걸러 그 주 숫자를 만든다.
export function weekStatsFromVideos(videos: readonly DraftVideo[], startYmd: string, endYmd: string): WeekStats {
  let videoCount = 0
  let totalViews = 0
  let unsynced = 0
  let best: DraftVideo | null = null
  for (const v of videos) {
    const t = Date.parse(v.created_at)
    if (!Number.isFinite(t)) continue
    // 한국(KST)은 일광절약시간이 없어서 +9시간만 더하면 한국 날짜가 된다(수천 개를 셀 때 Intl 을 매번 만들지 않는다)
    const ymd = new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10)
    if (ymd < startYmd || ymd > endYmd) continue
    videoCount += 1
    const views = Number(v.view_count) || 0
    totalViews += views
    if (!v.last_synced_at) unsynced += 1
    if (views > 0 && (!best || views > (Number(best.view_count) || 0))) best = v
  }
  return {
    videoCount,
    totalViews,
    unsynced,
    best: best ? { id: best.id, title: best.title, stock_name: best.stock_name, view_count: Number(best.view_count) || 0, owner_name: best.owner_name ?? null } : null
  }
}

// ---------------------------------------------------------------------------
// 자동 초안
// ---------------------------------------------------------------------------
export type RetroDraftText = { wentWell: string; toImprove: string; facts: string[] }

const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round((Math.abs(cur - prev) / prev) * 100) : null)

function compareCount(cur: number, prev: number, unit: string, prevWord: string): string {
  if (prev === 0 && cur === 0) return ''
  if (prev === 0) return `${prevWord}에는 없었어요`
  const diff = cur - prev
  if (diff === 0) return `${prevWord}와 같아요`
  return `${prevWord} 대비 ${Math.abs(diff).toLocaleString('ko-KR')}${unit} ${diff > 0 ? '늘었어요' : '줄었어요'}`
}

// wordThis: "이번 주" / "지난주" 등, wordPrev: 그 앞 주를 부르는 말("지난주" / "그 전 주")
export function buildRetroDraft(data: RetroDraftData, wordThis: string, wordPrev: string): RetroDraftText {
  const { current: cur, previous: prev } = data
  const facts: string[] = []
  const wentWell: string[] = []
  const toImprove: string[] = []

  if (cur.videoCount === 0) {
    facts.push(`${wordThis}에는 등록된 영상이 아직 없어요.`)
    return { wentWell: '', toImprove: '', facts }
  }

  const countCmp = compareCount(cur.videoCount, prev.videoCount, '개', wordPrev)
  facts.push(`${wordThis} 올린 영상 ${cur.videoCount.toLocaleString('ko-KR')}개${countCmp ? `, ${countCmp}` : ''}.`)

  const viewCmp = (() => {
    if (cur.unsynced > 0 && cur.unsynced >= cur.videoCount) return '' // 조회수를 거의 못 가져왔으면 비교하지 않는다
    if (prev.totalViews <= 0) return ''
    const p = pctChange(cur.totalViews, prev.totalViews)
    if (p === null) return ''
    if (cur.totalViews === prev.totalViews) return `${wordPrev}와 같아요`
    return `${wordPrev} 대비 ${p}% ${cur.totalViews > prev.totalViews ? '늘었어요' : '줄었어요'}`
  })()
  if (cur.totalViews > 0) facts.push(`조회수 합계 ${formatCount(cur.totalViews)}회${viewCmp ? `, ${viewCmp}` : ''}.`)

  if (cur.best) {
    const name = cur.best.title || cur.best.stock_name
    facts.push(`가장 잘 나간 영상: “${name}” (조회수 ${cur.best.view_count.toLocaleString('ko-KR')}회${cur.best.owner_name ? `, ${cur.best.owner_name}` : ''}).`)
  }

  wentWell.push(...facts)
  if (cur.best) wentWell.push('이 영상이 잘 된 이유: ')

  // 아쉬운 점은 숫자가 줄었을 때만 미리 적어 둔다.
  if (prev.videoCount > 0 && cur.videoCount < prev.videoCount) toImprove.push(`올린 영상이 ${wordPrev}보다 ${(prev.videoCount - cur.videoCount).toLocaleString('ko-KR')}개 줄었어요. 이유: `)
  if (prev.totalViews > 0 && cur.totalViews > 0 && cur.unsynced < cur.videoCount) {
    const p = pctChange(cur.totalViews, prev.totalViews)
    if (p !== null && cur.totalViews < prev.totalViews && p >= 10) toImprove.push(`조회수 합계가 ${wordPrev}보다 ${p}% 줄었어요. 이유: `)
  }
  if (cur.unsynced > 0) toImprove.push(`조회수를 아직 가져오지 못한 영상이 ${cur.unsynced.toLocaleString('ko-KR')}개 있어요. (점수판의 “유튜브에서 조회수 받기”)`)

  return { wentWell: wentWell.join('\n'), toImprove: toImprove.join('\n'), facts }
}

// ---------------------------------------------------------------------------
// 임시 저장(브라우저) 값 다루기
// ---------------------------------------------------------------------------
export type DraftValues = { wentWell: string; toImprove: string; actionItems: Array<{ text: string; done: boolean }>; actionDraft?: string }

export const RETRO_DRAFT_KEY_PREFIX = 'v5.retro.draft.v1.'
export const retroDraftKey = (week: string) => `${RETRO_DRAFT_KEY_PREFIX}${week}`

export function sameDraftValues(a: DraftValues, b: DraftValues): boolean {
  if (a.wentWell.trim() !== b.wentWell.trim()) return false
  if (a.toImprove.trim() !== b.toImprove.trim()) return false
  if ((a.actionDraft || '').trim() !== (b.actionDraft || '').trim()) return false
  if (a.actionItems.length !== b.actionItems.length) return false
  return a.actionItems.every((x, i) => x.text === b.actionItems[i].text && x.done === b.actionItems[i].done)
}

// 저장해 둔 글자(JSON)를 안전하게 풀어낸다. 모양이 이상하면 null.
export function parseStoredDraft(raw: string | null): { values: DraftValues; savedAt: number } | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return null
    const savedAt = typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : 0
    const items = Array.isArray(o.actionItems)
      ? o.actionItems
          .map((a: unknown) => (a && typeof a === 'object' ? { text: String((a as { text?: unknown }).text ?? '').trim(), done: Boolean((a as { done?: unknown }).done) } : null))
          .filter((a: { text: string; done: boolean } | null): a is { text: string; done: boolean } => Boolean(a && a.text))
          .slice(0, 20)
      : []
    return {
      savedAt,
      values: {
        wentWell: typeof o.wentWell === 'string' ? o.wentWell.slice(0, 2000) : '',
        toImprove: typeof o.toImprove === 'string' ? o.toImprove.slice(0, 2000) : '',
        actionItems: items,
        actionDraft: typeof o.actionDraft === 'string' ? o.actionDraft.slice(0, 300) : ''
      }
    }
  } catch {
    return null
  }
}

export function serializeDraft(values: DraftValues, savedAt: number): string {
  return JSON.stringify({ v: 1, savedAt, wentWell: values.wentWell, toImprove: values.toImprove, actionItems: values.actionItems, actionDraft: values.actionDraft || '' })
}
