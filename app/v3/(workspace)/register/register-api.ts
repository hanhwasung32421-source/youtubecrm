// 영상 등록·수정·삭제 요청을 한 곳에서 처리하고, 서버/네트워크 오류를 한 줄 한국어로 바꿔 준다.
// (단건 등록, 여러 개 등록, 목록의 수정·삭제가 모두 같은 문구를 쓰도록)

import { authedFetchJson, authedPostJson, type AuthedJsonResult } from '@/lib/session/authed-fetch'
import { classifyRegisterFailure, isVagueServerFailure, type Failure, type ProbeCode } from './register-logic'
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

// message = 화면 한가운데 안내(무슨 일 + 할 일), short = 여러 개 등록 표의 좁은 칸용 한 줄
export type RegisterResult = { ok: true; id: string | null } | { ok: false; message: string; short: string; failure: Failure }

const PROBE_CODES: ProbeCode[] = ['not-found', 'quota', 'key', 'no-key', 'unknown']

// 링크 미리보기에 물어 "저장 실패"의 진짜 원인(영상 없음/비공개, 하루 한도, 키 문제)을 알아낸다. 실패하면 null.
export async function probeVideo(url: string): Promise<ProbeCode | null> {
  try {
    const { data } = await authedFetchJson<{ code?: string; title?: string }>(`/api/v3/link-preview?url=${encodeURIComponent(url)}`)
    const code = data?.code
    return PROBE_CODES.includes(code as ProbeCode) ? (code as ProbeCode) : null
  } catch {
    return null
  }
}

export async function registerVideo(input: {
  url: string
  contentType: ContentType
  stockName: string
  contentCategory?: string
}): Promise<RegisterResult> {
  const normalized = normalizeYoutubeUrl(input.url)
  const url = normalized.ok ? normalized.url : input.url
  const fail = (failure: Failure): RegisterResult => ({ ok: false, message: failure.message, short: failure.short, failure })

  let response: AuthedJsonResult<{ error?: string; video?: { id?: string } }>
  try {
    response = await authedPostJson<{ error?: string; video?: { id?: string } }>('/api/videos/create', {
      youtubeUrl: url,
      contentType: input.contentType,
      stockName: input.stockName,
      contentCategory: input.contentCategory?.trim() || undefined
    })
  } catch {
    return fail(classifyRegisterFailure({ status: 0, network: true }))
  }

  if (response.ok) return { ok: true, id: response.data?.video?.id || null }

  const raw = response.data?.error
  const probe = isVagueServerFailure(response.status, raw) ? await probeVideo(url) : null
  return fail(classifyRegisterFailure({ status: response.status, raw, probe }))
}

// 이 영상을 이미 등록했는지(등록 전에 확인). 확인하지 못하면 null — 등록을 막지 않는다.
export type VideoLookup =
  | { found: false }
  | { found: true; mine: true; video: { id: string; stock_name: string | null; content_type: ContentType; content_category: string | null; created_at: string } }
  | { found: true; mine: false; registeredAt: string }

export async function lookupVideo(videoId: string): Promise<VideoLookup | null> {
  try {
    const { ok, data } = await authedFetchJson<VideoLookup & { error?: string }>(`/api/v3/my-videos?videoId=${encodeURIComponent(videoId)}`)
    if (!ok || typeof data?.found !== 'boolean') return null
    return data
  } catch {
    return null
  }
}

// 수정·삭제 API(/api/v3/my-videos/[id])는 이미 한국어 안내를 돌려주므로 그대로 보여 주고,
// 서버 내부 오류만 일반 문구로 바꾼다.
// status: 401 = 로그인 만료, 0 = 인터넷 연결 문제
export type CallResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number }

export async function callMyVideo<T = any>(id: string, method: 'GET' | 'PATCH' | 'DELETE', body?: unknown): Promise<CallResult<T>> {
  try {
    const { ok, status, data } = await authedFetchJson<T & { error?: string }>(`/api/v3/my-videos/${encodeURIComponent(id)}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (ok) return { ok: true, data }
    if (status === 401) return { ok: false, status, message: '로그인이 만료됐어요. 다시 로그인해 주세요.' }
    const raw = (data as { error?: string } | null)?.error
    if (status >= 500 || !raw) return { ok: false, status, message: RETRY_MESSAGE }
    return { ok: false, status, message: raw }
  } catch {
    return { ok: false, status: 0, message: NETWORK_MESSAGE }
  }
}
