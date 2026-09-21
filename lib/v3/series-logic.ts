// 시리즈 관리 화면의 순수 로직: 이름 중복, ↑↓ 순서 바꾸기(서버에 저장), 영상 검색해서 추가, 화면 먼저 바꾸기(낙관적 갱신)와 되돌리기.
// (외부 import 없음 — 서버 규칙(같은 이름 금지, 영상은 한 시리즈에만)과 같은 기준으로 미리 걸러 준다)

export type Member = { id: string; title: string }
export type SeriesLike = { id: string; name: string; members: Member[]; videoCount: number }

// 서버의 이름 비교 규칙과 같다: 앞뒤 공백 제거, 연속 공백 하나로, 대소문자 무시
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function findDuplicateName<T extends { id: string; name: string }>(name: string, all: T[], exceptId?: string): T | null {
  const target = normalizeName(name)
  if (!target) return null
  return all.find((s) => s.id !== exceptId && normalizeName(s.name) === target) || null
}

// ── 롱폼 vs 숏폼 비교 ──
export type FormatSide = 'longform' | 'shortform'

// 두 값이 얼마나 차이 나는지(%, 작은 쪽 기준). 둘 다 0 이하면 0, 작은 쪽만 0 이하면 아주 큰 차이(Infinity)로 본다.
export function gapPct(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > 0)) return 0
  if (!(lo > 0)) return Infinity
  return ((hi - lo) / lo) * 100
}

// 눈에 띄게(기본 5% 이상) 더 높은 쪽. 차이가 작으면 null(비슷해요)
export function pickWinner(long: number, short: number, thresholdPct = 5): FormatSide | null {
  if (gapPct(long, short) < thresholdPct) return null
  return long > short ? 'longform' : 'shortform'
}

// ── 순서 바꾸기 ──
export function moveItem(ids: string[], id: string, dir: -1 | 1): string[] {
  const from = ids.indexOf(id)
  const to = from + dir
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = ids.slice()
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

// 요청한 순서(requested)를 현재 멤버(current)에 맞춰 정리한다. 결과는 항상 current 의 순열이다.
//   - 요청에 있지만 지금은 시리즈에 없는 영상(그사이 빠졌을 수 있다)과 중복은 버린다.
//   - 지금 있지만 요청에 없는 영상(그사이 새로 추가됨)은 원래 순서대로 뒤에 붙인다.
export function mergeOrder(current: string[], requested: string[]): string[] {
  const inSeries = new Set(current)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of requested) {
    if (inSeries.has(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of current) if (!seen.has(id)) out.push(id)
  return out
}

// 순서는 "추가된 시각(added_at)" 칸에 담는다. 순서대로 1초 간격의 시각을 만든다. 모두 지금(nowMs)보다 이전이라서,
// 이 뒤에 새로 추가되는 영상(추가 시각 = 그때의 지금)은 자연스럽게 맨 뒤에 온다.
export function orderTimestamps(count: number, nowMs: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i += 1) out.push(new Date(nowMs - (count - i) * 1000).toISOString())
  return out
}

// 화면에서 먼저 순서를 바꿔 보여 준다. 없는 영상 번호는 무시하고, 빠진 영상은 원래 순서로 뒤에 붙는다.
export function withReordered<S extends SeriesLike>(list: S[], seriesId: string, ids: string[]): S[] {
  return list.map((s) => {
    if (s.id !== seriesId) return s
    const byId = new Map(s.members.map((m) => [m.id, m]))
    const order = mergeOrder(
      s.members.map((m) => m.id),
      ids
    )
    return { ...s, members: order.map((id) => byId.get(id) as Member) }
  })
}

// ── 영상 검색해서 추가 ──
export type Addable = { id: string; title: string; stockName: string | null; moveFromSeriesName?: string | null }

export function findAddable(opts: {
  query: string
  eligible: { id: string; title: string; stockName: string | null }[]
  movable: { id: string; title: string; stockName: string | null; seriesId: string; seriesName: string }[]
  memberIds: string[]
  seriesId: string
  limit?: number
}): { results: Addable[]; total: number } {
  const q = opts.query.trim().toLowerCase()
  const inSeries = new Set(opts.memberIds)
  const seen = new Set<string>()
  const all: Addable[] = []
  for (const v of opts.eligible) {
    if (inSeries.has(v.id) || seen.has(v.id)) continue
    seen.add(v.id)
    all.push({ id: v.id, title: v.title, stockName: v.stockName })
  }
  for (const v of opts.movable) {
    if (v.seriesId === opts.seriesId || inSeries.has(v.id) || seen.has(v.id)) continue
    seen.add(v.id)
    all.push({ id: v.id, title: v.title, stockName: v.stockName, moveFromSeriesName: v.seriesName || '다른 시리즈' })
  }
  const filtered = q ? all.filter((v) => v.title.toLowerCase().includes(q) || (v.stockName || '').toLowerCase().includes(q)) : all
  return { results: filtered.slice(0, opts.limit ?? 6), total: filtered.length }
}

// 검색어에 맞는 영상이 이미 이 시리즈에 들어 있으면 알려 주려고 찾는다.
export function membersMatching(query: string, members: Member[]): Member[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return members.filter((m) => m.title.toLowerCase().includes(q))
}

// ── 화면 먼저 바꾸기 / 되돌리기 ──
export function withoutMember<S extends SeriesLike>(list: S[], seriesId: string, memberId: string): S[] {
  return list.map((s) => {
    if (s.id !== seriesId || !s.members.some((m) => m.id === memberId)) return s
    return { ...s, members: s.members.filter((m) => m.id !== memberId), videoCount: Math.max(s.videoCount - 1, 0) }
  })
}

// 이미 들어 있으면 그대로(중복 방지). 다른 시리즈에서 옮기는 경우 그 시리즈에서는 뺀다.
export function withMember<S extends SeriesLike>(list: S[], seriesId: string, member: Member): S[] {
  return list.map((s) => {
    if (s.id === seriesId) {
      if (s.members.some((m) => m.id === member.id)) return s
      return { ...s, members: [...s.members, member], videoCount: s.videoCount + 1 }
    }
    if (s.members.some((m) => m.id === member.id)) {
      return { ...s, members: s.members.filter((m) => m.id !== member.id), videoCount: Math.max(s.videoCount - 1, 0) }
    }
    return s
  })
}

export function withRenamed<S extends { id: string; name: string }>(list: S[], seriesId: string, name: string): S[] {
  return list.map((s) => (s.id === seriesId ? { ...s, name } : s))
}

export function withoutSeries<S extends { id: string }>(list: S[], seriesId: string): { list: S[]; removed: S | null; index: number } {
  const index = list.findIndex((s) => s.id === seriesId)
  if (index < 0) return { list, removed: null, index: -1 }
  return { list: [...list.slice(0, index), ...list.slice(index + 1)], removed: list[index], index }
}

// 삭제를 되돌릴 때 원래 자리에 다시 끼워 넣는다(이미 있으면 그대로).
export function restoreSeries<S extends { id: string }>(list: S[], series: S, index: number): S[] {
  if (list.some((s) => s.id === series.id)) return list
  const at = Math.min(Math.max(index, 0), list.length)
  return [...list.slice(0, at), series, ...list.slice(at)]
}
