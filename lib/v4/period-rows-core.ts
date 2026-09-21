// 여러 분석 API(랭킹·종목·타이밍·담당자·대시보드)가 같은 기간의 영상을 각자 읽지 않도록,
// 잠깐(기본 15초) 기억해 두는 메모의 순수 로직. DB/Next 의존 없음 → 그대로 테스트할 수 있다.

export const ROWS_TTL_MS = 15_000
export const ROWS_MAX_ENTRIES = 6

export type MemoEntry<T> = {
  ownerKey: string // 직원 범위(관리자 = '*', 직원 = 본인 id)
  startMs: number
  endMs: number
  loadedAt: number | null // 읽기가 끝난 시각 (읽는 중이면 null)
  createdAt: number
  value: T
}

export function ownerKeyOf(ownerId: string | null | undefined) {
  return ownerId ? `u:${ownerId}` : '*'
}

// 요청한 기간을 통째로 포함하는(같은 범위의) 아직 유효한 메모를 찾는다. 읽는 중인 것도 재사용해 같은 읽기를 함께 기다린다.
export function findCovering<T>(entries: MemoEntry<T>[], ownerKey: string, startMs: number, endMs: number, now: number, ttl = ROWS_TTL_MS): MemoEntry<T> | undefined {
  let best: MemoEntry<T> | undefined
  for (const e of entries) {
    if (e.ownerKey !== ownerKey) continue
    if (e.startMs > startMs || e.endMs < endMs) continue
    if (e.loadedAt !== null && now - e.loadedAt > ttl) continue
    // 가장 좁게 딱 맞는(불필요하게 넓지 않은) 메모를 우선한다.
    if (!best || e.endMs - e.startMs < best.endMs - best.startMs) best = e
  }
  return best
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
