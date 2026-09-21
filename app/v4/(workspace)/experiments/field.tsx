'use client'

import type { ReactNode } from 'react'

// 라벨은 입력칸 위에, 필수는 * 로 표시, 오류는 칸 바로 아래에 보여준다.
export function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children
}: {
  id: string
  label: string
  required?: boolean
  optional?: boolean
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="v4p-field">
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className="v4p-req" aria-hidden="true">
            *
          </span>
        ) : null}
        {optional ? <span className="opt">(선택)</span> : null}
      </label>
      {children}
      {error ? (
        <div className="v4p-field-error" id={`${id}-err`} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="v4p-field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}
