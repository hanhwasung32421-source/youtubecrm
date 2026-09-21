// 영상 등록 화면의 "순수" 계산 모음: 화면·네트워크 없이 시험할 수 있게 따로 뒀다.
//  - 잘못된 주소 설명, 중복 확인, 종목별 개수, 오늘 진행 문구
//  - 등록 실패를 "무슨 일이었고 무엇을 하면 되는지" 한 문장으로 바꾸기
//  - 되돌리기(undo) 상태 기계

import type { ContentType } from './register-api'
import { videoIdFromStoredUrl } from './youtube-url'

// ─────────────────────────────────────────────────────────────
// 잘못된 주소를 구체적으로 설명
// ─────────────────────────────────────────────────────────────
const WRAP_START = /^[<(\[{"'“‘「『]+/
const WRAP_END = /[>)\]}"'”’」』.,;:!?]+$/
const LOOKS_LIKE_ADDRESS = /^https?:\/\//i
const HAS_DOMAIN = /[a-z0-9-]+\.[a-z]{2,}/i

export function explainInvalidUrl(raw: string): string {
  const cleaned = (raw || '').trim()
  if (!cleaned) return '유튜브 영상 주소를 붙여넣어 주세요.'

  const candidate = cleaned
    .split(/\s+/)
    .map((token) => token.replace(WRAP_START, '').replace(WRAP_END, ''))
    .find((token) => LOOKS_LIKE_ADDRESS.test(token) || HAS_DOMAIN.test(token))
  if (!candidate) return '주소 모양이 아니에요. 유튜브 영상 주소(youtube.com/watch?v=… 또는 youtu.be/…)를 붙여넣어 주세요.'

  let parsed: URL
  try {
    parsed = new URL(LOOKS_LIKE_ADDRESS.test(candidate) ? candidate : `https://${candidate}`)
  } catch {
    return '주소 모양이 이상해요. 영상 페이지에서 주소를 다시 복사해 붙여넣어 주세요.'
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const isYoutube = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com'
  if (!isYoutube) return '유튜브 주소가 아니에요. youtube.com 또는 youtu.be 로 시작하는 영상 주소를 붙여넣어 주세요.'

  const parts = parsed.pathname.split('/').filter(Boolean)
  const first = parts[0] || ''
  const hasVideoParam = !!parsed.searchParams.get('v')

  if (host === 'youtu.be') return '주소가 중간에 잘린 것 같아요. 영상의 공유 버튼에서 링크를 다시 복사해 붙여넣어 주세요.'
  if (first === 'playlist' || (parsed.searchParams.get('list') && !hasVideoParam)) {
    return '재생목록 주소예요. 재생목록 안의 영상 하나를 열고, 그 영상의 주소를 복사해 붙여넣어 주세요.'
  }
  if (first.startsWith('@') || first === 'channel' || first === 'c' || first === 'user') {
    return '채널 주소예요. 등록할 영상을 열고, 그 영상의 주소를 복사해 붙여넣어 주세요.'
  }
  if (first === 'results') return '검색 결과 주소예요. 등록할 영상을 열고, 그 영상의 주소를 복사해 붙여넣어 주세요.'
  if (first === 'shorts' || first === 'live' || first === 'embed') {
    return '쇼츠·라이브 주소가 끝까지 복사되지 않은 것 같아요. 공유 버튼에서 링크를 다시 복사해 붙여넣어 주세요.'
  }
  if (parts.length === 0) return '유튜브 첫 화면 주소예요. 등록할 영상을 열고, 그 영상의 주소를 복사해 붙여넣어 주세요.'
  if (first === 'watch') return '영상 번호(v=…)가 빠져 있어요. 영상 페이지에서 주소를 다시 복사해 붙여넣어 주세요.'
  return '영상 주소가 아니에요. 등록할 영상을 열고, 주소창의 주소를 다시 복사해 붙여넣어 주세요.'
}

// ─────────────────────────────────────────────────────────────
// 중복 확인 · 날짜 표시
// ─────────────────────────────────────────────────────────────
export type ListedVideo = {
  id: string
  youtube_url: string | null
  stock_name: string | null
  content_type: ContentType
  created_at: string
}

// 화면에 이미 받아 둔 내 목록에서 같은 영상을 찾는다.
export function findDuplicate<T extends ListedVideo>(videos: T[] | null | undefined, videoId: string): T | null {
  if (!videoId || !videos) return null
  for (const v of videos) {
    if (videoIdFromStoredUrl(v.youtube_url) === videoId) return v
  }
  return null
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function kstParts(ms: number) {
  const d = new Date(ms + KST_OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() }
}

// "9/20 등록" (오늘이면 "오늘 14:05 등록")
export function registeredAtLabel(iso: string | null | undefined, now: number = Date.now()): string {
  const ms = iso ? new Date(iso).getTime() : NaN
  if (Number.isNaN(ms)) return '등록'
  const a = kstParts(ms)
  const b = kstParts(now)
  if (a.y === b.y && a.m === b.m && a.d === b.d) {
    return `오늘 ${String(a.hh).padStart(2, '0')}:${String(a.mm).padStart(2, '0')} 등록`
  }
  return `${a.m}/${a.d} 등록`
}

const norm = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()

// 이미 등록한 영상에 지금 입력한 종목을 어떻게 할지
//  need-stock: 종목 칸이 비어 있음 / same: 종목이 이미 같음 / change: 종목만 바꿀 수 있음
export function duplicateAction(existingStock: string | null | undefined, typedStock: string): 'need-stock' | 'same' | 'change' {
  const typed = norm(typedStock)
  if (!typed) return 'need-stock'
  return typed === norm(existingStock) ? 'same' : 'change'
}

// ─────────────────────────────────────────────────────────────
// 오늘 등록 현황
// ─────────────────────────────────────────────────────────────
export const NO_STOCK_LABEL = '(종목 없음)'

// 종목별 개수. 많은 순, 같으면 먼저 나온(=최근에 등록한) 순.
export function groupByStock(items: { stock_name: string | null }[]): { name: string; count: number }[] {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const item of items) {
    const name = norm(item.stock_name) || NO_STOCK_LABEL
    if (!counts.has(name)) order.push(name)
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return order
    .map((name, index) => ({ name, count: counts.get(name) || 0, index }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ name, count }) => ({ name, count }))
}

export const DEFAULT_GOAL = 12

export function parseGoal(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isFinite(n)) return DEFAULT_GOAL
  const whole = Math.floor(n)
  if (whole < 1) return DEFAULT_GOAL
  return Math.min(whole, 99)
}

export function progressPercent(count: number, goal: number): number {
  if (goal <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((count / goal) * 100)))
}

// 차분한 안내 문구(재촉하지 않는다)
export function progressCopy(count: number, goal: number): string {
  if (count <= 0) return `오늘은 아직 등록 전이에요. 목표는 ${goal}개예요.`
  if (count < goal) return `${goal - count}개 남았어요.`
  if (count === goal) return '오늘 목표를 채웠어요. 수고하셨어요.'
  return `목표를 넘겼어요. 수고하셨어요.`
}

// ─────────────────────────────────────────────────────────────
// 등록 실패 → 한 문장 안내 (무슨 일이었는지 + 무엇을 하면 되는지)
// ─────────────────────────────────────────────────────────────
export type ProbeCode = 'not-found' | 'quota' | 'key' | 'no-key' | 'unknown'

export type FailureKind =
  | 'network'
  | 'auth'
  | 'invalid-url'
  | 'not-found'
  | 'quota'
  | 'key'
  | 'setup'
  | 'stock-missing'
  | 'duplicate'
  | 'server'

export type Failure = {
  kind: FailureKind
  message: string // 화면 한가운데 안내(한 문장 + 할 일)
  short: string // 여러 개 등록 표의 좁은 칸용
  retry: boolean // "다시 시도" 버튼을 보여 줄지
  focus: 'url' | 'stock' | null // 고친 뒤 커서를 둘 곳
}

const FAILURES: Record<FailureKind, Omit<Failure, 'kind'>> = {
  network: {
    message: '인터넷 연결이 끊겨 등록하지 못했어요. 입력한 내용은 그대로 두었으니, 연결을 확인하고 “다시 시도”를 눌러 주세요.',
    short: '인터넷 연결을 확인하고 다시 시도해 주세요.',
    retry: true,
    focus: null
  },
  auth: {
    message: '로그인이 만료돼서 등록하지 못했어요. 입력한 내용은 저장해 두었으니, “다시 로그인”을 누르면 돌아와서 이어서 할 수 있어요.',
    short: '로그인이 만료됐어요. 다시 로그인해 주세요.',
    retry: false,
    focus: null
  },
  'invalid-url': {
    message: '유튜브 영상 주소가 아니라서 등록하지 못했어요. 영상 페이지에서 주소를 다시 복사해 붙여넣어 주세요.',
    short: '유튜브 영상 주소가 아니에요.',
    retry: false,
    focus: 'url'
  },
  'not-found': {
    message: '유튜브에서 이 영상을 찾지 못했어요. 삭제됐거나 비공개일 수 있으니, 영상이 열리는지 확인하고 다른 주소를 넣어 주세요.',
    short: '유튜브에서 영상을 찾지 못했어요. (삭제·비공개일 수 있어요)',
    retry: false,
    focus: 'url'
  },
  quota: {
    message: '오늘 유튜브에서 영상 정보를 가져올 수 있는 횟수를 다 썼어요. 내일 다시 시도하거나 관리자에게 알려 주세요.',
    short: '오늘 유튜브 조회 한도를 다 썼어요. 내일 다시 시도해 주세요.',
    retry: false,
    focus: null
  },
  key: {
    message: '유튜브 연결 설정에 문제가 있어 영상 정보를 가져오지 못했어요. 관리자에게 “유튜브 API 키 확인”을 요청해 주세요.',
    short: '유튜브 연결 설정 문제예요. 관리자에게 알려 주세요.',
    retry: false,
    focus: null
  },
  setup: {
    message: '유튜브 연결 설정이 아직 끝나지 않아 등록하지 못했어요. 관리자에게 “유튜브 API 설정”을 요청해 주세요.',
    short: '유튜브 연결 설정이 필요해요. 관리자에게 알려 주세요.',
    retry: false,
    focus: null
  },
  'stock-missing': {
    message: '종목이 비어 있어서 등록하지 못했어요. 종목을 입력하고 다시 등록해 주세요.',
    short: '종목을 입력해 주세요.',
    retry: false,
    focus: 'stock'
  },
  duplicate: {
    message: '이미 등록된 영상이에요. 아래 목록에서 종목이나 형식을 고칠 수 있어요.',
    short: '이미 등록된 영상이에요.',
    retry: false,
    focus: 'url'
  },
  server: {
    message: '서버가 잠깐 응답하지 못했어요. 입력한 내용은 그대로예요. 잠시 뒤 “다시 시도”를 눌러 주세요.',
    short: '잠시 후 다시 시도해 주세요.',
    retry: true,
    focus: null
  }
}

function make(kind: FailureKind): Failure {
  return { kind, ...FAILURES[kind] }
}

// probe = 등록이 "저장 실패"처럼 뭉뚱그려 실패했을 때, 링크 미리보기로 알아낸 진짜 원인(없으면 null)
export function classifyRegisterFailure(input: { status: number; raw?: string | null; network?: boolean; probe?: ProbeCode | null }): Failure {
  if (input.network) return make('network')
  if (input.status === 401) return make('auth')

  const raw = input.raw || ''
  if (/already|duplicate|unique|23505|이미 등록/i.test(raw)) return make('duplicate')
  if (/유효한 유튜브|유효하지|invalid.*url|올바른 주소/i.test(raw)) return make('invalid-url')
  if (/비활성|채널 ID|API 활성/.test(raw)) return make('setup')
  if (/quota|dailyLimit|한도/i.test(raw)) return make('quota')
  if (/찾을 수 없|not found|메타데이터/i.test(raw)) return make('not-found')
  if (/at least 1|>=\s*1|too small|required/i.test(raw)) return make('stock-missing')

  if (input.probe === 'not-found') return make('not-found')
  if (input.probe === 'quota') return make('quota')
  if (input.probe === 'key') return make('key')
  return make('server')
}

// 등록이 "원인을 알 수 없는 서버 오류"로 끝났는지(=미리보기로 원인을 한 번 더 확인할 가치가 있는지)
export function isVagueServerFailure(status: number, raw?: string | null): boolean {
  if (status < 500) return false
  return classifyRegisterFailure({ status, raw }).kind === 'server'
}

// ─────────────────────────────────────────────────────────────
// 되돌리기(undo) 상태 기계
// ─────────────────────────────────────────────────────────────
export const UNDO_WINDOW_MS = 10_000
export const UNDO_DONE_MS = 4_000

export type UndoPlan =
  | { kind: 'delete' } // 새로 등록한 영상: 지운다
  | { kind: 'restore'; stock: string | null; type: ContentType } // 이미 있던 영상을 덮어쓴 경우: 이전 종목·형식으로 돌린다
  | { kind: 'none' } // 남의 영상 등 되돌릴 수 없는 경우

export type UndoEntry = { id: string; stock: string; plan: UndoPlan }

export type UndoState =
  | { phase: 'idle' }
  | { phase: 'open'; entry: UndoEntry; expiresAt: number }
  | { phase: 'working'; entry: UndoEntry }
  | { phase: 'done'; entry: UndoEntry; until: number }
  | { phase: 'failed'; entry: UndoEntry; message: string }

export type UndoEvent =
  | { type: 'registered'; entry: UndoEntry; now: number }
  | { type: 'tick'; now: number }
  | { type: 'start'; now: number }
  | { type: 'succeeded'; id: string; now: number }
  | { type: 'failed'; id: string; message: string }
  | { type: 'dismiss' }

export const UNDO_IDLE: UndoState = { phase: 'idle' }

export function undoReduce(state: UndoState, event: UndoEvent): UndoState {
  switch (event.type) {
    case 'registered': {
      // 되돌리는 중에 새로 등록해도, 되돌리는 요청 결과는 아래 id 확인으로 걸러진다.
      if (event.entry.plan.kind === 'none') return UNDO_IDLE
      return { phase: 'open', entry: event.entry, expiresAt: event.now + UNDO_WINDOW_MS }
    }
    case 'tick': {
      if (state.phase === 'open' && event.now >= state.expiresAt) return UNDO_IDLE
      if (state.phase === 'done' && event.now >= state.until) return UNDO_IDLE
      return state
    }
    case 'start': {
      if (state.phase === 'open') {
        if (event.now >= state.expiresAt) return UNDO_IDLE // 시간이 막 지난 순간의 클릭은 무시
        return { phase: 'working', entry: state.entry }
      }
      if (state.phase === 'failed') return { phase: 'working', entry: state.entry }
      return state
    }
    case 'succeeded': {
      if (state.phase === 'working' && state.entry.id === event.id) return { phase: 'done', entry: state.entry, until: event.now + UNDO_DONE_MS }
      return state
    }
    case 'failed': {
      if (state.phase === 'working' && state.entry.id === event.id) return { phase: 'failed', entry: state.entry, message: event.message }
      return state
    }
    case 'dismiss':
      return state.phase === 'working' ? state : UNDO_IDLE
  }
}

// 남은 초(올림). 열려 있지 않으면 0.
export function undoSecondsLeft(state: UndoState, now: number): number {
  if (state.phase !== 'open') return 0
  return Math.max(0, Math.ceil((state.expiresAt - now) / 1000))
}
