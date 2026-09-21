'use client'

// 반응 점수 분포 막대그래프. 글자는 SVG 가 아니라 일반 글자라 화면이 좁아져도 작아지지 않는다.
// 색만으로 구분하지 않도록 아래 띠에 ▼ 낮음 / ● 보통 / ▲ 좋음 글자를 함께 적는다.
import { useMemo } from 'react'
import { BAND_SYMBOL, BAND_WORD, SCORE_GOOD_MIN, SCORE_LOW_MAX, bandCounts, bucketScores, type ScoreBand } from './score'

const BAND_OF_BUCKET: ScoreBand[] = ['low', 'low', 'low', 'low', 'mid', 'mid', 'mid', 'good', 'good', 'good']

function rangeLabel(index: number) {
  const lo = index * 10
  return index === 9 ? `${lo}~100점` : `${lo}~${lo + 9}점`
}

export function ScoreDistribution({ scores, periodLabel }: { scores: readonly number[]; periodLabel: string }) {
  const { buckets, counts, max } = useMemo(() => {
    const b = bucketScores(scores)
    return { buckets: b, counts: bandCounts(scores), max: Math.max(1, ...b) }
  }, [scores])
  const total = counts.good + counts.mid + counts.low

  if (total === 0) {
    return (
      <div className="v2a-chart">
        <div className="v2a-chart-title">반응 점수 분포</div>
        <p className="v2a-note" style={{ margin: 0 }}>
          {periodLabel}에는 점수를 낼 영상이 아직 없어요.
        </p>
      </div>
    )
  }

  const summary = `${periodLabel} 영상 ${total.toLocaleString('ko-KR')}개의 반응 점수 분포. 좋음(${SCORE_GOOD_MIN}점 이상) ${counts.good}개, 보통 ${counts.mid}개, 낮음(${SCORE_LOW_MAX}점 미만) ${counts.low}개.`

  return (
    <figure className="v2a-chart" aria-label="반응 점수 분포 그래프">
      <figcaption className="v2a-chart-title">
        반응 점수 분포 <span className="muted">· {periodLabel} 영상 {total.toLocaleString('ko-KR')}개</span>
      </figcaption>
      <div role="img" aria-label={summary}>
        <div className="v2a-hist">
          <div className="v2a-hist-ylabel" aria-hidden="true">
            영상 수(개)
          </div>
          <div className="v2a-hist-plot" aria-hidden="true">
            {buckets.map((n, i) => (
              <div className={`v2a-hist-col ${BAND_OF_BUCKET[i]}`} key={i} title={`${rangeLabel(i)}: 영상 ${n.toLocaleString('ko-KR')}개`}>
                <span className="v2a-hist-n">{n > 0 ? n.toLocaleString('ko-KR') : ''}</span>
                <span className="v2a-hist-track">
                  <span className="v2a-hist-bar" style={{ height: n > 0 ? `${Math.max(4, (n / max) * 100)}%` : '2px' }} />
                </span>
                <span className="v2a-hist-x">{i * 10}</span>
              </div>
            ))}
          </div>
          <div className="v2a-hist-bands" aria-hidden="true">
            <span className="low" style={{ gridColumn: 'span 4' }}>
              {BAND_SYMBOL.low} {BAND_WORD.low}
            </span>
            <span className="mid" style={{ gridColumn: 'span 3' }}>
              {BAND_SYMBOL.mid} {BAND_WORD.mid}
            </span>
            <span className="good" style={{ gridColumn: 'span 3' }}>
              {BAND_SYMBOL.good} {BAND_WORD.good}
            </span>
          </div>
          <div className="v2a-hist-xlabel" aria-hidden="true">
            반응 점수(점, 10점 단위) →
          </div>
        </div>
      </div>
      <ul className="v2a-legend v2a-chart-legend">
        <li className="good">
          {BAND_SYMBOL.good} 좋음 ({SCORE_GOOD_MIN}점 이상) <b>{counts.good.toLocaleString('ko-KR')}개</b>
        </li>
        <li className="mid">
          {BAND_SYMBOL.mid} 보통 <b>{counts.mid.toLocaleString('ko-KR')}개</b>
        </li>
        <li className="low">
          {BAND_SYMBOL.low} 낮음 ({SCORE_LOW_MAX}점 미만) <b>{counts.low.toLocaleString('ko-KR')}개</b>
        </li>
      </ul>
    </figure>
  )
}
