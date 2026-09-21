// 영상 등록 화면에서 함께 쓰는 순수 함수 모음(서버 코드 없음).

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

// 서버가 돌려주는 오류 문장을 사용자가 바로 이해할 수 있는 한 줄로 바꾼다.
export function friendlyRegisterError(message: string | undefined, status?: number): string {
  const m = String(message || '')
  if (status === 401 || /로그인이 필요/.test(m)) return '로그인 시간이 지났어요. 다시 로그인해 주세요.'
  if (/유효한 유튜브|유효하지 않|invalid url|주소가 올바르지/i.test(m)) return '유효하지 않은 주소예요. 유튜브 영상 주소를 확인해 주세요.'
  if (/이미 등록/.test(m)) return '이미 등록된 영상이에요.'
  if (/메타데이터|찾을 수 없/.test(m)) return '영상을 찾지 못했어요. 주소가 맞는지, 비공개 영상은 아닌지 확인해 주세요.'
  if (/quota|한도|api ?key|API 키|API가 비활성|API 활성화|채널 ID/i.test(m)) return '잠시 후 다시 시도해 주세요.'
  return '등록하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

// 수정·삭제 API 오류(서버가 한국어로 내려주므로 대부분 그대로 쓴다)
export function friendlyEditError(message: string | undefined, status: number | undefined, fallback: string): string {
  const m = String(message || '')
  if (status === 401 || /로그인이 필요/.test(m)) return '로그인 시간이 지났어요. 다시 로그인해 주세요.'
  if (status === 403 || status === 404 || status === 400) return m || fallback
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
