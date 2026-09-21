'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { formatKstFull, formatKstShort, formatRelative } from '@/lib/v5/format'
import './pages.css'
import './pages-r3.css'

// 성장 관리 화면(성장 실험/영상 점수판/성공 공식/주간 회고)이 함께 쓰는 작은 조각들.
// 스타일은 pages.css(.v5-theme 하위 v5p- 접두어)에만 있다.

// 예시 데이터 안내: 한 줄, 차분하게. (저장 공간이 아직 없을 때만 나온다)
export function SampleNote({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="v5p-sample" role="note">
      <span>지금 보이는 것은 예시예요. 저장 공간이 아직 준비되지 않아서 저장은 되지 않아요. 관리자에게 알려 주세요.</span>
    </div>
  )
}

// 페이지 맨 위 "한 줄 답". tone: good(초록) / bad(빨강) / neutral(기본).
export function AnswerBanner({
  label,
  tone = 'neutral',
  children,
  aside
}: {
  label: string
  tone?: 'good' | 'bad' | 'neutral'
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className={`v5p-answer ${tone}`} aria-live="polite">
      <div className="v5p-answer-main">
        <div className="v5p-answer-label">{label}</div>
        <div className="v5p-answer-text">{children}</div>
      </div>
      {aside ? <div className="v5p-answer-aside">{aside}</div> : null}
    </section>
  )
}

export function EmptyBlock({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="v5p-empty">
      <div className="v5p-empty-title">{title}</div>
      {children ? <div className="v5p-empty-body">{children}</div> : null}
      {action ? <div className="v5p-empty-action">{action}</div> : null}
    </div>
  )
}

// 로그인이 끝난 경우(401)에는 "다시 시도"가 소용없으니 로그인 화면으로 가는 링크를 준다.
export const isLoginError = (status: number | undefined, message?: string) => status === 401 || Boolean(message && message.includes('다시 로그인해 주세요'))

export function LoginLink() {
  return (
    <Link className="v5p-login-link" href="/v5/login">
      다시 로그인해 주세요
    </Link>
  )
}

// 오류 문장 + (로그인이 끝난 경우) 로그인 링크. 인라인 오류 자리에 그대로 쓴다.
export function ErrorText({ message, status }: { message: string; status?: number }) {
  if (!message) return null
  if (isLoginError(status, message)) {
    return (
      <>
        <span>로그인이 끝났어요. </span>
        <LoginLink />
      </>
    )
  }
  return <>{message}</>
}

export function LoadError({ message, onRetry, status }: { message: string; onRetry: () => void; status?: number }) {
  const needLogin = isLoginError(status, message)
  return (
    <div className="v5p-error" role="alert">
      <span>{needLogin ? '로그인이 끝났어요.' : message}</span>
      {needLogin ? (
        <LoginLink />
      ) : (
        <button type="button" className="button secondary sm" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

// 라벨은 위, 힌트는 라벨 아래, 오류는 입력칸 아래.
export function FormField({
  label,
  hint,
  error,
  optional,
  required,
  htmlFor,
  children
}: {
  label: string
  hint?: string
  error?: string
  optional?: boolean
  required?: boolean
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className={`field v5p-field ${error ? 'has-error' : ''}`}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="v5p-req" aria-hidden>
            {" *"}
          </span>
        ) : null}
        {optional ? <span className="v5p-optional"> (선택)</span> : null}
      </label>
      {hint ? <div className="v5p-hint">{hint}</div> : null}
      {children}
      {error ? (
        <div className="v5p-field-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}

export const nf = new Intl.NumberFormat('ko-KR')
// 숫자가 아니거나(NaN) 무한대(Infinity)면 "-"
export const fmtNum = (n: number | null | undefined) => (typeof n !== 'number' || !Number.isFinite(n) ? '-' : nf.format(n))

// 상대 시각("3분 전")을 보여 주고, 마우스를 올리면 정확한 한국 시간을 알려 준다.
export function RelTime({ value, absolute }: { value: string | null | undefined; absolute?: boolean }) {
  if (!value) return <>-</>
  const full = formatKstFull(value)
  if (!full) return <>-</>
  return (
    <time dateTime={value} title={full}>
      {absolute ? formatKstShort(value) : formatRelative(value)}
    </time>
  )
}
