'use client'

// V3 분석 화면용 "읽기" 도우미.
//   - 지난번 받아 둔 응답(60초 이내)이 있으면 곧바로 보여 주고, 뒤에서 조용히 새로 받는다.
//   - 같은 주소를 동시에 부르면 요청은 한 번만 나가고, 필터를 바꾸거나 화면을 떠나면 기다리던 요청은 취소된다.
//   - 화면 쪽 정렬/검색처럼 주소가 바뀌지 않는 조작은 다시 받지 않는다(주소가 같으면 아무 일도 없다).
//   - onError 같은 콜백은 ref 에 담아 두어서, 렌더마다 새 함수여도 효과(useEffect)가 다시 돌지 않는다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { v3Request, type V3Result } from '@/lib/v3/api-client'
import { createSwrCore } from '@/lib/v3/swr-core'
import { useLatest } from '@/lib/v3/interact'

const core = createSwrCore({ maxAgeMs: 60_000, freshMs: 3_000 })
let forceSeq = 0

// 저장/수정/삭제/새로고침 뒤에 호출: 이 주소가 들어간 옛 응답을 지운다. 예) invalidateV3('/api/v3/viral')
export function invalidateV3(...prefixes: string[]) {
  for (const prefix of prefixes) core.invalidate(prefix)
}

// 화면에서 이미 고쳐 둔 값은 남겨 두고, 다음에 받을 때만 서버에서 새로 받게 한다.
export function markDirtyV3(...prefixes: string[]) {
  for (const prefix of prefixes) core.markDirty(prefix)
}

export function clearV3Cache() {
  core.clear()
}

type State<T> = { dataKey: string | null; data: T | null; error: string | null; status: number }

export type V3Data<T> = {
  data: T | null
  // 아직 보여 줄 것이 아무것도 없다(처음 불러오는 중). 뼈대(스켈레톤)를 보여 주면 된다.
  loading: boolean
  // 이미 보여 주는 값이 있고 뒤에서 새로 받는 중
  refreshing: boolean
  // 보여 주는 값이 "이전 필터/이전 영상"의 것이다(새 값을 기다리는 동안). 흐리게 보여 주면 된다.
  stale: boolean
  error: string | null
  status: number
  unauthorized: boolean
  // force=true: 저장 직후처럼 반드시 서버의 최신 값이 필요할 때
  reload: (force?: boolean) => Promise<V3Result<T> | null>
  // 화면에서 먼저 바꿔 보여 줄 때(낙관적 갱신). 캐시에도 같이 반영된다.
  mutate: (updater: (prev: T) => T) => void
}

export function useV3Data<T>(
  url: string | null,
  opts: { scope?: string | null; fallback?: string; onError?: (message: string, status: number) => void } = {}
): V3Data<T> {
  const key = url ? `${opts.scope || 'anon'}|${url}` : null
  const [state, setState] = useState<State<T>>({ dataKey: null, data: null, error: null, status: 0 })
  const [fetching, setFetching] = useState(false)

  const stateRef = useRef(state)
  stateRef.current = state
  const latest = useLatest({ url, key, fallback: opts.fallback || '화면을 불러오지 못했어요.', onError: opts.onError })
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(
    async (force: boolean): Promise<V3Result<T> | null> => {
      const { url: u, key: k, fallback } = latest.current
      if (!u || !k) return null
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setFetching(true)

      // 저장 직후이거나 최근에 저장이 있었던 주소는 브라우저가 들고 있는 옛 응답을 건너뛴다.
      const bypass = force || core.isDirty(u)
      const requestKey = force ? `${k}#force${++forceSeq}` : bypass ? `${k}#fresh` : k
      let res: V3Result<T>
      try {
        res = await core.request(requestKey, (signal) => v3Request<T>(u, { signal, cache: bypass ? 'reload' : undefined }, fallback), ctrl.signal)
      } catch {
        return null // 취소됨(필터 변경·화면 이동·새 요청)
      }
      if (ctrl.signal.aborted || res.aborted) return null
      if (abortRef.current === ctrl) abortRef.current = null
      setFetching(false)

      if (res.ok) {
        core.set(k, res.data)
        setState({ dataKey: k, data: res.data, error: null, status: res.status })
        return res
      }
      const message = res.error || fallback
      // 같은 화면의 새로고침이 실패했으면 보던 값은 그대로 두고, 다른 필터/영상의 값이었다면 그 값은 버린다.
      setState((prev) => (prev.dataKey === k ? { ...prev, error: message, status: res.status } : { dataKey: null, data: null, error: message, status: res.status }))
      latest.current.onError?.(message, res.status)
      return res
    },
    [latest]
  )

  // 주소가 바뀔 때만 실행된다. (콜백·정렬·검색어 같은 것은 의존성에 없다)
  useEffect(() => {
    if (!key) {
      setFetching(false)
    } else {
      const hit = core.peek<T>(key)
      if (hit) {
        setState({ dataKey: key, data: hit.data, error: null, status: 200 })
      } else {
        setState((prev) => (prev.error === null && prev.status === 0 ? prev : { ...prev, error: null, status: 0 }))
      }
      if (hit?.fresh) {
        setFetching(false) // 방금 받은 값이라 다시 받지 않는다
      } else {
        void run(false)
      }
    }
    return () => {
      // 화면을 떠나거나 주소가 바뀌면 기다리던 요청을 취소한다.
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [key, run])

  const reload = useCallback((force = false) => run(force), [run])

  const mutate = useCallback(
    (updater: (prev: T) => T) => {
      const current = stateRef.current
      if (current.data === null) return
      const next = updater(current.data)
      const nextState = { ...current, data: next }
      stateRef.current = nextState
      setState(nextState)
      const k = latest.current.key
      if (k && current.dataKey === k) core.set(k, next)
    },
    [latest]
  )

  const hasData = state.data !== null
  const stale = hasData && state.dataKey !== key
  return {
    data: state.data,
    loading: !hasData && state.error === null,
    refreshing: fetching && hasData && !stale,
    stale,
    error: state.error,
    status: state.status,
    unauthorized: state.error !== null && state.status === 401,
    reload,
    mutate
  }
}
