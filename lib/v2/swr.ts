'use client'

// 분석·업무 화면용 "먼저 보여주고, 뒤에서 조용히 새로 고치는" 조회 훅 (stale-while-revalidate).
//  - 같은 주소를 다시 열면 지난번 결과를 바로 그리고, 뒤에서 새 값을 받아 조용히 바꿉니다.
//  - 같은 주소를 동시에 여러 번 요청해도 실제 요청은 1번만 보냅니다.
//  - 필터·주간을 바꿔 이전 요청이 필요 없어지면 요청을 취소해, 늦게 온 응답이 화면을 덮어쓰지 않게 합니다.
//  - 저장·삭제 직후에는 브라우저 캐시를 건너뛰고 서버 값을 받습니다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useV2Me } from '@/components/v2/session-context'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import { NETWORK_ERROR, friendlyMessage } from './client'
import { ABORTED, FRESH_MS, SKIP_MS, dirty, invalidate, peek, store, subscribe, type Runner } from './swr-core'

// 조회 한 번: 로그인 토큰을 붙여 요청하고, 결과를 사용자에게 보여줄 수 있는 한 문장 오류와 함께 돌려준다.
function makeRunner(url: string, fallback: string): Runner {
  return async (controller, bypass) => {
    try {
      const res = await authedFetchJson<unknown>(url, { signal: controller.signal, cache: bypass ? 'reload' : 'default' })
      if (controller.signal.aborted) return ABORTED
      return { ok: res.ok, status: res.status, data: res.data, error: res.ok ? '' : friendlyMessage(res.status, res.data, fallback), aborted: false }
    } catch {
      if (controller.signal.aborted) return ABORTED
      return { ok: false, status: 0, data: {}, error: NETWORK_ERROR, aborted: false }
    }
  }
}

// 다른 화면(예: 영상 등록)에서 데이터가 바뀐 뒤 목록을 새로 받게 하고 싶을 때 쓴다. match 가 없으면 전부 비운다.
export function invalidateV2Cache(match?: string) {
  invalidate(match)
}

type State<T> = { key: string | null; data: T | undefined; at: number; error: string; status: number; fetching: boolean }

function initialState<T>(key: string | null): State<T> {
  const entry = key ? peek(key) : undefined
  return { key, data: entry?.data as T | undefined, at: entry?.at ?? 0, error: '', status: 0, fetching: false }
}

export type V2Query<T> = {
  data: T | undefined
  /** 보여줄 값이 아직 전혀 없고 받는 중일 때만 true (이때 스켈레톤을 보여준다) */
  loading: boolean
  /** 오래된(1분 넘은) 값을 먼저 보여주고 새 값을 받는 중 */
  refreshing: boolean
  error: string
  /** 로그인 시간이 지나 다시 로그인해야 함 */
  expired: boolean
  updatedAt: number
  /** 서버 값을 강제로 다시 받는다 (브라우저 캐시 건너뜀) */
  reload: () => void
  /** 저장·삭제 결과를 화면과 캐시에 바로 반영한다 (다시 요청하지 않음) */
  setData: (updater: (prev: T) => T) => void
  /** 저장 등 다른 요청의 상태 코드를 알려 주면 401 일 때 "다시 로그인" 안내를 띄운다 */
  noteStatus: (status: number) => void
}

export function useV2Query<T>(url: string | null, opts: { fallback: string; validate?: (data: unknown) => boolean }): V2Query<T> {
  const me = useV2Me()
  const key = url ? `${me.crmUserId || '-'}|${url}` : null

  const [state, setState] = useState<State<T>>(() => initialState<T>(key))
  const [nonce, setNonce] = useState(0)
  const [expiredFlag, setExpiredFlag] = useState(false)
  const forceRef = useRef(false)
  const epochRef = useRef(0)
  const fallbackRef = useRef(opts.fallback)
  const validateRef = useRef(opts.validate)
  // 최신 문구/검증 함수를 ref 에 담아 두면 아래 조회 효과가 이것들 때문에 다시 실행되지 않는다.
  useEffect(() => {
    fallbackRef.current = opts.fallback
    validateRef.current = opts.validate
  })

  // 주소(필터)가 바뀌면 그 주소의 캐시로 바로 바꿔 그린다.
  let cur = state
  if (state.key !== key) {
    cur = initialState<T>(key)
    setState(cur)
  }

  useEffect(() => {
    if (!key || !url) return
    const force = forceRef.current
    forceRef.current = false
    const entry = peek(key)
    if (entry && !force && Date.now() - entry.at < SKIP_MS) return

    const startEpoch = epochRef.current
    const bypass = force || dirty.has(key)
    setState((prev) => (prev.key === key ? { ...prev, fetching: true, error: force ? '' : prev.error } : prev))

    const sub = subscribe(key, bypass, makeRunner(url, fallbackRef.current))
    let live = true
    void sub.promise.then((out) => {
      if (!live || out.aborted) return
      const valid = out.ok && (!validateRef.current || validateRef.current(out.data))
      if (valid) {
        setExpiredFlag(false)
        if (bypass) dirty.delete(key)
        // 받는 동안 사용자가 화면에서 고친 게 있으면, 옛 응답이 그것을 되돌리지 않게 버린다.
        if (epochRef.current !== startEpoch) {
          setState((prev) => (prev.key === key ? { ...prev, fetching: false } : prev))
          return
        }
        store(key, out.data, Date.now())
        setState((prev) => (prev.key === key ? { ...prev, data: out.data as T, at: Date.now(), error: '', status: out.status, fetching: false } : prev))
      } else {
        setState((prev) => (prev.key === key ? { ...prev, fetching: false, error: out.ok ? fallbackRef.current : out.error, status: out.ok ? 0 : out.status } : prev))
      }
    })
    return () => {
      live = false
      sub.cancel()
    }
  }, [key, url, nonce])

  // 다른 탭에 갔다 돌아왔을 때 1분 넘게 지난 값이면 조용히 새로 받는다.
  useEffect(() => {
    if (!key) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const entry = peek(key)
      if (!entry || Date.now() - entry.at > FRESH_MS) setNonce((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [key])

  const reload = useCallback(() => {
    forceRef.current = true
    setNonce((n) => n + 1)
  }, [])

  const setData = useCallback((updater: (prev: T) => T) => {
    epochRef.current += 1
    setState((prev) => {
      if (prev.data === undefined) return prev
      const next = updater(prev.data)
      if (prev.key) {
        store(prev.key, next)
        dirty.add(prev.key)
      }
      return { ...prev, data: next }
    })
  }, [])

  const noteStatus = useCallback((status: number) => {
    if (status === 401) setExpiredFlag(true)
  }, [])

  const stale = cur.data !== undefined && cur.at > 0 && Date.now() - cur.at > FRESH_MS
  return {
    data: cur.data,
    loading: key !== null && cur.data === undefined && cur.error === '',
    refreshing: cur.fetching && stale,
    error: cur.error,
    expired: cur.status === 401 || expiredFlag,
    updatedAt: cur.at,
    reload,
    setData,
    noteStatus
  }
}
