// 영상 등록 화면에서 함께 쓰는 순수 함수 모음(서버 코드 없음).

// 서버·라이브러리가 돌려준 문장이 한글일 때만 화면에 그대로 보여 주고, 영문 오류("Failed to fetch" 등)는 준비해 둔 문장으로 바꾼다.
export function koreanOr(message: unknown, fallback: string): string {
  return typeof message === 'string' && /[가-힣]/.test(message) ? message : fallback
}

// 한글 입력(IME)으로 글자를 조립하는 중인지. Chrome 은 isComposing 으로, Safari 는 조립을 끝내는 Enter 에서 keyCode 229 로 알려 준다.
// 이 상태의 Enter·Esc 는 "글자 확정/취소"이므로 등록·저장 같은 동작으로 쓰면 안 된다.
export function isImeKey(e: { keyCode?: number; nativeEvent?: { isComposing?: boolean } }): boolean {
  return Boolean(e.nativeEvent?.isComposing) || e.keyCode === 229
}

// 유튜브 주소처럼 보이는 조각인지: (https://)(www.|m.|music.)youtube.com/… , youtu.be/… 만 인정한다.
// 예전에는 "YouTube"라는 단어(공유 문구의 "제목 - YouTube")까지 주소로 착각했다.
const YT_TOKEN = /^(?:https?:\/\/)?(?:[\w-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(?:[/?#:]|$)/i
const LEADING_JUNK = /^[(\[{<'"“‘「『]+/
const TRAILING_JUNK = /[)\]}>.,;!'"”’」』]+$/

function cleanToken(token: string): string {
  return token.replace(LEADING_JUNK, '').replace(TRAILING_JUNK, '')
}

export function isYoutubeToken(token: string): boolean {
  return YT_TOKEN.test(cleanToken(token))
}

// 글 안에서 첫 번째 유튜브 주소 조각(괄호·마침표 등 앞뒤 기호는 뗀 것). 없으면 null.
export function findYoutubeToken(raw: string): string | null {
  for (const t of raw.split(/\s+/)) {
    const c = cleanToken(t)
    if (c && YT_TOKEN.test(c)) return c
  }
  return null
}

export function hasYoutubeUrl(raw: string): boolean {
  return findYoutubeToken(raw) !== null
}

// 앞뒤 공백·줄바꿈 제거, "제목 + 주소"처럼 섞여 있으면 주소 부분만, https:// 가 없으면 붙여 준다.
export function normalizeYoutubeUrl(raw: string): string {
  const token = findYoutubeToken(raw) ?? raw.split(/\s+/).map(cleanToken).find(Boolean)
  if (!token) return ''
  return /^https?:\/\//i.test(token) ? token : `https://${token.replace(/^\/+/, '')}`
}

// 붙여넣은 글에 들어 있는 서로 다른 유튜브 영상 주소를 모두(같은 영상은 한 번만).
export function extractYoutubeUrls(raw: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw.split(/\s+/)) {
    const c = cleanToken(t)
    if (!c || !YT_TOKEN.test(c)) continue
    const url = normalizeYoutubeUrl(c)
    const key = youtubeVideoId(url) || url
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m|music)\./, '')
    if (host === 'youtu.be') return u.pathname.split('/')[1] || null
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null
    const v = u.searchParams.get('v')
    if (v) return v
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

export function isShortsUrl(url: string): boolean {
  return /\/shorts\//i.test(url)
}

// ---- 주소 종류 나누기: 영상 주소가 아니면 "무엇이 잘못됐고 무엇을 하면 되는지"를 종류별로 알려 주기 위해 ----
export type UrlCheck =
  | { kind: 'empty' }
  | { kind: 'ok'; url: string; videoId: string; shorts: boolean; inPlaylist: boolean }
  | { kind: 'not-youtube' }
  | { kind: 'playlist' }
  | { kind: 'channel' }
  | { kind: 'no-video' }
  | { kind: 'bad-id' }

const VIDEO_ID_SHAPE = /^[\w-]{11}$/
const CHANNEL_PATH = /^\/(?:@|channel\/|c\/|user\/)/i

export function checkYoutubeInput(raw: string): UrlCheck {
  if (!raw || !raw.trim()) return { kind: 'empty' }
  if (!findYoutubeToken(raw)) return { kind: 'not-youtube' }
  const url = normalizeYoutubeUrl(raw)
  const videoId = youtubeVideoId(url)
  if (videoId) {
    if (!VIDEO_ID_SHAPE.test(videoId)) return { kind: 'bad-id' }
    let inPlaylist = false
    try {
      inPlaylist = new URL(url).searchParams.has('list')
    } catch {
      inPlaylist = false
    }
    return { kind: 'ok', url, videoId, shorts: isShortsUrl(url), inPlaylist }
  }
  try {
    const path = new URL(url).pathname
    if (/^\/playlist\/?$/i.test(path)) return { kind: 'playlist' }
    if (CHANNEL_PATH.test(path)) return { kind: 'channel' }
  } catch {
    return { kind: 'not-youtube' }
  }
  return { kind: 'no-video' }
}

// 주소 칸 아래에 보여 줄 한 문장(무엇이 문제인지 + 무엇을 하면 되는지)
export function urlProblemText(check: UrlCheck): string {
  switch (check.kind) {
    case 'empty':
      return '유튜브 주소를 붙여 넣어 주세요.'
    case 'not-youtube':
      return '유튜브 주소가 아닌 것 같아요. 영상을 열어 주소창의 주소(또는 공유 > 복사)를 붙여 넣어 주세요.'
    case 'playlist':
      return '재생목록 주소예요. 재생목록 안의 영상 하나를 열어서 그 영상의 주소를 붙여 넣어 주세요.'
    case 'channel':
      return '채널 주소예요. 등록할 영상을 열어서 그 영상의 주소를 붙여 넣어 주세요.'
    case 'no-video':
      return '영상 주소가 아니에요. 등록할 영상을 열어서 그 영상의 주소를 붙여 넣어 주세요.'
    case 'bad-id':
      return '주소가 중간에 잘린 것 같아요. 주소 전체를 다시 복사해서 붙여 넣어 주세요.'
    default:
      return ''
  }
}

// ---- 등록 오류 문구 ----
// /api/videos/create 가 돌려줄 수 있는 것:
//  · 유튜브 주소 검사 실패("유효한 유튜브 영상 주소가 아닙니다." / zod "Invalid URL")
//  · API 비활성·채널 ID 없음(관리자 설정 문제)
//  · "유튜브 영상 메타데이터를 찾을 수 없습니다." — 삭제·비공개·틀린 주소, 그리고 호출 한도 초과/키 오류도 같은 문장으로 나온다
//  · "영상 저장 실패"·"채널 생성 실패" 등 500, 토큰 만료도 운영에서는 "영상 저장 실패"(500)로 나올 수 있다
export type RegisterErrorKind = 'session' | 'network' | 'invalid' | 'config' | 'quota' | 'notfound' | 'exists' | 'forbidden' | 'unknown'
export type RegisterError = { kind: RegisterErrorKind; text: string; retry: boolean }

export function describeRegisterError(message: string | undefined, status?: number): RegisterError {
  const m = String(message || '')
  if (status === 0) {
    return { kind: 'network', retry: true, text: '인터넷 연결이 불안정해서 등록하지 못했어요. 적은 내용은 그대로 두었으니 연결을 확인한 뒤 「다시 시도」를 눌러 주세요.' }
  }
  if (status === 401 || /로그인이 필요/.test(m)) {
    return { kind: 'session', retry: false, text: '로그인 시간이 지났어요. 「다시 로그인」을 누르면 지금 적은 내용을 그대로 두고 돌아와요.' }
  }
  if (status === 403 || /권한이 필요|권한이 없/.test(m)) {
    return { kind: 'forbidden', retry: false, text: '이 계정으로는 등록할 수 없어요. 관리자에게 계정 권한을 확인해 달라고 알려 주세요.' }
  }
  if (/API가 비활성|API 활성화|채널 ID/.test(m)) {
    return { kind: 'config', retry: false, text: '아직 유튜브 연결이 준비되지 않아 등록할 수 없어요. 관리자에게 알려 주세요.' }
  }
  if (/유효한 유튜브|유효하지 않|invalid url|주소가 올바르지/i.test(m)) {
    return { kind: 'invalid', retry: false, text: '유튜브 영상 주소로 인식하지 못했어요. 영상의 주소를 다시 복사해서 붙여 넣어 주세요.' }
  }
  if (/quota|한도|rate ?limit|too many|api ?key|API 키/i.test(m) || status === 429) {
    return { kind: 'quota', retry: true, text: '유튜브 조회가 잠시 막혀 있어요. 몇 분 뒤에 「다시 시도」를 눌러 보고, 계속 안 되면 관리자에게 알려 주세요.' }
  }
  if (/이미 등록/.test(m)) {
    return { kind: 'exists', retry: false, text: '이미 등록된 영상이에요. 종목만 바꾸려면 아래 목록에서 「수정」을 눌러 주세요.' }
  }
  if (/메타데이터|찾을 수 없|not found/i.test(m)) {
    return {
      kind: 'notfound',
      retry: true,
      text: '유튜브에서 영상 정보를 찾지 못했어요. 삭제·비공개 영상이거나 주소가 틀렸는지 확인하고, 영상이 열리는데도 안 되면 잠시 뒤 「다시 시도」를 눌러 주세요.'
    }
  }
  return { kind: 'unknown', retry: true, text: '등록 중에 서버에 문제가 생겼어요. 잠시 뒤 「다시 시도」를 눌러 보고, 계속되면 관리자에게 알려 주세요.' }
}

// 여러 개 붙여넣기 표처럼 버튼이 없는 곳에서 쓰는 한 줄(같은 분류를 쓴다)
export function friendlyRegisterError(message: string | undefined, status?: number): string {
  const err = describeRegisterError(message, status)
  if (err.kind === 'session') return '로그인 시간이 지났어요. 화면을 새로고침해서 다시 로그인해 주세요.'
  return err.text
}

// 수정·삭제 API 오류(서버가 한국어로 내려주므로 대부분 그대로 쓴다)
export function friendlyEditError(message: string | undefined, status: number | undefined, fallback: string): string {
  const m = String(message || '')
  if (status === 401 || /로그인이 필요/.test(m)) return '로그인 시간이 지났어요. 다시 로그인해 주세요.'
  if (status === 403 || status === 404 || status === 400 || status === 409) return m || fallback
  return fallback
}

// ---- 여러 개 붙여넣기 ----
export type ParsedLine = {
  key: string // 영상 ID(주소가 잘못된 줄은 줄 번호)
  line: number // 붙여넣은 글에서의 줄 번호(1부터)
  url: string
  videoId: string | null
  stock: string // 그 줄에 적혀 있던 종목명(없으면 빈 문자열)
  isShorts: boolean
}

export type ParsedBulk = { rows: ParsedLine[]; duplicates: number }

const SEPARATORS = /^[\s,;|:·\-–—>]+|[\s,;|:·\-–—>]+$/g

// 한 줄에 `주소 [종목명]`(종목이 앞에 와도 됨). 같은 영상이 두 번 나오면 첫 줄만 남긴다.
export function parseBulkText(text: string): ParsedBulk {
  const rows: ParsedLine[] = []
  const seen = new Set<string>()
  let duplicates = 0
  const lines = text.split(/\r?\n/)

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim()
    if (!trimmed) return
    const tokens = trimmed.split(/\s+/)
    let urlIndex = tokens.findIndex((t) => isYoutubeToken(t))
    if (urlIndex < 0) urlIndex = tokens.findIndex((t) => /^https?:\/\//i.test(t))
    if (urlIndex < 0) urlIndex = 0
    const rawUrl = tokens[urlIndex]
    const stock = tokens
      .filter((_, i) => i !== urlIndex)
      .join(' ')
      .replace(SEPARATORS, '')
      .replace(/\s+/g, ' ')
      .trim()
    const url = normalizeYoutubeUrl(rawUrl)
    const videoId = youtubeVideoId(url)
    const key = videoId || `line-${index + 1}`
    if (videoId) {
      if (seen.has(videoId)) {
        duplicates += 1
        return
      }
      seen.add(videoId)
    }
    rows.push({ key, line: index + 1, url, videoId, stock, isShorts: isShortsUrl(url) })
  })

  return { rows, duplicates }
}
