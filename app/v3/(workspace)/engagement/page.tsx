'use client'

import '../analysis.css'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Suspense, memo, useEffect, useMemo } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { Section, Tag } from '@/components/v3/ui'
import { useV3Me } from '@/components/v3/auth-guard'
import { useV3Data } from '@/lib/v3/use-v3-data'
import { useUrlFilters } from '@/lib/v3/use-filters'
import { ENGAGEMENT_FILTERS, chipLabel, defaultFilters, optionsFor } from '@/lib/v3/filters'
import { formatCompactNumber, formatNumber, formatPct } from '@/lib/v3/format'
import { pctChange } from '@/lib/v3/engagement'
import { lifecycleHref } from '@/lib/v3/links'
import { sortEngagementRows, type EngagementRow } from '@/lib/v3/sorting'
import {
  AnswerCard,
  AnswerSkeleton,
  ChartSkeleton,
  EmptyBlock,
  ErrorBlock,
  HowTo,
  MoreButton,
  RefreshFailed,
  RowsSkeleton,
  SectionSkeleton,
  Skel,
  SkeletonShell,
  StatCard,
  StatGrid,
  StatsSkeleton,
  describeChange,
  per100,
  useShowMore
} from '../analysis-parts'
import { FilterBar, GlossaryHelp, ShareTools, Term, type FilterField } from '../analysis-tools'
import type { ScatterDot } from '../analysis-charts'

// 차트는 데이터가 오는 동안 따로 내려받는다(처음 화면을 가볍게).
const HistogramChart = dynamic(() => import('../analysis-charts').then((m) => m.HistogramChart), { ssr: false, loading: () => <ChartSkeleton height={180} /> })
const ScatterChart = dynamic(() => import('../analysis-charts').then((m) => m.ScatterChart), { ssr: false, loading: () => <ChartSkeleton height={280} /> })

// 모든 비율은 % 단위(0~100)다.
type EngagementResponse = {
  videoCount: number
  weekCounts?: { thisWeek: number; lastWeek: number }
  kpis: {
    avgEngagementPct: { current: number }
    avgCommentRatePct: { current: number }
    thisWeekAvgEngagementPct: { current: number; previous?: number }
  }
  distribution: { key: string; label: string; count: number }[]
  scatter: ScatterDot[]
  topComment: { id: string; label: string; sub?: string; value: number; viewCount?: number; youtubeUrl: string | null }[]
  // 영상별 순위표 재료(정렬을 바꿔 볼 수 있다). 정렬 기준마다 상위 rankLimit 개씩 들어 있다.
  videoRows?: EngagementRow[]
  rankLimit?: number
  // 영상이 너무 많아 오래된 영상이 계산에서 빠졌다
  truncated?: boolean
  loadedCount?: number
  staffOptions: { id: string; name: string }[]
}

// 구간 이름에 쉬운 뜻을 붙인다.
const BUCKET_LABELS: Record<string, string> = {
  '0-1': '0~1% · 조용함',
  '1-2': '1~2% · 보통 이하',
  '2-4': '2~4% · 보통',
  '4-8': '4~8% · 좋음',
  '8+': '8% 이상 · 매우 좋음'
}

// 실제 화면과 같은 모양의 뼈대(답 → 숫자 3개 → 순위 → 막대)
function EngagementSkeleton() {
  return (
    <SkeletonShell label="참여 현황을 불러오는 중이에요…">
      <AnswerSkeleton />
      <StatsSkeleton count={3} />
      <SectionSkeleton>
        <RowsSkeleton rows={5} />
      </SectionSkeleton>
      <SectionSkeleton titleWidth={260}>
        <div className="v3a-figure" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 70px', gap: 12, alignItems: 'center', marginBottom: 10 }}>
              <Skel h={13} />
              <Skel h={14} w={`${88 - i * 14}%`} />
              <Skel h={13} />
            </div>
          ))}
        </div>
      </SectionSkeleton>
    </SkeletonShell>
  )
}

// 정렬 기준에 맞는 값을 오른쪽 큰 글자로, 나머지는 작은 글자로 보여 준다.
function rowValue(row: EngagementRow, sort: string) {
  const views = row.viewCount ? `조회수 ${formatCompactNumber(row.viewCount)}회` : ''
  const withViews = (text: string) => (views ? `${views} · ${text}` : text)
  if (sort === 'engagement') return { main: formatPct(row.engagementPct, 2), small: withViews(`100명 중 약 ${per100(row.engagementPct)}이 반응`) }
  if (sort === 'views') return { main: `${formatNumber(row.viewCount)}회`, small: `참여율 ${formatPct(row.engagementPct, 2)}` }
  if (sort === 'recent') return { main: formatPct(row.engagementPct, 2), small: withViews('참여율') }
  return { main: formatPct(row.commentRatePct, 2), small: withViews(`100명 중 약 ${per100(row.commentRatePct)}이 댓글`) }
}

// 순위표의 한 줄. 더 보기를 눌러 줄이 늘어도 이미 그려진 줄은 다시 그리지 않는다.
const RankRow = memo(function RankRow({ row, rank, sort }: { row: EngagementRow; rank: number; sort: string }) {
  const value = rowValue(row, sort)
  return (
    <div className="v3a-row">
      <span className="v3-rank">{rank}</span>
      <div className="v3a-row-main">
        <div className="v3a-row-title" title={row.title}>
          {row.youtubeUrl ? (
            <a className="v3-link" href={row.youtubeUrl} target="_blank" rel="noreferrer">
              {row.title}
            </a>
          ) : (
            row.title
          )}
          {row.stockName ? <Tag tone="blue">{row.stockName}</Tag> : null}
        </div>
        <div className="v3a-row-links">
          <Link className="v3-link" href={lifecycleHref(row.id)}>
            조회수 성장 곡선 보기
          </Link>
        </div>
      </div>
      <div className="v3a-row-value">
        {value.main}
        <small>{value.small}</small>
      </div>
    </div>
  )
})

const HEADER_PROPS = { icon: '💬', title: '참여 현황', subtitle: '시청자가 좋아요·댓글로 얼마나 반응하는지 한눈에 봐요.' }

// useSearchParams 는 Suspense 안에서만 쓸 수 있다(Next 16).
export default function EngagementPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader {...HEADER_PROPS} />
          <EngagementSkeleton />
        </>
      }
    >
      <EngagementView />
    </Suspense>
  )
}

function EngagementView() {
  const me = useV3Me()
  const { toast, showSuccess, showError } = useToast()
  const f = useUrlFilters('engagement', ENGAGEMENT_FILTERS)
  const { filters, set: setFilter } = f
  const isAdmin = !!me?.isAdmin

  const apiUrl = useMemo(() => {
    if (!f.ready) return null
    const q = new URLSearchParams()
    if (isAdmin && filters.staff) q.set('staffId', filters.staff)
    if (filters.format !== 'all') q.set('format', filters.format)
    if (filters.period !== 'all') q.set('days', filters.period)
    const s = q.toString()
    return `/api/v3/engagement${s ? `?${s}` : ''}`
  }, [f.ready, isAdmin, filters.staff, filters.format, filters.period])

  const res = useV3Data<EngagementResponse>(apiUrl, { scope: me?.crmUserId, fallback: '참여 현황을 불러오지 못했어요.' })
  const { data, reload } = res

  // 저장해 둔 직원이 더는 목록에 없거나, 직원이 아닌 사람이 직원 필터를 들고 오면 전체 팀으로 되돌린다.
  useEffect(() => {
    if (!data || !me || !filters.staff) return
    if (!isAdmin || !data.staffOptions.some((s) => s.id === filters.staff)) setFilter({ staff: '' })
  }, [data, me, isAdmin, filters.staff, setFilter])

  // 순위표: 서버가 준 영상별 값(없으면 Top 5 로 대신)을 정렬 기준대로 놓는다.
  const rows = useMemo<EngagementRow[]>(() => {
    if (!data) return []
    const base: EngagementRow[] =
      data.videoRows ??
      data.topComment.map((t) => ({
        id: t.id,
        title: t.label,
        stockName: t.sub || null,
        contentType: '',
        viewCount: t.viewCount || 0,
        likeRatePct: 0,
        commentRatePct: t.value,
        engagementPct: 0,
        publishedAt: null,
        youtubeUrl: t.youtubeUrl
      }))
    const sorted = sortEngagementRows(base, filters.sort)
    // 서버는 정렬 기준마다 상위 N개의 합집합을 준다. 그중 이 정렬의 진짜 상위 N개까지만 순위로 보여 준다.
    return data.rankLimit ? sorted.slice(0, data.rankLimit) : sorted
  }, [data, filters.sort])
  const rowsMore = useShowMore(rows, 10, 50)

  const staffOptions = data?.staffOptions || []
  const staffName = staffOptions.find((s) => s.id === filters.staff)?.name
  const scope = staffName ? `${staffName}님의` : isAdmin ? '팀' : '내'

  const fields: FilterField[] = [
    ...(isAdmin && staffOptions.length > 0
      ? [{ key: 'staff', label: '직원', options: [{ value: '', label: '전체 팀' }, ...staffOptions.map((s) => ({ value: s.id, label: s.name }))] }]
      : []),
    { key: 'period', label: '등록 시기', options: optionsFor('engagement', ENGAGEMENT_FILTERS, 'period') },
    { key: 'format', label: '형식', options: optionsFor('engagement', ENGAGEMENT_FILTERS, 'format') },
    { key: 'sort', label: '순위 정렬', options: optionsFor('engagement', ENGAGEMENT_FILTERS, 'sort') }
  ]
  const chips = f.chips((key, value) => chipLabel('engagement', key, value, (id) => staffOptions.find((s) => s.id === id)?.name || null))
  const filtered = chips.some((c) => c.key !== 'sort')

  const filterBar = (
    <FilterBar
      fields={fields}
      filters={filters}
      defaults={defaultFilters(ENGAGEMENT_FILTERS)}
      chips={chips}
      onChange={(key, value) => f.set({ [key]: value })}
      onReset={f.reset}
    >
      <ShareTools
        getLink={() => f.shareUrl()}
        csv={{ baseName: '참여 현황 영상별 순위', rowCount: rows.length, build: async () => (await import('@/lib/v3/table-rows')).engagementCsv(rows) }}
        notify={{ success: showSuccess, error: showError }}
      />
    </FilterBar>
  )

  const header = <PageHeader {...HEADER_PROPS} />

  if (!data) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        <div style={{ marginBottom: 16 }}>{filterBar}</div>
        {res.error ? <ErrorBlock message={res.error} status={res.status} onRetry={() => void reload(true)} /> : <EngagementSkeleton />}
      </>
    )
  }

  if (data.videoCount === 0) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        <div className="v3a-stack">
          {filterBar}
          {filtered ? (
            <EmptyBlock title={`이 조건에 맞는 ${scope} 영상이 없어요`} actionLabel="필터 초기화" onAction={f.reset} secondaryLabel="영상 등록하러 가기" secondaryHref="/v3/register">
              고른 기간·형식·직원에 조회수가 있는 영상이 없어요. 조건을 풀면 다른 영상이 보일 수 있어요.
            </EmptyBlock>
          ) : (
            <EmptyBlock title={`아직 ${scope} 반응을 분석할 영상이 없어요`} actionLabel="영상 등록하러 가기" actionHref="/v3/register" secondaryLabel="조회수 새로고침 누르기" secondaryHref="/v3/lifecycle">
              영상을 등록하고 유튜브 조회수가 잡히면, 좋아요·댓글 반응이 어떤지 여기에 보여드려요. 이미 등록했다면 ‘조회수 새로고침’을 눌러 조회수를 가져와 주세요. (조회수가 0인 영상은 계산에서 빠져요)
            </EmptyBlock>
          )}
        </div>
      </>
    )
  }

  const thisWeek = data.kpis.thisWeekAvgEngagementPct
  const thisWeekCount = data.weekCounts?.thisWeek ?? (thisWeek.current > 0 ? 1 : 0)
  const lastWeekCount = data.weekCounts?.lastWeek ?? (thisWeek.previous !== undefined ? 1 : 0)
  const weekChange = lastWeekCount > 0 && thisWeek.previous !== undefined ? pctChange(thisWeek.current, thisWeek.previous) : null
  const change = describeChange(weekChange, '지난주')
  const overall = data.kpis.avgEngagementPct.current
  const best = data.topComment[0]

  let headline: string
  let tone: 'good' | 'bad' | 'neutral' = 'neutral'
  if (thisWeekCount > 0) {
    headline = `이번 주 영상은 보는 사람 100명 중 약 ${per100(thisWeek.current)}이 좋아요나 댓글로 반응했어요.`
    if (weekChange !== null) {
      tone = change.tone
      headline += ` ${change.text}.`
    }
  } else {
    headline = `이번 주에 조회수가 잡힌 영상이 아직 없어요. ${filters.period === 'all' ? '지금까지 영상 전체로는' : '고른 기간의 영상으로는'} 보는 사람 100명 중 약 ${per100(overall)}이 반응했어요.`
  }

  const buckets = data.distribution.map((b) => ({ ...b, label: BUCKET_LABELS[b.key] || b.label }))
  const biggest = [...data.distribution].sort((a, b) => b.count - a.count)[0]
  const bucketSentence =
    biggest && biggest.count > 0 && data.videoCount > 0
      ? `${scope} 영상 중 ${formatNumber(biggest.count)}개(${formatPct((biggest.count / data.videoCount) * 100, 0)})가 ‘${BUCKET_LABELS[biggest.key] || biggest.label}’ 구간에 모여 있어요.`
      : null

  const deltaText = thisWeekCount > 0 && weekChange !== null ? `${change.arrow} ${change.text}`.trim() : thisWeekCount > 0 ? '지난주 영상이 없어 비교하지 않았어요' : '이번 주 조회수가 잡힌 영상 없음'

  return (
    <>
      {header}
      <Toast toast={toast} />

      <div className="v3a-stack">
        {filterBar}
        {res.error ? <RefreshFailed message={res.error} status={res.status} onRetry={() => void reload(true)} /> : null}
        <div className={`v3a-stack ${res.stale ? 'v3a-dim' : ''}`} aria-busy={res.stale || res.refreshing}>
          <AnswerCard
            tone={tone}
            eyebrow={`${scope} 반응 요약`}
            headline={headline}
            detail={best ? `댓글 반응이 가장 뜨거운 영상: “${best.label}”` : '조회수 100회 이상 영상이 생기면 댓글이 뜨거운 영상도 알려드려요.'}
            action={
              best ? (
                <a className="button secondary" href="#v3a-top-comment">
                  뜨거운 영상 보기
                </a>
              ) : null
            }
          />

          <StatGrid>
            <StatCard
              label="이번 주 참여율"
              value={thisWeekCount > 0 ? formatPct(thisWeek.current, 2) : '—'}
              hint="이번 주 올린 영상에서 조회수 대비 좋아요+댓글이 차지하는 비율이에요. 높을수록 반응이 좋아요. (기간 조건과 상관없이 최근 7일)"
              delta={deltaText}
              tone={thisWeekCount > 0 ? change.tone : 'neutral'}
            />
            <StatCard
              label={
                <>
                  {filters.period === 'all' ? '전체 평균 ' : '이 기간 평균 '}
                  <Term k="engagement" />
                </>
              }
              value={formatPct(overall, 2)}
              hint={filters.period === 'all' ? '지금까지 영상 전체의 평균이에요. 이번 주 값과 비교해 보세요.' : '위에서 고른 기간에 올린 영상의 평균이에요. 이번 주 값과 비교해 보세요.'}
            />
            <StatCard
              label={<Term k="commentRate" />}
              value={formatPct(data.kpis.avgCommentRatePct.current, 2)}
              hint="조회수 대비 댓글 비율이에요. 댓글은 좋아요보다 남기기 어려워서, 높으면 팬이 생기고 있다는 신호예요."
            />
          </StatGrid>
          <p className="v3a-note">
            분석 대상: 조회수가 있는 영상 {formatNumber(data.videoCount)}개 (조회수 0인 영상은 제외)
            {data.truncated ? ` · 영상이 많아서 가장 최근에 등록한 ${formatNumber(data.loadedCount ?? 0)}개까지만 계산했어요.` : ''}
          </p>

          <GlossaryHelp page="engagement" keys={['engagement', 'commentRate']} />

          <span id="v3a-top-comment" />
          <Section
            title="영상별 반응 순위"
            count={rows.length}
            description={`조회수 100회 이상 영상만 순위에 넣어요. 위의 ‘순위 정렬’로 기준을 바꿔 볼 수 있어요. 반응이 좋은 영상은 후속편이나 같은 종목 영상을 만들기 좋아요.${data.rankLimit && rows.length >= data.rankLimit ? ` (위쪽 ${formatNumber(data.rankLimit)}개까지만 보여요.)` : ''}`}
          >
            {rows.length === 0 ? (
              <EmptyBlock title="아직 순위에 넣을 영상이 없어요" actionLabel="조회수 새로고침 누르기" actionHref="/v3/lifecycle">
                조회수가 100회를 넘는 영상이 생기면 반응 순서대로 보여드려요. 조회수를 최근 값으로 가져오지 않았다면 ‘조회수 새로고침’을 먼저 눌러 주세요.
              </EmptyBlock>
            ) : (
              <>
                <div className="v3a-list">
                  {rowsMore.visible.map((row, index) => (
                    <RankRow key={row.id} row={row} rank={index + 1} sort={filters.sort} />
                  ))}
                </div>
                <MoreButton remaining={rowsMore.remaining} onClick={rowsMore.more} />
              </>
            )}
          </Section>

          <Section title="영상 대부분은 반응이 어느 정도인가요?" description={bucketSentence || '영상마다 참여율을 구해 구간별로 몇 개씩 있는지 보여줘요.'}>
            <HistogramChart buckets={buckets} />
          </Section>

          <HowTo title="좋아요와 댓글을 영상별로 자세히 보기 (선택)">
            <p>
              점 하나가 영상 하나예요. 오른쪽일수록 좋아요가 많고, 위쪽일수록 댓글이 많아요. 주황색 마름모(◆)는 좋아요보다 댓글이 상대적으로 활발한 영상이에요. 점 위에 마우스를 올리거나 그래프를 클릭한 뒤 화살표 키를 누르면 영상 제목과 정확한 값이 보여요.
            </p>
            <ScatterChart points={data.scatter} />
          </HowTo>

          <HowTo>
            <p>참여율 = (좋아요 + 댓글) ÷ 조회수 × 100</p>
            <p>댓글 참여율 = 댓글 ÷ 조회수 × 100</p>
            <p>이번 주 = 최근 7일 안에 등록한 영상, 지난주 = 그 이전 7일 안에 등록한 영상이에요. (위의 ‘등록 시기’ 조건과 상관없이 늘 최근 2주를 봐요.)</p>
            <p>구간별 개수는 영상마다 구한 참여율을 0~1%, 1~2%, 2~4%, 4~8%, 8% 이상으로 나눠 센 값이에요.</p>
          </HowTo>
        </div>
      </div>
    </>
  )
}
