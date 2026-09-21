// 시리즈 관리 화면의 순수 로직: 이름 중복, ↑↓ 순서 바꾸기, 영상 검색해서 추가, 화면 먼저 바꾸기(낙관적 갱신)와 되돌리기.
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

// ── 순서 바꾸기 ──
export function moveItem(ids: string[], id: string, dir: -1 | 1): string[] {
  const from = ids.indexOf(id)
  const to = from + dir
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = ids.slice()
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

// 저장해 둔 순서를 적용한다. 저장본에 없는 영상(새로 추가)은 원래 순서대로 뒤에 붙고, 사라진 영상은 무시한다.
export function applyOrder<T extends { id: string }>(items: T[], saved: string[] | null | undefined): T[] {
  if (!saved || saved.length === 0) return items
  const byId = new Map(items.map((i) => [i.id, i]))
  const out: T[] = []
  const seen = new Set<string>()
  for (const id of saved) {
    const hit = byId.get(id)
    if (hit && !seen.has(id)) {
      out.push(hit)
      seen.add(id)
    }
  }
  for (const item of items) if (!seen.has(item.id)) out.push(item)
  return out
}

export function orderKey(seriesId: string): string {
  return `v3:series-order:v1:${seriesId}`
}

// 저장된 글자 -> id 목록. 깨졌으면 null
export function decodeOrder(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) return null
    return parsed as string[]
  } catch {
    return null
  }
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
