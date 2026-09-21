'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '@/lib/session/authed-fetch'
import { errorText, v5Get } from '@/lib/v5/client'
import { recentlyMutated } from '@/lib/v5/freshness'

// 조회(GET)용 아주 작은 "먼저 보여 주고 뒤에서 새로 받기"(stale-while-revalidate) 캐시.
//  - 같은 주소를 60초 안에 다시 열면 저장해 둔 값을 바로 보여 주고, 뒤에서 조용히 새로 받는다.
//  - 4초 안이면 새로 받지도 않는다(메뉴를 빠르게 오갈 때 불필요한 요청 방지).
//  - 같은 주소를 동시에 두 번 요청하지 않는다(진행 중인 요청을 함께 쓴다).
//  - 필터를 바꾸거나 화면을 떠나면 더 이상 필요 없는 요청은 취소한다.
//  - 로그인한 사람이 바뀌면(로그아웃 후 다른 계정) 캐시를 통째로 비운다.

const SHOW_TTL_MS = 60_000
const FRESH_TTL_MS = 4_000
const MAX_ENTRIES = 40

type Entry = { data: unknown; at: number; seq: number }
type Result = { ok: boolean; status: number; data: any; aborted: boolean }
type Inflight = { url: string; promise: Promise<Result>; controller: AbortController; refs: number; fresh: boolean }

const cache = new Map<string, Entry>()
const inflight = new Map<string, Inflight>()
let seqCounter = 0
let cacheOwner: string | null = null

// 토큰(JWT)에서 사용자 식별자(sub)만 꺼낸다. 못 꺼내면 토큰 끝부분으로 대신한다.
export function tokenOwner(token: string | null | undefined): string {
  if (!token) return ''
  try {
    const payload = token.split('.')[1]
    if (payload) {
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
      if (json && typeof json.sub === 'string' && json.sub) return json.sub
    }
  } catch {
    // 아래 대체값 사용
  }
  return token.slice(-16)
}

async function ensureOwner() {
  let next = ''
  try {
    next = tokenOwner(await getAccessToken())
  } catch {
    next = ''
  }
  if (cacheOwner !== null && cacheOwner !== next) {
    cache.clear()
    for (const e of inflight.values()) e.controller.abort()
    inflight.clear()
  }
  cacheOwner = next
}

function remember(url: string, data: unknown, seq: number, at = Date.now()) {
  const prev = cache.get(url)
  if (prev && prev.seq > seq) return // 더 나중에 시작한 요청의 결과가 이미 있다
  cache.delete(url)
  cache.set(url, { data, at, seq })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function request(url: string, fresh: boolean): Inflight {
  const existing = inflight.get(url)
  // 이미 받는 중이면 함께 쓴다. 단, "새로 받아야 하는" 요청인데 진행 중인 것이 그렇지 않다면 새로 시작한다.
  if (existing && (!fresh || existing.fresh)) {
    existing.refs += 1
    return existing
  }
  const controller = new AbortController()
  const seq = ++seqCounter
  const useFresh = fresh || recentlyMutated()
  const entry: Inflight = {
    url,
    controller,
    refs: 1,
    fresh: useFresh,
    promise: Promise.resolve().then(() =>
      v5Get<any>(url, controller.signal, { fresh: useFresh }).then((res) => {
        if (inflight.get(url) === entry) inflight.delete(url)
        const aborted = controller.signal.aborted
        if (res.ok && !aborted) remember(url, res.data, seq)
        return { ok: res.ok, status: res.status, data: res.data, aborted }
      })
    )
  }
  inflight.set(url, entry)
  return entry
}

function release(entry: Inflight) {
  entry.refs -= 1
  if (entry.refs <= 0) {
    if (inflight.get(entry.url) === entry) inflight.delete(entry.url)
    entry.controller.abort() // 이미 끝난 요청이면 아무 일도 없다
  }
}

// 저장한 값(낙관적 갱신 포함)을 캐시에도 반영해 두면 다른 화면을 다녀와도 옛 값으로 되돌아가지 않는다.
export function writeV5Cache(url: string, data: unknown) {
  const prev = cache.get(url)
  remember(url, data, ++seqCounter, prev?.at ?? Date.now())
}

export function clearV5Cache(prefix?: string) {
  if (!prefix) cache.clear()
  else for (const key of Array.from(cache.keys())) if (key.startsWith(prefix)) cache.delete(key)
}

export type QueryState<T> = {
  data: T | null
  // 사람이 읽을 오류 문장(없으면 '')
  error: string
  // 마지막 요청의 HTTP 상태(0 = 인터넷 문제, 401 = 로그인 필요)
  status: number
  // 아직 보여 줄 값이 하나도 없고 오류도 없는 상태(첫 로딩)
  loading: boolean
  // 값이 있는 채로 뒤에서 새로 받는 중
  validating: boolean
  // 서버/캐시에서 값을 새로 받을 때마다 1씩 늘어난다(update() 로 고친 것은 세지 않는다) — "서버가 확인해 준 값" 기준점이 필요할 때 쓴다.
  rev: number
}

export function useV5Query<T>(url: string | null, opts: { errorFallback: string }) {
  const [state, setState] = useState<QueryState<T>>({ data: null, error: '', status: 200, loading: true, validating: false, rev: 0 })
  const [tick, setTick] = useState(0)
  const dataRef = useRef<T | null>(null)
  // dataRef 의 값이 어느 주소의 것인지(필터를 바꾸는 중에 저장하면 엉뚱한 주소 캐시를 덮지 않게)
  const dataUrlRef = useRef<string | null>(null)
  const fallbackRef = useRef(opts.errorFallback)
  fallbackRef.current = opts.errorFallback
  const freshRef = useRef(false)

  useEffect(() => {
    if (!url) return
    let cancelled = false
    let entry: Inflight | null = null

    const run = async () => {
      await ensureOwner()
      if (cancelled) return
      const forceFresh = freshRef.current
      freshRef.current = false
      const hit = cache.get(url)
      const age = hit ? Date.now() - hit.at : Number.POSITIVE_INFINITY
      if (hit && age <= SHOW_TTL_MS && !forceFresh) {
        dataRef.current = hit.data as T
        dataUrlRef.current = url
        if (age <= FRESH_TTL_MS) {
          setState((s) => ({ data: hit.data as T, error: '', status: 200, loading: false, validating: false, rev: s.rev + 1 }))
          return
        }
        setState((s) => ({ data: hit.data as T, error: '', status: 200, loading: false, validating: true, rev: s.rev + 1 }))
      } else {
        // 캐시가 없으면 이전 화면의 값은 그대로 둔 채(흐리게) 새로 받는다.
        setState((s) => ({ ...s, error: '', validating: true, loading: s.data === null }))
      }

      const mine = request(url, forceFresh)
      entry = mine
      const res = await mine.promise
      if (entry === mine) {
        entry = null
        release(mine)
      }
      if (cancelled || res.aborted) return
      if (res.ok) {
        dataRef.current = res.data as T
        dataUrlRef.current = url
        setState((s) => ({ data: res.data as T, error: '', status: res.status, loading: false, validating: false, rev: s.rev + 1 }))
      } else {
        setState((s) => ({ ...s, error: errorText(res, fallbackRef.current), status: res.status, loading: false, validating: false }))
      }
    }
    void run()

    return () => {
      cancelled = true
      if (entry) {
        const pending = entry
        entry = null
        release(pending)
      }
    }
  }, [url, tick])

  // 다시 시도 버튼 등: 캐시를 건너뛰고 새로 받는다.
  const reload = useCallback(() => {
    freshRef.current = true
    setTick((t) => t + 1)
  }, [])

  // 화면의 값을 바꾼다(저장 직후 반영/낙관적 갱신). 캐시에도 함께 적는다. 값이 아직 없으면 아무것도 하지 않는다.
  const update = useCallback((fn: (prev: T) => T) => {
    const prev = dataRef.current
    if (prev === null) return
    const next = fn(prev)
    dataRef.current = next
    setState((s) => ({ ...s, data: next }))
    if (dataUrlRef.current) writeV5Cache(dataUrlRef.current, next)
  }, [])

  return { ...state, reload, update }
}
