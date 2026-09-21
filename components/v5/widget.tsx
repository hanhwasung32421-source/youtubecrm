'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

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
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
        role="img"
        aria-label={segments.map((seg) => `${seg.label} ${seg.value.toLocaleString('ko-KR')}`).join(', ')}
      >
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
    <div className="v5-segment" role="group">
      {options.map((opt) => (
        <button key={opt.value} type="button" className={opt.value === value ? 'active' : ''} aria-pressed={opt.value === value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ---- 불러오는 중 자리표시(shimmer) -------------------------------------------------------
// 글자 "불러오는 중..." 대신 실제 모양과 비슷한 회색 조각을 보여 준다.
// prefers-reduced-motion 이면 움직이지 않는다(theme.css).

export function Skeleton({
  width,
  height = 14,
  radius,
  circle,
  className,
  style
}: {
  width?: number | string
  height?: number | string
  radius?: number | string
  circle?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={`v5-skel ${className || ''}`}
      aria-hidden="true"
      style={{ width: circle && width === undefined ? height : (width ?? '100%'), height, borderRadius: circle ? '50%' : radius, ...style }}
    />
  )
}

export function SkeletonText({ lines = 3, lastWidth = '60%' }: { lines?: number; lastWidth?: number | string }) {
  return (
    <div className="v5-skel-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 && lines > 1 ? lastWidth : '100%'} />
      ))}
    </div>
  )
}

// 스킨을 감싸서 화면 읽기 프로그램에는 "불러오는 중" 한 마디만 전한다.
export function SkeletonRegion({ label = '불러오는 중', className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <span className="v5-sr-only">{label}</span>
      {children}
    </div>
  )
}

// ---- Drawer ----------------------------------------------------------------------------
// 오른쪽 슬라이드 인 폼 패널(등록/편집용). 좁은 화면에서는 화면 전체 너비.
// 열려 있는 동안: 포커스가 패널 안에서만 돌고, Esc 로 닫히고, 뒤 화면은 스크롤되지 않으며,
// 닫으면 열기 전에 있던 자리로 포커스가 돌아간다.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement | null) {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
}

export function Drawer({ title, onClose, footer, children }: { title: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  const titleId = useId()

  // 열기 직전 포커스 위치. 안쪽 입력칸의 autoFocus 가 먼저 움직이기 전에, 처음 그릴 때 붙잡아 둔다.
  const [opener] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null
    const active = document.activeElement
    return active instanceof HTMLElement && active !== document.body ? active : null
  })

  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const body = document.body
    const prevOverflow = body.style.overflow
    const prevPaddingRight = body.style.paddingRight
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`

    // 안쪽에서 이미 포커스를 가져갔으면 건드리지 않고, 아니면 첫 입력칸(없으면 패널)으로.
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const first = focusables(bodyRef.current)[0] || focusables(panel)[0]
      if (first) first.focus()
      else panel.focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = focusables(panelRef.current)
      if (items.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!panelRef.current.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    // window 에 건다: 화면 쪽에서 document 에 이미 Esc 를 처리했다면(preventDefault) 여기서는 다시 닫지 않는다.
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      body.style.overflow = prevOverflow
      body.style.paddingRight = prevPaddingRight
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [opener])

  return (
    <>
      <div className="v5-drawer-backdrop" onClick={() => closeRef.current()} aria-hidden="true" />
      <div ref={panelRef} className="v5-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="v5-drawer-head">
          <div className="v5-drawer-title" id={titleId}>
            {title}
          </div>
          <button className="button secondary sm" type="button" onClick={() => closeRef.current()}>
            닫기
          </button>
        </div>
        <div ref={bodyRef} className="v5-drawer-body">
          {children}
        </div>
        {footer ? <div className="v5-drawer-foot">{footer}</div> : null}
      </div>
    </>
  )
}
