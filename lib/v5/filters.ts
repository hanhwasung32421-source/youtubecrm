// 화면 필터 ⇄ 주소(쿼리) 변환(순수 함수). 주소로 공유해도, 브라우저에 기억해 둬도 같은 값이 되돌아오도록
// "필터 → 글자 목록 → 필터" 왕복이 항상 같은 결과를 내게 만든다. 기본값은 주소에서 생략한다.

import { isoWeekRangeYmd } from '@/lib/v5/format'
import { EXPERIMENT_STATUSES, type ExperimentStatus } from '@/lib/v5/types'

export type QueryLike = { get(name: string): string | null }
export type QueryRecord = Record<string, string>

export type FilterSpec<T> = {
  // 이 화면 필터가 쓰는 주소 이름들(이 밖의 주소 값은 건드리지 않는다)
  keys: readonly string[]
  defaults: T
  parse: (q: QueryLike) => T
  // 기본값과 다른 것만 담는다
  serialize: (f: T) => QueryRecord
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEK_RE = /^\d{4}-W\d{2}$/

export const recordToQuery = (rec: QueryRecord): QueryLike => ({ get: (name) => (Object.prototype.hasOwnProperty.call(rec, name) ? rec[name] : null) })

export function hasAnyKey(spec: { keys: readonly string[] }, q: QueryLike): boolean {
  return spec.keys.some((k) => q.get(k) !== null)
}

// 필터가 기본값과 같은가(= 주소에 아무것도 안 남는가)
export function isDefaultFilters<T>(spec: FilterSpec<T>, f: T): boolean {
  return Object.keys(spec.serialize(f)).length === 0
}

// 비교용 글자(같은 필터면 항상 같은 글자)
export function filterSignature<T>(spec: FilterSpec<T>, f: T): string {
  const rec = spec.serialize(f)
  return Object.keys(rec)
    .sort()
    .map((k) => `${k}=${rec[k]}`)
    .join('&')
}

// 브라우저에 저장해 둔 값(직렬화한 글자 모음)을 되살린다. 모양이 이상하면 null.
export function filtersFromStored<T>(spec: FilterSpec<T>, raw: unknown): T | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec: QueryRecord = {}
  for (const k of spec.keys) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'string') rec[k] = v
  }
  return spec.parse(recordToQuery(rec))
}

// 지금 주소 글자('a=1&b=2')에서 이 화면 필터 자리만 새 값으로 바꾼 주소 글자를 만든다.
// remove 에 넣은 이름(한 번만 쓰는 new/video 같은 것)은 지운다. 다른 값은 그대로 둔다.
export function mergeQuery(current: string, keys: readonly string[], serialized: QueryRecord, remove: readonly string[] = []): string {
  const params = new URLSearchParams(current)
  for (const k of keys) params.delete(k)
  for (const k of remove) params.delete(k)
  for (const k of Object.keys(serialized)) params.set(k, serialized[k])
  return params.toString()
}

const pickOwner = (v: string | null) => (v && UUID_RE.test(v) ? v.toLowerCase() : '')

// ---------------------------------------------------------------------------
// 영상 점수판: 기간 · 담당자 · 정렬
// ---------------------------------------------------------------------------
export type ScorePeriod = 7 | 30 | 90
export const SCORE_SORTS = ['score', 'views', 'recent', 'weak'] as const
export type ScoreSort = (typeof SCORE_SORTS)[number]
export const SCORE_SORT_LABEL: Record<ScoreSort, string> = {
  score: '점수 높은 순',
  views: '조회수 많은 순',
  recent: '최근 올린 순',
  weak: '점수 낮은 순'
}
export type ScoreFilters = { days: ScorePeriod; owner: string; sort: ScoreSort }

export const SCORE_SPEC: FilterSpec<ScoreFilters> = {
  keys: ['days', 'owner', 'sort'],
  defaults: { days: 30, owner: '', sort: 'score' },
  parse(q) {
    const days = Number(q.get('days'))
    const sort = q.get('sort')
    return {
      days: days === 7 || days === 90 ? days : 30,
      owner: pickOwner(q.get('owner')),
      sort: (SCORE_SORTS as readonly string[]).includes(sort || '') ? (sort as ScoreSort) : 'score'
    }
  },
  serialize(f) {
    const out: QueryRecord = {}
    if (f.days !== 30) out.days = String(f.days)
    if (f.owner) out.owner = f.owner
    if (f.sort !== 'score') out.sort = f.sort
    return out
  }
}

// ---------------------------------------------------------------------------
// 성장 실험: 상태 · 만든 사람
// ---------------------------------------------------------------------------
export type CanvasStatusFilter = 'all' | ExperimentStatus
export type CanvasFilters = { status: CanvasStatusFilter; author: string }

export const CANVAS_SPEC: FilterSpec<CanvasFilters> = {
  keys: ['status', 'author'],
  defaults: { status: 'all', author: '' },
  parse(q) {
    const status = q.get('status') || ''
    return {
      status: (EXPERIMENT_STATUSES as readonly string[]).includes(status) ? (status as ExperimentStatus) : 'all',
      author: pickOwner(q.get('author'))
    }
  },
  serialize(f) {
    const out: QueryRecord = {}
    if (f.status !== 'all') out.status = f.status
    if (f.author) out.author = f.author
    return out
  }
}

// ---------------------------------------------------------------------------
// 성공 공식: 검색어 · 태그 · 정렬
// ---------------------------------------------------------------------------
export type PlaybookSort = 'usage' | 'recent'
export type PlaybookFilters = { q: string; tags: string[]; sort: PlaybookSort }
const MAX_TAG_FILTERS = 5

export const PLAYBOOK_SPEC: FilterSpec<PlaybookFilters> = {
  keys: ['q', 'tags', 'sort'],
  defaults: { q: '', tags: [], sort: 'usage' },
  parse(q) {
    const seen = new Set<string>()
    const tags: string[] = []
    for (const raw of (q.get('tags') || '').split(',')) {
      const t = raw.trim().slice(0, 30)
      if (!t || seen.has(t.toLowerCase())) continue
      seen.add(t.toLowerCase())
      tags.push(t)
      if (tags.length >= MAX_TAG_FILTERS) break
    }
    return { q: (q.get('q') || '').trim().slice(0, 60), tags, sort: q.get('sort') === 'recent' ? 'recent' : 'usage' }
  },
  serialize(f) {
    const out: QueryRecord = {}
    const query = f.q.trim().slice(0, 60)
    if (query) out.q = query
    if (f.tags.length > 0) out.tags = f.tags.join(',')
    if (f.sort !== 'usage') out.sort = f.sort
    return out
  }
}

// ---------------------------------------------------------------------------
// 주간 회고: 보고 있는 주(빈 값 = 이번 주)
// ---------------------------------------------------------------------------
export type RetroFilters = { week: string }

export const RETRO_SPEC: FilterSpec<RetroFilters> = {
  keys: ['week'],
  defaults: { week: '' },
  parse(q) {
    const week = q.get('week') || ''
    return { week: WEEK_RE.test(week) && isoWeekRangeYmd(week) ? week : '' }
  },
  serialize(f) {
    const out: QueryRecord = {}
    if (f.week) out.week = f.week
    return out
  }
}
