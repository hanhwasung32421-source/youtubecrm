'use client'

import { useState } from 'react'

type Props = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  inputRef?: React.Ref<HTMLInputElement>
  invalid?: boolean
  describedBy?: string
  readOnly?: boolean
  disabled?: boolean
  help?: string
  error?: string
}

// 비밀번호 칸: 보기/숨기기 토글, Caps Lock 켜짐 안내, 칸 아래 도움말·오류(오류는 role="alert").
// 비밀번호는 어디에도 저장하지 않는다(브라우저의 자체 비밀번호 관리자만 사용).
export function PasswordField({ id, label, value, onChange, autoComplete, inputRef, invalid, describedBy, readOnly, disabled, help, error }: Props) {
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)

  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const capsId = `${id}-caps`
  const described = [describedBy, help ? helpId : '', error ? errorId : '', caps ? capsId : ''].filter(Boolean).join(' ') || undefined

  const sniffCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 일부 키(Shift 등)에서는 값을 못 읽는 브라우저가 있어 함수가 있을 때만 갱신한다.
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'))
  }

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="v2-pw-wrap">
        <input
          id={id}
          ref={inputRef}
          className="input v2-pw-input"
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={sniffCaps}
          onKeyUp={sniffCaps}
          onBlur={() => setCaps(false)}
        />
        <button
          type="button"
          className="v2-pw-toggle"
          aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setShow((v) => !v)}
        >
          {show ? '숨기기' : '보기'}
        </button>
      </div>
      <div className="v2-caps-slot" id={capsId} aria-live="polite">
        {caps ? <span className="v2-hint">Caps Lock이 켜져 있어요. 영문 대소문자를 확인해 주세요.</span> : null}
      </div>
      {help ? (
        <div className="v2-field-help" id={helpId}>
          {help}
        </div>
      ) : null}
      {error ? (
        <div className="v2-field-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}
