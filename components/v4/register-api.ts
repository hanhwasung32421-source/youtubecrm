// 영상 등록 화면이 서버와 주고받는 호출 모음 (클라이언트 전용).
// 실패 이유는 항상 "무슨 일이 있었고 이제 뭘 하면 되는지" 한 문장으로 바꿔서 돌려준다 (문장 규칙은 register-logic.ts).

import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { extractVideoId, todayKst } from '@/components/v4/register-utils'
import {
  DEFAULT_DAILY_TARGET,
  NETWORK_COPY,
  daysInMonthOf,
  dailyTargetFromGoals,
  mutationErrorCopy,
  registerErrorCopy,
  type GoalLite,
  type RegisterErrorKind
} from '@/components/v4/register-logic'

export type ContentType = 'longform' | 'shortform'

export const DAILY_TARGET = DEFAULT_DAILY_TARGET // 직원 1명의 하루 기본 목표 (안내용 숫자일 뿐, 강제하지 않는다)

// 예전 호출부(일괄 등록 등)가 쓰던 함수. 문장 규칙은 registerErrorCopy 로 옮겼다.
export function friendlyRegisterError(status: number, raw?: string | null) {
  return registerErrorCopy(status, raw).message
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
  | { ok: false; message: string; kind: RegisterErrorKind; retry: boolean }

// 로그인이 풀렸는지 가볍게 확인한다 (V4 API 는 진짜 401 을 돌려준다).
// 공유 등록 API 는 로그인이 풀려도 500 "영상 저장 실패"만 돌려주므로, 원인을 알 수 없는 실패 때 이것으로 구분한다.
export async function isSessionExpired(): Promise<boolean> {
  try {
    const { status } = await authedFetchJson('/api/v4/my-today')
    return status === 401
  } catch {
    return false
  }
}

export async function registerVideo(input: { youtubeUrl: string; contentType: ContentType; stockName: string; contentCategory?: string | null }): Promise<RegisterResult> {
  try {
    const { ok, status, data } = await authedPostJson<{ error?: string; video?: { id?: string; title?: string | null } }>('/api/videos/create', {
      youtubeUrl: toWatchUrl(input.youtubeUrl),
      contentType: input.contentType,
      stockName: input.stockName,
      contentCategory: input.contentCategory ?? null
    })
    if (!ok) {
      const copy = registerErrorCopy(status, data?.error)
      // 이유를 알 수 없는 서버 실패면, 혹시 로그인이 풀린 것인지 확인한다.
      if (copy.kind === 'server' || copy.kind === 'other') {
        if (await isSessionExpired()) {
          const auth = registerErrorCopy(401)
          return { ok: false, message: auth.message, kind: auth.kind, retry: auth.retry }
        }
      }
      return { ok: false, message: copy.message, kind: copy.kind, retry: copy.retry }
    }
    return { ok: true, video: data?.video || null }
  } catch (e) {
    if (isNetworkError(e)) return { ok: false, message: NETWORK_COPY, kind: 'network', retry: true }
    const copy = registerErrorCopy(500)
    return { ok: false, message: copy.message, kind: copy.kind, retry: copy.retry }
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

// 오늘 목표: 내 이번 달 개인 목표가 있으면 일수로 나눈 값, 없으면 기본 12개. 실패해도 기본값.
export async function fetchDailyTarget(userId: string): Promise<{ target: number; source: 'personal' | 'default' }> {
  try {
    const ym = todayKst().slice(0, 7)
    const { ok, data } = await authedFetchJson<{ sample?: boolean; items?: GoalLite[] }>(`/api/v4/goals?month=${ym}`)
    if (!ok) return { target: DEFAULT_DAILY_TARGET, source: 'default' }
    return dailyTargetFromGoals(data?.items, userId, { sample: Boolean(data?.sample), daysInMonth: daysInMonthOf(ym) })
  } catch {
    return { target: DEFAULT_DAILY_TARGET, source: 'default' }
  }
}

export type VideoPatch = { stock_name?: string; content_type?: ContentType; content_category?: string | null }
export type MutationResult<T> = { ok: true; item: T } | { ok: false; message: string; auth: boolean }

export async function patchMyVideo(id: string, patch: VideoPatch): Promise<MutationResult<{ stock_name: string; content_type: ContentType; content_category: string | null }>> {
  try {
    const { ok, status, data } = await authedFetchJson<{ error?: string; item?: { stock_name: string; content_type: ContentType; content_category: string | null } }>(
      `/api/v4/my-videos/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }
    )
    if (!ok || !data?.item) return { ok: false, message: mutationErrorCopy(status, data?.error, '고치지'), auth: status === 401 }
    return { ok: true, item: data.item }
  } catch (e) {
    return { ok: false, message: isNetworkError(e) ? NETWORK_COPY : mutationErrorCopy(500, undefined, '고치지'), auth: false }
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
    if (!ok && status !== 404) return { ok: false, message: mutationErrorCopy(status, data?.error, '지우지'), auth: status === 401 }
    return { ok: true, item: null }
  } catch (e) {
    return { ok: false, message: isNetworkError(e) ? NETWORK_COPY : mutationErrorCopy(500, undefined, '지우지'), auth: false }
  }
}
