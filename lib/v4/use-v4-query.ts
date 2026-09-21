'use client'

// 분석 화면용 GET 훅: 옛 값 먼저 보여주기(SWR) + 같은 요청 합치기 + 주소가 바뀌면 이전 요청 취소 + 화면을 떠나면 취소.
//
// - path 가 null 이면 아직 요청하지 않는다 (저장된 기간 등을 읽는 중).
// - data 는 "마지막으로 받은 값"이다. path 가 바뀐 직후에는 이전 값이 남아 있고 stale=true 다 (화면이 깜빡이지 않게).
// - onError 는 ref 에 담아 두므로 매 렌더 새로 만들어지는 함수(useToast 의 showError 등)를 그대로 넘겨도 다시 요청하지 않는다.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useV4Me } from '@/components/v4/me-context'
import { patchCache, readCache, requestShared } from '@/lib/v4/fetch-cache'

type State<T> = { data: T | null; dataPath: string | null; error: string; status: number; fetching: boolean }

export function useV4Query<T>(path: string | null, options: { fallback: string; onError?: (message: string, status: number) => void }) {
  const { me } = useV4Me()
  const scope = me?.crmUserId ?? ''
  const [state, setState] = useState<State<T>>({ data: null, dataPath: null, error: '', status: 0, fetching: false })
  const [reloadKey, setReloadKey] = useState(0)
  const forceRef = useRef(false)
  const onErrorRef = useRef(options.onError)
  const fallbackRef = useRef(options.fallback)
  onErrorRef.current = options.onError
  fallbackRef.current = options.fallback

  useEffect(() => {
    if (!path) return
    const key = `${scope}|${path}`
    const force = forceRef.current
    forceRef.current = false

    const cached = force ? null : readCache<T>(key)
    if (cached && cached.phase === 'fresh') {
      setState({ data: cached.data, dataPath: path, error: '', status: 200, fetching: false })
      return
    }
    // 30초 안의 옛 값은 바로 보여주고, 뒤에서 새로 받는다.
    setState((prev) => ({
      data: cached ? cached.data : prev.data,
      dataPath: cached ? path : prev.dataPath,
      error: '',
      status: 0,
      fetching: true
    }))

    const controller = new AbortController()
    void requestShared<T>(key, path, { signal: controller.signal, fallback: fallbackRef.current, force }).then((res) => {
      if (!res || controller.signal.aborted) return
      if (res.ok) {
        setState({ data: res.data, dataPath: path, error: '', status: res.status, fetching: false })
        return
      }
      setState((prev) => ({ ...prev, error: res.message, status: res.status, fetching: false }))
      onErrorRef.current?.(res.message, res.status)
    })
    return () => controller.abort()
  }, [path, scope, reloadKey])

  const reload = useCallback(() => {
    forceRef.current = true
    setReloadKey((k) => k + 1)
  }, [])

  // 화면에서 값을 직접 고칠 때(저장 직후 등). 캐시에도 같이 반영한다.
  const mutate = useCallback(
    (update: (prev: T) => T) => {
      setState((prev) => (prev.data ? { ...prev, data: update(prev.data) } : prev))
      if (path) patchCache<T>(`${scope}|${path}`, update)
    },
    [path, scope]
  )

  const stale = state.data !== null && state.dataPath !== path
  return {
    data: state.data,
    stale,
    error: state.error,
    status: state.status,
    fetching: state.fetching,
    // 보여줄 값이 아직 없거나(첫 로딩), 다른 조건의 값이 남아 있는 동안
    loading: path === null || (state.data === null && !state.error) || (state.fetching && stale),
    reload,
    mutate
  }
}
