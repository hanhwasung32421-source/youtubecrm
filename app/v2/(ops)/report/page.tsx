'use client'

import { useEffect, useMemo, useState } from 'react'
import { AdminOnly } from '@/components/v2/auth-guard'
import { PageHeader } from '@/components/v2/app-shell'
import { ContentTypeTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { Answer, EmptyGuide, HowTo, Kpi, KpiRow, LoadError, MoreButton, RefreshNote, SampleNote, SkeletonSummary, SkeletonTable, Stamp } from '@/lib/v2/analysis-ui'
import { readRemembered, useRememberedState } from '@/lib/v2/use-remembered'
import { clampScore, formatCountOrDash, formatExact, formatPercent, isNum, safeAverage, safeRatio, shortText } from '@/lib/v2/format'
import { ScoreDistribution } from '@/lib/v2/score-chart'
import { BAND_SYMBOL, BAND_WORD, SCORE_GOOD_MIN, SCORE_LOW_MAX, bandCounts, scoreBand } from '@/lib/v2/score'
import { useV2Query } from '@/lib/v2/swr'
import { LIKE_RATE_TARGET, VIEW_VELOCITY_TARGET_PER_DAY, type DiscoverabilityRow, type ReportPayload } from '@/lib/v2/types'

const EMPTY: ReportPayload = { items: [], insight: '' }
const isPayload = (data: unknown) => Array.isArray((data as { items?: unknown } | null)?.items)
const PAGE_STEP = 20
const PERIODS = ['week', 'all'] as const
const ORDERS = ['best', 'worst'] as const
const SORTS = ['score', 'views', 'likes'] as const
type SortKey = (typeof SORTS)[number]
const SORT_LABELS: Record<SortKey, string> = { score: '반응 점수', views: '하루 조회', likes: '좋아요 비율' }
const LOAD_ERROR = '성과 요약을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// 좋아요 비율(%). 조회수가 0이거나 모르면 null (0% 와 "모름"을 구분한다)
function likePercent(row: DiscoverabilityRow): number | null {
  const ratio = safeRatio(row.video.like_count ?? 0, row.video.view_count ?? 0)
  return ratio === null ? null : ratio * 100
}

function timeOf(row: DiscoverabilityRow): number {
  const t = new Date(row.video.published_at || row.video.created_at).getTime()
  return Number.isNaN(t) ? 0 : t
}

function sortValue(row: DiscoverabilityRow, key: SortKey): number {
  if (key === 'views') return isNum(row.viewsPerDay) ? row.viewsPerDay : -1
  if (key === 'likes') return likePercent(row) ?? -1
  return isNum(row.score) ? row.score : -1
}

function ReportBody() {
  const { toast } = useToast()
  const query = useV2Query<ReportPayload>('/api/v2/report', { fallback: LOAD_ERROR, validate: isPayload })
  const payload = query.data ?? EMPTY
  const loaded = !query.loading
  const loadError = query.error
  const [period, setPeriod] = useRememberedState<'week' | 'all'>('rep.period', 'week', PERIODS)
  const [order, setOrder] = useRememberedState<'best' | 'worst'>('rep.order', 'best', ORDERS)
  const [sortKey, setSortKey] = useRememberedState<SortKey>('rep.sort', 'score', SORTS)
  const [owner, setOwner] = useRememberedState<string>('rep.owner', '')
  const [visible, setVisible] = useState(PAGE_STEP)

  const all = payload.items

  // 저장해 둔 기간이 없고 최근 7일에 등록·발행된 영상도 없으면 처음부터 전체를 보여준다.
  const firstData = query.data
  useEffect(() => {
    if (!firstData || readRemembered('rep.period') !== null) return
    const since = Date.now() - WEEK_MS
    if (!firstData.items.some((row) => timeOf(row) >= since)) setPeriod('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstData])

  const recent = useMemo(() => {
    const since = Date.now() - WEEK_MS
    return all.filter((row) => timeOf(row) >= since)
  }, [all])

  const owners = useMemo(() => [...new Set(all.map((row) => row.ownerName).filter((name) => name && name !== '-'))].sort((a, b) => a.localeCompare(b, 'ko')), [all])

  const pool = period === 'week' ? recent : all
  // 저장해 둔 담당자가 지금 목록에 없으면 전체로 본다.
  const ownerNow = owners.includes(owner) ? owner : ''
  const scoped = useMemo(() => (ownerNow ? pool.filter((row) => row.ownerName === ownerNow) : pool), [pool, ownerNow])
  // 정렬은 화면 안에서만 다시 하므로 서버에 다시 묻지 않는다. (기본은 서버가 준 반응 점수 순서)
  const list = useMemo(() => {
    const sorted =
      sortKey === 'score'
        ? [...scoped]
        : [...scoped].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey) || sortValue(b, 'score') - sortValue(a, 'score'))
    return order === 'best' ? sorted : sorted.reverse()
  }, [scoped, sortKey, order])
  const shown = list.slice(0, visible)

  // 요약 숫자는 담당자 필터와 상관없이 "보는 기간" 전체 기준
  const scores = useMemo(() => pool.map((row) => row.score), [pool])
  const counts = useMemo(() => bandCounts(scores), [scores])
  const avgViewsPerDay = safeAverage(pool.map((row) => row.viewsPerDay))

  const headlineRow = recent[0] || all[0]
  const headlineIsRecent = recent.length > 0

  const pick = <T,>(setter: (v: T) => void, value: T) => {
    setter(value)
    setVisible(PAGE_STEP)
  }

  const periodName = period === 'week' ? '최근 7일' : '전체'

  return (
    <>
      <PageHeader title="성과 요약" subtitle="어떤 영상과 담당자가 검색·조회에서 잘 되고 있는지 순위로 보여줍니다." />
      <Toast toast={toast} />
      <SampleNote show={payload.sample} />
      {(loaded && loadError) || query.expired ? <LoadError message={loadError} expired={query.expired} onRetry={query.reload} /> : null}
      <RefreshNote show={query.refreshing} />

      {!loaded ? (
        <>
          <SkeletonSummary />
          <div className="panel">
            <SkeletonTable rows={6} />
          </div>
        </>
      ) : all.length === 0 ? (
        loadError ? null : <EmptyGuide title="아직 성과를 볼 영상이 없어요" href="/v2/register" action="영상 등록하러 가기">
          직원이 영상을 등록하면 조회수·좋아요가 자동으로 모이고, 이 화면에서 어떤 영상이 잘 되는지 순위로 볼 수 있어요.
        </EmptyGuide>
      ) : (
        <>
          <Answer tone="good">
            {headlineRow ? (
              <>
                {headlineIsRecent ? '이번 주' : '지금까지'} 반응이 가장 좋은 영상은 <b>「{shortText(headlineRow.video.title, 34)}」</b>
                ({headlineRow.ownerName})이에요.
                <span className="v2a-sub" style={{ display: 'block', marginTop: 6, fontWeight: 500 }}>
                  하루 평균 {formatExact(headlineRow.viewsPerDay)}회 조회 · 반응 점수 {isNum(headlineRow.score) ? headlineRow.score : '-'}점 (100점 만점)
                </span>
              </>
            ) : null}
          </Answer>

          <KpiRow>
            <Kpi label="반응이 좋은 영상" value={counts.good.toLocaleString('ko-KR')} unit="개" tone={counts.good > 0 ? 'good' : 'neutral'} hint={`반응 점수가 ${SCORE_GOOD_MIN}점 이상인 영상 수예요.`} />
            <Kpi label="손봐야 할 영상" value={counts.low.toLocaleString('ko-KR')} unit="개" tone={counts.low > 0 ? 'bad' : 'good'} hint={`반응 점수가 ${SCORE_LOW_MAX}점 미만이라 제목·썸네일 점검이 필요한 영상이에요.`} />
            <Kpi
              label="영상 1개당 하루 조회"
              value={formatCountOrDash(avgViewsPerDay)}
              unit={avgViewsPerDay === null ? undefined : '회'}
              hint={`${periodName} 영상이 하루에 평균 몇 번 조회되는지예요.`}
            />
          </KpiRow>

          <div className="panel">
            <div className="v2a-toolbar">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <div className="v2-seg" role="group" aria-label="기간">
                  <button aria-pressed={period === 'week'} className={period === 'week' ? 'active' : ''} onClick={() => pick(setPeriod, 'week')}>
                    최근 7일 {recent.length.toLocaleString('ko-KR')}
                  </button>
                  <button aria-pressed={period === 'all'} className={period === 'all' ? 'active' : ''} onClick={() => pick(setPeriod, 'all')}>
                    전체 {all.length.toLocaleString('ko-KR')}
                  </button>
                </div>
                <div className="v2-seg" role="group" aria-label="정렬 방향">
                  <button aria-pressed={order === 'best'} className={order === 'best' ? 'active' : ''} onClick={() => pick(setOrder, 'best')}>
                    잘 된 순
                  </button>
                  <button aria-pressed={order === 'worst'} className={order === 'worst' ? 'active' : ''} onClick={() => pick(setOrder, 'worst')}>
                    손볼 순
                  </button>
                </div>
              </div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" htmlFor="rep-sort">
                    기준
                  </label>
                  <select id="rep-sort" className="select compact" value={sortKey} onChange={(e) => pick(setSortKey, e.target.value as SortKey)}>
                    {SORTS.map((key) => (
                      <option key={key} value={key}>
                        {SORT_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
                {owners.length > 1 ? (
                  <div className="row" style={{ gap: 8 }}>
                    <label className="small muted" htmlFor="rep-owner">
                      담당자
                    </label>
                    <select id="rep-owner" className="select compact" value={ownerNow} onChange={(e) => pick(setOwner, e.target.value)}>
                      <option value="">전체</option>
                      {owners.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            </div>

            <ScoreDistribution scores={scores} periodLabel={periodName} />

            {payload.capped ? <p className="v2a-note">가장 최근에 등록한 영상 위주로 계산해요. 더 오래된 영상은 순위에 나오지 않을 수 있어요.</p> : null}

            {list.length === 0 ? (
              <EmptyGuide title="이 조건에 맞는 영상이 없어요">
                {period === 'week' ? '위의 ‘전체’ 탭을 누르면 지난 영상도 볼 수 있어요.' : '담당자 선택을 ‘전체’로 바꿔 보세요.'}
              </EmptyGuide>
            ) : (
              <div className="v2a-rank-wrap">
                <div role="table" aria-label={`영상별 반응 순위 (${periodName}, ${SORT_LABELS[sortKey]} 기준 ${order === 'best' ? '높은' : '낮은'} 순)`}>
                  <div className="v2a-rank head" role="row">
                    <div role="columnheader" className="rk">
                      #
                    </div>
                    <div role="columnheader">영상</div>
                    <div role="columnheader" className="num" title="발행 후 하루 평균 조회수예요.">
                      하루 조회
                    </div>
                    <div role="columnheader" className="num" title="조회한 사람 100명 중 좋아요를 누른 사람 수예요.">
                      좋아요 비율
                    </div>
                    <div role="columnheader" className="num" title="SEO 체크리스트 4칸 중 완료한 칸 수예요.">
                      점검
                    </div>
                    <div role="columnheader" className="num" title="조회·좋아요·점검을 합친 100점 만점 점수예요.">
                      반응 점수
                    </div>
                  </div>
                  {shown.map((row, index) => {
                    const band = scoreBand(row.score)
                    const score = clampScore(row.score)
                    const views = row.viewsPerDay
                    const likes = likePercent(row)
                    const title = row.video.title || '(제목 수집 대기)'
                    return (
                      <div className="v2a-rank" role="row" key={row.video.id}>
                        <div role="cell" className="rk" data-label="순위">
                          {order === 'best' ? index + 1 : list.length - index}
                        </div>
                        <div role="cell" className="v2a-rank-title">
                          <div className="t" title={row.video.title || ''}>
                            {row.video.youtube_url ? (
                              <a href={row.video.youtube_url} target="_blank" rel="noreferrer noopener">
                                {title}
                              </a>
                            ) : (
                              title
                            )}
                          </div>
                          <div className="s">
                            <ContentTypeTag contentType={row.video.content_type} /> {row.video.stock_name} · {row.ownerName} · <Stamp iso={row.video.published_at} />
                          </div>
                        </div>
                        <div role="cell" className="num c-views" data-label="하루 조회" title={isNum(views) ? `${formatExact(views)}회/일` : undefined}>
                          {isNum(views) ? `${formatCountOrDash(views)}회` : '-'}
                        </div>
                        <div role="cell" className="num c-likes" data-label="좋아요 비율" title={likes === null ? '조회수가 없어 계산할 수 없어요' : undefined}>
                          {formatPercent(likes)}
                        </div>
                        <div role="cell" className="num c-check" data-label="점검">
                          {row.checklistDone}/4
                        </div>
                        <div role="cell" className="v2a-score" data-label="반응 점수" title={`반응 점수 ${score}점 (100점 만점)`}>
                          <b>{score}</b>
                          <div className="v2-score-bar-track" style={{ width: 48 }} aria-hidden="true">
                            <div className={`v2-score-bar-fill ${band === 'good' ? 'high' : band === 'low' ? 'low' : ''}`} style={{ width: `${score}%` }} />
                          </div>
                          <span className={`v2a-score-word ${band === 'good' ? 'high' : band === 'low' ? 'low' : 'mid'}`}>
                            {BAND_SYMBOL[band]} {BAND_WORD[band]}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <MoreButton shown={shown.length} total={list.length} step={PAGE_STEP} onMore={() => setVisible((v) => v + PAGE_STEP)} />

            <HowTo>
              <p>반응 점수(0~100점) = 하루 조회 점수 × 40% + 좋아요 비율 점수 × 30% + SEO 체크리스트 점수 × 30%</p>
              <p>· 하루 조회 점수: 발행 후 하루 평균 조회수 ÷ {VIEW_VELOCITY_TARGET_PER_DAY.toLocaleString('ko-KR')}회 × 100 (최대 100점)</p>
              <p>· 좋아요 비율 점수: 좋아요 수 ÷ 조회수 ÷ {(LIKE_RATE_TARGET * 100).toFixed(0)}% × 100 (최대 100점)</p>
              <p>· SEO 체크리스트 점수: 4칸 중 완료한 칸 수 ÷ 4 × 100</p>
              <p>
                {SCORE_GOOD_MIN}점 이상이면 ‘{BAND_SYMBOL.good} {BAND_WORD.good}’, {SCORE_LOW_MAX}점 미만이면 ‘{BAND_SYMBOL.low} {BAND_WORD.low}’으로 표시해요. 기준 조회수·좋아요 비율은 채널 규모에 맞춰 나중에
                조정할 수 있어요.
              </p>
            </HowTo>
          </div>
        </>
      )}
    </>
  )
}

export default function ReportPage() {
  return (
    <AdminOnly>
      <ReportBody />
    </AdminOnly>
  )
}
