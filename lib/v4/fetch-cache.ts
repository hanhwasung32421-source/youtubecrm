'use client'

// V4 분석 화면 전용 아주 작은 요청 캐시.
// - 같은 주소를 30초 안에 다시 열면 옛 값을 바로 보여주고(5초 안이면 서버에 묻지도 않는다), 그보다 오래됐으면 뒤에서 새로 받는다.
// - 같은 주소를 동시에 두 번 요청하면 한 번만 보내고 함께 기다린다.
// - 필터를 바꿔 옛 요청이 필요 없어지면(모든 구독자가 취소하면) 진짜 요청도 취소한다.
// 모듈 변수(Map)에만 저장하므로 새로고침하면 사라지고, 사용자가 바뀌면 키가 달라져 섞이지 않는다.

import { v4Fetch, type V4Result } from '@/lib/v4/client'
import { SWR_MAX_ENTRIES, classifyAge, trimOldest, type CachePhase } from '@/lib/v4/swr-policy'

type Entry = { data: unknown; at: number }
type Job = { promise: Promise<V4Result<any>>; controller: AbortController; refs: number }

const store = new Map<string, Entry>()
const jobs = new Map<string, Job>()

export function readCache<T>(key: string): { data: T; phase: Exclude<CachePhase, 'expired'> } | null {
  const entry = store.get(key)
  if (!entry) return null
  const phase = classifyAge(Date.now() - entry.at)
  if (phase === 'expired') {
    store.delete(key)
    return null
  }
  return { data: entry.data as T, phase }
}

export function writeCache(key: string, data: unknown) {
  store.delete(key) // 넣은 순서를 갱신해 가장 오래된 것부터 지워지게 한다
  store.set(key, { data, at: Date.now() })
  trimOldest(store, SWR_MAX_ENTRIES)
}

// 화면에서 값을 직접 고쳤을 때(예: 실험 저장) 캐시에도 같은 값을 남겨, 다른 화면에 갔다 와도 옛 값이 보이지 않게 한다.
export function patchCache<T>(key: string, update: (prev: T) => T) {
  const entry = store.get(key)
  if (!entry) return
  store.set(key, { data: update(entry.data as T), at: entry.at })
}

export function clearCache() {
  store.clear()
}

// 같은 key 의 요청을 함께 쓴다. 이 구독이 취소되면 null 을 돌려준다.
export function requestShared<T>(key: string, path: string, options: { signal: AbortSignal; fallback: string; force?: boolean }): Promise<V4Result<T> | null> {
  let job = jobs.get(key)
  if (!job) {
    const controller = new AbortController()
    const created: Job = { controller, refs: 0, promise: Promise.resolve({ ok: false, status: 0, message: '', data: null }) }
    const init: RequestInit = { signal: controller.signal }
    // 다시 불러오기 버튼: 브라우저에 저장된 사본도 쓰지 않는다.
    if (options.force) init.cache = 'reload'
    created.promise = v4Fetch<T>(path, init, options.fallback).then((res) => {
      if (jobs.get(key) === created) jobs.delete(key)
      if (res.ok) writeCache(key, res.data)
      else if (res.status === 401) clearCache()
      return res
    })
    jobs.set(key, created)
    job = created
  }

  const current = job
  current.refs += 1
  return new Promise<V4Result<T> | null>((resolve) => {
    let done = false
    const finish = (value: V4Result<T> | null) => {
      if (done) return
      done = true
      options.signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = () => {
      if (done) return
      current.refs -= 1
      if (current.refs <= 0) {
        if (jobs.get(key) === current) jobs.delete(key)
        current.controller.abort()
      }
      finish(null)
    }
    if (options.signal.aborted) {
      onAbort()
      return
    }
    options.signal.addEventListener('abort', onAbort, { once: true })
    void current.promise.then((res) => finish(res as V4Result<T>))
  })
}
