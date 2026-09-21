'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Drawer } from '@/components/v5/widget'
import { todayYmd } from '@/lib/v5/format'

// 성장 관리 4개 화면이 함께 쓰는 상호작용 조각: Esc 닫기, 기억되는 필터, 두 번 눌러 삭제, 폼 서랍.

// ---------------------------------------------------------------------------
// Esc: 가장 나중에 열린 것(맨 위 편집기/서랍)만 닫는다.
// ---------------------------------------------------------------------------
const escapeStack: Array<{ current: () => void }> = []
let escapeBound = false

function bindEscape() {
  if (escapeBound || typeof document === 'undefined') return
  escapeBound = true
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return
    const top = escapeStack[escapeStack.length - 1]
    if (!top) return
    e.preventDefault()
    top.current()
  })
}

export function useEscape(active: boolean, handler: () => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    bindEscape()
    escapeStack.push(ref)
    return () => {
      const i = escapeStack.indexOf(ref)
      if (i >= 0) escapeStack.splice(i, 1)
    }
  }, [active])
}

// ---------------------------------------------------------------------------
// 오늘 날짜(한국 시간). 화면을 밤새 켜 둬도 자정(한국 시간)이 지나면 새 날짜로 바뀐다("D+N", 이번 주 같은 값이 어제 것으로 남지 않게).
// 첫 그림은 서버와 같은 값이고, 1분마다·탭으로 돌아올 때 날짜만 확인한다(바뀔 때만 다시 그린다).
// ---------------------------------------------------------------------------
export function useKstToday() {
  const [today, setToday] = useState(todayYmd)
  useEffect(() => {
    const check = () => setToday((prev) => {
      const next = todayYmd()
      return next === prev ? prev : next
    })
    check()
    const timer = window.setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  return today
}

// ---------------------------------------------------------------------------
// 쓰던 내용이 있을 때(dirty)만, 탭을 닫거나 새로 고치기 전에 브라우저가 한 번 묻게 한다.
// ---------------------------------------------------------------------------
export function useBeforeUnload(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}

// ---------------------------------------------------------------------------
// 한 번에 하나만: 더블클릭/연타로 같은 저장이 두 번 나가지 않게 한다(state 가 아니라 ref 라서 같은 순간의 두 번째 클릭도 막는다).
// key 를 주면 그 항목만 잠근다(카드별 저장 등).
// ---------------------------------------------------------------------------
export function useSingleFlight() {
  const running = useRef(new Set<string>())
  return useCallback(async <T,>(fn: () => Promise<T>, key = '*'): Promise<T | undefined> => {
    if (running.current.has(key)) return undefined
    running.current.add(key)
    try {
      return await fn()
    } finally {
      running.current.delete(key)
    }
  }, [])
}

// ---------------------------------------------------------------------------
// 마지막에 쓴 필터를 브라우저에 기억한다(localStorage 가 막혀 있어도 화면은 정상 동작).
// ready 가 true 가 된 뒤에 첫 조회를 하면 필터가 바뀌며 화면이 두 번 그려지는 일이 없다.
// ---------------------------------------------------------------------------
export function usePref<T>(key: string, initial: T, validate: (v: unknown) => v is T): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [ready, setReady] = useState(false)
  const validateRef = useRef(validate)
  validateRef.current = validate

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) {
        const parsed = JSON.parse(raw)
        if (validateRef.current(parsed)) setValue(parsed)
      }
    } catch {
      // 저장소를 못 읽으면 기본값으로 시작
    }
    setReady(true)
  }, [key])

  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // 저장 실패는 무시(이번 화면에서만 적용)
      }
    },
    [key]
  )

  return [value, update, ready]
}

// ---------------------------------------------------------------------------
// 두 번 눌러 지우기(window.confirm 대신). Esc 로 취소.
// ---------------------------------------------------------------------------
export function ConfirmDelete({
  onConfirm,
  busy,
  label = '삭제',
  question = '정말 지울까요?',
  disabled
}: {
  onConfirm: () => void | Promise<void>
  busy?: boolean
  label?: string
  question?: string
  disabled?: boolean
}) {
  const [asking, setAsking] = useState(false)
  useEscape(asking, () => setAsking(false))

  if (!asking) {
    return (
      <button type="button" className="button xs ghost v5p-danger-text" disabled={busy || disabled} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="v5p-confirm" role="group" aria-label="삭제 확인">
      <span className="small">{question}</span>
      <button type="button" className="button xs danger" disabled={busy} onClick={() => void onConfirm()} autoFocus>
        {busy ? '지우는 중…' : '지우기'}
      </button>
      <button type="button" className="button xs secondary" disabled={busy} onClick={() => setAsking(false)}>
        아니요
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// 폼 서랍: Enter 로 저장(한 줄 입력칸), Esc 로 닫기, 저장 중 버튼 잠금,
// 쓰던 내용이 있으면 닫기 전에 한 번 더 묻는다. 열리면 첫 칸에 커서를 둔다.
// ---------------------------------------------------------------------------
export function FormDrawer({
  title,
  formId,
  dirty,
  saving,
  submitLabel,
  onSubmit,
  onClose,
  children
}: {
  title: ReactNode
  formId: string
  dirty: boolean
  saving: boolean
  submitLabel: string
  onSubmit: () => void | Promise<void>
  onClose: () => void
  children: ReactNode
}) {
  const [asking, setAsking] = useState(false)
  const savingRef = useRef(saving)
  savingRef.current = saving
  useBeforeUnload(dirty)

  const requestClose = useCallback(() => {
    if (savingRef.current) return
    if (dirty) setAsking(true)
    else onClose()
  }, [dirty, onClose])

  useEscape(true, () => {
    if (asking) setAsking(false)
    else requestClose()
  })

  useEffect(() => {
    const t = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>('.v5-drawer [data-autofocus], .v5-drawer form input:not([type="checkbox"]):not([type="search"]), .v5-drawer form textarea')
      target?.focus()
    }, 60)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <Drawer
      title={title}
      onClose={requestClose}
      footer={
        asking ? (
          <>
            <span className="small v5p-discard-text">쓰던 내용이 사라져요. 닫을까요?</span>
            <button className="button secondary" type="button" onClick={() => setAsking(false)}>
              계속 쓰기
            </button>
            <button className="button danger" type="button" onClick={onClose}>
              닫기
            </button>
          </>
        ) : (
          <>
            <button className="button secondary" type="button" disabled={saving} onClick={requestClose}>
              취소
            </button>
            <button className="button" type="submit" form={formId} disabled={saving}>
              {saving ? '저장 중…' : submitLabel}
            </button>
          </>
        )
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!savingRef.current) void onSubmit()
        }}
      >
        <div className="v5p-drawer-form">{children}</div>
      </form>
    </Drawer>
  )
}
