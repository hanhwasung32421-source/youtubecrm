'use client'

// V3 화면용 API 호출 도우미. 절대 throw 하지 않고, 사용자에게 그대로 보여줘도 되는
// 짧은 한글 문장(error)만 돌려준다. (Postgres/JSON 원문, 영어 메시지는 걸러낸다)

import { authedFetchJson } from '@/lib/session/authed-fetch'

export const NETWORK_ERROR = '인터넷 연결을 확인하고 다시 시도해 주세요.'
const HANGUL = /[가-힣]/

export type V3Result<T> = { ok: boolean; status: number; data: T; error: string | null }

export function friendlyMessage(status: number, raw: unknown, fallback: string): string {
  if (status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요.'
  if (status === 429) return typeof raw === 'string' && HANGUL.test(raw) ? raw : '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.'
  if (typeof raw === 'string' && HANGUL.test(raw) && !/\.sql|supabase|postgres|PGRST|duplicate key|violates/i.test(raw)) return raw
  if (status === 403) return '이 작업을 할 권한이 없어요.'
  if (status === 404) return '찾는 항목이 없어요. 화면을 새로 고친 뒤 다시 시도해 주세요.'
  return fallback.includes('다시') ? fallback : `${fallback} 잠시 뒤 다시 시도해 주세요.`
}

export async function v3Request<T = any>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
  fallback = '처리하지 못했어요.'
): Promise<V3Result<T>> {
  try {
    const init: RequestInit = { method: opts.method || 'GET' }
    if (opts.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(opts.body)
    }
    const res = await authedFetchJson<T>(path, init)
    if (res.ok) return { ok: true, status: res.status, data: res.data, error: null }
    return { ok: false, status: res.status, data: res.data, error: friendlyMessage(res.status, (res.data as any)?.error, fallback) }
  } catch {
    return { ok: false, status: 0, data: {} as T, error: NETWORK_ERROR }
  }
}
