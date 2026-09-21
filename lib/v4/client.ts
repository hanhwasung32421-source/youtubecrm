'use client'

// V4 화면 공용 요청 도우미: 네트워크 실패/원문 오류를 쉬운 한국어 한 문장으로 바꿔준다.

import { authedFetchJson } from '@/lib/session/authed-fetch'
import { NETWORK_ERROR_MESSAGE, friendlyMessage } from '@/lib/v4/errors'

export type V4Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; message: string; data: (Partial<T> & { error?: string }) | null }

export async function v4Fetch<T = any>(path: string, init: RequestInit = {}, fallback = '문제가 생겼어요. 잠시 후 다시 시도해 주세요.'): Promise<V4Result<T>> {
  try {
    const res = await authedFetchJson<T & { error?: string }>(path, init)
    const errorText = (res.data as { error?: string } | null)?.error
    if (!res.ok || errorText) {
      return { ok: false, status: res.status, message: friendlyMessage(res.status, errorText, fallback), data: res.data }
    }
    return { ok: true, status: res.status, data: res.data as T }
  } catch {
    // fetch 자체가 실패한 경우(오프라인, 서버 연결 끊김 등)
    return { ok: false, status: 0, message: NETWORK_ERROR_MESSAGE, data: null }
  }
}

export function v4Json<T = any>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body: unknown, fallback?: string) {
  return v4Fetch<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }, fallback)
}
