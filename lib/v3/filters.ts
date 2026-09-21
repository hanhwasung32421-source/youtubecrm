// V3 분석 화면의 "필터" 규칙(기간·직원·형식·정렬·검색)을 주소(URL)와 브라우저 저장소로 오가게 하는 순수 함수 모음.
//   - 주소에는 기본값과 다른 것만 적는다. (?format=longform&sort=views)
//   - 주소에 필터가 하나도 없으면 마지막에 쓰던 필터(저장소)를 쓴다. 주소에 하나라도 있으면 주소가 이긴다.
//   - 저장하지 않는 값(persist:false: 검색어·선택한 영상)은 주소에만 남는다.
//   - 잘못된 값(직접 고친 주소, 옛 저장값)은 조용히 기본값으로 바꾼다. (외부 import 없음)

export type FilterDef = {
  def: string
  // 허용하는 값 목록(있으면 이 안의 값만 통과)
  values?: readonly string[]
  // 값 모양 검사(예: UUID)
  pattern?: RegExp
  // 글자 수 제한(검색어 등 자유 입력)
  max?: number
  // false 면 브라우저 저장소에 기억하지 않는다(기본 true)
  persist?: boolean
  // false 면 "적용 중인 필터" 칩에 보이지 않는다(기본 true)
  chip?: boolean
}

export type FilterSpec = Record<string, FilterDef>
export type Filters = Record<string, string>
export type Getter = (key: string) => string | null | undefined

export const FILTERS_STORAGE_VERSION = 1
export const FILTERS_STORAGE_PREFIX = 'v3:filters:'

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ownKeys = (spec: FilterSpec) => Object.keys(spec)
const isPersisted = (def: FilterDef) => def.persist !== false
const showsChip = (def: FilterDef) => def.chip !== false

export function sanitizeValue(def: FilterDef, raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return def.def
  let value = String(raw)
  if (def.max !== undefined) value = value.trim().slice(0, def.max)
  if (def.values) return def.values.includes(value) ? value : def.def
  if (def.pattern) return def.pattern.test(value) ? value : def.def
  return value
}

export function defaultFilters(spec: FilterSpec): Filters {
  const out: Filters = {}
  for (const key of ownKeys(spec)) out[key] = spec[key].def
  return out
}

// 주소에 "기억되는 필터"가 하나라도 적혀 있는지
export function hasPersistedKey(spec: FilterSpec, get: Getter): boolean {
  return ownKeys(spec).some((key) => isPersisted(spec[key]) && get(key) !== null && get(key) !== undefined)
}

export function parseFilters(spec: FilterSpec, get: Getter): Filters {
  const out: Filters = {}
  for (const key of ownKeys(spec)) out[key] = sanitizeValue(spec[key], get(key))
  return out
}

// 주소 + 저장된 값 -> 화면이 쓸 필터
export function resolveFilters(spec: FilterSpec, get: Getter, saved: Filters | null): Filters {
  const fromUrl = parseFilters(spec, get)
  if (hasPersistedKey(spec, get) || !saved) return fromUrl
  const out: Filters = { ...fromUrl }
  for (const key of ownKeys(spec)) {
    if (isPersisted(spec[key])) out[key] = sanitizeValue(spec[key], saved[key])
  }
  return out
}

// 주소 뒤에 붙일 글자("a=1&b=2", 맨 앞 ? 없음). all=true 면 기본값도 모두 적는다(공유 링크용).
export function serializeFilters(spec: FilterSpec, filters: Filters, opts: { all?: boolean } = {}): string {
  const q = new URLSearchParams()
  for (const key of ownKeys(spec)) {
    const def = spec[key]
    const value = sanitizeValue(def, filters[key])
    if (value === '') continue
    if (!opts.all && value === def.def) continue
    q.set(key, value)
  }
  return q.toString()
}

export function filtersEqual(spec: FilterSpec, a: Filters, b: Filters): boolean {
  return ownKeys(spec).every((key) => sanitizeValue(spec[key], a[key]) === sanitizeValue(spec[key], b[key]))
}

export function storageKey(pageKey: string): string {
  return `${FILTERS_STORAGE_PREFIX}v${FILTERS_STORAGE_VERSION}:${pageKey}`
}

// 저장할 글자(기억할 필터만)
export function encodeSaved(spec: FilterSpec, filters: Filters): string {
  const f: Filters = {}
  for (const key of ownKeys(spec)) {
    if (isPersisted(spec[key])) f[key] = sanitizeValue(spec[key], filters[key])
  }
  return JSON.stringify({ v: FILTERS_STORAGE_VERSION, f })
}

// 저장된 글자 -> 필터. 버전이 다르거나 깨졌으면 null(= 저장된 게 없는 것처럼)
export function decodeSaved(spec: FilterSpec, raw: string | null | undefined): Filters | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; f?: unknown }
    if (!parsed || parsed.v !== FILTERS_STORAGE_VERSION || !parsed.f || typeof parsed.f !== 'object') return null
    const stored = parsed.f as Record<string, unknown>
    const out = defaultFilters(spec)
    for (const key of ownKeys(spec)) {
      if (isPersisted(spec[key]) && typeof stored[key] === 'string') out[key] = sanitizeValue(spec[key], stored[key] as string)
    }
    return out
  } catch {
    return null
  }
}

export type FilterChip = { key: string; value: string; label: string }

// "적용 중인 필터" 칩. 기본값과 다른 것만 보여 준다. labelFor 가 사람이 읽는 이름을 돌려준다.
export function activeChips(spec: FilterSpec, filters: Filters, labelFor: (key: string, value: string) => string): FilterChip[] {
  const chips: FilterChip[] = []
  for (const key of ownKeys(spec)) {
    const def = spec[key]
    if (!showsChip(def)) continue
    const value = sanitizeValue(def, filters[key])
    if (value === def.def) continue
    chips.push({ key, value, label: labelFor(key, value) })
  }
  return chips
}

// 초기화할 때 되돌릴 값들(칩으로 보이는 필터만. 선택한 영상 같은 것은 그대로 둔다)
export function resetPatch(spec: FilterSpec): Filters {
  const out: Filters = {}
  for (const key of ownKeys(spec)) {
    if (showsChip(spec[key])) out[key] = spec[key].def
  }
  return out
}

// ── 화면별 규칙 ────────────────────────────────────────────────
const FORMAT_VALUES = ['all', 'longform', 'shortform'] as const
const STAFF: FilterDef = { def: '', pattern: UUID_PATTERN }
const FORMAT: FilterDef = { def: 'all', values: FORMAT_VALUES }

export const ENGAGEMENT_FILTERS = {
  staff: STAFF,
  period: { def: 'all', values: ['all', '7', '30', '90'] },
  format: FORMAT,
  sort: { def: 'comment', values: ['comment', 'engagement', 'views', 'recent'] }
} satisfies FilterSpec

export const VIRAL_FILTERS = {
  staff: STAFF,
  period: { def: '30', values: ['7', '14', '30'] },
  format: FORMAT,
  sort: { def: 'ratio', values: ['ratio', 'views', 'recent'] }
} satisfies FilterSpec

export const LIFECYCLE_FILTERS = {
  staff: STAFF,
  format: FORMAT,
  sort: { def: 'recent', values: ['recent', 'views', 'records'] },
  q: { def: '', max: 60, persist: false },
  video: { def: '', pattern: UUID_PATTERN, persist: false, chip: false }
} satisfies FilterSpec

export const SERIES_FILTERS = {
  staff: STAFF,
  period: { def: 'all', values: ['all', '7', '30', '90'] },
  sort: { def: 'recent', values: ['recent', 'effect', 'videos'] },
  q: { def: '', max: 60, persist: false }
} satisfies FilterSpec

export const FILTER_FIELD_LABELS: Record<string, string> = {
  staff: '직원',
  period: '기간',
  format: '형식',
  sort: '정렬',
  q: '검색'
}

const PERIOD_LABELS: Record<string, string> = { all: '전체 기간', '7': '최근 7일', '14': '최근 14일', '30': '최근 30일', '90': '최근 90일' }
const FORMAT_LABELS: Record<string, string> = { all: '롱폼·숏폼 모두', longform: '롱폼', shortform: '숏폼' }

export const FILTER_VALUE_LABELS: Record<string, Record<string, Record<string, string>>> = {
  engagement: {
    period: PERIOD_LABELS,
    format: FORMAT_LABELS,
    sort: { comment: '댓글 반응이 높은 순', engagement: '전체 반응이 높은 순', views: '조회수 많은 순', recent: '최근 등록 순' }
  },
  viral: {
    period: PERIOD_LABELS,
    format: FORMAT_LABELS,
    sort: { ratio: '많이 빠른 순', views: '조회수 많은 순', recent: '최근 올린 순' }
  },
  lifecycle: {
    format: FORMAT_LABELS,
    sort: { recent: '최근 등록 순', views: '조회수 많은 순', records: '기록 많은 순' }
  },
  series: {
    period: PERIOD_LABELS,
    sort: { recent: '최근 만든 순', effect: '효과 큰 순', videos: '영상 많은 순' }
  }
}

// 칩에 쓸 이름 "형식: 롱폼". staff 는 직원 이름을 아는 화면이 넘겨준다.
export function chipLabel(page: string, key: string, value: string, staffName?: (id: string) => string | null): string {
  const field = FILTER_FIELD_LABELS[key] || key
  if (key === 'staff') return `${field}: ${staffName?.(value) || '선택한 직원'}`
  if (key === 'q') return `${field}: “${value}”`
  const label = FILTER_VALUE_LABELS[page]?.[key]?.[value] || value
  return `${field}: ${label}`
}

// <select> 에 넣을 선택지. 순서는 규칙(values)에 적힌 순서를 따른다.
// (객체 키 순서에 기대면 '7','30' 같은 숫자 키가 'all' 보다 앞으로 와 버린다)
export function optionsFor(page: string, spec: FilterSpec, key: string): { value: string; label: string }[] {
  const values = spec[key]?.values || []
  const labels = FILTER_VALUE_LABELS[page]?.[key] || {}
  return values.map((value) => ({ value, label: labels[value] || value }))
}

// 우리가 주소에 적은 값들의 대기열. 주소가 바뀌어 돌아오면 "우리가 한 것"이므로 무시하고,
// 그 앞에 적었다가 건너뛰어진 값들도 함께 치운다. 대기열에 없는 값이면 밖에서(뒤로 가기·링크) 바뀐 것이다.
export function consumeWritten(queue: string[], current: string): { matched: boolean; rest: string[] } {
  const hit = queue.indexOf(current)
  if (hit < 0) return { matched: false, rest: queue }
  return { matched: true, rest: queue.slice(hit + 1) }
}
