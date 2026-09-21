// 아주 작은 stale-while-revalidate 메모리 캐시 (React 의존 없음).
// - 값이 있으면 나이와 상관없이 바로 돌려준다 (화면을 즉시 그리기 위해).
// - fresh=true(ttl 이내)면 다시 받을 필요가 없다는 뜻, false면 화면은 유지한 채 뒤에서 새로 받는다.

export type SwrEntry<T> = { value: T; at: number; fresh: boolean }

export function createSwrCache<T>(ttlMs = 60_000, maxEntries = 12, now: () => number = Date.now) {
  const store = new Map<string, { value: T; at: number }>()

  return {
    get(key: string): SwrEntry<T> | null {
      const hit = store.get(key)
      if (!hit) return null
      return { value: hit.value, at: hit.at, fresh: now() - hit.at < ttlMs }
    },
    set(key: string, value: T) {
      store.delete(key) // 넣은 순서를 갱신해 오래된 것부터 밀어낸다
      store.set(key, { value, at: now() })
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value
        if (oldest === undefined) break
        store.delete(oldest)
      }
    },
    // 인자가 없으면 전부, 있으면 접두어가 맞는 것만 비운다.
    clear(prefix?: string) {
      if (!prefix) {
        store.clear()
        return
      }
      for (const key of Array.from(store.keys())) if (key.startsWith(prefix)) store.delete(key)
    },
    size() {
      return store.size
    }
  }
}
