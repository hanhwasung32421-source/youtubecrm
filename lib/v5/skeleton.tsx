import type { CSSProperties, ReactNode } from 'react'
import './pages.css'
import './pages-r3.css'

// 불러오는 동안 "최종 화면과 같은 자리"에 회색 반짝임 블록을 그려서, 데이터가 들어와도 화면이 출렁이지 않게 한다.
// (components/v5/widget.tsx 의 Skeleton 과 별개로 이 폴더 안에서만 쓴다.)

export function Sk({ w, h = 14, r, className, style }: { w?: number | string; h?: number | string; r?: number | string; className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`v5p-sk ${className || ''}`} style={{ width: w, height: h, borderRadius: r, ...style }} />
}

function Wrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="v5p-skwrap" role="status" aria-busy="true" aria-live="polite">
      <span className="v5p-sr-only">{label}</span>
      {children}
    </div>
  )
}

function AnswerSk() {
  return (
    <div className="v5p-answer neutral" aria-hidden>
      <div className="v5p-answer-main">
        <Sk w={110} h={12} />
        <Sk w="72%" h={22} className="v5p-sk-gap" />
      </div>
    </div>
  )
}

// 성장 실험 보드(4칸)
export function BoardSkeleton() {
  return (
    <Wrap label="실험 목록을 불러오는 중이에요…">
      <AnswerSk />
      <div className="v5p-toolbar" aria-hidden>
        <Sk w={220} h={14} />
        <Sk w={120} h={34} r={10} />
      </div>
      <div className="v5p-board" aria-hidden>
        {[2, 1, 1, 1].map((cards, col) => (
          <div className={`v5p-col ${col === 0 ? "is-active" : ""}`} key={col}>
            <div className="v5p-col-head">
              <Sk w={70} h={16} />
              <Sk w={110} h={11} className="v5p-sk-gap" />
            </div>
            {Array.from({ length: cards }).map((_, i) => (
              <div className="v5p-card v5p-sk-card" key={i}>
                <Sk w="88%" h={15} />
                <Sk w="60%" h={12} className="v5p-sk-gap" />
                <Sk w="75%" h={12} className="v5p-sk-gap" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Wrap>
  )
}

// 점수판(요약 3개 + 순위 목록)
export function ScoreboardSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Wrap label="점수판을 불러오는 중이에요…">
      <AnswerSk />
      <div className="v5p-kpis" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div className="v5-kpi" key={i}>
            <Sk w={90} h={12} />
            <Sk w={70} h={30} className="v5p-sk-gap" />
            <Sk w="80%" h={11} className="v5p-sk-gap" />
          </div>
        ))}
      </div>
      <div className="v5p-board-card" aria-hidden>
        <Sk w={90} h={16} />
        <ul className="v5p-score-list" style={{ marginTop: 12 }}>
          {Array.from({ length: rows }).map((_, i) => (
            <li className="v5p-score-row v5p-sk-row" key={i}>
              <Sk w={28} h={28} r={999} />
              <div className="v5p-sk-col">
                <Sk w="70%" h={15} />
                <Sk w="45%" h={11} />
              </div>
              <Sk w="100%" h={12} r={6} className="v5p-sk-bar" />
              <Sk w={56} h={34} r={8} />
            </li>
          ))}
        </ul>
      </div>
    </Wrap>
  )
}

// 성공 공식 카드 묶음
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Wrap label="성공 공식을 불러오는 중이에요…">
      <AnswerSk />
      <div className="v5p-pb-grid" aria-hidden>
        {Array.from({ length: count }).map((_, i) => (
          <div className="v5p-pb-card" key={i}>
            <Sk w="75%" h={16} />
            <Sk w="95%" h={12} className="v5p-sk-gap" />
            <Sk w="60%" h={12} />
            <Sk w="100%" h={30} r={8} className="v5p-sk-gap" />
          </div>
        ))}
      </div>
    </Wrap>
  )
}

// 주간 회고(작성 칸 + 지난 회고 카드)
export function RetroSkeleton() {
  return (
    <Wrap label="회고를 불러오는 중이에요…">
      <AnswerSk />
      <div className="v5p-retro-form" aria-hidden>
        <Sk w={140} h={16} />
        <div className="v5p-form-cols" style={{ marginTop: 14 }}>
          <Sk w="100%" h={84} r={10} />
          <Sk w="100%" h={84} r={10} />
        </div>
      </div>
      <div className="v5p-retro-grid" style={{ marginTop: 24 }} aria-hidden>
        {[0, 1].map((i) => (
          <div className="v5p-retro-card" key={i}>
            <Sk w={160} h={16} />
            <Sk w="90%" h={12} />
            <Sk w="70%" h={12} />
            <Sk w="80%" h={12} />
          </div>
        ))}
      </div>
    </Wrap>
  )
}
