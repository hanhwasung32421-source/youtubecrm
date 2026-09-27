// 영상 등록 화면의 "순수 규칙" 모음(화면 · 네트워크와 무관). 상태를 바꾸는 규칙은 전부 여기서 시험한다.
// 이 파일은 ./youtube-url 과 ./paste-detect 만 가져온다.

import { analyzePaste, type PasteInfo } from './paste-detect'
import { describeUrlProblem, extractVideoId, isYoutubeUrl, normalizeUrl } from './youtube-url'

export type ContentTypeValue = 'longform' | 'shortform'

// ---- 로그인 후 돌아올 주소(next) ------------------------------------------------------------

// 로그인 뒤에 이동해도 안전한 주소만 돌려준다: 같은 사이트의 /v5/ 아래 화면뿐.
// 그 밖(다른 사이트, //로 시작, 역슬래시, /v5/ 밖으로 나가는 ../, 로그인·가입 화면 자신)은 null.
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s.length === 0 || s.length > 300) return null
  if (!s.startsWith('/v5/')) return null
  if (s.includes('\\') || Array.from(s).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return null
  try {
    const base = 'http://local.invalid'
    const u = new URL(s, base)
    if (u.origin !== base) return null
    if (!u.pathname.startsWith('/v5/')) return null
    if (/^\/v5\/(login|signup)(\/|$)/.test(u.pathname)) return null
    return u.pathname + u.search + u.hash
  } catch {
    return null
  }
}

// 로그인 화면 주소. 돌아올 화면이 안전하면 ?next= 로 붙인다.
export function loginHref(current: string | null | undefined): string {
  const next = safeNext(current)
  return next ? `/v5/login?next=${encodeURIComponent(next)}` : '/v5/login'
}

// 주소창의 ?next= 값을 꺼낸다(안전하지 않으면 null).
export function readNextFromSearch(search: string): string | null {
  try {
    return safeNext(new URLSearchParams(search).get('next'))
  } catch {
    return null
  }
}

// ---- 로그인이 풀렸을 때 입력 임시 보관 -------------------------------------------------------

export type RegisterDraft = { url: string; savedAt: number }

export const DRAFT_MAX_AGE_MS = 30 * 60 * 1000

export function serializeDraft(d: RegisterDraft): string {
  return JSON.stringify({ url: d.url, savedAt: d.savedAt })
}

// 예전에 저장된 글({stock}이 함께 들어 있던 시절 것)도 그대로 읽는다. url·savedAt 만 있으면 된다.
export function parseDraft(raw: string | null | undefined, now: number, maxAgeMs = DRAFT_MAX_AGE_MS): RegisterDraft | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<RegisterDraft> | null
    if (!v || typeof v !== 'object') return null
    if (typeof v.url !== 'string' || typeof v.savedAt !== 'number') return null
    if (now - v.savedAt > maxAgeMs || v.savedAt > now + 60_000) return null
    if (!v.url.trim()) return null
    return { url: v.url.slice(0, 500), savedAt: v.savedAt }
  } catch {
    return null
  }
}

// ---- 붙여넣기(Ctrl+V · 붙여넣기 버튼 공통) --------------------------------------------------

export type ClipboardOutcome =
  | { kind: 'empty' } // 클립보드가 비어 있음
  | { kind: 'none' } // 유튜브 주소가 없음
  | { kind: 'multi'; count: number } // 서로 다른 영상 여러 개
  | { kind: 'bad'; url: string; problem: string } // 유튜브 주소지만 영상이 아님(재생목록·채널 등)
  | { kind: 'ok'; url: string; videoId: string; info: PasteInfo }

export function interpretClipboard(text: string): ClipboardOutcome {
  if (!text || !text.trim()) return { kind: 'empty' }
  const info = analyzePaste(text)
  if (info.kind === 'multi') return { kind: 'multi', count: info.videoCount }
  const url = normalizeUrl(text)
  if (info.kind === 'none') {
    // 재생목록/채널처럼 "유튜브 주소이긴 한데 영상이 아닌" 경우는 이유를 알려 준다.
    if (/(?:youtube\.com|youtu\.be)\//i.test(text) && isYoutubeUrl(url)) return { kind: 'bad', url, problem: describeUrlProblem(url) }
    return { kind: 'none' }
  }
  const videoId = extractVideoId(url)
  if (!videoId) return { kind: 'bad', url, problem: describeUrlProblem(url) }
  return { kind: 'ok', url, videoId, info }
}

// "주소만 붙이면 바로 등록"을 지금 실행해도 되는가. 종목은 서버가 알아서 정하므로 주소가 새 영상인지만 본다.
export function shouldAutoSubmit(opts: { enabled: boolean; outcome: ClipboardOutcome }): boolean {
  return opts.enabled && opts.outcome.kind === 'ok'
}

// ---- 되돌리기(등록 직후 10초) ---------------------------------------------------------------

export const UNDO_WINDOW_MS = 10_000

// "방금 새로 만든 영상만 지운다"는 안전장치: 서버는 이 시간(초)보다 오래된 영상은 되돌리기로 지우지 않는다.
export const UNDO_DELETE_MAX_AGE_SEC = 60

export type UndoPrev = { stock: string; type: ContentTypeValue; category: string | null }

export type UndoEntry = {
  id: string // 되돌릴 영상 id
  // delete: 방금 새로 만든 영상이므로 지운다 / restore: 이미 있던 영상을 고쳤으므로 이전 값으로 되돌린다
  kind: 'delete' | 'restore'
  videoId: string
  url: string
  stock: string
  type: ContentTypeValue
  prev?: UndoPrev
  expiresAt: number
}

export type UndoState =
  | { phase: 'idle' }
  | { phase: 'offer'; entry: UndoEntry }
  | { phase: 'busy'; entry: UndoEntry }
  | { phase: 'failed'; entry: UndoEntry; message: string }

export type UndoAction =
  | { type: 'offer'; entry: UndoEntry }
  | { type: 'tick'; now: number }
  | { type: 'begin'; now: number }
  | { type: 'fail'; message: string }
  | { type: 'done' }
  | { type: 'dismiss' }

export const UNDO_IDLE: UndoState = { phase: 'idle' }

export function undoReduce(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
    case 'offer':
      // 새 등록이 생기면 항상 "가장 최근 것"만 남긴다(진행 중인 되돌리기는 끝날 때까지 건드리지 않는다).
      return state.phase === 'busy' ? state : { phase: 'offer', entry: action.entry }
    case 'tick':
      if (state.phase === 'offer' || state.phase === 'failed') return action.now >= state.entry.expiresAt ? UNDO_IDLE : state
      return state
    case 'begin':
      if ((state.phase === 'offer' || state.phase === 'failed') && action.now < state.entry.expiresAt) return { phase: 'busy', entry: state.entry }
      return state.phase === 'offer' || state.phase === 'failed' ? UNDO_IDLE : state
    case 'fail':
      return state.phase === 'busy' ? { phase: 'failed', entry: state.entry, message: action.message } : state
    case 'done':
      return state.phase === 'busy' ? UNDO_IDLE : state
    case 'dismiss':
      return state.phase === 'busy' ? state : UNDO_IDLE
    default:
      return state
  }
}

export function undoSecondsLeft(entry: UndoEntry, now: number): number {
  return Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))
}

// ---- 이미 등록한 영상 ----------------------------------------------------------------------

export type DupInfo = {
  id: string
  stock: string
  type: ContentTypeValue
  category: string | null
  createdAt: string
  mine: boolean // 내가 등록한 영상인가(아니면 다른 팀원 것)
  ownerName: string | null
}

export type DupState =
  | { status: 'idle' }
  | { status: 'checking'; videoId: string }
  | { status: 'none'; videoId: string }
  | { status: 'found'; videoId: string; info: DupInfo }
  | { status: 'unknown'; videoId: string } // 확인하지 못함(인터넷 문제 등)

// 서버(/api/v5/my-videos?videoId=)의 응답을 안전하게 읽는다. 모양이 이상하면 null(=없음으로 취급하지 않고 호출부가 판단).
export function parseDupResponse(json: unknown): { ok: true; info: DupInfo | null } | { ok: false } {
  if (!json || typeof json !== 'object' || !('match' in json)) return { ok: false }
  const m = (json as { match: unknown }).match
  if (m === null) return { ok: true, info: null }
  if (!m || typeof m !== 'object') return { ok: false }
  const r = m as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.stock_name !== 'string' || typeof r.created_at !== 'string') return { ok: false }
  return {
    ok: true,
    info: {
      id: r.id,
      stock: r.stock_name,
      type: r.content_type === 'shortform' ? 'shortform' : 'longform',
      category: typeof r.content_category === 'string' && r.content_category ? r.content_category : null,
      createdAt: r.created_at,
      mine: r.mine === true,
      ownerName: typeof r.owner_name === 'string' && r.owner_name ? r.owner_name : null
    }
  }
}

const kstDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })

function kstParts(d: Date) {
  const [y, m, day] = kstDayFormatter.format(d).split('-')
  return { y, m: Number(m), day: Number(day) }
}

// "오늘 등록" / "9/20 등록" (한국 시간 기준)
export function whenLabel(createdAt: string, now: Date = new Date()): string {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime())) return '등록'
  const a = kstParts(d)
  const b = kstParts(now)
  if (a.y === b.y && a.m === b.m && a.day === b.day) return '오늘 등록'
  return `${a.m}/${a.day} 등록`
}

// 미리 알려 줄 문구와 가능한 행동을 정한다. 종목을 직접 적지 않으므로 "같다/다르다"를 가릴 일이 없다 —
// 내가 이미 등록한 영상이면 다시 등록해 정보만 새로 갱신하고, 다른 팀원 것이면 등록 시 담당이 나로 바뀐다.
export type DupDecision =
  | { action: 'register' } // 새 영상 → 그대로 등록
  | { action: 'refresh' } // 내가 이미 등록함 → 다시 등록해 정보만 새로 갱신(종목은 그대로 둠)
  | { action: 'takeover' } // 다른 팀원이 등록한 영상 → 등록하면 담당이 나로 바뀜

export function decideDuplicate(state: DupState): DupDecision {
  if (state.status !== 'found') return { action: 'register' }
  return state.info.mine ? { action: 'refresh' } : { action: 'takeover' }
}

export function dupNotice(info: DupInfo, now: Date = new Date()): string {
  const when = whenLabel(info.createdAt, now)
  if (info.mine) return `이미 등록한 영상이에요 (${when} · 종목 ${info.stock}).`
  return `${info.ownerName ? `${info.ownerName}님이` : '다른 팀원이'} 이미 등록한 영상이에요 (${when} · 종목 ${info.stock}). 그대로 등록하면 내 영상으로 바뀝니다.`
}

// ---- 오늘 등록 묶음(종목별 개수) ----------------------------------------------------------------

export type StockCount = { stock: string; count: number }

function stockKey(name: string) {
  return name.replace(/\s+/g, '').toLowerCase()
}

// 종목 이름을 공백·대소문자 차이 없이 묶고, 많은 순(같으면 먼저 나온 순)으로 정렬한다.
export function groupStocks(names: Array<string | null | undefined>): StockCount[] {
  const map = new Map<string, StockCount>()
  for (const raw of names) {
    const name = (raw ?? '').trim()
    if (!name) continue
    const key = stockKey(name)
    const hit = map.get(key)
    if (hit) hit.count += 1
    else map.set(key, { stock: name, count: 1 })
  }
  return Array.from(map.values())
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v.count - a.v.count || a.i - b.i)
    .map((x) => x.v)
}

// 서버가 준 stocks 값을 안전하게 읽는다(없거나 이상하면 null → 화면이 목록에서 직접 계산).
export function parseStockCounts(value: unknown): StockCount[] | null {
  if (!Array.isArray(value)) return null
  const out: StockCount[] = []
  for (const v of value) {
    if (!v || typeof v !== 'object') return null
    const r = v as Record<string, unknown>
    if (typeof r.stock !== 'string' || typeof r.count !== 'number' || !Number.isFinite(r.count)) return null
    out.push({ stock: r.stock, count: Math.max(0, Math.floor(r.count)) })
  }
  return out
}

// ---- 오늘 진행 문구 ------------------------------------------------------------------------

export function progressCopy(count: number, goal: number): { headline: string; sub: string; pct: number; full: boolean } {
  const n = Math.max(0, Math.floor(count))
  const pct = goal > 0 ? Math.min(Math.round((n / goal) * 100), 100) : 0
  const headline = `오늘 ${n.toLocaleString('ko-KR')} / 목표 ${goal}`
  if (n === 0) return { headline, sub: '첫 영상부터 천천히 시작해 보세요.', pct, full: false }
  if (n < goal) {
    const left = goal - n
    return { headline, sub: left <= 2 ? `${left}개만 더 하면 목표예요. 거의 다 왔어요.` : `${left}개 남았어요. 천천히 하셔도 괜찮아요.`, pct, full: false }
  }
  if (n === goal) return { headline, sub: '오늘 목표를 채웠어요. 수고하셨어요.', pct, full: true }
  return { headline, sub: `목표보다 ${n - goal}개 더 등록했어요. 수고하셨어요.`, pct, full: true }
}
