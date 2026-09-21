'use client'

import { PERIOD_OPTIONS, type PeriodDays } from '@/lib/v4/analytics'
import { V4_SQL_FILE } from '@/lib/v4/tables'
import { fmtNumber } from '@/lib/v4/format'

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
      <span>
        샘플 데이터 표시 중{what ? `(${what})` : ''} · <code>{V4_SQL_FILE}</code> 실행 후 실제 데이터로 바뀝니다
      </span>
    </div>
  )
}

export function KpiCard({
  title,
  value,
  meta,
  tone = 'indigo'
}: {
  title: string
  value: string
  meta?: string
  tone?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate'
}) {
  return (
    <div className={`metric-card v4-kpi tone-${tone}`}>
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      {meta ? <div className="card-meta">{meta}</div> : null}
    </div>
  )
}

export function TrendArrow({ trend, ratio }: { trend: 'up' | 'down' | 'flat' | 'new'; ratio: number }) {
  if (trend === 'new') return <span className="v4-trend new">NEW</span>
  const pct = `${ratio > 0 ? '+' : ''}${Math.round(ratio * 100)}%`
  if (trend === 'up') return <span className="v4-trend up">▲ {pct}</span>
  if (trend === 'down') return <span className="v4-trend down">▼ {pct}</span>
  return <span className="v4-trend flat">― {pct}</span>
}

export function FormatPill({ contentType }: { contentType: string }) {
  const short = contentType === 'shortform'
  return <span className={`v4-format ${short ? 'short' : 'long'}`}>{short ? '숏폼' : '롱폼'}</span>
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

export function StatLine({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="row-between v4-statline">
      <span className="muted small">{label}</span>
      <span className="v4-num">{typeof value === 'number' ? fmtNumber(value) : value}</span>
    </div>
  )
}
