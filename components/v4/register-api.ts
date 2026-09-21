// 영상 등록 화면이 서버와 주고받는 호출 모음 (클라이언트 전용).
// 실패 이유는 항상 "사람이 읽을 수 있는 한 줄"로 바꿔서 돌려준다.

import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { extractVideoId } from '@/components/v4/register-utils'

export type ContentType = 'longform' | 'shortform'

export const DAILY_TARGET = 12 // 직원 1명의 하루 기본 목표 (안내용 숫자일 뿐, 강제하지 않는다)

const NETWORK_MESSAGE = '인터넷 연결을 확인해 주세요.'

// 서버가 준 메시지·상태 코드를 쉬운 한 줄로 바꾼다.
export function friendlyRegisterError(status: number, raw?: string | null) {
  const text = String(raw || '')
  if (status === 401) return '로그인이 풀렸어요. 새로고침한 뒤 다시 로그인해 주세요.'
  if (/유효|invalid/i.test(text)) return '유효하지 않은 주소예요.'
  if (/이미|duplicate|unique|already/i.test(text)) return '이미 등록된 영상이에요.'
  if (/찾을 수 없|not found/i.test(text)) return '유튜브에서 영상을 찾지 못했어요. 주소를 확인해 주세요.'
  if (/quota|api|key|limit|한도|rate|forbidden|비활성/i.test(text) || status === 403 || status === 429) return '잠시 후 다시 시도해 주세요.'
  if (status >= 500) return '잠시 후 다시 시도해 주세요.'
  return '등록하지 못했어요. 주소와 종목명을 확인해 주세요.'
}

function isNetworkError(e: unknown) {
  return e instanceof TypeError || /failed to fetch|network|load failed/i.test(String((e as any)?.message || ''))
}

// 공유 API는 watch?v=ID / youtu.be/ID 만 이해한다. shorts·live·embed 주소도 통일해서 보낸다.
function toWatchUrl(url: string) {
  const id = extractVideoId(url)
  return id ? `https://www.youtube.com/watch?v=${id}` : url
}

export type RegisterResult =
  | { ok: true; video: { id?: string; title?: string | null } | null }
  | { ok: false; message: string }

export async function registerVideo(input: { youtubeUrl: string; contentType: ContentType; stockName: string; contentCategory?: string | null }): Promise<RegisterResult> {
  try {
    const { ok, status, data } = await authedPostJson<{ error?: string; video?: { id?: string; title?: string | null } }>('/api/videos/create', {
      youtubeUrl: toWatchUrl(input.youtubeUrl),
      contentType: input.contentType,
      stockName: input.stockName,
      contentCategory: input.contentCategory ?? null
    })
    if (!ok) return { ok: false, message: friendlyRegisterError(status, data?.error) }
    return { ok: true, video: data?.video || null }
  } catch (e) {
    return { ok: false, message: isNetworkError(e) ? NETWORK_MESSAGE : '잠시 후 다시 시도해 주세요.' }
  }
}

// 오늘(한국 시간) 내가 등록한 영상 수. 실패하면 null.
export async function fetchTodayCount(): Promise<number | null> {
  try {
    const { ok, data } = await authedFetchJson<{ count?: number }>('/api/v4/my-today')
    if (!ok || typeof data?.count !== 'number') return null
    return data.count
  } catch {
    return null
  }
}

export type VideoPatch = { stock_name?: string; content_type?: ContentType; content_category?: string | null }
export type MutationResult<T> = { ok: true; item: T } | { ok: false; message: string }

function mutationMessage(status: number, serverMessage: string | undefined, fallback: string) {
  if (status === 401) return '로그인이 풀렸어요. 새로고침한 뒤 다시 로그인해 주세요.'
  if (status >= 400 && status < 500 && serverMessage) return serverMessage
  return fallback
}

export async function patchMyVideo(id: string, patch: VideoPatch): Promise<MutationResult<{ stock_name: string; content_type: ContentType; content_category: string | null }>> {
  try {
    const { ok, status, data } = await authedFetchJson<{ error?: string; item?: { stock_name: string; content_type: ContentType; content_category: string | null } }>(
      `/api/v4/my-videos/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
    )
    if (!ok || !data?.item) return { ok: false, message: mutationMessage(status, data?.error, '고치지 못했어요. 잠시 후 다시 시도해 주세요.') }
    return { ok: true, item: data.item }
  } catch (e) {
    return { ok: false, message: isNetworkError(e) ? NETWORK_MESSAGE : '고치지 못했어요. 잠시 후 다시 시도해 주세요.' }
  }
}

export async function loadMyVideoMemo(id: string): Promise<string | null> {
  try {
    const { ok, data } = await authedFetchJson<{ item?: { content_category?: string | null } }>(`/api/v4/my-videos/${encodeURIComponent(id)}`)
    if (!ok) return null
    return data?.item?.content_category || ''
  } catch {
    return null
  }
}

export async function deleteMyVideo(id: string): Promise<MutationResult<null>> {
  try {
    const { ok, status, data } = await authedFetchJson<{ error?: string }>(`/api/v4/my-videos/${encodeURIComponent(id)}`, { method: 'DELETE' })
    // 이미 지워진 영상(404)은 목적을 이룬 것과 같다.
    if (!ok && status !== 404) return { ok: false, message: mutationMessage(status, data?.error, '지우지 못했어요. 잠시 후 다시 시도해 주세요.') }
    return { ok: true, item: null }
  } catch (e) {
    return { ok: false, message: isNetworkError(e) ? NETWORK_MESSAGE : '지우지 못했어요. 잠시 후 다시 시도해 주세요.' }
  }
}
