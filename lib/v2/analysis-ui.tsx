'use client'

// 분석·업무 화면(성과 요약 / 영상 점검 / 키워드 모음 / 업로드 계획)이 함께 쓰는 작은 조각들.
// 스타일은 ./analysis.css (.v2-theme 스코프, v2a- 접두어)에만 둔다.
import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { V2_SAMPLE_BANNER_TEXT } from './tables'
import './analysis.css'

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

// 페이지 맨 위에서 "결론 한 줄"을 보여준다.
export function Answer({ children, tone = 'neutral', label = '한눈에 보기' }: { children: ReactNode; tone?: Tone; label?: string }) {
  return (
    <div className={`v2a-answer ${tone}`} role="status">
      <span className="v2a-answer-label">{label}</span>
      <p className="v2a-answer-text">{children}</p>
    </div>
  )
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="v2a-kpis">{children}</div>
}

// 숫자 카드: 이름 + 큰 숫자 + "이게 뭐예요?" 한 줄 설명
export function Kpi({ label, value, unit, hint, tone = 'neutral' }: { label: string; value: ReactNode; unit?: string; hint: string; tone?: Tone }) {
  return (
    <div className={`v2a-kpi ${tone}`} title={hint}>
      <div className="v2a-kpi-label">{label}</div>
      <div className="v2a-kpi-value">
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      <div className="v2a-kpi-hint">{hint}</div>
    </div>
  )
}

// 계산식·기준처럼 "가끔만 궁금한" 설명을 접어 둔다.
export function HowTo({ title = '계산 방법 보기', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="v2a-howto">
      <summary>{title}</summary>
      <div className="v2a-howto-body">{children}</div>
    </details>
  )
}

// 비어 있을 때: 이 화면이 뭔지 + 무엇을 하면 채워지는지 + 바로 갈 버튼
export function EmptyGuide({ title, children, href, action }: { title: string; children?: ReactNode; href?: string; action?: string }) {
  return (
    <div className="v2a-empty">
      <div className="v2a-empty-title">{title}</div>
      {children ? <p className="v2a-empty-body">{children}</p> : null}
      {href && action ? (
        <Link className="button xs" href={href}>
          {action}
        </Link>
      ) : null}
    </div>
  )
}

// 목록이 길 때 "더 보기"
export function MoreButton({ shown, total, onMore, step = 20 }: { shown: number; total: number; onMore: () => void; step?: number }) {
  if (shown >= total) return null
  const next = Math.min(step, total - shown)
  return (
    <div className="v2a-more">
      <button type="button" className="button secondary xs" onClick={onMore}>
        {next}개 더 보기
      </button>
      <span className="small muted">
        {shown} / {total.toLocaleString('ko-KR')}
      </span>
    </div>
  )
}

// 첫 조회 중일 때 조용히 보여줄 한 줄
export function LoadingLine() {
  return <div className="v2a-loading">불러오는 중…</div>
}

// 샘플 데이터 안내를 한 줄로 (기존 SampleBanner와 같은 문구 사용)
export function SampleNote({ show }: { show?: boolean }) {
  if (!show) return null
  return (
    <div className="v2a-sample" role="status">
      <b>샘플</b>
      <span>{V2_SAMPLE_BANNER_TEXT}</span>
    </div>
  )
}

// 필수 입력 표시 (라벨 안에 넣는다)
export function Req() {
  return (
    <span className="v2a-req" aria-hidden="true" title="꼭 입력해야 해요">
      {' '}
      *
    </span>
  )
}

// 입력칸 아래에 붙는 한 줄 오류
export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <span id={id} className="v2a-field-error" role="alert">
      {children}
    </span>
  )
}

// 목록을 못 불러왔을 때: 빈 화면처럼 보이지 않게 이유 + 다시 시도 버튼
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="v2a-loaderror" role="alert">
      <span>{message}</span>
      <button type="button" className="button secondary xs" onClick={onRetry}>
        다시 불러오기
      </button>
    </div>
  )
}

// 2단계 삭제: 버튼을 누르면 "정말 삭제할까요?" 가 그 자리에서 열리고, Esc 나 취소로 닫는다. (window.confirm 대신)
export function InlineConfirm({
  label = '삭제',
  prompt = '정말 삭제할까요?',
  confirmLabel = '삭제',
  busyLabel = '삭제 중…',
  busy,
  disabled,
  onConfirm
}: {
  label?: string
  prompt?: string
  confirmLabel?: string
  busyLabel?: string
  busy?: boolean
  disabled?: boolean
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!armed) return
    cancelRef.current?.focus()
    // 열어 두고 잊어버려도 실수로 지워지지 않도록 잠시 뒤 스스로 닫는다.
    const timer = window.setTimeout(() => setArmed(false), 8000)
    return () => window.clearTimeout(timer)
  }, [armed])

  const close = () => {
    setArmed(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  if (!armed) {
    return (
      <button ref={triggerRef} type="button" className="button secondary xs v2a-danger-text" disabled={disabled || busy} onClick={() => setArmed(true)}>
        {busy ? busyLabel : label}
      </button>
    )
  }

  return (
    <span
      className="v2a-confirm"
      role="group"
      aria-label={prompt}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      <span className="v2a-confirm-text">{prompt}</span>
      <button
        type="button"
        className="button xs v2a-danger-solid"
        disabled={busy}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </button>
      <button ref={cancelRef} type="button" className="button secondary xs" onClick={close}>
        취소
      </button>
    </span>
  )
}
