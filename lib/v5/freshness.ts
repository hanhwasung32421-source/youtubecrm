// "방금 저장/수정/삭제가 있었나"를 기억하는 아주 작은 모듈(브라우저 전용, 다른 곳에서 import 하지 않아도 안전).
// 저장한 직후에는 브라우저가 15초 동안 들고 있는 조회 응답이 옛 값일 수 있으므로,
// 그 뒤 잠시 동안의 조회는 브라우저 캐시를 건너뛰고 새로 받는다.

const FRESH_WINDOW_MS = 60_000
let lastMutationAt = 0

export function markMutated() {
  lastMutationAt = Date.now()
}

export function recentlyMutated(now: number = Date.now()) {
  return now - lastMutationAt < FRESH_WINDOW_MS
}

// 저장해 둔 값(at: 받은 시각)보다 나중에 저장/수정/삭제가 있었나 — 있었다면 그 값은 "방금 받은 값"으로 믿지 않는다.
export function mutatedSince(at: number) {
  return lastMutationAt > at
}
