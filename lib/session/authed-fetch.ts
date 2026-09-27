'use client'

import { createSupabaseBrowserClient } from '@/lib/supabase/browser-client'

// 페이지마다 "세션 꺼내기 -> Authorization 헤더 붙이기 -> fetch"를 따로 구현하던
// 코드를 한 곳으로 모았다. 세션이 없으면(로그아웃 상태) null을 돌려주고, 호출부는
// AuthGuard가 이미 로그인 여부를 걸러준다고 가정하고 조용히 넘어가면 된다.

export async function getAccessToken(): Promise<string | null> {
  const supabase = createSupabaseBrowserClient()
  const {
    data: { session }
  } = await supabase.auth.getSession()
  return session?.access_token || null
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = await getAccessToken()
  if (!token) return null

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return fetch(path, { ...init, headers })
}

export type AuthedJsonResult<T> = { ok: boolean; status: number; data: T }

// 가장 흔한 패턴(JSON 응답을 받아서 성공/실패를 바로 판단)까지 감싼 버전.
export async function authedFetchJson<T = any>(path: string, init: RequestInit = {}): Promise<AuthedJsonResult<T>> {
  const res = await authedFetch(path, init)
  if (!res) {
    return { ok: false, status: 401, data: { error: '로그인이 필요합니다.' } as T }
  }
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data: data as T }
}

export async function authedPostJson<T = any>(path: string, body: unknown): Promise<AuthedJsonResult<T>> {
  return authedFetchJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export async function authedPatchJson<T = any>(path: string, body: unknown): Promise<AuthedJsonResult<T>> {
  return authedFetchJson<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}
