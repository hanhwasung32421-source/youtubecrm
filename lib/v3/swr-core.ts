// 화면용 아주 작은 "먼저 보여 주고 뒤에서 새로 받기" 저장소. (React/네트워크 의존성 없음 — 그래서 따로 테스트할 수 있다)
//   - 주소(키)마다 마지막 응답을 메모리에 잠깐(기본 60초) 들고 있는다.
//   - 같은 주소를 동시에 두 번 요청하면 실제 요청은 한 번만 보낸다(dedupe).
//   - 요청을 기다리던 화면이 모두 사라지면(필터 변경·화면 이동) 실제 요청도 취소한다.

export type CacheHit<T> = { data: T; at: number; age: number; fresh: boolean }

export function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

type Inflight = { promise: Promise<unknown>; controller: AbortController; refs: number }

export function createSwrCore(
  opts: { now?: () => number; maxAgeMs?: number; freshMs?: number; maxEntries?: number; dirtyMs?: number } = {}
) {
  const now = opts.now || (() => Date.now())
  const maxAgeMs = opts.maxAgeMs ?? 60_000
  const freshMs = opts.freshMs ?? 3_000
  const maxEntries = opts.maxEntries ?? 60
  const dirtyMs = opts.dirtyMs ?? 70_000

  const store = new Map<string, { data: unknown; at: number }>()
  const inflight = new Map<string, Inflight>()
  const dirty = new Map<string, number>()

  // 저장된 값이 너무 오래됐으면 버리고 null. maxAge 안이면 값과 나이를 돌려준다(fresh=바로 다시 받을 필요 없음).
  function peek<T>(key: string): CacheHit<T> | null {
    const entry = store.get(key)
    if (!entry) return null
    const age = now() - entry.at
    if (age > maxAgeMs || age < 0) {
      store.delete(key)
      return null
    }
    return { data: entry.data as T, at: entry.at, age, fresh: age < freshMs }
  }

  function set(key: string, data: unknown) {
    store.delete(key) // 넣은 순서 = 오래된 순서로 유지
    store.set(key, { data, at: now() })
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value
      if (oldest === undefined) break
      store.delete(oldest)
    }
  }

  // 저장/수정/삭제 뒤에 옛 값이 다시 나타나지 않게 한다. prefix 로 시작하는 키를 지운다.
  // (브라우저 HTTP 캐시도 한동안 건너뛰도록 dirty 표시를 남긴다)
  function invalidate(prefix: string) {
    for (const key of Array.from(store.keys())) {
      if (key.includes(prefix)) store.delete(key)
    }
    dirty.set(prefix, now())
  }

  // 저장된 값은 두고(화면에서 이미 고쳐 둔 값일 때), 다음 요청만 서버에서 새로 받게 한다.
  function markDirty(prefix: string) {
    dirty.set(prefix, now())
  }

  // 이 주소는 최근 저장 작업의 영향을 받았나? (그렇다면 요청할 때 브라우저 캐시를 건너뛴다)
  function isDirty(url: string): boolean {
    const t = now()
    for (const [prefix, at] of Array.from(dirty.entries())) {
      if (t - at > dirtyMs) {
        dirty.delete(prefix)
        continue
      }
      if (url.includes(prefix)) return true
    }
    return false
  }

  function clear() {
    store.clear()
    dirty.clear()
    for (const f of inflight.values()) f.controller.abort()
    inflight.clear()
  }

  // 같은 key 로 요청 중인 것이 있으면 그 결과를 함께 받는다. 호출한 쪽이 signal 로 그만두면 그 쪽만 AbortError 로 끝나고,
  // 기다리는 사람이 아무도 없게 되면 실제 요청도 취소된다.
  function request<R>(key: string, fetcher: (signal: AbortSignal) => Promise<R>, signal?: AbortSignal): Promise<R> {
    let entry = inflight.get(key)
    if (!entry) {
      const controller = new AbortController()
      const created: Inflight = { promise: Promise.resolve(), controller, refs: 0 }
      created.promise = fetcher(controller.signal).finally(() => {
        if (inflight.get(key) === created) inflight.delete(key)
      })
      inflight.set(key, created)
      entry = created
    }
    const shared = entry
    shared.refs += 1

    return new Promise<R>((resolve, reject) => {
      let settled = false
      const finish = () => {
        settled = true
        signal?.removeEventListener('abort', onAbort)
        shared.refs -= 1
      }
      const onAbort = () => {
        if (settled) return
        finish()
        if (shared.refs <= 0) {
          shared.controller.abort()
          if (inflight.get(key) === shared) inflight.delete(key)
        }
        reject(abortError())
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort)
      ;(shared.promise as Promise<R>).then(
        (value) => {
          if (settled) return
          finish()
          resolve(value)
        },
        (error) => {
          if (settled) return
          finish()
          reject(error)
        }
      )
    })
  }

  return { peek, set, invalidate, markDirty, isDirty, clear, request, inflightCount: () => inflight.size }
}
