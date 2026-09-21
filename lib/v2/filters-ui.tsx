'use client'

// 지금 적용된 필터를 칩으로 보여 주고, 하나씩 끄거나 한 번에 초기화한다. 켜진 필터가 없으면 아무것도 그리지 않는다.
export type FilterChip = { key: string; label: string; onClear: () => void }

export function ActiveFilters({ chips, onReset }: { chips: FilterChip[]; onReset: () => void }) {
  if (chips.length === 0) return null
  return (
    <div className="v2a-chips" role="group" aria-label="지금 적용된 필터">
      <span className="v2a-chips-label">적용된 필터</span>
      {chips.map((chip) => (
        <span key={chip.key} className="v2a-chip">
          {chip.label}
          <button type="button" className="v2a-chip-x" onClick={chip.onClear} aria-label={`${chip.label} 필터 끄기`}>
            ×
          </button>
        </span>
      ))}
      <button type="button" className="button secondary xs" onClick={onReset}>
        필터 초기화
      </button>
    </div>
  )
}
