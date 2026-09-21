// 유튜브 통계를 여러 영상 묶어서(최대 50개) 한 번에 가져온다(서버 전용).
// videos.list 는 id 를 쉼표로 50개까지 받고 호출 1회당 쿼터 1이라, 영상마다 부르는 것보다 최대 50배 아낀다.

export type YoutubeStats = {
  viewCount: number | null
  likeCount: number | null // 좋아요를 숨긴 영상은 null (기존 값을 덮어쓰지 않는다)
  commentCount: number | null // 댓글을 막은 영상은 null
  privacyStatus: string | null
}

export class YoutubeApiError extends Error {
  constructor(
    message: string,
    public kind: 'quota' | 'key' | 'network' | 'other'
  ) {
    super(message)
  }
}

export const YOUTUBE_BATCH_SIZE = 50

const toNumberOrNull = (v: string | undefined) => {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchYoutubeStatsBatch(ids: string[], apiKey: string): Promise<Map<string, YoutubeStats>> {
  const out = new Map<string, YoutubeStats>()
  if (ids.length === 0) return out
  if (ids.length > YOUTUBE_BATCH_SIZE) throw new Error('한 번에 50개까지만 조회할 수 있습니다.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  let response: Response
  try {
    response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(ids.join(','))}&part=statistics,status&maxResults=${YOUTUBE_BATCH_SIZE}&key=${encodeURIComponent(apiKey)}`,
      { cache: 'no-store', signal: controller.signal }
    )
  } catch {
    throw new YoutubeApiError('유튜브에 연결하지 못했어요.', 'network')
  } finally {
    clearTimeout(timer)
  }

  const json = (await response.json().catch(() => ({}))) as {
    error?: { errors?: Array<{ reason?: string }>; message?: string }
    items?: Array<{
      id: string
      status?: { privacyStatus?: string }
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
    }>
  }

  if (!response.ok) {
    const reason = json.error?.errors?.[0]?.reason || ''
    if (/quota|rateLimit|dailyLimit/i.test(reason)) throw new YoutubeApiError('유튜브 조회 한도를 넘었어요.', 'quota')
    if (/keyInvalid|keyExpired|accessNotConfigured|forbidden|ipRefererBlocked/i.test(reason) || response.status === 400 || response.status === 403) {
      throw new YoutubeApiError('유튜브 API 키에 문제가 있어요.', 'key')
    }
    throw new YoutubeApiError('유튜브에서 통계를 받지 못했어요.', 'other')
  }

  for (const item of json.items || []) {
    out.set(item.id, {
      viewCount: toNumberOrNull(item.statistics?.viewCount),
      likeCount: toNumberOrNull(item.statistics?.likeCount),
      commentCount: toNumberOrNull(item.statistics?.commentCount),
      privacyStatus: item.status?.privacyStatus || null
    })
  }
  return out
}
