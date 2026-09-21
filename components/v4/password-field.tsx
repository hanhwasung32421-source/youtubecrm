'use client'

import { useId, useState } from 'react'

// 비밀번호 입력 칸: 보이기/숨기기 버튼 + Caps Lock 안내.
// 비밀번호는 어디에도 저장하지 않는다 (상태에만 잠깐 머문다).
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid,
  inputRef,
  help
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  autoComplete: 'current-password' | 'new-password'
  describedBy?: string
  invalid?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  help?: React.ReactNode
}) {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const capsId = useId()

  const readCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // getModifierState 가 없는 환경은 조용히 넘어간다.
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'))
  }

  const described = [describedBy, caps ? capsId : ''].filter(Boolean).join(' ') || undefined

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="v4-pw">
        <input
          id={id}
          ref={inputRef}
          className="input v4-pw-input"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={readCaps}
          onKeyUp={readCaps}
          onBlur={() => setCaps(false)}
        />
        <button type="button" className="v4-pw-toggle" onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-controls={id}>
          {visible ? '숨기기' : '보기'}
        </button>
      </div>
      {caps ? (
        <div id={capsId} className="v4-hint warn" role="status">
          Caps Lock이 켜져 있어요. 대문자로 입력될 수 있어요.
        </div>
      ) : null}
      {help}
    </div>
  )
}
