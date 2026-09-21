'use client'

import { useId, useRef } from 'react'

// 두 개~세 개 중 하나를 고르는 조각 버튼(예: 롱폼/숏폼).
// 화면 읽기 프로그램에는 "라디오 묶음"으로 보이고, 방향키로 옮길 수 있다.
export function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  const groupId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className={`v5-type-toggle ${className || ''}`} role="radiogroup" aria-label={label} id={groupId}>
      {options.map((opt, i) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'active' : ''}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(i, 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(i, -1)
              }
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
