// swr.ts 의 순수 부분: 메모리 캐시 + 같은 주소 요청 합치기 + 필요 없어진 요청 취소.
// (React 나 네트워크를 직접 부르지 않아 단독으로 시험할 수 있다.)

export const SKIP_MS = 4_000 // 방금(4초 안에) 받은 값이면 다시 요청하지 않는다.
export const FRESH_MS = 60_000 // 1분 안의 값은 "신선": 표시 없이 조용히 새로 고친다.
export const MAX_AGE_MS = 10 * 60_000 // 10분이 지난 값은 버리고 처음처럼 그린다.
const MAX_ENTRIES = 40

export type Entry = { data: unknown; at: number }
export type Outcome = { ok: boolean; status: number; data: unknown; error: string; aborted: boolean }
export type Runner = (controller: AbortController, bypass: boolean) => Promise<Outcome>

type Shared = { promise: Promise<Outcome>; controller: AbortController; subs: number; bypass: boolean }

const cache = new Map<string, Entry>()
// 이 화면에서 직접 고친 주소: 다음 조회는 브라우저 캐시(최대 15초)를 건너뛴다.
export const dirty = new Set<string>()
const inflight = new Map<string, Shared>()

export const ABORTED: Outcome = { ok: false, status: 0, data: {}, error: '', aborted: true }

export function peek(key: string, now: number = Date.now()): Entry | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (now - entry.at > MAX_AGE_MS) {
    cache.delete(key)
    return undefined
  }
  return entry
}

export function store(key: string, data: unknown, at?: number) {
  const prev = cache.get(key)
  cache.delete(key) // 가장 최근 것이 뒤로 가도록
  cache.set(key, { data, at: at ?? prev?.at ?? Date.now() })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function invalidate(match?: string) {
  for (const key of [...cache.keys()]) if (!match || key.includes(match)) cache.delete(key)
}

export function cacheSize() {
  return cache.size
}

export function inflightCount() {
  return inflight.size
}

// 같은 키를 이미 받는 중이면 그 요청에 합류한다. 모든 구독자가 떠나면 요청을 취소한다.
export function subscribe(key: string, bypass: boolean, runner: Runner): { promise: Promise<Outcome>; cancel: () => void } {
  let shared = inflight.get(key)
  if (!shared || (bypass && !shared.bypass)) {
    const controller = new AbortController()
    const created: Shared = { controller, subs: 0, bypass, promise: Promise.resolve(ABORTED) }
    created.promise = runner(controller, bypass).finally(() => {
      if (inflight.get(key) === created) inflight.delete(key)
    })
    inflight.set(key, created)
    shared = created
  }
  const mine = shared
  mine.subs += 1
  let cancelled = false
  return {
    promise: mine.promise,
    cancel: () => {
      if (cancelled) return
      cancelled = true
      mine.subs -= 1
      // 같은 순간에 다시 구독하는 경우(개발 모드의 이중 실행 등)를 위해 한 박자 뒤에 확인한다.
      void Promise.resolve().then(() => {
        if (mine.subs > 0) return
        mine.controller.abort()
        if (inflight.get(key) === mine) inflight.delete(key)
      })
    }
  }
}
