// 통계 새로고침용 유튜브 조회수 일괄 조회. (서버 전용)
// videos.list 는 id 를 쉼표로 여러 개 넣어도 할당량이 1 이라서, 10개를 한 번에 요청한다.

import { ApiFail } from '@/lib/v3/server'

export type YoutubeStat = {
  viewCount: number | null
  likeCount: number | null // 좋아요 숨김 영상은 null
  commentCount: number | null // 댓글 막힌 영상은 null
  privacyStatus: string | null
}

function toCount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// 요청한 id 중 유튜브가 돌려준 것만 Map 에 담긴다. 없는 id 는 삭제/비공개 처리된 영상이다.
export async function fetchYoutubeStatsBatch(youtubeVideoIds: string[], apiKey: string): Promise<Map<string, YoutubeStat>> {
  const result = new Map<string, YoutubeStat>()
  if (youtubeVideoIds.length === 0) return result

  let response: Response
  try {
    const params = new URLSearchParams({ part: 'statistics,status', id: youtubeVideoIds.join(','), key: apiKey, maxResults: '50' })
    response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12000)
    })
  } catch {
    throw new ApiFail(502, '유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }

  const json = (await response.json().catch(() => ({}))) as {
    error?: { errors?: { reason?: string }[]; message?: string }
    items?: { id: string; statistics?: Record<string, string>; status?: { privacyStatus?: string } }[]
  }

  if (!response.ok) {
    const reason = json.error?.errors?.[0]?.reason || ''
    if (/quota|dailyLimit|rateLimit/i.test(reason)) {
      throw new ApiFail(429, '오늘 유튜브에서 가져올 수 있는 한도를 다 썼어요. 내일 다시 시도해 주세요.')
    }
    if (/keyInvalid|API_KEY|forbidden|accessNotConfigured|ipRefererBlocked/i.test(reason) || response.status === 400 || response.status === 403) {
      throw new ApiFail(502, '유튜브 연결 키에 문제가 있어요. 관리자에게 알려 주세요.')
    }
    throw new ApiFail(502, '유튜브에서 정보를 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }

  for (const item of json.items || []) {
    result.set(item.id, {
      viewCount: toCount(item.statistics?.viewCount),
      likeCount: toCount(item.statistics?.likeCount),
      commentCount: toCount(item.statistics?.commentCount),
      privacyStatus: item.status?.privacyStatus || null
    })
  }
  return result
}
