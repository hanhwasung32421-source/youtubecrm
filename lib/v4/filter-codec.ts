// 화면의 필터 상태 ⇄ 주소(쿼리) 문자열을 서로 바꾸는 순수 함수 (React/브라우저 의존 없음).
// - 기본값과 같은 값은 주소에 쓰지 않는다 (링크가 짧고 깔끔하게).
// - 읽을 때는 모르는 값·범위 밖의 값을 조용히 기본값으로 되돌린다 (손으로 고친 주소가 화면을 깨지 않게).
// - encode(decode(x)) 는 항상 같은 문자열을 돌려준다.

export type FieldSpec<V> = {
  def: V
  parse: (raw: string) => V | undefined // 못 읽으면 undefined → 기본값
  format?: (value: V) => string
}

export type FilterSpec<F> = { [K in keyof F]: FieldSpec<F[K]> }

type Getter = (name: string) => string | null

export function defaultsOf<F>(spec: FilterSpec<F>): F {
  const out = {} as F
  for (const key of Object.keys(spec) as Array<keyof F>) out[key] = spec[key].def
  return out
}

export function decodeFilters<F>(spec: FilterSpec<F>, get: Getter): F {
  const out = {} as F
  for (const key of Object.keys(spec) as Array<keyof F>) {
    const field = spec[key]
    const raw = get(String(key))
    const parsed = raw === null ? undefined : field.parse(raw)
    out[key] = parsed === undefined ? field.def : parsed
  }
  return out
}

export function encodeFilters<F>(spec: FilterSpec<F>, filters: F): string {
  const parts: string[] = []
  for (const key of Object.keys(spec) as Array<keyof F>) {
    const field = spec[key]
    const value = filters[key]
    if (value === field.def) continue
    const text = field.format ? field.format(value) : String(value)
    parts.push(`${encodeURIComponent(String(key))}=${encodeURIComponent(text)}`)
  }
  return parts.join('&')
}

// 주소에 이 화면의 필터가 하나라도 들어 있는지 (있으면 저장된 값보다 주소를 우선한다)
export function hasSpecParams<F>(spec: FilterSpec<F>, get: Getter): boolean {
  return (Object.keys(spec) as Array<keyof F>).some((key) => get(String(key)) !== null)
}

export function sameFilters<F>(spec: FilterSpec<F>, a: F, b: F): boolean {
  return (Object.keys(spec) as Array<keyof F>).every((key) => a[key] === b[key])
}

// 문자열("a=1&b=2")에서 바로 읽기 (저장소에 넣어 둔 값을 되살릴 때)
export function decodeFromString<F>(spec: FilterSpec<F>, query: string): F {
  const params = new URLSearchParams(query)
  return decodeFilters(spec, (name) => params.get(name))
}

// ---------------------------------------------------------------- 필드 만들기 도우미

export function enumField<T extends string>(def: T, allowed: readonly T[]): FieldSpec<T> {
  return { def, parse: (raw) => (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined }
}

export function textField(max: number, def = ''): FieldSpec<string> {
  return { def, parse: (raw) => raw.trim().slice(0, max) }
}

// 사용자 id 처럼 글자·숫자·_·- 로만 된 값 (UUID 포함). 이상하면 무시.
export function idField(max = 64): FieldSpec<string> {
  return { def: '', parse: (raw) => (raw.length > 0 && raw.length <= max && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : undefined) }
}

// min~max 정수. "없음" 은 def(예: -1) 로 표현한다.
export function intField(def: number, min: number, max: number): FieldSpec<number> {
  return {
    def,
    parse: (raw) => {
      if (raw.trim() === '') return undefined
      const n = Number(raw)
      return Number.isInteger(n) && n >= min && n <= max ? n : undefined
    }
  }
}

export function numberChoiceField<T extends number>(def: T, allowed: readonly T[]): FieldSpec<T> {
  return {
    def,
    parse: (raw) => {
      if (raw.trim() === '') return undefined
      const n = Number(raw)
      return (allowed as readonly number[]).includes(n) ? (n as T) : undefined
    }
  }
}

// ---------------------------------------------------------------- 주소가 바뀌었을 때 "우리가 쓴 것인가?" 판단
// 필터를 바꾸면 우리가 router.replace 로 주소를 쓴다. 그 주소가 나중에 화면에 되돌아올 때(useSearchParams) 다시 필터로 읽어 버리면
// 빠르게 두 번 바꾼 사이에 앞선 값으로 되돌아가는 문제가 생긴다. 그래서 "방금 쓴 주소" 를 순서대로 기억해 두고 되돌아오면 무시한다.

export type UrlChange = { kind: 'own'; pending: string[] } | { kind: 'same'; pending: string[] } | { kind: 'external'; pending: string[] }

// urlQuery: 지금 주소(정리된 문자열) / pending: 우리가 쓰고 아직 되돌아오는 걸 못 본 값들(오래된 순) / believed: 주소가 지금 이 값이라고 우리가 믿는 것
export function classifyUrlChange(urlQuery: string, pending: string[], believed: string): UrlChange {
  const idx = pending.indexOf(urlQuery)
  if (idx >= 0) return { kind: 'own', pending: pending.slice(idx + 1) }
  if (urlQuery === believed) return { kind: 'same', pending }
  return { kind: 'external', pending }
}
