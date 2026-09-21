'use client'

// 분석·업무 화면(성과 요약 / 영상 점검 / 키워드 모음 / 업로드 계획)이 함께 쓰는 작은 조각들.
// 스타일은 ./analysis.css (.v2-theme 스코프, v2a- 접두어)에만 둔다.
import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatKstStamp, formatRelative } from './dates'
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

// 목록을 못 불러왔을 때: 빈 화면처럼 보이지 않게 이유 + 다시 시도 버튼.
// 로그인 시간이 지난 경우(expired)에는 "다시 시도" 대신 로그인 화면으로 가는 링크를 보여준다.
export const V2_LOGIN_HREF = '/v2/login'

export function LoadError({ message, onRetry, expired }: { message: string; onRetry: () => void; expired?: boolean }) {
  if (expired) {
    return (
      <div className="v2a-loaderror" role="alert">
        <span>로그인 시간이 지났어요. 다시 로그인해 주세요.</span>
        <Link className="button secondary xs" href={V2_LOGIN_HREF}>
          다시 로그인
        </Link>
      </div>
    )
  }
  return (
    <div className="v2a-loaderror" role="alert">
      <span>{message}</span>
      <button type="button" className="button secondary xs" onClick={onRetry}>
        다시 불러오기
      </button>
    </div>
  )
}

// 오래된 값을 먼저 보여주고 새 값을 받는 중일 때 조용히 알린다.
export function RefreshNote({ show }: { show?: boolean }) {
  if (!show) return null
  return (
    <div className="v2a-refresh" role="status">
      최신 내용으로 바꾸는 중…
    </div>
  )
}

// 시각: 화면에는 "3일 전", 마우스를 올리면(title) 정확한 날짜·시각(KST)
export function Stamp({ iso, absolute }: { iso: string | null | undefined; absolute?: boolean }) {
  if (!iso) return <span>-</span>
  const full = formatKstStamp(iso)
  if (full === '-') return <span>-</span>
  return (
    <time dateTime={iso} title={absolute ? formatRelative(iso) : full}>
      {absolute ? full : formatRelative(iso)}
    </time>
  )
}

// ---- 스켈레톤: 실제 화면과 같은 모양의 회색 틀 (움직임 줄이기 설정이면 멈춤) ----
export function Skel({ w, h = 14, className = '' }: { w?: number | string; h?: number | string; className?: string }) {
  return <span className={`v2a-skel ${className}`} style={{ width: w, height: h }} aria-hidden="true" />
}

function SkelWrap({ children, label = '불러오는 중' }: { children: ReactNode; label?: string }) {
  return (
    <div className="v2a-skel-wrap" role="status" aria-busy="true" aria-live="polite">
      <span className="v2a-vh">{label}</span>
      <div aria-hidden="true" style={{ display: 'contents' }}>
        {children}
      </div>
    </div>
  )
}

// 결론 한 줄 + 숫자 카드 3개
export function SkeletonSummary() {
  return (
    <SkelWrap>
      <div className="v2a-answer neutral">
        <Skel w={72} h={11} />
        <Skel w="72%" h={18} />
      </div>
      <div className="v2a-kpis">
        {[0, 1, 2].map((i) => (
          <div className="v2a-kpi" key={i}>
            <Skel w="55%" h={13} />
            <div style={{ marginTop: 10 }}>
              <Skel w={80} h={28} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Skel w="90%" h={12} />
            </div>
          </div>
        ))}
      </div>
    </SkelWrap>
  )
}

// 카드 목록 (영상 점검·키워드 목록)
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <SkelWrap>
      <div className="list">
        {Array.from({ length: rows }, (_, i) => (
          <div className="list-item" key={i}>
            <Skel w={`${60 - (i % 3) * 8}%`} h={16} />
            <div style={{ marginTop: 10 }}>
              <Skel w="40%" h={12} />
            </div>
            <div className="v2a-skel-row" style={{ marginTop: 12 }}>
              <Skel w={110} h={22} />
              <Skel w={90} h={22} />
            </div>
          </div>
        ))}
      </div>
    </SkelWrap>
  )
}

// 순위 표 (성과 요약)
export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <SkelWrap>
      <div className="v2a-skel-table">
        {Array.from({ length: rows }, (_, i) => (
          <div className="v2a-skel-tr" key={i}>
            <Skel w={18} h={14} />
            <div className="v2a-skel-title">
              <Skel w={`${70 - (i % 4) * 9}%`} h={14} />
              <Skel w="45%" h={11} />
            </div>
            <Skel w={54} h={14} className="hide-sm" />
            <Skel w={44} h={14} className="hide-sm" />
            <Skel w={96} h={14} />
          </div>
        ))}
      </div>
    </SkelWrap>
  )
}

// 주간 계획 표 (담당자 줄 × 7일)
export function SkeletonPlanner({ rows = 3 }: { rows?: number }) {
  return (
    <SkelWrap>
      <div className="v2a-skel-plan">
        {Array.from({ length: rows }, (_, r) => (
          <div className="v2a-skel-plan-row" key={r}>
            <Skel w={56} h={16} />
            <div className="v2a-skel-plan-cells">
              {Array.from({ length: 7 }, (_, c) => (
                <Skel key={c} h={62} className="v2a-skel-cell" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SkelWrap>
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
