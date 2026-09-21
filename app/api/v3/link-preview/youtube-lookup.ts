// 유튜브 영상 정보 조회(미리보기용). 공용 fetchYoutubeVideoMeta는 "영상 없음"과 "하루 한도 초과·키 오류"를
// 똑같은 오류로 던져서 화면이 원인을 알려 줄 수 없다. 여기서는 원인을 구분해서 돌려준다.
// (공용 lib/youtube/api.ts 는 그대로 두고, 이 화면의 미리보기에서만 쓴다.)

export type LookupCode = 'not-found' | 'quota' | 'key' | 'unknown'

export type LookupMeta = {
  title: string
  channelName: string
  thumbnailUrl: string | null
  publishedAt: string | null
  viewCount: number
  durationSeconds: number | null
  privacyStatus: string | null
}

export type LookupResult = { ok: true; meta: LookupMeta } | { ok: false; code: LookupCode }

type YoutubeJson = {
  error?: { code?: number; message?: string; status?: string; errors?: Array<{ reason?: string }> }
  items?: Array<{
    snippet?: { title?: string; publishedAt?: string; channelTitle?: string; thumbnails?: Record<string, { url: string }> }
    contentDetails?: { duration?: string }
    status?: { privacyStatus?: string }
    statistics?: { viewCount?: string }
  }>
}

// ── 입력 검사 ──────────────────────────────────────────────
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const MAX_URL_LENGTH = 300

// 유튜브 영상 주소에서 영상 번호(11자)만 꺼낸다. 유튜브 주소가 아니거나 번호가 정확하지 않으면 빈 문자열. (순수 함수)
export function parseVideoId(input: string): string {
  const raw = (input || '').trim()
  if (!raw || raw.length > MAX_URL_LENGTH) return ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  let id = ''
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0] || ''
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const parts = url.pathname.split('/').filter(Boolean)
    id = ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] || '' : url.searchParams.get('v') || ''
  }
  return VIDEO_ID.test(id) ? id : ''
}

// ── 사용 횟수 제한(서버 한 대 안에서만 세는 간단한 방식) ──────────────
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 60
const hits = new Map<string, number[]>()

export function checkRate(key: string, now: number = Date.now()): boolean {
  const recent = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 500) {
    for (const [k, list] of hits) if (list.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k)
  }
  return true
}

const FETCH_TIMEOUT_MS = 6000

const QUOTA_REASONS = ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded']
const KEY_REASONS = ['keyInvalid', 'keyExpired', 'accessNotConfigured', 'ipRefererBlocked', 'forbidden', 'API_KEY_INVALID', 'badRequest']

function parseDuration(duration: string | undefined): number | null {
  if (!duration) return null
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return null
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
}

// 유튜브가 돌려준 응답을 원인별로 나눈다. (순수 함수)
export function classifyYoutubeResponse(httpStatus: number, json: YoutubeJson | null | undefined): LookupResult {
  const body = json || {}
  if (body.error || httpStatus >= 400) {
    const reason = body.error?.errors?.[0]?.reason || body.error?.status || ''
    const message = body.error?.message || ''
    if (QUOTA_REASONS.includes(reason) || /quota/i.test(message)) return { ok: false, code: 'quota' }
    if (KEY_REASONS.includes(reason) || /api key|not valid|not configured|has not been used/i.test(message) || httpStatus === 403 || httpStatus === 401) {
      return { ok: false, code: 'key' }
    }
    return { ok: false, code: 'unknown' }
  }

  const item = body.items?.[0]
  if (!item?.snippet) return { ok: false, code: 'not-found' } // 삭제됐거나 비공개인 영상은 목록이 비어 돌아온다.

  const thumbs = item.snippet.thumbnails || {}
  return {
    ok: true,
    meta: {
      title: item.snippet.title || '',
      channelName: item.snippet.channelTitle || '',
      thumbnailUrl: thumbs.medium?.url || thumbs.high?.url || thumbs.default?.url || thumbs.maxres?.url || null,
      publishedAt: item.snippet.publishedAt || null,
      viewCount: Number(item.statistics?.viewCount || 0),
      durationSeconds: parseDuration(item.contentDetails?.duration),
      privacyStatus: item.status?.privacyStatus || null
    }
  }
}

export async function lookupYoutubeVideo(videoId: string, apiKey: string): Promise<LookupResult> {
  const params = new URLSearchParams({ id: videoId, part: 'snippet,contentDetails,statistics,status', key: apiKey })
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    const json = (await response.json().catch(() => null)) as YoutubeJson | null
    return classifyYoutubeResponse(response.status, json)
  } catch {
    return { ok: false, code: 'unknown' }
  }
}
