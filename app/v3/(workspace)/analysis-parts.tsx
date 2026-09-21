'use client'

// V3 분석/작업 페이지(참여 현황 · 급상승 영상 · 조회수 성장 · 롱폼·숏폼·시리즈 비교)가 함께 쓰는 작은 부품들.
// 원칙: 페이지는 "한 문장 답"으로 시작하고, 숫자마다 뜻(한 줄 힌트)을 붙이고, 공식은 접어 둔다.

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { V3_SQL_FILE } from '@/lib/v3/tables'

export type Tone = 'good' | 'bad' | 'neutral'

// ── 맨 위 "한 문장 답" ──────────────────────────────────────────
export function AnswerCard({
  tone = 'neutral',
  eyebrow,
  headline,
  detail,
  action
}: {
  tone?: Tone
  eyebrow?: string
  headline: ReactNode
  detail?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={`v3a-answer ${tone}`} role="status">
      <div className="v3a-answer-body">
        {eyebrow ? <div className="v3a-eyebrow">{eyebrow}</div> : null}
        <div className="v3a-headline">{headline}</div>
        {detail ? <div className="v3a-answer-detail">{detail}</div> : null}
      </div>
      {action ? <div className="v3a-answer-action">{action}</div> : null}
    </div>
  )
}

// ── 숫자 카드(이름 + 값 + "이게 뭐예요?" 한 줄) ─────────────────
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="v3a-stats">{children}</div>
}

export function StatCard({
  label,
  value,
  hint,
  delta,
  tone = 'neutral'
}: {
  label: string
  value: ReactNode
  hint: string
  delta?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="v3a-stat">
      <div className="v3a-stat-label">{label}</div>
      <div className="v3a-stat-value">{value}</div>
      {delta ? <div className={`v3a-stat-delta v3a-tone-${tone}`}>{delta}</div> : null}
      <div className="v3a-stat-hint">{hint}</div>
    </div>
  )
}

// ── 접이식 설명 ─────────────────────────────────────────────────
export function HowTo({ title = '계산 방법 보기', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="v3a-fold">
      <summary>{title}</summary>
      <div className="v3a-fold-body">{children}</div>
    </details>
  )
}

// ── 불러오는 중 / 실패 / 빈 화면 ────────────────────────────────
export function LoadingBlock({ children = '불러오는 중이에요…' }: { children?: ReactNode }) {
  return (
    <div className="v3a-loading" role="status" aria-live="polite">
      {children}
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="v3a-empty" role="alert">
      <div className="v3a-empty-title">화면을 불러오지 못했어요</div>
      <p className="v3a-empty-text">{message}</p>
      <button type="button" className="button secondary" onClick={onRetry}>
        다시 불러오기
      </button>
    </div>
  )
}

export function EmptyBlock({
  title,
  children,
  actionHref,
  actionLabel,
  onAction
}: {
  title: string
  children?: ReactNode
  actionHref?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="v3a-empty">
      <div className="v3a-empty-title">{title}</div>
      {children ? <p className="v3a-empty-text">{children}</p> : null}
      {actionLabel && actionHref ? (
        <Link className="button" href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
      {actionLabel && !actionHref && onAction ? (
        <button type="button" className="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

// ── 준비 안내 한 줄(SQL 미실행) ─────────────────────────────────
export function SetupNote({ children }: { children: ReactNode }) {
  return (
    <div className="v3-sample-banner" role="status">
      <span aria-hidden>🧪</span>
      <span>
        {children} <code>{V3_SQL_FILE}</code>
      </span>
    </div>
  )
}

// ── "더 보기" ───────────────────────────────────────────────────
export function useShowMore<T>(items: T[], initial = 5, step = 10) {
  const [limit, setLimit] = useState(initial)
  const visible = items.slice(0, limit)
  const remaining = Math.max(items.length - visible.length, 0)
  return {
    visible,
    remaining,
    more: () => setLimit((n) => n + step),
    reset: () => setLimit(initial)
  }
}

export function MoreButton({ remaining, onClick, label }: { remaining: number; onClick: () => void; label?: string }) {
  if (remaining <= 0) return null
  return (
    <button type="button" className="button secondary v3a-more" onClick={onClick}>
      {label || '더 보기'} ({remaining.toLocaleString('ko-KR')}개 남음)
    </button>
  )
}

// ── 쉬운 말 도우미 ──────────────────────────────────────────────
// "참여율 2.5%" → "100명 중 약 2.5명"
export function per100(pct: number, digits = 1): string {
  if (!Number.isFinite(pct)) return '—'
  return `${pct.toFixed(digits)}명`
}

// 변화율을 "12% 높아요/낮아요/비슷해요"로
export function describeChange(pct: number | null, base = '지난 기간', threshold = 3): { text: string; tone: Tone } {
  if (pct === null || !Number.isFinite(pct)) return { text: `비교할 ${base} 기록이 없어요`, tone: 'neutral' }
  if (Math.abs(pct) < threshold) return { text: `${base}과 비슷해요`.replace('지난주과', '지난주와'), tone: 'neutral' }
  const rounded = Math.round(Math.abs(pct)).toLocaleString('ko-KR')
  return pct > 0 ? { text: `${base}보다 ${rounded}% 높아요`, tone: 'good' } : { text: `${base}보다 ${rounded}% 낮아요`, tone: 'bad' }
}
