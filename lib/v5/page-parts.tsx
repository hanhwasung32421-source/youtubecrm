'use client'

import type { ReactNode } from 'react'
import './pages.css'

// 성장 관리 화면(성장 실험/영상 점수판/성공 공식/주간 회고)이 함께 쓰는 작은 조각들.
// 스타일은 pages.css(.v5-theme 하위 v5p- 접두어)에만 있다.

export const SAMPLE_SQL_FILE = 'supabase/sql/v5/100_v5_growth_lab.sql'

// 샘플 데이터 안내: 한 줄, 차분하게.
export function SampleNote({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div className="v5p-sample" role="note">
      <span>샘플 화면이에요. 실제 데이터로 바꾸려면</span>
      <code>{SAMPLE_SQL_FILE}</code>
      <span>을 실행하세요.</span>
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

export function LoadingLine({ text = '불러오는 중이에요…' }: { text?: string }) {
  return <div className="v5p-loading">{text}</div>
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="v5p-error" role="alert">
      <span>{message}</span>
      <button type="button" className="button secondary sm" onClick={onRetry}>
        다시 시도
      </button>
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
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '-' : nf.format(n))
