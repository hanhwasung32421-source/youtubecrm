'use client'

// V3 작업 화면 공통 입력 부품: 두 번 눌러 확인하는 버튼, 한 줄 인라인 편집기, 필수 표시, 필드 오류.
// window.confirm 을 쓰지 않고, 버튼이 있던 자리에서 바로 "정말요?"를 묻는다.

import './interact.css'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'

// useToast() 가 돌려주는 showError 등은 렌더마다 새 함수라서, useCallback/useEffect 의 의존성에 넣으면
// 불러오기가 끝없이 반복된다. 최신 함수를 ref 에 담아 두고 의존성에서는 뺀다.
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

export function Req() {
  return (
    <>
      <span className="v3i-req" aria-hidden>
        *
      </span>
      <span className="v3i-sr">(필수)</span>
    </>
  )
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} className="v3a-field-error" role="alert">
      {children}
    </p>
  )
}

// ── 두 번 눌러 확인 ─────────────────────────────────────────────
// 1) 버튼 클릭 → "정말 ○○할까요?  [확인] [아니요]"  2) 확인을 눌러야 실행. Esc 로 취소.
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  busy = false,
  busyLabel,
  danger = false,
  disabled = false,
  onConfirm
}: {
  label: string
  question: string
  confirmLabel: string
  busy?: boolean
  busyLabel?: string
  danger?: boolean
  disabled?: boolean
  onConfirm: () => void | Promise<void>
}) {
  const [armed, setArmed] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (armed) cancelRef.current?.focus()
  }, [armed])

  const close = () => {
    setArmed(false)
    // 취소하면 처음 눌렀던 버튼으로 포커스를 돌려준다.
    window.setTimeout(() => openerRef.current?.focus(), 0)
  }

  if (!armed) {
    return (
      <button ref={openerRef} type="button" className="button secondary xs" disabled={disabled || busy} onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation()
      close()
    }
  }

  return (
    <span className="v3i-confirm" role="group" aria-label={question} onKeyDown={onKeyDown}>
      <span className="v3i-confirm-q">{question}</span>
      <button type="button" className={`button xs ${danger ? 'danger' : ''}`} disabled={busy} onClick={() => void onConfirm()}>
        {busy ? busyLabel || '처리 중…' : confirmLabel}
      </button>
      <button ref={cancelRef} type="button" className="button secondary xs" disabled={busy} onClick={close}>
        아니요
      </button>
    </span>
  )
}

// ── 한 줄 인라인 편집기 ─────────────────────────────────────────
// Enter = 저장, Esc = 취소. 저장 중에는 입력과 버튼이 잠긴다.
export function InlineEditor({
  label,
  initial,
  maxLength,
  placeholder,
  required = false,
  saving,
  error,
  onSave,
  onCancel
}: {
  label: string
  initial: string
  maxLength: number
  placeholder?: string
  required?: boolean
  saving: boolean
  error?: string | null
  onSave: (value: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [attempted, setAttempted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useRef(`v3i-edit-${Math.random().toString(36).slice(2, 8)}`).current

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const emptyError = required && attempted && !value.trim() ? `${label}을(를) 입력해 주세요.` : null
  const shownError = emptyError || error || null

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (saving) return
    setAttempted(true)
    if (required && !value.trim()) return
    void onSave(value.trim())
  }

  return (
    <form className="v3i-edit" onSubmit={submit} noValidate>
      <div className="field">
        <label className="label" htmlFor={inputId}>
          {label}
          {required ? <Req /> : null}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="input"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={saving}
          aria-invalid={!!shownError}
          aria-describedby={shownError ? `${inputId}-err` : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              if (!saving) onCancel()
            }
          }}
        />
        <FieldError id={`${inputId}-err`}>{shownError}</FieldError>
      </div>
      <div className="v3i-edit-actions">
        <button type="submit" className="button xs" disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="button secondary xs" disabled={saving} onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  )
}
