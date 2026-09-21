'use client'

import { useState } from 'react'

// 비밀번호 칸: 보기/숨기기 버튼 + Caps Lock 안내. 로그인과 회원가입이 함께 쓴다.
export function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  disabled,
  invalid,
  describedBy,
  inputRef,
  placeholder
}: {
  id: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  inputRef?: React.Ref<HTMLInputElement>
  placeholder?: string
}) {
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const capsId = `${id}-caps`

  const trackCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'))
  }

  return (
    <>
      <div className="v5-pw">
        <input
          id={id}
          ref={inputRef}
          className="input"
          type={shown ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={[describedBy, caps ? capsId : ''].filter(Boolean).join(' ') || undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={trackCaps}
          onKeyUp={trackCaps}
          onBlur={() => setCaps(false)}
        />
        <button
          type="button"
          className="v5-pw-toggle"
          aria-pressed={shown}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? '숨기기' : '보기'}
        </button>
      </div>
      <p id={capsId} className="v5-auth-help v5-caps-hint" aria-live="polite">
        {caps ? 'Caps Lock이 켜져 있습니다. 대문자로 입력될 수 있어요.' : ''}
      </p>
    </>
  )
}
