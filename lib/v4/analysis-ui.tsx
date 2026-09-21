'use client'

// V4 분석 화면(랭킹·종목·타이밍·담당자·실험)이 공유하는 작은 화면 조각들.
// 스타일은 app/v4/(workspace)/pages.css (.v4-theme 범위, v4p- 접두어)에 있다.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { fmtKstStamp, fmtRelative } from '@/lib/v4/format'
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

export function ErrorPanel({ message, onRetry, status, busy }: { message: string; onRetry?: () => void; status?: number; busy?: boolean }) {
  // 로그인이 풀린 경우(401)에는 다시 불러와도 소용없으니 로그인 화면으로 안내한다.
  if (status === 401) {
    return (
      <div className="v4p-empty error" role="alert">
        <div className="v4p-empty-title">다시 로그인해 주세요</div>
        <p className="v4p-empty-text">로그인이 만료됐어요. 로그인하면 보던 화면으로 돌아올 수 있어요.</p>
        <Link href="/v4/login" className="button">
          로그인하러 가기
        </Link>
      </div>
    )
  }
  return (
    <div className="v4p-empty error" role="alert">
      <div className="v4p-empty-title">불러오지 못했어요</div>
      <p className="v4p-empty-text">{message}</p>
      {onRetry ? (
        <button type="button" className="button secondary" onClick={onRetry} disabled={busy}>
          {busy ? '불러오는 중…' : '다시 불러오기'}
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
    <div className="v4p-skel-rows" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <Skel key={i} h={38} />
      ))}
    </div>
  )
}

// ---- 완성됐을 때와 같은 모양의 뼈대 (자리가 미리 잡혀 있어 데이터가 와도 화면이 밀리지 않는다)

// 표 모양: 머리줄 + 행. 좁은 화면에서는 카드 높이로 바뀐다.
export function SkelTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="v4p-skel-table" aria-busy="true" aria-label="불러오는 중">
      <div className="v4p-skel-thead">
        <Skel w="40%" h={12} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div className="v4p-skel-trow" key={i}>
          <Skel w={24} h={24} />
          <div className="v4p-skel-cell">
            <Skel w={i % 2 ? '62%' : '78%'} h={14} />
            <Skel w="34%" h={11} />
          </div>
          <Skel w={64} h={14} />
          <Skel w={64} h={14} />
        </div>
      ))}
    </div>
  )
}

export function SkelTiles({ count = 8 }: { count?: number }) {
  const sizes = ['xl', 'lg', 'lg', 'md', 'md', 'md', 'sm', 'sm', 'sm', 'sm', 'sm', 'sm']
  return (
    <div className="v4p-tiles" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: count }, (_, i) => (
        <div className={`v4p-tile skel ${sizes[i] || 'sm'}`} key={i} />
      ))}
    </div>
  )
}

export function SkelBars({ rows = 5 }: { rows?: number }) {
  return (
    <div className="v4p-bars" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div className="v4p-bar" key={i}>
          <Skel w="70%" h={14} />
          <Skel h={16} />
          <Skel w="60%" h={14} />
        </div>
      ))}
    </div>
  )
}

export function SkelHeat() {
  return (
    <div className="v4p-skel-heat" aria-busy="true" aria-label="불러오는 중">
      <Skel h={16} w="30%" />
      <Skel h={224} />
    </div>
  )
}

export function SkelCards({ count = 3 }: { count?: number }) {
  return (
    <div className="v4p-exp-list" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: count }, (_, i) => (
        <div className="v4p-exp v4p-skel-card" key={i}>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skel w="45%" h={14} />
            <Skel w="80%" h={18} />
            <div className="v4p-ab">
              <Skel h={64} />
              <Skel h={64} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// 시각 표기: 화면에는 "3시간 전", 마우스를 올리면 정확한 한국 시간 ("9/21 (월) 14:30")
export function TimeAgo({ iso, prefix }: { iso: string | null | undefined; prefix?: string }) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return <>-</>
  return (
    <time dateTime={iso} title={fmtKstStamp(iso)}>
      {prefix}
      {fmtRelative(iso)}
    </time>
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
  const label = (i: number) => labels?.[i] ?? (values.length - 1 - i === 0 ? '오늘' : `${values.length - 1 - i}일 전`)
  const summary = values.map((v, i) => `${label(i)} ${v}개`).join(', ')
  return (
    <div className="v4p-minibars" role="img" aria-label={`최근 ${values.length}일 하루 업로드 수: ${summary}`} title={`최근 ${values.length}일 하루 업로드 수 (오른쪽이 오늘)\n${summary}`}>
      {values.map((v, i) => (
        <span key={i} className={`v4p-minibar ${v > 0 ? 'on' : ''}`} style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
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
  leader,
  exact
}: {
  label: string
  value: number
  max: number
  valueText: string
  sub?: string
  leader?: boolean
  // 마우스를 올리면 보이는 정확한 값 (예: "1,234,567회")
  exact?: string
}) {
  const w = Number.isFinite(value) && max > 0 ? Math.min(100, Math.max((value / max) * 100, value > 0 ? 2 : 0)) : 0
  return (
    <div className={`v4p-bar ${leader ? 'leader' : ''}`} title={exact ? `${label} · ${exact}` : undefined}>
      <div className="v4p-bar-label" title={label}>
        {label}
        {leader ? <span className="v4p-bar-flag">최고</span> : null}
      </div>
      <div className="v4p-bar-track" aria-hidden="true">
        <div className="v4p-bar-fill" style={{ width: `${w}%` }} />
      </div>
      <div className="v4p-bar-value">
        <strong>{valueText}</strong>
        {sub ? <span className="v4p-bar-sub">{sub}</span> : null}
      </div>
    </div>
  )
}

// 폼 안의 저장 실패 안내. 로그인이 풀린 경우(401)에는 로그인 화면으로 가는 링크를 함께 보여준다.
export function FormError({ message, status }: { message: string; status?: number }) {
  return (
    <div className="v4p-form-error" role="alert">
      {message}
      {status === 401 ? (
        <>
          {' '}
          <Link href="/v4/login" className="v4p-login-link">
            다시 로그인하기
          </Link>
        </>
      ) : null}
    </div>
  )
}
