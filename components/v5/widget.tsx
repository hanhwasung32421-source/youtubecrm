'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

// V5 공용 위젯 모음. 모든 V5 화면이 이 파일을 함께 쓴다(내보낸 이름·속성은 바꾸지 않고 덧붙이기만 한다).
//
//  카드/표시    WidgetCard · Badge · Kpi · Donut · SampleBanner
//  선택         Segment(필터 조각 버튼) · Tabs / StatusTabs / tabPanelProps(탭 + 화면 전환)
//  상태 화면    EmptyState(비었음·오류) · Skeleton / SkeletonText / SkeletonRegion(불러오는 중)
//  덮개 패널    Drawer(오른쪽에서 열리는 입력 패널)
//
// 상태 화면 원칙(모든 화면 동일)
//  1) 불러오는 중  = SkeletonRegion + Skeleton  (글자 "불러오는 중..." 대신 실제 모양의 회색 조각)
//  2) 비었음        = EmptyState (무엇인지 + 지금 무엇을 하면 되는지 + 바로 할 수 있는 버튼)
//  3) 오류          = EmptyState tone="error" (무슨 일이 생겼는지 + 다시 시도 버튼). 입력 중이던 값은 절대 지우지 않는다.

export function SampleBanner({ show, sqlFile = 'supabase/sql/v5/100_v5_growth_lab.sql' }: { show: boolean; sqlFile?: string }) {
  if (!show) return null
  return (
    <div className="v5-banner" role="status">
      샘플 데이터를 보여 주고 있어요 · <code>{sqlFile}</code> 실행 후 실제 데이터로 바뀌어요
    </div>
  )
}

// 비어 있거나 실패한 화면 안내: 이 화면이 무엇인지 + 무엇을 하면 되는지 + (선택) 바로 할 수 있는 버튼.
//  - tone="error"  실패 안내. 화면 읽기 프로그램에 즉시 알려 준다(role=alert). 문구는 "무슨 일 + 다음에 할 일" 한 쌍으로.
//  - compact       표 안이나 작은 카드 안에서 쓰는 낮은 버전(여백을 줄인다).
export function EmptyState({
  title,
  children,
  action,
  tone = 'default',
  compact
}: {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  tone?: 'default' | 'error'
  compact?: boolean
}) {
  return (
    <div className={`v5-empty ${tone === 'error' ? 'is-error' : ''} ${compact ? 'is-compact' : ''}`} role={tone === 'error' ? 'alert' : undefined}>
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

// ---- Tabs / StatusTabs -----------------------------------------------------------------------
// 화면 안에서 "보기"를 바꾸는 탭 줄(예: 전체 · 진행 중 · 끝난 실험). 화면 읽기 프로그램에는 탭 목록으로 읽히고,
// 방향키(←→)·Home·End 로 옮기면 바로 선택된다(선택된 탭만 Tab 키로 들어간다).
//  - Tabs        밑줄 모양. 서로 다른 내용 화면을 오갈 때.
//  - StatusTabs  알약 모양 + 개수 배지. 같은 목록을 상태별로 걸러 볼 때(개수 0 이어도 누를 수 있다).
// 탭 아래 내용에는 tabPanelProps(idBase, value) 를 펼쳐 넣으면 탭과 연결된다(생략해도 동작한다).
//   <Tabs idBase="exp" value={v} onChange={setV} label="실험 상태" tabs={[{ value: 'all', label: '전체', count: 12 }]} />
//   <div {...tabPanelProps('exp', v)}>…</div>

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number; disabled?: boolean }

const tabId = (base: string, value: string) => `${base}-tab-${value}`
const panelId = (base: string, value: string) => `${base}-panel-${value}`

export function tabPanelProps(idBase: string, value: string) {
  return { role: 'tabpanel' as const, id: panelId(idBase, value), 'aria-labelledby': tabId(idBase, value), tabIndex: 0 }
}

export type TabsProps<T extends string> = {
  value: T
  tabs: Array<TabItem<T>>
  onChange: (v: T) => void
  label: string
  idBase?: string
  variant?: 'line' | 'pill'
  className?: string
}

export function Tabs<T extends string>({ value, tabs, onChange, label, idBase, variant = 'line', className }: TabsProps<T>) {
  const autoId = useId()
  const base = idBase || autoId
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  // Tab 키로 들어갈 탭 하나: 선택된 탭. 선택된 탭이 없거나 못 누르는 탭이면 첫 번째로 누를 수 있는 탭(그래야 탭 줄에 키보드로 들어올 수 있다).
  const selectedIdx = tabs.findIndex((t) => t.value === value && !t.disabled)
  const entryIdx = selectedIdx >= 0 ? selectedIdx : tabs.findIndex((t) => !t.disabled)

  const move = (from: number, step: number) => {
    // 못 누르는 탭은 건너뛴다.
    for (let i = 1; i <= tabs.length; i += 1) {
      const idx = (from + step * i + tabs.length * i) % tabs.length
      if (!tabs[idx].disabled) {
        onChange(tabs[idx].value)
        refs.current[idx]?.focus()
        return
      }
    }
  }
  // Home/End: 맨 앞/뒤에서 가장 가까운, 누를 수 있는 탭으로.
  const jump = (idx: number) => {
    const order = idx === 0 ? tabs.map((_, i) => i) : tabs.map((_, i) => tabs.length - 1 - i)
    const target = order.find((i) => !tabs[i].disabled)
    if (target !== undefined) {
      onChange(tabs[target].value)
      refs.current[target]?.focus()
    }
  }

  return (
    <div className={`v5-tabs ${variant === 'pill' ? 'pill' : 'line'} ${className || ''}`} role="tablist" aria-label={label}>
      {tabs.map((tab, i) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={tabId(base, tab.value)}
            aria-selected={selected}
            aria-controls={selected ? panelId(base, tab.value) : undefined}
            tabIndex={i === entryIdx ? 0 : -1}
            disabled={tab.disabled}
            className={`v5-tab ${selected ? 'active' : ''}`}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => {
              // 가로 탭이므로 ←→ 만 쓴다(↑↓ 는 화면을 스크롤하는 데 그대로 둔다).
              if (e.key === 'ArrowRight') {
                e.preventDefault()
                move(i, 1)
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                move(i, -1)
              } else if (e.key === 'Home') {
                e.preventDefault()
                jump(0)
              } else if (e.key === 'End') {
                e.preventDefault()
                jump(tabs.length - 1)
              }
            }}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined ? <span className="v5-tab-count">{tab.count.toLocaleString('ko-KR')}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export function StatusTabs<T extends string>(props: Omit<TabsProps<T>, 'variant'>) {
  return <Tabs {...props} variant="pill" />
}

// ---- 불러오는 중 자리표시(shimmer) -------------------------------------------------------
// 글자 "불러오는 중..." 대신 실제 모양과 비슷한 회색 조각을 보여 준다.
// 규칙: (1) 조각의 높이·너비는 진짜 내용과 비슷하게 잡아 화면이 덜 흔들리게 한다.
//       (2) 조각은 화면 읽기 프로그램에서 숨기고(aria-hidden), 바깥 SkeletonRegion 이 "불러오는 중" 한 마디만 전한다.
//       (3) prefers-reduced-motion 이면 움직이지 않는다(theme.css).

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
// 쓰는 법: 열 때만 그린다({open ? <Drawer title=… onClose=…>…</Drawer> : null}). 안쪽에 autoFocus 가 있으면 그 칸이 먼저 포커스를 받는다.
// Esc: 안쪽 입력 위젯이 Esc 를 이미 처리(preventDefault)했다면 Drawer 는 닫지 않는다 → 입력 중 Esc 로 자동완성만 닫을 수 있다.
// 주의: 위 동작(포커스 가두기 · Esc · 스크롤 잠금 · 포커스 복귀)은 접근성 약속이므로 바꾸면 안 된다.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// 덮개가 여러 개 겹치거나 닫히는 순서가 어긋나도 스크롤 잠금이 풀리지 않는 일이 없도록 열린 덮개를 세어 둔다.
//  - 맨 처음 열릴 때만 body 의 원래 스타일을 기억하고, 마지막 덮개가 닫힐 때만 되돌린다.
//  - Esc · Tab 은 가장 위(마지막으로 열린) 덮개만 처리한다.
const drawerStack: object[] = []
let savedBodyStyle: { overflow: string; paddingRight: string } | null = null

function lockBodyScroll() {
  if (drawerStack.length === 1 || !savedBodyStyle) {
    const body = document.body
    savedBodyStyle = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
  }
}

function unlockBodyScroll() {
  if (drawerStack.length === 0 && savedBodyStyle) {
    document.body.style.overflow = savedBodyStyle.overflow
    document.body.style.paddingRight = savedBodyStyle.paddingRight
    savedBodyStyle = null
  }
}

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
    const token = {}
    drawerStack.push(token)
    lockBodyScroll()

    // 안쪽에서 이미 포커스를 가져갔으면 건드리지 않고, 아니면 첫 입력칸(없으면 패널)으로.
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const first = focusables(bodyRef.current)[0] || focusables(panel)[0]
      if (first) first.focus()
      else panel.focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (drawerStack[drawerStack.length - 1] !== token) return // 위에 다른 덮개가 열려 있으면 그쪽이 처리한다
      // 한글 입력 중(조합 중)의 Esc 는 입력을 취소하는 키이므로 덮개를 닫지 않는다.
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) {
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
      const at = drawerStack.indexOf(token)
      if (at >= 0) drawerStack.splice(at, 1)
      unlockBodyScroll()
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
