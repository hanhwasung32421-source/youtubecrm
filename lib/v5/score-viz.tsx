import { Badge } from '@/components/v5/widget'
import { SCORE_TIER_LABEL, type ScoreTier, type ScoreboardRow } from '@/lib/v5/types'
import { scoreAriaLabel, scoreParts, tierSlices, tierSummaryText, totalOf, TIER_MIN } from '@/lib/v5/score-view'
import './pages.css'
import './pages-r3.css'

// 점수 시각화: (1) 세 요소를 이어 붙인 작은 막대 (2) 점수 구간 분포 도넛.
// 색만으로 뜻을 전하지 않는다: 모든 조각/구간에 글자(이름·점수·개수)와 마우스 설명(title), 스크린리더용 문장이 있다.

export const TIER_TONE: Record<ScoreTier, 'green' | 'indigo' | 'amber' | 'red'> = {
  excellent: 'green',
  good: 'indigo',
  fair: 'amber',
  poor: 'red'
}

const TIER_COLOR: Record<ScoreTier, string> = {
  excellent: 'var(--success, #16a34a)',
  good: 'var(--primary, #4f46e5)',
  fair: 'var(--warning, #f59e0b)',
  poor: 'var(--danger, #dc2626)'
}

export function TierChip({ tier }: { tier: ScoreTier }) {
  return (
    <span title={`${SCORE_TIER_LABEL[tier]} · ${TIER_MIN[tier]}`}>
      <Badge tone={TIER_TONE[tier]}>{SCORE_TIER_LABEL[tier]}</Badge>
    </span>
  )
}

// 총점 100칸 위에 조회 속도 → 참여율 → 초기 성장 순서로 이어 붙인 막대 + 아래 글자 설명.
export function ScoreBar({ row }: { row: ScoreboardRow }) {
  const parts = scoreParts(row)
  return (
    <div className="v5p-sbar">
      <div className="v5p-sbar-track" role="img" aria-label={scoreAriaLabel(row)} title={`총 ${totalOf(row)}점`}>
        {parts.map((p) => (
          <span key={p.key} className={`v5p-seg ${p.key} ${p.pending ? 'pending' : ''}`} style={{ width: `${p.widthPct}%` }} title={p.tip} />
        ))}
      </div>
      <ul className="v5p-sbar-legend" aria-hidden>
        {parts.map((p) => (
          <li key={p.key} title={p.tip}>
            <i className={`v5p-dot ${p.key} ${p.pending ? 'pending' : ''}`} />
            {p.label} <b>{p.value}</b>
            <span className="v5p-sbar-max">/{p.max}</span>
            {p.pending ? <em>기록 부족 (기본 10점)</em> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

const SIZE = 120
const STROKE = 20
const RADIUS = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * RADIUS

export function TierDonut({ distribution, avg }: { distribution: Array<{ tier: ScoreTier; count: number }> | null | undefined; avg?: number }) {
  const slices = tierSlices(distribution)
  const total = slices.reduce((s, x) => s + x.count, 0)
  const summary = tierSummaryText(slices)
  let offset = 0
  return (
    <figure className="v5p-dist">
      <svg className="v5p-donut" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={summary}>
        <title>{summary}</title>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--bg-soft, #eef0f7)" strokeWidth={STROKE} />
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {total > 0
            ? slices.map((s) => {
                if (s.count <= 0) return null
                const dash = (s.count / total) * CIRC
                const el = (
                  <circle
                    key={s.tier}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={TIER_COLOR[s.tier]}
                    strokeWidth={STROKE}
                    strokeDasharray={`${dash} ${CIRC - dash}`}
                    strokeDashoffset={-offset}
                  >
                    <title>{`${s.label} ${s.count.toLocaleString('ko-KR')}개 (${s.pct}%)`}</title>
                  </circle>
                )
                offset += dash
                return el
              })
            : null}
        </g>
        <text x="50%" y="48%" textAnchor="middle" className="v5p-donut-num">
          {typeof avg === 'number' && Number.isFinite(avg) ? avg.toLocaleString('ko-KR') : '-'}
        </text>
        <text x="50%" y="66%" textAnchor="middle" className="v5p-donut-cap">
          평균 점수
        </text>
      </svg>
      <figcaption className="v5p-dist-legend">
        <div className="v5p-dist-title">점수 구간별 영상 수</div>
        <ul>
          {slices.map((s) => (
            <li key={s.tier}>
              <i className="v5p-dot" style={{ background: TIER_COLOR[s.tier] }} />
              <span className="v5p-dist-name">
                {s.label}
                <span className="v5p-dist-range"> {s.range}</span>
              </span>
              <span className="v5p-dist-count">
                <b>{s.count.toLocaleString('ko-KR')}</b>개 · {s.pct}%
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
