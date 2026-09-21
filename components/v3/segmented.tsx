'use client'

import { useId } from 'react'

type ContentKind = 'longform' | 'shortform'

// 롱폼/숏폼 분절 선택. 진짜 라디오 버튼이라 화살표 키로 옮기고, 스크린리더가 "2개 중 1번째"로 읽는다.
export function SegmentedType({
  value,
  onChange,
  disabled,
  labelledBy
}: {
  value: ContentKind
  onChange: (next: ContentKind) => void
  disabled?: boolean
  labelledBy: string
}) {
  const name = useId()
  return (
    <div className="v3-seg" role="radiogroup" aria-labelledby={labelledBy}>
      {(['longform', 'shortform'] as const).map((type) => (
        <label key={type} className="v3-seg-opt">
          <input type="radio" name={name} value={type} checked={value === type} disabled={disabled} onChange={() => onChange(type)} />
          <span>{type === 'shortform' ? '숏폼' : '롱폼'}</span>
        </label>
      ))}
    </div>
  )
}
