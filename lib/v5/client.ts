'use client'

import { authedFetchJson, type AuthedJsonResult } from '@/lib/session/authed-fetch'
import { markMutated } from '@/lib/v5/freshness'

// 공용 authedFetchJson 위에 PATCH/PUT/DELETE 를 얹고, 네트워크 오류가 예외로 터지지 않게 한다.
// 모든 함수는 절대 throw 하지 않고 { ok, status, data } 를 돌려준다(status 0 = 인터넷 연결 문제).

export const NETWORK_ERROR_TEXT = '인터넷 연결을 확인하고 다시 시도해 주세요.'

async function safe<T>(run: () => Promise<AuthedJsonResult<T>>): Promise<AuthedJsonResult<T>> {
  try {
    return await run()
  } catch {
    return { ok: false, status: 0, data: { error: NETWORK_ERROR_TEXT } as T }
  }
}

// signal: 화면을 떠나거나 필터를 바꾸면 이전 요청을 취소한다. fresh: 방금 저장한 뒤라 브라우저 캐시를 건너뛰고 새로 받는다.
export function v5Get<T = any>(path: string, signal?: AbortSignal, opts: { fresh?: boolean } = {}): Promise<AuthedJsonResult<T>> {
  return safe(() => authedFetchJson<T>(path, opts.fresh ? { signal, cache: 'reload' } : { signal }))
}

// 저장 성공 시 "방금 바뀜"을 기억해 다음 조회가 옛 캐시를 쓰지 않게 한다.
async function mutating<T>(run: () => Promise<AuthedJsonResult<T>>): Promise<AuthedJsonResult<T>> {
  const res = await safe(run)
  if (res.ok) markMutated()
  return res
}

export function v5Post<T = any>(path: string, body: unknown): Promise<AuthedJsonResult<T>> {
  return mutating(() =>
    authedFetchJson<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  )
}

export function authedPatchJson<T = any>(path: string, body: unknown): Promise<AuthedJsonResult<T>> {
  return mutating(() =>
    authedFetchJson<T>(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  )
}

export function authedPutJson<T = any>(path: string, body: unknown): Promise<AuthedJsonResult<T>> {
  return mutating(() =>
    authedFetchJson<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  )
}

export function authedDeleteJson<T = any>(path: string): Promise<AuthedJsonResult<T>> {
  return mutating(() => authedFetchJson<T>(path, { method: 'DELETE' }))
}

export type ApiError = { error?: string }

const HANGUL = /[가-힣]/
// 개발 모드에서 서버가 붙이는 "(원문 오류)" 꼬리표. 영문뿐인 괄호만 떼어낸다.
const DEV_SUFFIX = /\s*\([^)]*[A-Za-z][^)]*\)\s*$/

// 화면에 보여줄 오류 문장: 짧은 한국어 한 문장. Postgres/JSON 원문은 절대 그대로 보이지 않는다.
export function errorText(res: { status: number; data?: unknown }, fallback: string): string {
  if (res.status === 0) return NETWORK_ERROR_TEXT
  if (res.status === 401) return '로그인이 끝났어요. 다시 로그인해 주세요.'
  if (res.status === 403) {
    const m = pickMessage(res.data)
    return m || '이 작업을 할 권한이 없어요.'
  }
  if (res.status === 404) return pickMessage(res.data) || '항목을 찾을 수 없어요. 이미 지워졌을 수 있어요.'
  if (res.status === 429) return pickMessage(res.data) || '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.'
  return pickMessage(res.data) || fallback
}

function pickMessage(data: unknown): string {
  const raw = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
  if (typeof raw !== 'string') return ''
  const text = raw.replace(DEV_SUFFIX, '').trim()
  if (!text || !HANGUL.test(text)) return ''
  // 원문이 새어 나온 흔적(JSON, SQL, 예외 이름)이 있으면 쓰지 않는다.
  if (/[{}]|PGRST|violates|relation |column |syntax|Unexpected|TypeError|undefined/i.test(text)) return ''
  return text
}
