'use client'

import { authedFetchJson, type AuthedJsonResult } from '@/lib/session/authed-fetch'

// 공용 authed-fetch에는 POST만 있어서 V2에서 쓰는 PATCH/DELETE 래퍼를 둔다.
export function authedPatchJson<T = any>(path: string, body: unknown): Promise<AuthedJsonResult<T>> {
  return authedFetchJson<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export function authedDeleteJson<T = any>(path: string): Promise<AuthedJsonResult<T>> {
  return authedFetchJson<T>(path, { method: 'DELETE' })
}

// ---- 사용자에게 보여줄 오류 문장 ----
// 서버가 내려준 문장 중 "한글 한 문장"만 그대로 보여주고, 영문·DB 용어가 섞인 것은 fallback 으로 바꾼다.
export const NETWORK_ERROR = '인터넷 연결을 확인하고 다시 시도해 주세요.'
export const SESSION_ERROR = '로그인 시간이 지났어요. 다시 로그인해 주세요.'

const HANGUL = /[가-힣]/
const RAW_TERMS = /PGRST|violates|relation |duplicate key|syntax|constraint|schema|column|postgres|supabase|undefined|\{|\}|Error:/i

export function friendlyMessage(status: number, data: unknown, fallback: string): string {
  if (status === 401) return SESSION_ERROR
  const raw = (data as { error?: unknown } | null | undefined)?.error
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text && text.length <= 140 && HANGUL.test(text) && !RAW_TERMS.test(text)) return text
  }
  if (status === 403) return '이 작업을 할 수 있는 권한이 없어요.'
  return fallback
}

export type V2Result<T> = { ok: boolean; status: number; data: T; error: string }

// 네트워크가 끊겨도 예외를 던지지 않고 { ok:false, error } 로 돌려준다. error 는 그대로 화면에 보여줘도 되는 한 문장.
async function run<T>(fallback: string, call: () => Promise<AuthedJsonResult<T>>): Promise<V2Result<T>> {
  try {
    const res = await call()
    return { ...res, error: res.ok ? '' : friendlyMessage(res.status, res.data, fallback) }
  } catch {
    return { ok: false, status: 0, data: {} as T, error: NETWORK_ERROR }
  }
}

export function v2Get<T = any>(path: string, fallback: string) {
  return run<T>(fallback, () => authedFetchJson<T>(path))
}

export function v2Post<T = any>(path: string, body: unknown, fallback: string) {
  return run<T>(fallback, () =>
    authedFetchJson<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  )
}

export function v2Patch<T = any>(path: string, body: unknown, fallback: string) {
  return run<T>(fallback, () => authedPatchJson<T>(path, body))
}

export function v2Delete<T = any>(path: string, fallback: string) {
  return run<T>(fallback, () => authedDeleteJson<T>(path))
}
