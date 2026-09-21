// 영상 등록 화면(한 개씩 / 여러 개 / 수정)이 함께 쓰는 순수 도우미 모음.

import { authedPostJson } from '@/lib/session/authed-fetch'

export type ContentType = 'longform' | 'shortform'

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = { longform: '롱폼', shortform: '숏폼' }

// 하루 등록 목표(안내용 숫자일 뿐, 넘겨도 막지 않는다).
export const DAILY_GOAL = 12

// ---- 주소 정리 ------------------------------------------------------------

const YOUTUBE_URL_RE = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i

// 붙여넣은 글에서 유튜브 주소만 뽑아 정리한다. 앞뒤 공백/줄바꿈 제거, https:// 없으면 붙여 준다.
export function normalizeUrl(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  const match = text.match(YOUTUBE_URL_RE)
  const picked = match ? match[0] : text.split(/\s+/)[0]
  return /^https?:\/\//i.test(picked) ? picked : `https://${picked}`
}

export function extractVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/)
  return m ? m[1] : null
}

export function isYoutubeUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|music)\./, '')
    return host === 'youtube.com' || host === 'youtu.be'
  } catch {
    return false
  }
}

export function isShortsUrl(url: string) {
  return /youtube\.com\/shorts\//i.test(url)
}

// 서버는 ?v= 형태와 youtu.be 형태만 알아보므로(/shorts/ · /live/ · /embed/ 는 인식 못 함),
// 서버로 보낼 때는 항상 이 표준 주소로 바꿔서 보낸다.
export function canonicalWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`
}

// ---- 여러 줄 붙여넣기 해석 ----------------------------------------------------

export type ParsedLine = {
  raw: string
  videoId: string | null
  canonicalUrl: string
  stock: string
  type: ContentType
  problem: string
}

// 한 줄 = `주소 [종목명]` (종목이 주소 앞에 와도 된다).
export function parseBulkText(text: string): { lines: ParsedLine[]; duplicates: number } {
  const seen = new Map<string, number>()
  const lines: ParsedLine[] = []
  let duplicates = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue

    const match = raw.match(YOUTUBE_URL_RE)
    if (!match) {
      lines.push({ raw, videoId: null, canonicalUrl: '', stock: '', type: 'longform', problem: '유튜브 주소를 찾지 못했습니다.' })
      continue
    }

    const url = normalizeUrl(match[0])
    const videoId = extractVideoId(url)
    const stock = raw
      .replace(match[0], ' ')
      .replace(/^[\s,;|/\\\t·•-]+|[\s,;|/\\\t·•-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!videoId) {
      lines.push({ raw, videoId: null, canonicalUrl: '', stock, type: 'longform', problem: '유효하지 않은 주소입니다.' })
      continue
    }

    const at = seen.get(videoId)
    if (at !== undefined) {
      duplicates += 1
      // 먼저 나온 줄에 종목이 없고 이 줄에 있으면 채워 준다.
      if (!lines[at].stock && stock) lines[at].stock = stock
      continue
    }

    seen.set(videoId, lines.length)
    lines.push({
      raw,
      videoId,
      canonicalUrl: canonicalWatchUrl(videoId),
      stock,
      type: isShortsUrl(url) ? 'shortform' : 'longform',
      problem: ''
    })
  }

  return { lines, duplicates }
}

// ---- 한국 시간 -----------------------------------------------------------------

const kstFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
const kstTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })

export function kstYmd(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '' : kstFormatter.format(d)
}

export function formatKstWhen(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  const hm = kstTimeFormatter.format(d)
  const ymd = kstYmd(d)
  return ymd === kstYmd(new Date()) ? hm : `${ymd.slice(5)} ${hm}`
}

// ---- 오류 문구 -----------------------------------------------------------------

// 서버/네트워크 오류를 비개발자가 읽을 수 있는 한 줄로 바꾼다.
export function friendlyError(input: unknown, status?: number): string {
  if (input instanceof TypeError || (input instanceof Error && /failed to fetch|network|load failed/i.test(input.message))) {
    return '인터넷 연결을 확인해 주세요.'
  }
  const message = typeof input === 'string' ? input : input instanceof Error ? input.message : ''

  if (status === 401) return '로그인이 만료되었습니다. 다시 로그인해 주세요.'
  if ((status === 403 || status === 404) && /[가-힣]/.test(message)) return message.replace(/\s*\(.*\)\s*$/, '')
  if (/이미 등록/.test(message)) return '이미 등록된 영상입니다.'
  if (/quota|limit|api\s*key|api 키|apikey|forbidden|rate|한도|비활성|API가|채널 ID/i.test(message)) return '잠시 후 다시 시도해 주세요.'
  if (/유효|invalid|url|주소/i.test(message)) return '유효하지 않은 주소입니다.'
  if (/찾을 수 없|not found/i.test(message)) return '영상을 찾을 수 없습니다. 주소를 확인해 주세요.'
  if (status && status >= 500) return '잠시 후 다시 시도해 주세요.'
  // 서버가 한글로 준 한 줄 안내는 그대로 쓴다. (개발 환경의 원본 오류가 덧붙은 경우는 잘라낸다)
  const korean = message.replace(/\s*\(.*\)\s*$/, '').trim()
  if (korean && /[가-힣]/.test(korean) && korean.length <= 80) return korean
  return '잠시 후 다시 시도해 주세요.'
}

// ---- 등록 호출 -----------------------------------------------------------------

export type RegisterInput = { videoId: string; contentType: ContentType; stockName: string; contentCategory?: string }
export type RegisterResult = { ok: true; id: string; title: string | null } | { ok: false; message: string }

// 한 개 등록. 예외를 던지지 않고 결과로 돌려주므로 여러 개 등록 중에도 흐름이 끊기지 않는다.
export async function registerVideo(input: RegisterInput): Promise<RegisterResult> {
  try {
    const res = await authedPostJson<{ ok?: boolean; video?: { id: string; title: string | null }; error?: string }>('/api/videos/create', {
      youtubeUrl: canonicalWatchUrl(input.videoId),
      contentType: input.contentType,
      stockName: input.stockName,
      contentCategory: input.contentCategory || undefined
    })
    if (!res.ok || !res.data.video) return { ok: false, message: friendlyError(res.data?.error || '', res.status) }
    return { ok: true, id: res.data.video.id, title: res.data.video.title || null }
  } catch (e) {
    return { ok: false, message: friendlyError(e) }
  }
}
