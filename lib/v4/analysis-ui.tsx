'use client'

// V4 분석 화면(랭킹·종목·타이밍·담당자·실험)이 공유하는 작은 화면 조각들.
// 스타일은 app/v4/(workspace)/pages.css (.v4-theme 범위, v4p- 접두어)에 있다.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { V4_SQL_FILE } from '@/lib/v4/tables'

// ------------------------------------------------------------------ 답부터 보여주는 상단 카드

export function Hero({
  eyebrow,
  headline,
  loading,
  children
}: {
  eyebrow?: string
  headline?: ReactNode
  loading?: boolean
  children?: ReactNode
}) {
  if (loading) {
    return (
      <section className="v4p-hero" aria-busy="true">
        <Skel w={120} h={12} />
        <div style={{ height: 12 }} />
        <Skel w="70%" h={26} />
        <div style={{ height: 12 }} />
        <Skel w="45%" h={14} />
      </section>
    )
  }
  return (
    <section className="v4p-hero">
      {eyebrow ? <div className="v4p-hero-eyebrow">{eyebrow}</div> : null}
      {headline ? <h2 className="v4p-hero-headline">{headline}</h2> : null}
      {children}
    </section>
  )
}

// ------------------------------------------------------------------ 숫자 카드 (라벨 + 값 + 한 줄 설명)

export function Kpi({
  label,
  value,
  hint,
  tone = 'neutral',
  loading
}: {
  label: string
  value: string
  hint: string
  tone?: 'good' | 'bad' | 'neutral'
  loading?: boolean
}) {
  return (
    <div className={`v4p-kpi ${tone}`}>
      <div className="v4p-kpi-label">{label}</div>
      {loading ? <Skel w={90} h={28} /> : <div className="v4p-kpi-value">{value}</div>}
      <div className="v4p-kpi-hint">{hint}</div>
    </div>
  )
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="v4p-kpis">{children}</div>
}

// ------------------------------------------------------------------ 카드 / 빈 화면 / 오류

export function Card({
  title,
  sub,
  actions,
  children
}: {
  title?: string
  sub?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="v4p-card">
      {title || actions ? (
        <div className="v4p-card-head">
          <div style={{ minWidth: 0 }}>
            {title ? <h3 className="v4p-card-title">{title}</h3> : null}
            {sub ? <p className="v4p-card-sub">{sub}</p> : null}
          </div>
          {actions ? <div className="v4p-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

// 무엇을 보여주는 화면인지 + 지금 무엇을 하면 되는지 + 영상 등록 링크
export function EmptyPanel({
  title,
  children,
  action = 'register'
}: {
  title: string
  children: ReactNode
  action?: 'register' | ReactNode | null
}) {
  return (
    <div className="v4p-empty">
      <div className="v4p-empty-title">{title}</div>
      <p className="v4p-empty-text">{children}</p>
      {action === 'register' ? (
        <Link href="/v4/register" className="button">
          영상 등록하러 가기
        </Link>
      ) : (
        action
      )}
    </div>
  )
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="v4p-empty error" role="alert">
      <div className="v4p-empty-title">불러오지 못했어요</div>
      <p className="v4p-empty-text">{message}</p>
      {onRetry ? (
        <button type="button" className="button secondary" onClick={onRetry}>
          다시 불러오기
        </button>
      ) : null}
    </div>
  )
}

// 샘플 데이터 안내: 한 줄, 조용하게
export function SampleNote() {
  return (
    <div className="v4p-sample" role="status">
      <span className="v4p-sample-dot" />
      <span>
        지금은 샘플 데이터예요. <code>{V4_SQL_FILE}</code> 를 실행하면 실제 기록으로 바뀝니다.
      </span>
    </div>
  )
}

// ------------------------------------------------------------------ 작은 조각

export function Skel({ w = '100%', h = 14 }: { w?: number | string; h?: number }) {
  return <span className="v4p-skel" style={{ width: w, height: h }} />
}

export function SkelRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="v4p-skel-rows" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skel key={i} h={38} />
      ))}
    </div>
  )
}

export function Formula({ children, summary = '계산 방법 보기' }: { children: ReactNode; summary?: string }) {
  return (
    <details className="v4p-details">
      <summary>{summary}</summary>
      <div className="v4p-details-body">{children}</div>
    </details>
  )
}

export function Badge({ tone = 'neutral', children, title }: { tone?: 'good' | 'bad' | 'neutral' | 'warn' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={`v4p-badge ${tone}`} title={title}>
      {children}
    </span>
  )
}

// 지난 기간 대비 변화 (초록 = 좋아짐, 빨강 = 나빠짐, 회색 = 비슷함)
export function TrendBadge({ trend, ratio, long }: { trend: 'up' | 'down' | 'flat' | 'new'; ratio: number; long?: boolean }) {
  if (trend === 'new') return <Badge tone="info" title="지난 기간에는 이 종목 영상이 없었어요">새로 등장</Badge>
  const pct = `${Math.abs(Math.round(ratio * 100))}%`
  if (trend === 'up') return <Badge tone="good" title={`지난 기간보다 조회수가 ${pct} 늘었어요`}>▲ {pct}{long ? ' 늘었어요' : ''}</Badge>
  if (trend === 'down') return <Badge tone="bad" title={`지난 기간보다 조회수가 ${pct} 줄었어요`}>▼ {pct}{long ? ' 줄었어요' : ''}</Badge>
  return <Badge tone="neutral" title="지난 기간과 비슷해요">{long ? '지난 기간과 비슷해요' : '비슷해요'}</Badge>
}

export function FormatBadge({ contentType }: { contentType: string }) {
  return contentType === 'shortform' ? <Badge tone="bad">숏폼</Badge> : <Badge tone="info">롱폼</Badge>
}

// 여러 보기 중 하나를 고르는 작은 토글
export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled
}: {
  value: T | null
  options: Array<[T, string]>
  onChange: (next: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div className="v4p-seg" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={String(key)}
          type="button"
          className={`v4p-seg-item ${value === key ? 'active' : ''}`}
          aria-pressed={value === key}
          disabled={disabled}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

// 정렬 가능한 열 제목
export function SortHead({
  label,
  active,
  desc,
  onClick,
  title,
  align = 'right'
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
  title?: string
  align?: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'v4p-td-r' : undefined} role="columnheader" aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className={`v4p-th ${active ? 'active' : ''}`} onClick={onClick} title={title}>
        {label}
        <span aria-hidden="true" className="v4p-th-arrow">{active ? (desc ? '▼' : '▲') : ''}</span>
      </button>
    </div>
  )
}

// 최근 7일 업로드 수를 막대 7개로
export function MiniBars({ values, labels }: { values: number[]; labels?: string[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="v4p-minibars" role="img" aria-label={`최근 7일 업로드 수: ${values.join(', ')}`}>
      {values.map((v, i) => (
        <span key={i} className={`v4p-minibar ${v > 0 ? 'on' : ''}`} style={{ height: `${Math.max(12, (v / max) * 100)}%` }} title={`${labels?.[i] ?? `${values.length - i}일 전`} · ${v}개`} />
      ))}
    </div>
  )
}

// 가로 막대 한 줄 (1위는 진하게, 나머지는 연하게)
export function BarRow({
  label,
  value,
  max,
  valueText,
  sub,
  leader
}: {
  label: string
  value: number
  max: number
  valueText: string
  sub?: string
  leader?: boolean
}) {
  const w = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0
  return (
    <div className={`v4p-bar ${leader ? 'leader' : ''}`}>
      <div className="v4p-bar-label" title={label}>{label}</div>
      <div className="v4p-bar-track">
        <div className="v4p-bar-fill" style={{ width: `${w}%` }} />
      </div>
      <div className="v4p-bar-value">
        <strong>{valueText}</strong>
        {sub ? <span className="v4p-bar-sub">{sub}</span> : null}
      </div>
    </div>
  )
}
