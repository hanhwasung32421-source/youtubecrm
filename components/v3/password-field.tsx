'use client'

import { useState } from 'react'

// 비밀번호 칸: "보기/숨기기" 버튼 + Caps Lock 켜짐 안내. 로그인·가입 화면이 함께 쓴다.
// 라벨(htmlFor↔id)과 아래 안내문(describedBy)은 호출하는 쪽에서 id로 이어 준다.
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  readOnly,
  invalid,
  describedBy,
  inputRef,
  children
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  autoComplete: 'current-password' | 'new-password'
  readOnly?: boolean
  invalid?: boolean
  describedBy?: string
  inputRef?: (el: HTMLInputElement | null) => void
  children?: React.ReactNode // 입력칸 아래의 안내·오류 문구
}) {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const capsId = `${id}-caps`

  const readCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock'))
  }

  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="v3-pw">
        <input
          id={id}
          ref={inputRef}
          className={`input ${invalid ? 'invalid' : ''}`}
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={[describedBy, capsId].filter(Boolean).join(' ')}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={readCaps}
          onKeyUp={readCaps}
          onBlur={() => setCaps(false)}
        />
        <button
          type="button"
          className="v3-pw-toggle"
          aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
          aria-controls={id}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? '숨기기' : '보기'}
        </button>
      </div>
      <div id={capsId} className="v3-caps" role="status" aria-live="polite">
        {caps ? 'Caps Lock이 켜져 있어요. 대문자로 입력될 수 있어요.' : ''}
      </div>
      {children}
    </div>
  )
}
