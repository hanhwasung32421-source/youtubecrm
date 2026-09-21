// 화면 쪽 "옛 값을 먼저 보여주고 뒤에서 새로 받는" 캐시의 판단 규칙 (순수 함수, React/브라우저 의존 없음).

export const SWR_FRESH_MS = 5_000 // 이 안이면 그대로 쓰고 서버에 묻지 않는다 (영상을 등록·삭제한 직후 옛 숫자가 오래 남지 않게 짧게)
export const SWR_MAX_AGE_MS = 30_000 // 이 안이면 옛 값을 먼저 보여주고 뒤에서 새로 받는다. 넘으면 버린다.
export const SWR_MAX_ENTRIES = 40

export type CachePhase = 'fresh' | 'stale' | 'expired'

export function classifyAge(ageMs: number, freshMs = SWR_FRESH_MS, maxAgeMs = SWR_MAX_AGE_MS): CachePhase {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'expired'
  if (ageMs <= freshMs) return 'fresh'
  if (ageMs <= maxAgeMs) return 'stale'
  return 'expired'
}

// Map 이 너무 커지지 않게 가장 오래 전에 넣은 것부터 지운다 (Map 은 넣은 순서를 기억한다).
export function trimOldest<K, V>(map: Map<K, V>, max = SWR_MAX_ENTRIES) {
  while (map.size > max) {
    const oldest = map.keys().next()
    if (oldest.done) break
    map.delete(oldest.value)
  }
}
