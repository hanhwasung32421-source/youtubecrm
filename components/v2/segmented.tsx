'use client'

import { useRef } from 'react'

type Option<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  value: T
  onChange: (value: T) => void
  options: readonly Option<T>[]
  labelledBy: string
  disabled?: boolean
}

// 둘 중 하나를 고르는 "칸막이 버튼"(롱폼/숏폼 등). 고른 쪽은 색이 꽉 차게 보이고,
// 키보드에서는 Tab으로 들어와 ←→(↑↓)로 바꾼다. 스크린리더에는 라디오 그룹으로 읽힌다.
export function Segmented<T extends string>({ value, onChange, options, labelledBy, disabled }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((o) => o.value === value)

  const move = (to: number) => {
    const next = (to + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className="v2-segmented" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option, i) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (selected < 0 && i === 0) ? 0 : -1}
            className={`v2-segmented-btn ${active ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(i + 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(i - 1)
              } else if (e.key === 'Home') {
                e.preventDefault()
                move(0)
              } else if (e.key === 'End') {
                e.preventDefault()
                move(options.length - 1)
              }
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
