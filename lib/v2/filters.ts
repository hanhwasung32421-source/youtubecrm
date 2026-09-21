// 화면 필터 ⇄ 주소(?period=30&staff=…) 변환. 순수 계산이라 브라우저 없이 시험할 수 있다.
//  - 주소가 가장 우선이다. 주소에 필터가 하나라도 있으면 그것만 쓰고(공유한 링크가 그대로 열리도록),
//    없을 때만 마지막에 저장해 둔 값을 쓴다.
//  - 기본값과 같은 값은 주소에서 뺀다 (주소가 짧고 깔끔하게).
//  - 허용 목록(allowed)이나 형식(pattern)에 맞지 않는 값은 기본값으로 돌린다.

export type FilterField = {
  default: string
  /** 이 중 하나만 허용 (빈 글자도 목록에 넣어야 허용된다) */
  allowed?: readonly string[]
  /** 글자로 자유 입력하는 값의 형식 */
  pattern?: RegExp
  /** 최대 글자 수 (기본 60) */
  max?: number
  /** true 면 링크로 넘겨받을 때만 쓰고, '마지막에 고른 필터'로는 기억하지 않는다 (예: 종목·영상 하나·특정 주) */
  transient?: boolean
}
export type FilterSpec = Record<string, FilterField>
export type Filters<S extends FilterSpec> = { [K in keyof S]: string }
export type ParamReader = { get(name: string): string | null }

// 제어 문자(0~31, 127). 글자로 소스에 쓰지 않으려고 문자 코드로 만든다.
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g')

export function cleanFilterValue(field: FilterField, raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return field.default
  const value = raw.replace(CONTROL_CHARS, '').trim().slice(0, field.max ?? 60)
  if (field.allowed) return field.allowed.includes(value) ? value : field.default
  if (field.pattern) return field.pattern.test(value) ? value : field.default
  return value
}

export function defaultFilters<S extends FilterSpec>(spec: S): Filters<S> {
  const out = {} as Filters<S>
  for (const key of Object.keys(spec) as (keyof S & string)[]) out[key] = spec[key].default
  return out
}

export function parseFilters<S extends FilterSpec>(spec: S, params: ParamReader): Filters<S> {
  const out = {} as Filters<S>
  for (const key of Object.keys(spec) as (keyof S & string)[]) out[key] = cleanFilterValue(spec[key], params.get(key))
  return out
}

// 주소에 이 화면의 필터가 하나라도 들어 있는지
export function hasKnownParam<S extends FilterSpec>(spec: S, params: ParamReader): boolean {
  return Object.keys(spec).some((key) => params.get(key) !== null)
}

// 기본값이 아닌 것만 'a=b&c=d' 로 (앞의 ? 는 붙이지 않는다). 순서는 spec 순서로 고정.
// persistOnly 를 켜면 transient 필터는 뺀다 (브라우저에 기억해 둘 값을 만들 때).
export function serializeFilters<S extends FilterSpec>(spec: S, state: Filters<S>, options: { persistOnly?: boolean } = {}): string {
  const query = new URLSearchParams()
  for (const key of Object.keys(spec) as (keyof S & string)[]) {
    if (options.persistOnly && spec[key].transient) continue
    const value = cleanFilterValue(spec[key], state[key])
    if (value !== spec[key].default) query.set(key, value)
  }
  return query.toString()
}

// 기본값과 다른(=켜져 있는) 필터의 이름들
export function activeFilterKeys<S extends FilterSpec>(spec: S, state: Filters<S>): (keyof S & string)[] {
  return (Object.keys(spec) as (keyof S & string)[]).filter((key) => cleanFilterValue(spec[key], state[key]) !== spec[key].default)
}

// 주소 → 저장값 → 기본값 순서로 필터를 정한다.
export function resolveFilters<S extends FilterSpec>(
  spec: S,
  params: ParamReader,
  saved: string | null
): { state: Filters<S>; source: 'url' | 'saved' | 'default' } {
  if (hasKnownParam(spec, params)) return { state: parseFilters(spec, params), source: 'url' }
  if (saved) {
    const state = parseFilters(spec, new URLSearchParams(saved))
    // 저장값에 끼어든 transient 값은 무시한다.
    for (const key of Object.keys(spec) as (keyof S & string)[]) if (spec[key].transient) state[key] = spec[key].default
    if (serializeFilters(spec, state) !== '') return { state, source: 'saved' }
  }
  return { state: defaultFilters(spec), source: 'default' }
}

// 경로 + 값이 있는 것만 붙인 주소. 예: withQuery('/v2/optimization', { view: 'todo', staff: '' }) → /v2/optimization?view=todo
export function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}
