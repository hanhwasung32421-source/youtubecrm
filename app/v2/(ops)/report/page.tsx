'use client'

import Link from 'next/link'
import { Suspense, useMemo, useState } from 'react'
import { AdminOnly } from '@/components/v2/auth-guard'
import { PageHeader } from '@/components/v2/app-shell'
import { ContentTypeTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { NextSteps } from '@/lib/v2/actions-ui'
import { Answer, EmptyGuide, HowTo, Kpi, KpiRow, LoadError, MoreButton, RefreshNote, SkeletonSummary, SkeletonTable, Stamp } from '@/lib/v2/analysis-ui'
import type { CsvValue } from '@/lib/v2/csv'
import { formatKstDate } from '@/lib/v2/dates'
import { ActiveFilters, type FilterChip } from '@/lib/v2/filters-ui'
import { withQuery, type FilterSpec } from '@/lib/v2/filters'
import { clampScore, formatCountOrDash, formatExact, formatPercent, isNum, safeAverage, safeRatio, shortText } from '@/lib/v2/format'
import { GlossaryDetails, Term } from '@/lib/v2/glossary-ui'
import { reportActions } from '@/lib/v2/next-actions'
import { ScoreDistribution } from '@/lib/v2/score-chart'
import { BAND_SYMBOL, BAND_WORD, SCORE_GOOD_MIN, SCORE_LOW_MAX, bandCounts, scoreBand } from '@/lib/v2/score'
import { ShareBar } from '@/lib/v2/share-ui'
import { useV2Query } from '@/lib/v2/swr'
import { useUrlFilters } from '@/lib/v2/use-url-filters'
import { CONTENT_TYPE_LABELS, LIKE_RATE_TARGET, VIEW_VELOCITY_TARGET_PER_DAY, type DiscoverabilityRow, type ReportPayload } from '@/lib/v2/types'

const EMPTY: ReportPayload = { items: [] }
const isPayload = (data: unknown) => Array.isArray((data as { items?: unknown } | null)?.items)
const PAGE_STEP = 20
const SORTS = ['score', 'views', 'likes'] as const
type SortKey = (typeof SORTS)[number]
const SORT_LABELS: Record<SortKey, string> = { score: '반응 점수', views: '하루 조회', likes: '좋아요 비율' }
const PERIOD_LABELS = { '7': '최근 7일', '30': '최근 30일', all: '전체' } as const
type Period = keyof typeof PERIOD_LABELS
const LOAD_ERROR = '성과 요약을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const DAY_MS = 24 * 60 * 60 * 1000

// 주소(?period=30&staff=…&format=…&sort=…&order=…)와 같은 이름이라, 링크로 공유·북마크할 수 있다.
const FILTER_SPEC = {
  period: { default: '7', allowed: ['7', '30', 'all'] },
  order: { default: 'best', allowed: ['best', 'worst'] },
  sort: { default: 'score', allowed: SORTS },
  staff: { default: '' },
  format: { default: '', allowed: ['', 'longform', 'shortform'] }
} as const satisfies FilterSpec

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
  const { filters, setFilters, reset, touched, shareHref } = useUrlFilters('report', FILTER_SPEC)
  const [visible, setVisible] = useState(PAGE_STEP)

  const all = payload.items

  const recent7 = useMemo(() => {
    const since = Date.now() - 7 * DAY_MS
    return all.filter((row) => timeOf(row) >= since)
  }, [all])
  const recent30 = useMemo(() => {
    const since = Date.now() - 30 * DAY_MS
    return all.filter((row) => timeOf(row) >= since)
  }, [all])

  // 기간을 고른 적이 없고 최근 7일에 영상이 없으면, 빈 화면 대신 처음부터 전체를 보여준다. (직접 고르면 그대로 따른다)
  const autoAll = loaded && !touched && filters.period === '7' && recent7.length === 0 && all.length > 0
  const period = (autoAll ? 'all' : filters.period) as Period
  const order = filters.order as 'best' | 'worst'
  const sortKey = filters.sort as SortKey
  const periodName = PERIOD_LABELS[period]

  const owners = useMemo(() => [...new Set(all.map((row) => row.ownerName).filter((name) => name && name !== '-'))].sort((a, b) => a.localeCompare(b, 'ko')), [all])

  const pool = period === '7' ? recent7 : period === '30' ? recent30 : all
  const scoped = useMemo(
    () => pool.filter((row) => (!filters.staff || row.ownerName === filters.staff) && (!filters.format || row.video.content_type === filters.format)),
    [pool, filters.staff, filters.format]
  )
  // 정렬은 화면 안에서만 다시 하므로 서버에 다시 묻지 않는다. (기본은 서버가 준 반응 점수 순서)
  const list = useMemo(() => {
    const sorted =
      sortKey === 'score'
        ? [...scoped]
        : [...scoped].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey) || sortValue(b, 'score') - sortValue(a, 'score'))
    return order === 'best' ? sorted : sorted.reverse()
  }, [scoped, sortKey, order])
  const shown = list.slice(0, visible)

  // 요약 숫자·그래프는 담당자·형식과 상관없이 "보는 기간" 전체 기준
  const scores = useMemo(() => pool.map((row) => row.score), [pool])
  const counts = useMemo(() => bandCounts(scores), [scores])
  const avgViewsPerDay = safeAverage(pool.map((row) => row.viewsPerDay))

  const headlineRow = pool[0] || all[0]
  const headlineIsRecent = pool.length > 0 && period !== 'all'

  // 지금 보는 조건(기간·담당자·형식) 안에서 다음에 할 일
  const actions = useMemo(() => {
    const scopedCounts = bandCounts(scoped.map((row) => row.score))
    return reportActions({
      lowCount: scopedCounts.low,
      uncheckedCount: scoped.filter((row) => row.checklistDone === 0).length,
      periodCount: scoped.length,
      staff: filters.staff,
      format: filters.format,
      periodLabel: `${periodName}${filters.staff ? ` ${filters.staff}님의` : ''}`
    })
  }, [scoped, filters.staff, filters.format, periodName])

  const pick = (patch: Partial<Record<keyof typeof FILTER_SPEC, string>>) => {
    setFilters(patch)
    setVisible(PAGE_STEP)
  }
  const resetAll = () => {
    reset()
    setVisible(PAGE_STEP)
  }

  const chips: FilterChip[] = []
  if (period !== '7' && !autoAll) chips.push({ key: 'period', label: `기간: ${periodName}`, onClear: () => pick({ period: '7' }) })
  if (filters.staff) chips.push({ key: 'staff', label: `담당자: ${filters.staff}`, onClear: () => pick({ staff: '' }) })
  if (filters.format) chips.push({ key: 'format', label: `형식: ${CONTENT_TYPE_LABELS[filters.format as 'longform' | 'shortform'] ?? filters.format}`, onClear: () => pick({ format: '' }) })
  if (sortKey !== 'score') chips.push({ key: 'sort', label: `기준: ${SORT_LABELS[sortKey]}`, onClear: () => pick({ sort: 'score' }) })
  if (order !== 'best') chips.push({ key: 'order', label: '손볼 순', onClear: () => pick({ order: 'best' }) })

  const csvTable = () => ({
    name: `성과 요약 ${periodName}`,
    headers: ['순위', '제목', '종목', '형식', '담당자', '발행일', '조회수', '하루 조회', '좋아요 비율(%)', '검색 점검(4칸 중)', '반응 점수', '유튜브 주소'],
    rows: list.map((row, index): CsvValue[] => [
      order === 'best' ? index + 1 : list.length - index,
      row.video.title || '',
      row.video.stock_name,
      CONTENT_TYPE_LABELS[row.video.content_type] ?? row.video.content_type,
      row.ownerName,
      formatKstDate(row.video.published_at),
      row.video.view_count,
      isNum(row.viewsPerDay) ? Math.round(row.viewsPerDay) : null,
      likePercent(row) === null ? null : Math.round((likePercent(row) as number) * 10) / 10,
      row.checklistDone,
      isNum(row.score) ? row.score : null,
      row.video.youtube_url || ''
    ])
  })

  const filtering = chips.length > 0
  const fixLink = withQuery('/v2/optimization', { view: 'todo', staff: filters.staff, format: filters.format })

  return (
    <>
      <PageHeader title="성과 요약" subtitle="어떤 영상과 담당자가 검색·조회에서 잘 되고 있는지 순위로 보여주고, 다음에 할 일을 알려 드려요." />
      <Toast toast={toast} />
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
        loadError ? null : (
          <EmptyGuide title="아직 성과를 볼 영상이 없어요" href="/v2/register" action="영상 등록하러 가기">
            성과는 등록된 영상의 조회수·좋아요로 계산해요. 직원이 영상을 등록하면 자동으로 모이고, 이 화면에서 어떤 영상이 잘 되는지 순위로 볼 수 있어요.
          </EmptyGuide>
        )
      ) : (
        <>
          <Answer tone="good">
            {headlineRow ? (
              <>
                {headlineIsRecent ? periodName : '지금까지'} 반응이 가장 좋은 영상은 <b>「{shortText(headlineRow.video.title, 34)}」</b>
                ({headlineRow.ownerName})이에요.
                <span className="v2a-sub" style={{ display: 'block', marginTop: 6, fontWeight: 500 }}>
                  하루 평균 {formatExact(headlineRow.viewsPerDay)}회 조회 · 반응 점수 {isNum(headlineRow.score) ? headlineRow.score : '-'}점 (100점 만점)
                </span>
              </>
            ) : null}
          </Answer>

          <NextSteps items={actions} title={`다음에 할 일 (${periodName}${filters.staff ? `, ${filters.staff}` : ''}${filters.format ? `, ${CONTENT_TYPE_LABELS[filters.format as 'longform' | 'shortform']}` : ''})`} />

          <KpiRow>
            <Kpi
              label="반응이 좋은 영상"
              value={counts.good.toLocaleString('ko-KR')}
              unit="개"
              tone={counts.good > 0 ? 'good' : 'neutral'}
              hint={`반응 점수가 ${SCORE_GOOD_MIN}점 이상인 영상 수예요.`}
            />
            <Kpi
              label="손봐야 할 영상"
              value={counts.low.toLocaleString('ko-KR')}
              unit="개"
              tone={counts.low > 0 ? 'bad' : 'good'}
              hint={`반응 점수가 ${SCORE_LOW_MAX}점 미만이라 제목·썸네일 점검이 필요한 영상이에요.`}
              href={counts.low > 0 ? fixLink : undefined}
              linkLabel={counts.low > 0 ? '영상 점검에서 고치기' : undefined}
            />
            <Kpi
              label={<Term k="views">영상 1개당 하루 조회</Term>}
              value={formatCountOrDash(avgViewsPerDay)}
              unit={avgViewsPerDay === null ? undefined : '회'}
              hint={`${periodName} 영상이 하루에 평균 몇 번 조회되는지예요.`}
            />
          </KpiRow>

          <div className="panel">
            <div className="v2a-toolbar">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <div className="v2-seg" role="group" aria-label="기간">
                  <button aria-pressed={period === '7'} className={period === '7' ? 'active' : ''} onClick={() => pick({ period: '7' })}>
                    최근 7일 {recent7.length.toLocaleString('ko-KR')}
                  </button>
                  <button aria-pressed={period === '30'} className={period === '30' ? 'active' : ''} onClick={() => pick({ period: '30' })}>
                    30일 {recent30.length.toLocaleString('ko-KR')}
                  </button>
                  <button aria-pressed={period === 'all'} className={period === 'all' ? 'active' : ''} onClick={() => pick({ period: 'all' })}>
                    전체 {all.length.toLocaleString('ko-KR')}
                  </button>
                </div>
                <div className="v2-seg" role="group" aria-label="정렬 방향">
                  <button aria-pressed={order === 'best'} className={order === 'best' ? 'active' : ''} onClick={() => pick({ order: 'best' })}>
                    잘 된 순
                  </button>
                  <button aria-pressed={order === 'worst'} className={order === 'worst' ? 'active' : ''} onClick={() => pick({ order: 'worst' })}>
                    손볼 순
                  </button>
                </div>
              </div>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" htmlFor="rep-sort">
                    기준
                  </label>
                  <select id="rep-sort" className="select compact" value={sortKey} onChange={(e) => pick({ sort: e.target.value })}>
                    {SORTS.map((key) => (
                      <option key={key} value={key}>
                        {SORT_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" htmlFor="rep-format">
                    형식
                  </label>
                  <select id="rep-format" className="select compact" value={filters.format} onChange={(e) => pick({ format: e.target.value })}>
                    <option value="">전체</option>
                    <option value="longform">롱폼</option>
                    <option value="shortform">숏폼</option>
                  </select>
                </div>
                {owners.length > 1 ? (
                  <div className="row" style={{ gap: 8 }}>
                    <label className="small muted" htmlFor="rep-owner">
                      담당자
                    </label>
                    <select id="rep-owner" className="select compact" value={owners.includes(filters.staff) ? filters.staff : ''} onChange={(e) => pick({ staff: e.target.value })}>
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

            <ActiveFilters chips={chips} onReset={resetAll} />
            <ShareBar getCsv={csvTable} csvDisabledReason={list.length === 0 ? '저장할 영상이 없어요' : undefined} getLink={shareHref} />

            <ScoreDistribution scores={scores} periodLabel={periodName} />
            <p className="v2a-note">위의 숫자와 그래프는 {periodName} 영상 전체 기준이고, 담당자·형식은 아래 순위 표에만 적용돼요.</p>

            {payload.capped ? <p className="v2a-note">가장 최근에 등록한 영상 위주로 계산해요. 더 오래된 영상은 순위에 나오지 않을 수 있어요.</p> : null}

            {list.length === 0 ? (
              period !== 'all' ? (
                <EmptyGuide title="이 기간에는 맞는 영상이 없어요" action="전체 기간 보기" onAction={() => pick({ period: 'all' })}>
                  {periodName} 동안 {filters.staff ? `${filters.staff}님이 ` : ''}등록한 영상이 없어요. 전체 기간으로 보면 지난 영상의 순위를 볼 수 있어요.
                </EmptyGuide>
              ) : (
                <EmptyGuide title="이 조건에 맞는 영상이 없어요" action={filtering ? '필터 초기화' : undefined} onAction={filtering ? resetAll : undefined}>
                  담당자나 형식 조건을 바꾸거나 필터를 초기화하면 다시 보여요.
                </EmptyGuide>
              )
            ) : (
              <div className="v2a-rank-wrap">
                <div role="table" aria-label={`영상별 반응 순위 (${periodName}, ${SORT_LABELS[sortKey]} 기준 ${order === 'best' ? '높은' : '낮은'} 순)`}>
                  <div className="v2a-rank head" role="row">
                    <div role="columnheader" className="rk">
                      #
                    </div>
                    <div role="columnheader">영상</div>
                    <div role="columnheader" className="num">
                      <Term k="views" />
                    </div>
                    <div role="columnheader" className="num">
                      <Term k="likes" />
                    </div>
                    <div role="columnheader" className="num">
                      <Term k="check" />
                    </div>
                    <div role="columnheader" className="num">
                      <Term k="score" />
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
                          {band !== 'good' ? (
                            <div className="v2a-rank-links">
                              <Link href={withQuery('/v2/optimization', { video: row.video.id, view: 'all' })}>이 영상 점검하고 고치기 →</Link>
                            </div>
                          ) : null}
                        </div>
                        <div role="cell" className="num c-views" data-label="하루 조회" title={isNum(views) ? `${formatExact(views)}회/일` : undefined}>
                          {isNum(views) ? `${formatCountOrDash(views)}회` : '-'}
                        </div>
                        <div role="cell" className="num c-likes" data-label="좋아요 비율" title={likes === null ? '조회수가 없어 계산할 수 없어요' : undefined}>
                          {formatPercent(likes)}
                        </div>
                        <div role="cell" className="num c-check" data-label="검색 점검">
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

            <GlossaryDetails keys={['score', 'views', 'likes', 'check']} />
            <HowTo>
              <p>반응 점수(0~100점) = 하루 조회 점수 × 40% + 좋아요 비율 점수 × 30% + 검색 점검 점수 × 30%</p>
              <p>· 하루 조회 점수: 발행 후 하루 평균 조회수 ÷ {VIEW_VELOCITY_TARGET_PER_DAY.toLocaleString('ko-KR')}회 × 100 (최대 100점)</p>
              <p>· 좋아요 비율 점수: 좋아요 수 ÷ 조회수 ÷ {(LIKE_RATE_TARGET * 100).toFixed(0)}% × 100 (최대 100점)</p>
              <p>· 검색 점검 점수: 4칸 중 완료한 칸 수 ÷ 4 × 100</p>
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
      {/* 필터를 주소에서 읽기 때문에 Suspense 로 감싸야 한다 (Next.js 요구사항). */}
      <Suspense fallback={<SkeletonSummary />}>
        <ReportBody />
      </Suspense>
    </AdminOnly>
  )
}
