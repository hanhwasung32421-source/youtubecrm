'use client'

// 분석·업무 화면(성과 요약 / 영상 점검 / 키워드 모음 / 업로드 계획)이 함께 쓰는 작은 조각들.
// 스타일은 ./analysis.css (.v2-theme 스코프, v2a- 접두어)에만 둔다.
import Link from 'next/link'
import type { ReactNode } from 'react'
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
