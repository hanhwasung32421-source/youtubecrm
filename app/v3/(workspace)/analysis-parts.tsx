'use client'

// V3 분석/작업 페이지(참여 현황 · 급상승 영상 · 조회수 성장 · 롱폼·숏폼·시리즈 비교)가 함께 쓰는 작은 부품들.
// 원칙: 페이지는 "한 문장 답"으로 시작하고, 숫자마다 뜻(한 줄 힌트)을 붙이고, 공식은 접어 둔다.

import '@/lib/v3/interact.css'
import Link from 'next/link'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { SESSION_EXPIRED } from '@/lib/v3/api-client'
import { DASH, formatKstDateTime, formatRelative } from '@/lib/v3/format'

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
  label: ReactNode
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

// ── 시간: "3일 전" 로 보여 주고, 정확한 한국 시간은 마우스를 올리면 ─────
export function RelTime({ value, fallback = DASH }: { value: string | null | undefined; fallback?: string }) {
  if (!value) return <>{fallback}</>
  const abs = formatKstDateTime(value)
  if (abs === DASH) return <>{fallback}</>
  return (
    <time dateTime={value} title={abs}>
      {formatRelative(value)}
    </time>
  )
}

// ── 불러오는 중: 실제 화면과 같은 모양의 뼈대(shimmer) ────────────
// 뼈대는 스크린리더에서는 숨기고, 아래의 한 줄 안내만 읽어 준다. (움직임 줄이기 설정이면 반짝임도 꺼진다)
export function Skel({ w, h = 14, r, className = '', style }: { w?: number | string; h?: number | string; r?: number; className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`v3a-skel ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} />
}

export function SkeletonShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="v3a-stack" role="status" aria-busy="true" aria-live="polite">
      <span className="v3a-sr">{label}</span>
      {children}
    </div>
  )
}

export function AnswerSkeleton() {
  return (
    <div className="v3a-answer v3a-skel-box" aria-hidden>
      <div className="v3a-answer-body">
        <Skel w={90} h={12} />
        <Skel w="86%" h={22} style={{ marginTop: 10 }} />
        <Skel w="54%" h={22} style={{ marginTop: 8 }} />
        <Skel w="62%" h={13} style={{ marginTop: 12 }} />
      </div>
    </div>
  )
}

export function StatsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="v3a-stats" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div className="v3a-stat" key={i}>
          <Skel w="46%" h={13} />
          <Skel w="58%" h={28} style={{ marginTop: 10 }} />
          <Skel w="82%" h={12} style={{ marginTop: 12 }} />
          <Skel w="70%" h={12} style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  )
}

export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="v3a-list" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div className="v3a-row" key={i}>
          <Skel w={18} h={14} />
          <Skel w={`${72 - (i % 3) * 12}%`} h={14} />
          <Skel w={64} h={14} />
        </div>
      ))}
    </div>
  )
}

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="v3a-cards" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div className="v3a-card" key={i}>
          <div className="v3a-card-head">
            <Skel w="64%" h={16} />
            <Skel w={86} h={24} r={999} />
          </div>
          <Skel w="78%" h={12} />
          <Skel w="100%" h={34} r={8} />
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return (
    <div className="v3-chart-card" aria-hidden>
      <Skel w="100%" h={height} r={8} />
    </div>
  )
}

export function SectionSkeleton({ children, titleWidth = 220 }: { children: ReactNode; titleWidth?: number }) {
  return (
    <div className="v3a-skel-section" aria-hidden>
      <Skel w={titleWidth} h={18} />
      <Skel w="70%" h={12} style={{ marginTop: 8, marginBottom: 12 }} />
      {children}
    </div>
  )
}

// ── 실패 / 로그인 만료 / 빈 화면 ─────────────────────────────────
const LOGIN_HREF = '/v3/login'

// 저장/수정 중에 로그인이 만료되면 오류 문장 뒤에 바로 다시 로그인할 수 있는 링크를 붙여 준다.
export function withLoginLink(message: string | null | undefined): ReactNode {
  if (!message) return null
  if (message !== SESSION_EXPIRED) return message
  return (
    <>
      {message}{' '}
      <Link className="v3-link" href={LOGIN_HREF}>
        로그인 화면으로 가기
      </Link>
    </>
  )
}

export function ErrorBlock({ message, onRetry, status, busy }: { message: string; onRetry: () => void; status?: number; busy?: boolean }) {
  if (status === 401) {
    return (
      <div className="v3a-empty" role="alert">
        <div className="v3a-empty-title">로그인이 만료됐어요</div>
        <p className="v3a-empty-text">보안을 위해 일정 시간이 지나면 자동으로 로그아웃돼요. 다시 로그인하면 보던 화면으로 돌아올 수 있어요.</p>
        <Link className="button" href={LOGIN_HREF}>
          다시 로그인해 주세요
        </Link>
      </div>
    )
  }
  return (
    <div className="v3a-empty" role="alert">
      <div className="v3a-empty-title">화면을 불러오지 못했어요</div>
      <p className="v3a-empty-text">{message}</p>
      <button type="button" className="button secondary" disabled={busy} onClick={onRetry}>
        {busy ? '불러오는 중…' : '다시 불러오기'}
      </button>
    </div>
  )
}

// 이미 화면에 값이 있는데 뒤에서 새로 받기가 실패했을 때: 화면은 그대로 두고 위에 한 줄만 알린다.
export function RefreshFailed({ message, status, onRetry, busy }: { message: string; status?: number; onRetry: () => void; busy?: boolean }) {
  return (
    <div className="v3i-notice warn" role="alert">
      <div>
        {status === 401 ? (
          <>
            로그인이 만료됐어요. 보이는 내용은 지난번에 받아 둔 거예요.{' '}
            <Link className="v3-link" href={LOGIN_HREF}>
              다시 로그인해 주세요
            </Link>
          </>
        ) : (
          <>지금 최신 내용을 받지 못해서, 지난번에 받아 둔 내용을 보여드리고 있어요. {message}</>
        )}
      </div>
      {status === 401 ? null : (
        <button type="button" className="v3i-linkbtn" disabled={busy} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

// 빈 화면: 왜 비었는지(children)와, 지금 할 수 있는 일 하나(action)를 꼭 함께 보여 준다.
// secondary 는 "필터 초기화" 같은 보조 행동 하나까지만.
export function EmptyBlock({
  title,
  children,
  actionHref,
  actionLabel,
  onAction,
  secondaryLabel,
  secondaryHref,
  onSecondary,
  compact
}: {
  title: string
  children?: ReactNode
  actionHref?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  secondaryHref?: string
  onSecondary?: () => void
  compact?: boolean
}) {
  const primary =
    actionLabel && actionHref ? (
      <Link className="button" href={actionHref}>
        {actionLabel}
      </Link>
    ) : actionLabel && onAction ? (
      <button type="button" className="button" onClick={onAction}>
        {actionLabel}
      </button>
    ) : null
  const secondary =
    secondaryLabel && secondaryHref ? (
      <Link className="button secondary" href={secondaryHref}>
        {secondaryLabel}
      </Link>
    ) : secondaryLabel && onSecondary ? (
      <button type="button" className="button secondary" onClick={onSecondary}>
        {secondaryLabel}
      </button>
    ) : null
  return (
    <div className={`v3a-empty ${compact ? 'compact' : ''}`}>
      <div className="v3a-empty-title">{title}</div>
      {children ? <p className="v3a-empty-text">{children}</p> : null}
      {primary || secondary ? (
        <div className="v3a-empty-actions">
          {primary}
          {secondary}
        </div>
      ) : null}
    </div>
  )
}

// ── 준비 안내 한 줄 ─────────────────────────────────────────────
// 이 기능을 쓰려면 관리자가 먼저 준비해야 할 때 쓴다. 무엇을 하면 되는지(children)만 적는다.
export function SetupNote({ children }: { children: ReactNode }) {
  return (
    <div className="v3-sample-banner" role="status">
      <span>{children}</span>
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
  if (!Number.isFinite(pct)) return DASH
  return `${pct.toFixed(digits)}명`
}

// 변화율을 "12% 높아요/낮아요/비슷해요"로. arrow 는 색을 못 보는 사람도 방향을 알 수 있게 붙이는 표시.
export function describeChange(pct: number | null, base = '지난 기간', threshold = 3): { text: string; tone: Tone; arrow: string } {
  if (pct === null || !Number.isFinite(pct)) return { text: `비교할 ${base} 기록이 없어요`, tone: 'neutral', arrow: '' }
  if (Math.abs(pct) < threshold) return { text: `${base}과 비슷해요`.replace('지난주과', '지난주와'), tone: 'neutral', arrow: '–' }
  const rounded = Math.round(Math.abs(pct)).toLocaleString('ko-KR')
  return pct > 0
    ? { text: `${base}보다 ${rounded}% 높아요`, tone: 'good', arrow: '▲' }
    : { text: `${base}보다 ${rounded}% 낮아요`, tone: 'bad', arrow: '▼' }
}
