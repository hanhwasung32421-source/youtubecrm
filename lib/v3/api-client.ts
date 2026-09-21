'use client'

// V3 화면용 API 호출 도우미. 절대 throw 하지 않고, 사용자에게 그대로 보여줘도 되는
// 짧은 한글 문장(error)만 돌려준다. (Postgres/JSON 원문, 영어 메시지는 걸러낸다)

import { authedFetchJson } from '@/lib/session/authed-fetch'

export const NETWORK_ERROR = '인터넷 연결을 확인하고 다시 시도해 주세요.'
export const SESSION_EXPIRED = '로그인이 만료됐어요. 다시 로그인해 주세요.'
const HANGUL = /[가-힣]/

export type V3Result<T> = { ok: boolean; status: number; data: T; error: string | null; aborted?: boolean }

export function friendlyMessage(status: number, raw: unknown, fallback: string): string {
  if (status === 401) return SESSION_EXPIRED
  if (status === 429) return typeof raw === 'string' && HANGUL.test(raw) ? raw : '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.'
  if (typeof raw === 'string' && HANGUL.test(raw) && !/\.sql|supabase|postgres|PGRST|duplicate key|violates/i.test(raw)) return raw
  if (status === 403) return '이 작업을 할 권한이 없어요.'
  if (status === 404) return '찾는 항목이 없어요. 화면을 새로 고친 뒤 다시 시도해 주세요.'
  return fallback.includes('다시') ? fallback : `${fallback} 잠시 뒤 다시 시도해 주세요.`
}

export type V3RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  // 화면을 떠나거나 필터를 바꿔 더는 필요 없는 요청을 취소할 때 쓴다.
  signal?: AbortSignal
  // 'reload' = 브라우저에 저장된 옛 응답을 건너뛰고 서버에서 새로 받기(저장 직후 새로고침용)
  cache?: RequestCache
}

export async function v3Request<T = any>(path: string, opts: V3RequestOptions = {}, fallback = '처리하지 못했어요.'): Promise<V3Result<T>> {
  try {
    const init: RequestInit = { method: opts.method || 'GET' }
    if (opts.signal) init.signal = opts.signal
    if (opts.cache) init.cache = opts.cache
    if (opts.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(opts.body)
    }
    const res = await authedFetchJson<T>(path, init)
    // 본문을 읽는 도중에 취소되면 빈 값이 성공처럼 돌아올 수 있어서, 취소됐다면 결과를 버린다.
    if (opts.signal?.aborted) return { ok: false, status: 0, data: {} as T, error: null, aborted: true }
    if (res.ok) {
      // 조회(GET)인데 내용이 비어 있으면(중간에서 화면 대신 다른 문서가 오는 경우) 성공으로 보지 않는다. 그대로 쓰면 화면이 깨진다.
      const isRead = !opts.method || opts.method === 'GET'
      const d = res.data as unknown
      if (isRead && (!d || typeof d !== 'object' || Object.keys(d as object).length === 0)) {
        return { ok: false, status: 502, data: {} as T, error: friendlyMessage(502, undefined, fallback) }
      }
      return { ok: true, status: res.status, data: res.data, error: null }
    }
    return { ok: false, status: res.status, data: res.data, error: friendlyMessage(res.status, (res.data as any)?.error, fallback) }
  } catch (e) {
    if (opts.signal?.aborted || (e as { name?: string } | null)?.name === 'AbortError') {
      return { ok: false, status: 0, data: {} as T, error: null, aborted: true }
    }
    return { ok: false, status: 0, data: {} as T, error: NETWORK_ERROR }
  }
}
