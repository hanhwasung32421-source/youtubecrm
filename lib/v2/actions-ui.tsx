'use client'

// "다음에 뭘 하면 되는지"를 보여 주는 조각: 진행 막대, 다음 할 일 목록, 유튜브 스튜디오 바로가기.
import Link from 'next/link'
import type { NextLink } from './next-actions'
import { studioEditUrl } from './next-actions'

// "12개 중 5개 완료" 막대. total 이 0이면 그리지 않는다.
export function ProgressBar({ done, total, label = '완료' }: { done: number; total: number; label?: string }) {
  if (total <= 0) return null
  const safeDone = Math.max(0, Math.min(total, done))
  const pct = Math.round((safeDone / total) * 100)
  return (
    <div className="v2a-progress">
      <div className="v2a-progress-text">
        <b>
          {total.toLocaleString('ko-KR')}개 중 {safeDone.toLocaleString('ko-KR')}개 {label}
        </b>
        <span className="muted">{pct}%</span>
      </div>
      <div className="v2a-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={safeDone} aria-label={`${total}개 중 ${safeDone}개 ${label}`}>
        <div className="v2a-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// 결과에서 바로 이어지는 다음 할 일 (각 줄에 이동 링크). 색만으로 구분하지 않도록 기호를 함께 쓴다.
const TONE_SYMBOL = { bad: '▼', warn: '●', good: '✓' } as const

export function NextSteps({ items, title = '다음에 할 일' }: { items: NextLink[]; title?: string }) {
  if (items.length === 0) return null
  return (
    <section className="v2a-next-steps" aria-label={title}>
      <div className="v2a-next-steps-title">{title}</div>
      <ul>
        {items.map((item) => (
          <li key={item.key} className={item.tone}>
            <span className="v2a-next-sym" aria-hidden="true">
              {TONE_SYMBOL[item.tone]}
            </span>
            <span className="v2a-next-text">{item.text}</span>
            <Link className="button secondary xs" href={item.href}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// 유튜브 스튜디오의 영상 수정 화면을 새 탭으로 연다. 영상 주소를 알 수 없으면 이유를 글로 알려 준다.
export function StudioLink({ youtubeUrl, className = 'button xs' }: { youtubeUrl: string | null | undefined; className?: string }) {
  const href = studioEditUrl(youtubeUrl)
  if (!href) return <span className="small muted">영상 주소를 알 수 없어 바로가기를 만들지 못했어요.</span>
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      이 영상 고치러 가기 <span aria-hidden="true">↗</span>
      <span className="v2a-vh"> (유튜브 스튜디오, 새 탭)</span>
    </a>
  )
}
