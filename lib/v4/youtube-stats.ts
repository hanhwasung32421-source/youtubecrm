// 유튜브 통계 일괄 조회 (서버 전용).
// videos.list 는 id 를 최대 50개까지 한 번에 받고, 호출 1번 = 쿼터 1 이므로
// 영상마다 따로 부르는 것보다 50배 적은 쿼터로 같은 일을 한다.

import { extractYoutubeVideoId } from '@/lib/youtube/api'

export const YT_BATCH_SIZE = 50

export type YoutubeStat = {
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  privacyStatus: string | null
}

export class YoutubeApiError extends Error {
  reason: string
  constructor(message: string, reason: string) {
    super(message)
    this.reason = reason
  }
}

// 영상 행에서 유튜브 영상 ID 를 뽑는다. (youtube_video_id 우선, 없으면 주소에서 추출)
export function youtubeIdOf(video: { youtube_video_id: string | null; youtube_url: string | null }) {
  const direct = (video.youtube_video_id || '').trim()
  if (direct) return direct
  return video.youtube_url ? extractYoutubeVideoId(video.youtube_url) : ''
}

function toCount(value: string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

// ids(최대 50개) → 응답에 들어 있는 영상별 통계. 응답에 없는 id(삭제/비공개 등)는 결과 Map 에 없다.
// 좋아요를 숨긴 영상은 likeCount 가 null 로 온다 (0 으로 바꿔 기존 값을 덮어쓰지 않게 하려는 것).
export async function fetchYoutubeStatsBatch(ids: string[], apiKey: string): Promise<Map<string, YoutubeStat>> {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos')
  url.searchParams.set('id', ids.join(','))
  url.searchParams.set('part', 'statistics,status')
  url.searchParams.set('maxResults', String(YT_BATCH_SIZE))

  let response: Response
  try {
    // 키는 주소(쿼리)가 아니라 헤더로 보낸다. (로그/오류 메시지에 키가 남지 않게)
    response = await fetch(url, { cache: 'no-store', headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(15000) })
  } catch {
    throw new YoutubeApiError('유튜브에 연결하지 못했어요.', 'network')
  }

  const json = (await response.json().catch(() => ({}))) as {
    items?: Array<{ id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }; status?: { privacyStatus?: string } }>
    error?: { errors?: Array<{ reason?: string }>; message?: string }
  }

  if (!response.ok) {
    const reason = json.error?.errors?.[0]?.reason || String(response.status)
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded') {
      throw new YoutubeApiError('유튜브 조회 한도를 넘었어요. 잠시 뒤(또는 내일) 다시 시도해 주세요.', 'quota')
    }
    if (reason === 'keyInvalid' || reason === 'forbidden' || response.status === 403) {
      throw new YoutubeApiError('유튜브 API 키를 사용할 수 없어요. 유튜브 계정 설정을 확인해 주세요.', 'key')
    }
    throw new YoutubeApiError('유튜브에서 통계를 받지 못했어요.', 'http')
  }

  const map = new Map<string, YoutubeStat>()
  for (const item of json.items || []) {
    map.set(item.id, {
      viewCount: toCount(item.statistics?.viewCount),
      likeCount: toCount(item.statistics?.likeCount),
      commentCount: toCount(item.statistics?.commentCount),
      privacyStatus: item.status?.privacyStatus || null
    })
  }
  return map
}
