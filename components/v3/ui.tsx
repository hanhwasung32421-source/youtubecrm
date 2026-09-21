'use client'

import { useState } from 'react'
import { V3_SQL_FILE } from '@/lib/v3/tables'
import { formatNumber, formatSignedPct } from '@/lib/v3/format'
import { pctChange } from '@/lib/v3/engagement'

// ── 샘플 데이터 배너 ────────────────────────────────────────────
// 한 줄로 조용히: 지금 보는 숫자가 예시이고, 무엇을 하면 실제 데이터로 바뀌는지만 알려준다.
export function SampleBanner({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="v3-sample-banner" role="status">
      <span>
        예시 데이터를 보고 있어요. 실제 데이터로 바꾸려면 <code>{V3_SQL_FILE}</code> 파일을 실행하세요.
      </span>
    </div>
  )
}

// ── 콜아웃(자동 생성 한글 요약) ─────────────────────────────────
export function Callout({
  icon = '💡',
  tone = 'default',
  children
}: {
  icon?: string
  tone?: 'default' | 'info' | 'warning' | 'success'
  children: React.ReactNode
}) {
  return (
    <div className={`v3-callout ${tone === 'default' ? '' : tone}`}>
      <span className="v3-callout-icon" aria-hidden>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

// ── 문서 섹션 ──────────────────────────────────────────────────
export function Section({
  title,
  count,
  description,
  actions,
  children
}: {
  title: string
  count?: number
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="v3-section">
      <div className="v3-section-head">
        <div>
          <h2 className="v3-section-title">
            {title}
            {typeof count === 'number' ? <span className="v3-count">{count}</span> : null}
          </h2>
          {description ? <p className="v3-section-desc">{description}</p> : null}
        </div>
        {actions ? <div className="toolbar">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

// ── 태그 ───────────────────────────────────────────────────────
export function Tag({ tone = 'gray', children }: { tone?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'gray'; children: React.ReactNode }) {
  return <span className={`v3-tag ${tone}`}>{children}</span>
}

// ── KPI 카드 ───────────────────────────────────────────────────
export function KpiCard({
  label,
  current,
  previous,
  format = formatNumber,
  invert = false,
  badge
}: {
  label: string
  current: number
  previous?: number
  format?: (value: number) => string
  invert?: boolean
  badge?: React.ReactNode
}) {
  const change = previous === undefined ? null : pctChange(current, previous)
  const positive = change !== null && (invert ? change < 0 : change > 0)
  const negative = change !== null && (invert ? change > 0 : change < 0)
  return (
    <div className="v3-kpi">
      <div className="v3-kpi-label">
        {label} {badge}
      </div>
      <div className="v3-kpi-value" title={format(current)}>
        {format(current)}
      </div>
      {previous !== undefined ? (
        <div className={`v3-kpi-delta ${positive ? 'v3-delta-up' : negative ? 'v3-delta-down' : ''}`}>
          지난 기간 {format(previous)} · {change === null ? '비교 불가' : formatSignedPct(change)}
        </div>
      ) : null}
    </div>
  )
}

// ── 노션 데이터베이스 풍 테이블 ───────────────────────────────
export type DocColumn = { key: string; label: string; width?: string; align?: 'left' | 'right' }

export function DocTable({
  columns,
  children,
  empty,
  isEmpty
}: {
  columns: DocColumn[]
  children: React.ReactNode
  empty?: string
  isEmpty?: boolean
}) {
  const template = columns.map((column) => column.width || 'minmax(0, 1fr)').join(' ')
  return (
    <div className="data-table">
      <div className="data-table-header" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <div key={column.key} className={column.align === 'right' ? 'data-right' : undefined}>
            {column.label}
          </div>
        ))}
      </div>
      {isEmpty ? (
        <div className="data-table-row" style={{ gridTemplateColumns: '1fr' }}>
          <div className="muted small">{empty || '표시할 항목이 없습니다.'}</div>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export function DocRow({
  columns,
  className,
  children
}: {
  columns: DocColumn[]
  className?: string
  children: React.ReactNode
}) {
  const template = columns.map((column) => column.width || 'minmax(0, 1fr)').join(' ')
  return (
    <div className={`data-table-row ${className || ''}`} style={{ gridTemplateColumns: template }}>
      {children}
    </div>
  )
}

// ── 종목 태그 pill 입력 ────────────────────────────────────────
// 자유 입력 + 자주 쓰는 종목 pill을 클릭하면 바로 채워지는 간단한 태그 입력기.
export function StockTagInput({
  value,
  onChange,
  suggestions,
  disabled
}: {
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        className="input"
        placeholder="예: 삼성전자"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {suggestions.map((name) => (
          <button
            type="button"
            key={name}
            className={`v3-tag blue v3-tag-button ${value === name ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 빈 상태: 무엇을 보는 곳인지 + 무엇을 하면 되는지 + (선택) 버튼 ─────────
export function EmptyState({ children, title, action }: { children?: React.ReactNode; title?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      {title ? <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div> : null}
      {children}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  )
}

export function useToggle(initial = false): [boolean, () => void] {
  const [value, setValue] = useState(initial)
  return [value, () => setValue((v) => !v)]
}
