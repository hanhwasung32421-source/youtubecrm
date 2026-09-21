'use client'

import type { ReactNode } from 'react'

// V5 공용 위젯 카드: header(icon+title+kebab) / body / footer(summary+link).
// 모든 V5 기능 블록이 이 컴포넌트를 재사용한다.

export function SampleBanner({ show, sqlFile = 'supabase/sql/v5/100_v5_growth_lab.sql' }: { show: boolean; sqlFile?: string }) {
  if (!show) return null
  return (
    <div className="v5-banner" role="status">
      샘플 데이터 표시 중 · <code>{sqlFile}</code> 실행 후 실제 데이터로 바뀝니다
    </div>
  )
}

// 비어 있는 화면 안내: 이 화면이 무엇인지 + 무엇을 하면 되는지 + (선택) 바로 할 수 있는 버튼.
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="v5-empty">
      <div className="v5-empty-title">{title}</div>
      {children ? <div className="v5-empty-body">{children}</div> : null}
      {action ? <div className="v5-empty-action">{action}</div> : null}
    </div>
  )
}

export function WidgetCard({
  icon,
  title,
  subtitle,
  kebab,
  footer,
  className,
  bodyClassName,
  children
}: {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  kebab?: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
  children?: ReactNode
}) {
  return (
    <div className={`v5-widget ${className || ''}`}>
      <div className="v5-widget-head">
        {icon ? <div className="v5-widget-icon">{icon}</div> : null}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="v5-widget-title">{title}</div>
          {subtitle ? <div className="v5-widget-subtitle">{subtitle}</div> : null}
        </div>
        {kebab}
      </div>
      <div className={`v5-widget-body ${bodyClassName || ''}`}>{children}</div>
      {footer ? <div className="v5-widget-foot">{footer}</div> : null}
    </div>
  )
}

export function Badge({ tone = 'plain', children }: { tone?: 'indigo' | 'green' | 'amber' | 'red' | 'plain'; children: ReactNode }) {
  return <span className={`v5-badge ${tone}`}>{children}</span>
}

export function Kpi({
  label,
  value,
  meta,
  tone
}: {
  label: ReactNode
  value: ReactNode
  meta?: ReactNode
  tone?: 'green' | 'amber' | 'red'
}) {
  return (
    <div className={`v5-kpi ${tone ? `tone-${tone}` : ''}`}>
      <div className="v5-kpi-label">{label}</div>
      <div className="v5-kpi-value">{value}</div>
      {meta ? <div className="v5-kpi-meta">{meta}</div> : null}
    </div>
  )
}

// 구간별 분포 도넛. segments의 value 합이 0이면 회색 원만 그린다.
export function Donut({
  segments,
  size = 132,
  strokeWidth = 22,
  centerLabel,
  centerValue
}: {
  segments: Array<{ label: string; value: number; color: string }>
  size?: number
  strokeWidth?: number
  centerLabel?: string
  centerValue?: string
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="v5-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-soft)" strokeWidth={strokeWidth} />
        {total > 0
          ? segments.map((seg) => {
              if (seg.value <= 0) return null
              const fraction = seg.value / total
              const dash = fraction * circumference
              const circle = (
                <circle
                  key={seg.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              )
              offset += dash
              return circle
            })
          : null}
        {centerLabel !== undefined ? (
          <g style={{ transform: 'rotate(90deg)', transformOrigin: '50% 50%' }}>
            <text x="50%" y="47%" textAnchor="middle" fontSize="20" fontWeight={800} fill="var(--text)">
              {centerValue}
            </text>
            <text x="50%" y="63%" textAnchor="middle" fontSize="11" fill="var(--muted)">
              {centerLabel}
            </text>
          </g>
        ) : null}
      </svg>
      <div className="v5-legend">
        {segments.map((seg) => (
          <div className="v5-legend-row" key={seg.label}>
            <span className="v5-legend-dot" style={{ background: seg.color }} />
            <span>{seg.label}</span>
            <span className="muted" style={{ marginLeft: 'auto' }}>
              {seg.value.toLocaleString('ko-KR')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Segment<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="v5-segment">
      {options.map((opt) => (
        <button key={opt.value} type="button" className={opt.value === value ? 'active' : ''} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// 오른쪽 슬라이드 인 폼 패널(등록/편집용).
export function Drawer({ title, onClose, footer, children }: { title: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="v5-drawer-backdrop" onClick={onClose} />
      <div className="v5-drawer" role="dialog" aria-modal="true">
        <div className="v5-drawer-head">
          <div className="v5-drawer-title">{title}</div>
          <button className="button secondary sm" type="button" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="v5-drawer-body">{children}</div>
        {footer ? <div className="v5-drawer-foot">{footer}</div> : null}
      </div>
    </>
  )
}
