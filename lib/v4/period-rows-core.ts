// 여러 분석 API(랭킹·종목·타이밍·담당자·대시보드)가 같은 기간의 영상을 각자 읽지 않도록,
// 아주 잠깐(기본 5초) 기억해 두는 메모의 순수 로직. DB/Next 의존 없음 → 그대로 테스트할 수 있다.
//
// 오래된 값이 보이지 않게 두 겹으로 지킨다.
//  1) 메모마다 "지문(sig)" 을 붙인다: 읽기 직전에 확인한 영상 개수 + 가장 최근 수정/통계 갱신 시각.
//     지금 지문이 다르면(영상이 등록·삭제·수정됐으면) 그 메모는 쓰지 않는다. 다른 서버 인스턴스나 공용 API 에서 바뀐 것도 잡힌다.
//  2) 지문에 안 잡히는 변경(수정 시각을 안 남기는 고치기)을 위해, 지문이 같아도 5초가 지나면 버린다.

export const ROWS_TTL_MS = 5_000
export const ROWS_MAX_ENTRIES = 6

export type MemoEntry<T> = {
  ownerKey: string // 직원 범위(관리자 = '*', 직원 = 본인 id)
  startMs: number
  endMs: number
  sig: string // 이 메모를 읽기 직전의 지문
  loadedAt: number | null // 읽기가 끝난 시각 (읽는 중이면 null)
  createdAt: number
  value: T
}

export function ownerKeyOf(ownerId: string | null | undefined) {
  return ownerId ? `u:${ownerId}` : '*'
}

// 지문 문자열 만들기. 값이 없으면 빈 칸으로 둔다.
export function makeSignature(count: number | null | undefined, maxUpdatedAt: string | null | undefined, maxSyncedAt: string | null | undefined) {
  return `${typeof count === 'number' && Number.isFinite(count) ? count : ''}|${maxUpdatedAt ?? ''}|${maxSyncedAt ?? ''}`
}

// 요청한 기간을 통째로 포함하는(같은 범위의) 아직 유효한 메모를 찾는다. 읽는 중인 것도 재사용해 같은 읽기를 함께 기다린다.
// sig 가 다른 메모(= 그 사이 데이터가 바뀜)는 절대 돌려주지 않는다.
export function findCovering<T>(entries: MemoEntry<T>[], ownerKey: string, startMs: number, endMs: number, now: number, sig: string, ttl = ROWS_TTL_MS): MemoEntry<T> | undefined {
  let best: MemoEntry<T> | undefined
  for (const e of entries) {
    if (e.ownerKey !== ownerKey) continue
    if (e.sig !== sig) continue
    if (e.startMs > startMs || e.endMs < endMs) continue
    if (e.loadedAt !== null && now - e.loadedAt > ttl) continue
    // 가장 좁게 딱 맞는(불필요하게 넓지 않은) 메모를 우선한다.
    if (!best || e.endMs - e.startMs < best.endMs - best.startMs) best = e
  }
  return best
}

// 같은 범위(ownerKey)에서 지금 지문과 다른 메모는 다시 쓸 일이 없으니 버린다.
export function dropOutdated<T>(entries: MemoEntry<T>[], ownerKey: string, sig: string): MemoEntry<T>[] {
  return entries.filter((e) => e.ownerKey !== ownerKey || e.sig === sig)
}

// 만료된 메모를 버리고, 너무 많으면 오래된 것부터 버린다. (살아남은 목록을 돌려준다)
export function pruneEntries<T>(entries: MemoEntry<T>[], now: number, ttl = ROWS_TTL_MS, max = ROWS_MAX_ENTRIES): MemoEntry<T>[] {
  const alive = entries.filter((e) => e.loadedAt === null || now - e.loadedAt <= ttl)
  if (alive.length <= max) return alive
  return [...alive].sort((a, b) => b.createdAt - a.createdAt).slice(0, max)
}

// 넓게 읽어 둔 rows 에서 요청한 기간(created_at) 만 잘라낸다. 시각(ms)으로 비교해 '+00:00' / 'Z' 표기 차이에 흔들리지 않는다.
export function sliceByCreatedAt<T extends { created_at: string }>(rows: T[], startMs: number, endMs: number): T[] {
  const out: T[] = []
  for (const row of rows) {
    const t = new Date(row.created_at).getTime()
    if (Number.isFinite(t) && t >= startMs && t <= endMs) out.push(row)
  }
  return out
}
