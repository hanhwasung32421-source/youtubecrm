// 영상 등록 화면의 "판단" 부분만 모은 순수 함수 (React·브라우저 의존 없음 → 테스트하기 쉽다).
//  - 주소 종류 진단(재생목록·채널·영상 아님) + 안내 문장
//  - 이미 등록한 영상인지 찾기
//  - 오늘 등록한 종목별 개수
//  - 오늘 목표 개수(내 이번 달 목표에서 계산, 없으면 기본값) + 진행 안내 문장
//  - 등록 실패 이유 → "무슨 일이 있었고 이제 뭘 하면 되는지" 한 문장

import { extractVideoId, isYoutubeUrl } from '@/components/v4/register-utils'

export const DEFAULT_DAILY_TARGET = 12

// ---------------------------------------------------------------- 주소 진단

export type UrlDiagnosis =
  | { ok: true }
  | { ok: false; kind: 'empty' | 'not-youtube' | 'playlist' | 'channel' | 'no-video'; message: string }

const MSG = {
  empty: '유튜브 주소를 붙여넣어 주세요.',
  notYoutube: '유튜브 주소가 아니에요. youtube.com 또는 youtu.be 로 시작하는 영상 주소를 붙여넣어 주세요.',
  playlist: '재생목록 주소예요. 재생목록에서 영상 하나를 열고, 그때 나오는 영상 주소를 붙여넣어 주세요. (여러 개는 "여러 개 붙여넣기"가 편해요)',
  channel: '채널 주소예요. 채널이 아니라 영상 하나의 주소(영상을 열었을 때의 주소)를 붙여넣어 주세요.',
  noVideo: '영상 주소가 아니에요. 영상을 열어서 주소창이나 공유 버튼의 주소를 복사해 붙여넣어 주세요.'
} as const

// 이미 normalizeYoutubeUrl 로 정리된 주소를 받는다. 쇼츠(/shorts/ID)는 정상 주소다 (등록할 때 자동으로 바꿔 보낸다).
export function diagnoseYoutubeUrl(value: string): UrlDiagnosis {
  const text = (value || '').trim()
  if (!text) return { ok: false, kind: 'empty', message: MSG.empty }
  if (!isYoutubeUrl(text)) return { ok: false, kind: 'not-youtube', message: MSG.notYoutube }
  if (extractVideoId(text)) return { ok: true }
  let path = ''
  try {
    path = new URL(text).pathname
  } catch {
    return { ok: false, kind: 'not-youtube', message: MSG.notYoutube }
  }
  if (/^\/playlist\/?$/.test(path)) return { ok: false, kind: 'playlist', message: MSG.playlist }
  if (/^\/(?:@|channel\/|c\/|user\/)/.test(path)) return { ok: false, kind: 'channel', message: MSG.channel }
  return { ok: false, kind: 'no-video', message: MSG.noVideo }
}

// ---------------------------------------------------------------- 이미 등록한 영상 찾기

export type KnownVideo = {
  id: string
  stock_name: string
  content_type: string
  created_at: string | null
  youtube_url: string | null
}

// 영상 고유 ID → 등록된 영상. 목록은 최신순이므로 같은 ID 가 겹치면 먼저 나온 것(최신)을 쓴다.
export function buildVideoIndex<T extends KnownVideo>(items: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const id = item.youtube_url ? extractVideoId(item.youtube_url) : ''
    if (id && !map.has(id)) map.set(id, item)
  }
  return map
}

export function findDuplicate<T extends KnownVideo>(index: Map<string, T>, normalizedUrl: string): T | null {
  if (!normalizedUrl || !isYoutubeUrl(normalizedUrl)) return null
  const id = extractVideoId(normalizedUrl)
  return (id && index.get(id)) || null
}

const KST_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })

// 한국 시간 기준 날짜 (YYYY-MM-DD). 잘못된 값이면 ''.
export function kstYmdOfIso(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return KST_PARTS.format(t)
}

// "9/20" 형태 (한국 시간 기준). 잘못된 값이면 ''.
export function fmtMonthDay(iso: string | null | undefined): string {
  const ymd = kstYmdOfIso(iso)
  if (!ymd) return ''
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}`
}

export function duplicateMessage(known: KnownVideo, isAdmin: boolean): string {
  const when = fmtMonthDay(known.created_at)
  const head = isAdmin ? '이미 등록된 영상이에요' : '이미 등록한 영상이에요'
  return when ? `${head} (${when} 등록)` : head
}

// 이미 등록된 영상에 지금 적은 종목/형식을 어떻게 할지
//  same    : 종목이 같다 → 할 일 없음 (주소만 지우면 된다)
//  change  : 종목이 다르다 → "종목만 바꾸기"를 권한다
//  no-stock: 아직 종목을 안 적었다
export function duplicateChoice(known: KnownVideo, typedStock: string): { kind: 'same' | 'change' | 'no-stock'; stock: string } {
  const typed = (typedStock || '').replace(/\s+/g, ' ').trim()
  if (!typed) return { kind: 'no-stock', stock: '' }
  if (typed === (known.stock_name || '').replace(/\s+/g, ' ').trim()) return { kind: 'same', stock: typed }
  return { kind: 'change', stock: typed }
}

// ---------------------------------------------------------------- 오늘 등록한 종목별 개수

export type StockCount = { stock: string; count: number }

// 오늘(한국 시간) 등록된 것만 종목별로 센다. 많은 순, 같으면 이름순.
export function groupTodayByStock(items: Array<{ stock_name: string | null; created_at: string | null }>, todayYmd: string): StockCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!todayYmd || kstYmdOfIso(item.created_at) !== todayYmd) continue
    const stock = (item.stock_name || '').replace(/\s+/g, ' ').trim() || '종목 없음'
    counts.set(stock, (counts.get(stock) || 0) + 1)
  }
  return Array.from(counts, ([stock, count]) => ({ stock, count })).sort((a, b) => b.count - a.count || a.stock.localeCompare(b.stock, 'ko'))
}

// ---------------------------------------------------------------- 오늘 목표

export type GoalLite = { userId: string | null; targetVideos: number }

export function daysInMonthOf(ym: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return 30
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return 30
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// 내 이번 달 목표(개인 목표)가 있으면 그것을 이번 달 일수로 나눈 값, 없으면 기본 12개.
// 팀 목표만 있을 땐 1인당 몫을 알 수 없어 기본값을 쓴다. 샘플 데이터(실제 목표 아님)도 기본값.
export function dailyTargetFromGoals(
  goals: GoalLite[] | null | undefined,
  userId: string,
  opts: { sample?: boolean; daysInMonth?: number; fallback?: number } = {}
): { target: number; source: 'personal' | 'default' } {
  const fallback = opts.fallback ?? DEFAULT_DAILY_TARGET
  if (!goals || opts.sample || !userId) return { target: fallback, source: 'default' }
  const mine = goals.find((g) => g.userId === userId && Number.isFinite(g.targetVideos) && g.targetVideos > 0)
  if (!mine) return { target: fallback, source: 'default' }
  const days = Math.max(opts.daysInMonth ?? 30, 1)
  return { target: Math.max(1, Math.round(mine.targetVideos / days)), source: 'personal' }
}

export type ProgressCopy = { ratio: number; tone: 'idle' | 'going' | 'done'; text: string }

// 차분한 한 줄 응원. 숫자를 재촉하지 않는다.
export function progressCopy(count: number | null, target: number): ProgressCopy {
  if (count === null || !Number.isFinite(count)) return { ratio: 0, tone: 'idle', text: '' }
  const goal = Math.max(1, target)
  const ratio = Math.min(1, count / goal)
  if (count <= 0) return { ratio: 0, tone: 'idle', text: '오늘 첫 영상을 등록해 보세요.' }
  if (count >= goal) {
    return { ratio: 1, tone: 'done', text: count === goal ? '오늘 목표를 채웠어요. 수고하셨어요.' : '오늘 목표를 넘겼어요. 수고하셨어요.' }
  }
  const remaining = goal - count
  if (remaining <= 3) return { ratio, tone: 'going', text: `거의 다 왔어요. ${remaining}개만 더 하면 목표예요.` }
  if (ratio < 0.5) return { ratio, tone: 'going', text: `좋은 출발이에요. 목표까지 ${remaining}개 남았어요.` }
  return { ratio, tone: 'going', text: `잘하고 있어요. 목표까지 ${remaining}개 남았어요.` }
}

// ---------------------------------------------------------------- 등록 실패 → 쉬운 한 문장

export type RegisterErrorKind = 'auth' | 'network' | 'invalid' | 'notfound' | 'quota' | 'config' | 'stock' | 'server' | 'other'
export type RegisterErrorCopy = { kind: RegisterErrorKind; message: string; retry: boolean }

export const NETWORK_COPY = '인터넷 연결이 끊긴 것 같아요. 입력한 내용은 그대로 두었어요. 연결을 확인하고 "다시 시도"를 눌러 주세요.'
export const AUTH_COPY = '로그인이 풀렸어요. 입력한 내용은 그대로 두었어요. "다시 로그인"을 누르고, 돌아와서 "다시 시도"를 눌러 주세요.'

// status: HTTP 상태(네트워크 실패면 0), raw: 서버가 준 error 문장(없을 수 있음)
// 참고: 공유 등록 API 는 운영 환경에서 대부분의 실패를 "영상 저장 실패"(500) 한 문장으로만 돌려준다.
//       그래서 이유를 알 수 없는 500 은 "삭제·비공개·조회 한도" 가능성을 함께 알려 주고 "다시 시도"를 권한다.
export function registerErrorCopy(status: number, raw?: string | null): RegisterErrorCopy {
  const text = String(raw || '')
  if (status === 401) return { kind: 'auth', message: AUTH_COPY, retry: true }
  if (/로그인이 필요/.test(text)) return { kind: 'auth', message: AUTH_COPY, retry: true }
  if (/유효한 유튜브|invalid url|유효하지/i.test(text)) {
    return { kind: 'invalid', message: '유효한 영상 주소가 아니에요. 영상 하나를 열었을 때의 주소를 다시 복사해 붙여넣어 주세요.', retry: false }
  }
  if (/API가 비활성|채널 ID/.test(text)) {
    return { kind: 'config', message: '유튜브 연결 설정이 아직 끝나지 않았어요. 관리자에게 "유튜브 계정 설정을 확인해 달라"고 알려 주세요.', retry: false }
  }
  if (/메타데이터|찾을 수 없|not found/i.test(text)) {
    return {
      kind: 'notfound',
      message: '유튜브에서 영상을 찾지 못했어요. 삭제됐거나 비공개 영상일 수 있어요. 공개(또는 일부 공개)로 바꾼 뒤 다시 시도하거나, 주소를 확인해 주세요.',
      retry: true
    }
  }
  if (/quota|한도|rate limit|too many|exceeded/i.test(text) || status === 429 || status === 403) {
    return { kind: 'quota', message: '유튜브 조회 한도에 걸린 것 같아요. 몇 분 뒤에 "다시 시도"를 눌러 주세요. 계속되면 관리자에게 알려 주세요.', retry: true }
  }
  if (/too small|종목|required/i.test(text)) {
    return { kind: 'stock', message: '종목명이 비어 있어요. 종목명을 적고 다시 등록해 주세요.', retry: false }
  }
  if (status >= 500) {
    return {
      kind: 'server',
      message: '유튜브에서 영상 정보를 가져오지 못했어요. 삭제·비공개 영상이거나 조회 한도 때문일 수 있어요. 주소를 확인하고 "다시 시도"를 눌러 주세요.',
      retry: true
    }
  }
  return { kind: 'other', message: '등록하지 못했어요. 주소와 종목명을 확인하고 "다시 시도"를 눌러 주세요.', retry: true }
}

// 이 문장에 "다시 로그인"이 들어 있으면 화면에 로그인 링크를 함께 보여 준다.
export function needsRelogin(message: string | null | undefined): boolean {
  return /다시 로그인/.test(message || '')
}

// 수정·삭제 같은 "내 영상 바꾸기" 실패 문장. 서버가 쉬운 한글 문장을 주면 그대로 쓴다.
export function mutationErrorCopy(status: number, serverMessage: string | undefined, action: '고치지' | '지우지' | '되돌리지'): string {
  if (status === 401) return '로그인이 풀렸어요. "다시 로그인"을 누르고 돌아와서 다시 해 주세요.'
  if (status >= 400 && status < 500 && serverMessage && /[가-힣]/.test(serverMessage)) return serverMessage
  return `${action} 못했어요. 잠시 후 다시 시도해 주세요.`
}
