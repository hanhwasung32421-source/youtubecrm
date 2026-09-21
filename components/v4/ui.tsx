'use client'

import { PERIOD_OPTIONS, type PeriodDays } from '@/lib/v4/analytics'
import { V4_SQL_FILE } from '@/lib/v4/tables'
import type { Delta } from '@/components/v4/delta'

export function PeriodToggle({ value, onChange, disabled }: { value: PeriodDays; onChange: (next: PeriodDays) => void; disabled?: boolean }) {
  return (
    <div className="v4-segment" role="group" aria-label="기간 선택">
      {PERIOD_OPTIONS.map((days) => (
        <button
          key={days}
          type="button"
          className={`v4-segment-item ${value === days ? 'active' : ''}`}
          onClick={() => onChange(days)}
          disabled={disabled}
          aria-pressed={value === days}
        >
          {days}일
        </button>
      ))}
    </div>
  )
}

// 샘플 데이터 안내: 한 줄, 차분하게. what = 샘플로 채워진 부분 (예: '이번 달 목표').
export function SampleBanner({ show, what }: { show: boolean; what?: string }) {
  if (!show) return null
  return (
    <div className="v4-banner" role="status">
      <span className="v4-banner-dot" />
      <span title={`관리자가 ${V4_SQL_FILE} 를 실행하면 실제 데이터로 바뀌어요`}>
        지금은 예시 데이터를 보여 주고 있어요{what ? `(${what})` : ''} · 데이터 준비가 끝나면 실제 데이터로 바뀌어요
      </span>
    </div>
  )
}

// 지난 기간 대비 칩. 색깔만으로 알리지 않도록 화살표+글자를 함께 보이고,
// 화면 낭독기에는 풀어 쓴 문장을 읽어 준다.
export function DeltaChip({ delta, subject }: { delta: Delta; subject?: string }) {
  if (delta.kind === 'none') return null
  return (
    <span className={`v4-delta ${delta.kind}`}>
      <span className="v4-delta-chip" aria-hidden="true">
        {delta.label}
      </span>
      <span className="v4-sr">{subject ? `${subject}: ` : ''}{delta.text}</span>
    </span>
  )
}

export function KpiCard({
  title,
  value,
  meta,
  tone = 'indigo',
  delta,
  compareLabel
}: {
  title: string
  value: string
  meta?: string
  tone?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate'
  delta?: Delta | null
  compareLabel?: string // 예: "지난 30일 대비"
}) {
  const showDelta = delta && delta.kind !== 'none'
  return (
    <div className={`metric-card v4-kpi tone-${tone}`}>
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      {showDelta ? (
        <div className="v4-kpi-delta">
          <DeltaChip delta={delta} subject={title} />
          {compareLabel && delta.kind !== 'new' ? <span className="v4-kpi-delta-label">{compareLabel}</span> : null}
        </div>
      ) : null}
      {meta ? <div className="card-meta">{meta}</div> : null}
    </div>
  )
}

export function FormatPill({ contentType }: { contentType: string }) {
  const short = contentType === 'shortform'
  return <span className={`v4-format ${short ? 'short' : 'long'}`}>{short ? '숏폼' : '롱폼'}</span>
}

// 롱폼/숏폼 고르기: 두 칸짜리 스위치. 화면 낭독기에는 "눌림 상태"가 있는 버튼 두 개로 읽힌다.
export function FormatToggle({
  value,
  onChange,
  disabled,
  labelledBy,
  className = ''
}: {
  value: 'longform' | 'shortform'
  onChange: (next: 'longform' | 'shortform') => void
  disabled?: boolean
  labelledBy: string
  className?: string
}) {
  return (
    <div className={`v4-segment ${className}`} role="group" aria-labelledby={labelledBy}>
      {(
        [
          ['longform', '롱폼'],
          ['shortform', '숏폼']
        ] as const
      ).map(([key, label]) => (
        <button key={key} type="button" className={`v4-segment-item ${value === key ? 'active' : ''}`} aria-pressed={value === key} disabled={disabled} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  )
}

// 빈 화면 안내: (선택) 제목 + 설명 + 다음에 할 일 버튼. 기존처럼 children만 넘겨도 된다.
export function EmptyState({ title, children, action }: { title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty-state v4-empty">
      {title ? <div className="v4-empty-title">{title}</div> : null}
      {children ? <div className="v4-empty-body">{children}</div> : null}
      {action ? <div className="v4-empty-action">{action}</div> : null}
    </div>
  )
}
