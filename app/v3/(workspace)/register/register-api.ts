// 영상 등록·수정·삭제 요청을 한 곳에서 처리하고, 서버/네트워크 오류를 한 줄 한국어로 바꿔 준다.
// (단건 등록, 여러 개 등록, 목록의 수정·삭제가 모두 같은 문구를 쓰도록)

import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { normalizeYoutubeUrl } from './youtube-url'

export type ContentType = 'longform' | 'shortform'

export const NETWORK_MESSAGE = '인터넷 연결을 확인해 주세요.'
export const RETRY_MESSAGE = '잠시 후 다시 시도해 주세요.'

// 등록(POST /api/videos/create) 오류 → 한 줄 안내
export function friendlyRegisterError(status: number, raw?: string): string {
  const msg = raw || ''
  if (status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요.'
  if (/already|duplicate|unique|23505|이미 등록/i.test(msg)) return '이미 등록된 영상이에요.'
  if (/유효한 유튜브|유효하지|invalid.*(url|string)|올바른 주소/i.test(msg)) return '유효하지 않은 주소예요.'
  if (/찾을 수 없|not found|메타데이터/i.test(msg)) return '유튜브에서 영상을 찾지 못했어요. 주소를 확인해 주세요.'
  // API 키 문제, 하루 한도 초과, 서버 오류 등 사용자가 고칠 수 없는 경우
  return RETRY_MESSAGE
}

export type RegisterResult = { ok: true; id: string | null } | { ok: false; message: string }

export async function registerVideo(input: {
  url: string
  contentType: ContentType
  stockName: string
  contentCategory?: string
}): Promise<RegisterResult> {
  try {
    const { ok, status, data } = await authedPostJson<{ error?: string; video?: { id?: string } }>('/api/videos/create', {
      youtubeUrl: (() => { const n = normalizeYoutubeUrl(input.url); return n.ok ? n.url : input.url })(),
      contentType: input.contentType,
      stockName: input.stockName,
      contentCategory: input.contentCategory?.trim() || undefined
    })
    if (!ok) return { ok: false, message: friendlyRegisterError(status, data?.error) }
    return { ok: true, id: data?.video?.id || null }
  } catch {
    return { ok: false, message: NETWORK_MESSAGE }
  }
}

// 수정·삭제 API(/api/v3/my-videos/[id])는 이미 한국어 안내를 돌려주므로 그대로 보여 주고,
// 서버 내부 오류만 일반 문구로 바꾼다.
export type CallResult<T> = { ok: true; data: T } | { ok: false; message: string }

export async function callMyVideo<T = any>(id: string, method: 'GET' | 'PATCH' | 'DELETE', body?: unknown): Promise<CallResult<T>> {
  try {
    const { ok, status, data } = await authedFetchJson<T & { error?: string }>(`/api/v3/my-videos/${encodeURIComponent(id)}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (ok) return { ok: true, data }
    if (status === 401) return { ok: false, message: '로그인이 만료됐어요. 다시 로그인해 주세요.' }
    const raw = (data as { error?: string } | null)?.error
    if (status >= 500 || !raw) return { ok: false, message: RETRY_MESSAGE }
    return { ok: false, message: raw }
  } catch {
    return { ok: false, message: NETWORK_MESSAGE }
  }
}
