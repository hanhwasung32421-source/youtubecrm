// 영상 등록 화면의 "순수 계산" 모음(화면·서버 코드 없음, 가져오는 것 없음).
// 되돌리기 상태, 오늘 종목별 개수, 진행 문구, 목록 합치기, 로그인 뒤 돌아갈 주소 검사 등.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// ---- 로그인 뒤 돌아갈 주소(?next=) 검사 ----
// 같은 사이트의 /v2/ 아래 화면만 허용한다. 다른 사이트·프로토콜 상대 주소(//)·백슬래시·.. 경로는 모두 거부.
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 300) return null
  if (/[\x00-\x1f\x7f\\]/.test(s)) return null
  if (!s.startsWith('/v2/')) return null
  if (/%2e|%5c|%2f%2f/i.test(s)) return null
  let parsed: URL
  try {
    parsed = new URL(s, 'http://next.invalid')
  } catch {
    return null
  }
  if (parsed.origin !== 'http://next.invalid') return null
  if (!parsed.pathname.startsWith('/v2/')) return null
  // 로그인·가입 화면으로 다시 돌려보내면 제자리걸음이 된다
  if (/^\/v2\/(?:login|signup)(?:\/|$)/.test(parsed.pathname)) return null
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

// ---- 날짜 표시(한국 시간) ----
function kstParts(iso: string): { ymd: string; m: number; d: number; hh: number; mm: number } | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const k = new Date(t + KST_OFFSET_MS)
  const m = k.getUTCMonth() + 1
  const d = k.getUTCDate()
  return {
    ymd: `${k.getUTCFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    m,
    d,
    hh: k.getUTCHours(),
    mm: k.getUTCMinutes()
  }
}

// "오늘 14:32 등록" / "9/20 등록" (값이 이상하면 "이전에 등록")
export function registeredWhenLabel(iso: string | null | undefined, todayYmd: string): string {
  const p = iso ? kstParts(iso) : null
  if (!p) return '이전에 등록'
  if (p.ymd === todayYmd) return `오늘 ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')} 등록`
  return `${p.m}/${p.d} 등록`
}

// ---- 오늘 등록한 것을 종목별로 ----
export type StockCount = { stock: string; count: number }

function stockKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

// 개수가 많은 종목 먼저, 같으면 가장 최근에 등록한 종목 먼저. 종목명은 띄어쓰기·대소문자 차이를 같은 것으로 본다.
export function groupTodayByStock<T extends { stock_name: string; created_at: string }>(items: readonly T[], isToday: (iso: string) => boolean): StockCount[] {
  const map = new Map<string, { stock: string; count: number; last: number }>()
  for (const item of items) {
    if (!isToday(item.created_at)) continue
    const label = (item.stock_name || '').trim().replace(/\s+/g, ' ')
    if (!label) continue
    const key = stockKey(label)
    const t = Date.parse(item.created_at)
    const stamp = Number.isNaN(t) ? 0 : t
    const cur = map.get(key)
    if (cur) {
      cur.count += 1
      if (stamp > cur.last) cur.last = stamp
    } else {
      map.set(key, { stock: label, count: 1, last: stamp })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.last - a.last || a.stock.localeCompare(b.stock, 'ko')).map(({ stock, count }) => ({ stock, count }))
}

// ---- 오늘 목표 ----
export const DEFAULT_DAILY_GOAL = 12

export function clampGoal(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_DAILY_GOAL
  return Math.min(99, Math.max(1, Math.trunc(n)))
}

export type Progress = { pct: number; remaining: number; over: number; done: boolean; message: string }

// 다그치지 않는 차분한 문구. 목표를 넘겨도 칭찬만 한다.
export function progressSummary(count: number, goalRaw: number): Progress {
  const goal = clampGoal(goalRaw)
  const n = Math.max(0, Math.trunc(count) || 0)
  const remaining = Math.max(0, goal - n)
  const over = Math.max(0, n - goal)
  const pct = Math.min(100, Math.round((n / goal) * 100))
  const done = n >= goal
  let message: string
  if (n === 0) message = '오늘 첫 영상을 등록해 볼까요?'
  else if (over > 0) message = `목표보다 ${over}개 더 등록했어요. 수고하셨어요.`
  else if (done) message = '오늘 목표를 채웠어요. 수고하셨어요.'
  else if (remaining <= 3) message = `거의 다 왔어요. ${remaining}개만 더 하면 돼요.`
  else if (pct >= 50) message = `절반을 넘었어요. ${remaining}개 남았어요.`
  else message = `좋아요, 천천히 쌓아 가요. ${remaining}개 남았어요.`
  return { pct, remaining, over, done, message }
}

// ---- 목록 합치기 ----
// 등록 직후에는 가장 새로운 한 쪽(page 1)만 다시 받는다. 받은 쪽이 꽉 차 있으면 그보다 오래된 기존 항목은 그대로 두고,
// 덜 찼으면(=전체가 다 온 것) 받은 것만 쓴다. 받은 범위 안에서 사라진 항목(다른 곳에서 삭제)은 자연히 빠진다.
export function mergeVideoLists<T extends { id: string; created_at: string }>(fresh: readonly T[], prev: readonly T[], pageSize = 20): T[] {
  const time = (v: T) => {
    const t = Date.parse(v.created_at)
    return Number.isNaN(t) ? 0 : t
  }
  const byNewest = (a: T, b: T) => time(b) - time(a)
  if (fresh.length < pageSize) return [...fresh].sort(byNewest)
  const freshIds = new Set(fresh.map((v) => v.id))
  const oldest = Math.min(...fresh.map(time))
  const tail = prev.filter((v) => !freshIds.has(v.id) && time(v) < oldest)
  return [...fresh, ...tail].sort(byNewest)
}

// ---- 방금 등록한 영상: 되돌리기 상태 ----
export const UNDO_WINDOW_MS = 10_000

export type EntryType = 'longform' | 'shortform'

// 방금 등록한 영상이 어디서 왔는지(등록 직전 확인 결과):
//  · created  — 확인해 보니 그때까지 없던 영상. 이번에 새로 만들어졌다.
//  · existing — 이미 있던 영상(내 것이거나 다른 담당자 것)
//  · unknown  — 확인하지 못했다(네트워크 등)
export type EntryOrigin = 'created' | 'existing' | 'unknown'

export type LastEntry = {
  videoId: string
  url: string // 되돌리면 주소 칸에 다시 채워 줄 주소
  stock: string
  type: EntryType
  nth: number // 오늘 몇 번째인지
  origin: EntryOrigin
  // 이미 있던 내 영상의 종목만 바꾼 경우: 되돌리면 삭제가 아니라 이 값으로 복원한다(영상 자체는 지우지 않는다)
  updatedFrom: { stock: string; type: EntryType } | null
  // 새로 만든 영상을 되돌릴 때 서버가 "이 시각 이후에 만든 영상만" 지우도록 확인하는 기준(서버 시각)
  guard: string | null
}

// 되돌리기 방식: 새로 만든 것을 확인했을 때만 삭제('delete'), 이미 있던 내 영상은 이전 값으로 복원('restore'),
// 그 밖에는 되돌리기를 열지 않는다('none' — 남의 영상이나 확인 못 한 영상을 지우는 일이 없도록).
export type UndoKind = 'delete' | 'restore' | 'none'

export function undoKindOf(entry: Pick<LastEntry, 'origin' | 'updatedFrom' | 'guard'>): UndoKind {
  if (entry.updatedFrom) return 'restore'
  if (entry.origin === 'created' && entry.guard) return 'delete'
  return 'none'
}

export type UndoPhase = 'none' | 'open' | 'busy' | 'closed'

export type UndoState = {
  entry: LastEntry | null
  expiresAt: number
  phase: UndoPhase
  error: string
}

export const UNDO_INITIAL: UndoState = { entry: null, expiresAt: 0, phase: 'none', error: '' }

export type UndoAction =
  | { type: 'registered'; entry: LastEntry; now: number }
  | { type: 'tick'; now: number }
  | { type: 'undo_start'; now: number }
  | { type: 'undo_ok'; videoId: string }
  | { type: 'undo_fail'; videoId: string; error: string; now: number }
  | { type: 'stock_fixed'; videoId: string; stock: string }
  | { type: 'clear' }

export function undoReducer(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
    case 'registered':
      // 되돌릴 수 없는 등록(이미 있던 남의 영상 등)은 처음부터 닫힌 상태로 둔다
      return { entry: action.entry, expiresAt: action.now + UNDO_WINDOW_MS, phase: undoKindOf(action.entry) === 'none' ? 'closed' : 'open', error: '' }
    case 'tick':
      if (state.phase === 'open' && action.now >= state.expiresAt) return { ...state, phase: 'closed' }
      return state
    case 'undo_start':
      // 시간이 지났거나 이미 처리 중이면 시작하지 않는다
      if (state.phase !== 'open' || !state.entry || action.now >= state.expiresAt || undoKindOf(state.entry) === 'none') return state
      return { ...state, phase: 'busy', error: '' }
    case 'undo_ok':
      // 그 사이 다음 영상을 등록했다면(다른 videoId) 새 항목을 지우지 않는다
      if (!state.entry || state.entry.videoId !== action.videoId) return state
      return UNDO_INITIAL
    case 'undo_fail':
      if (!state.entry || state.entry.videoId !== action.videoId) return state
      return { ...state, phase: action.now < state.expiresAt ? 'open' : 'closed', error: action.error }
    case 'stock_fixed':
      if (!state.entry || state.entry.videoId !== action.videoId) return state
      return { ...state, entry: { ...state.entry, stock: action.stock } }
    case 'clear':
      return UNDO_INITIAL
    default:
      return state
  }
}

// 남은 초(올림). 지났으면 0.
export function undoSecondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

// ---- 로그인이 끊겼을 때 입력 내용을 잠시 보관(같은 탭 sessionStorage) ----
export type Draft = { url: string; stock: string; note: string; type: EntryType }
export const DRAFT_MAX_AGE_MS = 30 * 60 * 1000

export function serializeDraft(draft: Draft, now: number): string {
  return JSON.stringify({ v: 1, at: now, url: draft.url, stock: draft.stock, note: draft.note, type: draft.type })
}

export function parseDraft(raw: string | null | undefined, now: number): Draft | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object' || o.v !== 1) return null
    if (typeof o.at !== 'number' || now - o.at > DRAFT_MAX_AGE_MS || now < o.at - 60_000) return null
    const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '')
    const url = str(o.url, 500)
    const stock = str(o.stock, 100)
    const note = str(o.note, 300)
    if (!url && !stock && !note) return null
    return { url, stock, note, type: o.type === 'shortform' ? 'shortform' : 'longform' }
  } catch {
    return null
  }
}

// 이미 가진 목록에 더 오래된 쪽(page 2, 3…)을 이어 붙인다. 같은 id는 기존 것을 그대로 두고, 최신순으로 정렬한다.
export function unionVideos<T extends { id: string; created_at: string }>(prev: readonly T[], more: readonly T[]): T[] {
  const seen = new Set(prev.map((v) => v.id))
  const added = more.filter((v) => !seen.has(v.id))
  if (added.length === 0) return prev as T[]
  const time = (v: T) => {
    const t = Date.parse(v.created_at)
    return Number.isNaN(t) ? 0 : t
  }
  return [...prev, ...added].sort((a, b) => time(b) - time(a))
}

// 방금 등록한 영상 한 줄을 목록 맨 위에 넣는다(이미 있으면 그 자리에서 교체).
export function upsertVideo<T extends { id: string; created_at: string }>(list: readonly T[], item: T): T[] {
  const without = list.filter((v) => v.id !== item.id)
  return [item, ...without].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
}
