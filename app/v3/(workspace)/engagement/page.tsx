'use client'

import '../analysis.css'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { Section, Tag } from '@/components/v3/ui'
import { HistogramBars, ScatterGrid, type ScatterPoint } from '@/components/v3/charts'
import { useV3Me } from '@/components/v3/auth-guard'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import { formatNumber, formatPct } from '@/lib/v3/format'
import { pctChange } from '@/lib/v3/engagement'
import { AnswerCard, EmptyBlock, ErrorBlock, HowTo, LoadingBlock, StatCard, StatGrid, describeChange } from '../analysis-parts'

type EngagementResponse = {
  summary: string
  videoCount: number
  weekCounts?: { thisWeek: number; lastWeek: number }
  kpis: {
    avgEngagementPct: { current: number }
    avgCommentRatePct: { current: number }
    thisWeekAvgEngagementPct: { current: number; previous?: number }
  }
  distribution: { key: string; label: string; count: number }[]
  scatter: ScatterPoint[]
  topComment: { id: string; label: string; sub?: string; value: number; youtubeUrl: string | null }[]
  staffOptions: { id: string; name: string }[]
  staffIdFilter: string | null
}

// 구간 이름에 쉬운 뜻을 붙인다.
const BUCKET_LABELS: Record<string, string> = {
  '0-1': '0~1% · 조용함',
  '1-2': '1~2% · 보통 이하',
  '2-4': '2~4% · 보통',
  '4-8': '4~8% · 좋음',
  '8+': '8% 이상 · 매우 좋음'
}

export default function EngagementPage() {
  const me = useV3Me()
  const { toast, showError } = useToast()
  const [data, setData] = useState<EngagementResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [staffId, setStaffId] = useState('')

  const load = useCallback(
    async (filter: string) => {
      setLoading(true)
      try {
        const qs = filter ? `?staffId=${filter}` : ''
        const { ok, data } = await authedFetchJson<EngagementResponse>(`/api/v3/engagement${qs}`)
        if (!ok) {
          const message = (data as any)?.error || '참여 현황을 불러오지 못했습니다.'
          setLoadError(message)
          showError(message)
          return
        }
        setLoadError(null)
        setData(data)
      } finally {
        setLoading(false)
      }
    },
    [showError]
  )

  useEffect(() => {
    void load(staffId)
  }, [staffId, load])

  const isAdmin = !!me?.isAdmin
  const staffName = data?.staffOptions.find((s) => s.id === staffId)?.name
  const scope = staffName ? `${staffName}님의` : isAdmin ? '팀' : '내'

  const header = (
    <PageHeader
      icon="💬"
      title="참여 현황"
      subtitle="시청자가 좋아요·댓글로 얼마나 반응하는지 한눈에 봅니다."
      actions={
        isAdmin && data?.staffOptions?.length ? (
          <select className="select" aria-label="보는 범위" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">전체 팀</option>
            {data.staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null
      }
    />
  )

  if (!data) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        {loadError ? <ErrorBlock message={loadError} onRetry={() => void load(staffId)} /> : <LoadingBlock>참여 현황을 불러오는 중이에요…</LoadingBlock>}
      </>
    )
  }

  if (data.videoCount === 0) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        <EmptyBlock title={`아직 ${scope} 반응을 분석할 영상이 없어요`} actionHref="/v3/register" actionLabel="영상 등록하러 가기">
          영상을 등록하고 유튜브 조회수가 잡히면, 좋아요·댓글 반응이 어떤지 여기에 보여드려요. (조회수가 0인 영상은 계산에서 빠져요)
        </EmptyBlock>
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
    headline = `이번 주 영상은 보는 사람 100명 중 약 ${thisWeek.current.toFixed(1)}명이 좋아요나 댓글로 반응했어요.`
    if (weekChange !== null) {
      tone = change.tone
      headline += ` ${change.text}.`
    }
  } else {
    headline = `이번 주에 올린 영상이 아직 없어요. 지금까지 영상 전체로는 보는 사람 100명 중 약 ${overall.toFixed(1)}명이 반응했어요.`
  }

  const buckets = data.distribution.map((b) => ({ ...b, label: BUCKET_LABELS[b.key] || b.label }))
  const biggest = [...data.distribution].sort((a, b) => b.count - a.count)[0]
  const bucketSentence =
    biggest && biggest.count > 0
      ? `${scope} 영상 중 ${formatNumber(biggest.count)}개(${Math.round((biggest.count / data.videoCount) * 100)}%)가 ‘${BUCKET_LABELS[biggest.key] || biggest.label}’ 구간에 모여 있어요.`
      : null

  return (
    <>
      {header}
      <Toast toast={toast} />

      <div className={`v3a-stack ${loading ? 'v3a-dim' : ''}`}>
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
            label="이번 주 반응률"
            value={thisWeekCount > 0 ? formatPct(thisWeek.current, 2) : '—'}
            hint="이번 주 올린 영상에서 조회수 대비 좋아요+댓글이 차지하는 비율이에요. 높을수록 반응이 좋아요."
            delta={thisWeekCount > 0 && weekChange !== null ? change.text : thisWeekCount > 0 ? '지난주 영상이 없어 비교하지 않았어요' : '이번 주 영상 없음'}
            tone={thisWeekCount > 0 ? change.tone : 'neutral'}
          />
          <StatCard label="전체 평균 반응률" value={formatPct(overall, 2)} hint="지금까지 영상 전체의 평균이에요. 이번 주 값과 비교해 보세요." />
          <StatCard
            label="댓글 반응률"
            value={formatPct(data.kpis.avgCommentRatePct.current, 2)}
            hint="조회수 대비 댓글 비율이에요. 댓글은 좋아요보다 남기기 어려워서, 높으면 팬이 생기고 있다는 신호예요."
          />
        </StatGrid>
        <p className="v3a-note">분석 대상: 조회수가 있는 영상 {formatNumber(data.videoCount)}개 (조회수 0인 영상은 제외)</p>

        <span id="v3a-top-comment" />
        <Section title="댓글 반응이 특히 뜨거운 영상 Top 5" description="조회수 대비 댓글이 많은 영상이에요 (조회수 100회 이상). 이런 영상은 후속편이나 같은 종목 영상을 만들기 좋아요.">
          {data.topComment.length === 0 ? (
            <EmptyBlock title="아직 보여드릴 영상이 없어요">조회수가 100회를 넘는 영상이 생기면 댓글 반응이 뜨거운 순서대로 5개를 보여드려요.</EmptyBlock>
          ) : (
            <div className="v3a-list">
              {data.topComment.map((row, index) => (
                <div className="v3a-row" key={row.id}>
                  <span className="v3-rank">{index + 1}</span>
                  <div className="v3a-row-title" title={row.label}>
                    {row.youtubeUrl ? (
                      <a className="v3-link" href={row.youtubeUrl} target="_blank" rel="noreferrer">
                        {row.label}
                      </a>
                    ) : (
                      row.label
                    )}
                    {row.sub ? <Tag tone="blue">{row.sub}</Tag> : null}
                  </div>
                  <div className="v3a-row-value">
                    {formatPct(row.value, 2)}
                    <small>100명 중 약 {row.value.toFixed(1)}명이 댓글</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="영상 대부분은 반응이 어느 정도인가요?" description={bucketSentence || '영상마다 반응률을 구해 구간별로 몇 개씩 있는지 보여줘요.'}>
          <HistogramBars buckets={buckets} />
        </Section>

        <HowTo title="좋아요와 댓글을 영상별로 자세히 보기 (선택)">
          <p>점 하나가 영상 하나예요. 오른쪽일수록 좋아요가 많고, 위쪽일수록 댓글이 많아요. 보라색 점은 좋아요보다 댓글이 상대적으로 활발한 영상이에요. 점 위에 마우스를 올리면 제목이 보여요.</p>
          <ScatterGrid points={data.scatter} />
        </HowTo>

        <HowTo>
          <p>반응률 = (좋아요 + 댓글) ÷ 조회수 × 100</p>
          <p>댓글 반응률 = 댓글 ÷ 조회수 × 100</p>
          <p>이번 주 = 최근 7일 안에 등록한 영상, 지난주 = 그 이전 7일 안에 등록한 영상이에요.</p>
          <p>구간별 개수는 영상마다 구한 반응률을 0~1%, 1~2%, 2~4%, 4~8%, 8% 이상으로 나눠 센 값이에요.</p>
        </HowTo>
      </div>
    </>
  )
}
