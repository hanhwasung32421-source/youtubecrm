'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { ProgressRing, ShareBar, TimelineChart } from '@/components/v4/charts'
import { EmptyState, KpiCard, PeriodToggle, SampleBanner } from '@/components/v4/ui'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import type { DailyPoint, Kpis, PeriodDays } from '@/lib/v4/analytics'
import { fmtCompact, fmtNumber, fmtPercent, fmtRelative } from '@/lib/v4/format'
import { buildInsight } from './insight'

type FeedItem = {
  id: string
  title: string
  stockName: string
  ownerName: string
  contentType: string
  viewCount: number
  createdAt: string
  thumbnailUrl: string | null
  youtubeUrl: string
}

type DashboardResponse = {
  scope: 'admin' | 'staff'
  period: PeriodDays
  range: { start: string; end: string }
  staffCount: number
  targetPerDay: number
  kpis: Kpis
  // API가 지난 기간 값을 함께 주면 한 줄 요약이 그것과 비교한다 (없어도 동작).
  previousKpis?: Kpis | null
  daily: DailyPoint[]
  feed: FeedItem[]
  lastSyncedAt: string | null
  goal: {
    month: string
    scope: 'team' | 'user' | 'derived' | 'none'
    targetVideos: number
    targetViews: number
    actualVideos: number
    actualViews: number
    teamGoal: { targetVideos: number; targetViews: number } | null
    sample: boolean
  }
  error?: string
}

const GOAL_SCOPE_LABEL: Record<DashboardResponse['goal']['scope'], string> = {
  team: '팀 목표',
  user: '개인 목표',
  derived: '팀 목표를 인원수로 나눈 값',
  none: '목표 미설정'
}

const STALE_HOURS = 24

export default function GrowthDashboardPage() {
  const { isAdmin } = useV4Me()
  const { toast, showSuccess, showError } = useToast()
  const [period, setPeriod] = useState<PeriodDays>(30)
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [goalVideos, setGoalVideos] = useState('')
  const [goalViews, setGoalViews] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)

  const load = useCallback(
    async (days: PeriodDays) => {
      setLoading(true)
      const { ok, data: res } = await authedFetchJson<DashboardResponse>(`/api/v4/dashboard?period=${days}`)
      setLoading(false)
      if (!ok || res?.error) {
        showError(res?.error || '성장 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
      setData(res)
      if (res.goal.teamGoal) {
        setGoalVideos(String(res.goal.teamGoal.targetVideos))
        setGoalViews(String(res.goal.teamGoal.targetViews))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(() => {
    void load(period)
  }, [period, load])

  const syncStats = async () => {
    if (syncing) return
    setSyncing(true)
    const { ok, data: res } = await authedPostJson<{ updated: number; failed: number; total: number; error?: string }>('/api/v4/sync-stats', {})
    setSyncing(false)
    if (!ok || res?.error) {
      showError(res?.error || '조회수를 새로 받지 못했어요. 잠시 후 다시 시도해 주세요.')
      return
    }
    showSuccess(`영상 ${fmtNumber(res.total)}개 중 ${fmtNumber(res.updated)}개의 조회수를 새로 받았어요.${res.failed ? ` (실패 ${res.failed}개)` : ''}`)
    void load(period)
  }

  const saveGoal = async () => {
    if (!data || savingGoal) return
    setSavingGoal(true)
    const { ok, data: res } = await authedPostJson<{ error?: string }>('/api/v4/goals', {
      month: data.goal.month,
      userId: null,
      targetVideos: Number(goalVideos || 0),
      targetViews: Number(goalViews || 0)
    })
    setSavingGoal(false)
    if (!ok || res?.error) {
      showError(res?.error || '목표를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
      return
    }
    showSuccess('이번 달 팀 목표를 저장했어요.')
    void load(period)
  }

  const kpis = data?.kpis
  const goal = data?.goal
  const videoRatio = goal && goal.targetVideos > 0 ? goal.actualVideos / goal.targetVideos : 0
  const viewRatio = goal && goal.targetViews > 0 ? goal.actualViews / goal.targetViews : 0
  const perDay = data && kpis ? kpis.videoCount / data.period : 0
  const insight = data && kpis ? buildInsight({ days: data.period, scope: data.scope, kpis, daily: data.daily, targetPerDay: data.targetPerDay, previousKpis: data.previousKpis }) : null

  const staleHours = data?.lastSyncedAt ? (Date.now() - new Date(data.lastSyncedAt).getTime()) / 3600000 : null
  const syncStale = Boolean(data) && (staleHours === null || staleHours > STALE_HOURS)

  const goalSummary =
    goal && goal.scope !== 'none'
      ? `영상 ${Math.round(videoRatio * 100)}% · 조회수 ${Math.round(viewRatio * 100)}% 달성`
      : '아직 목표가 없어요'

  return (
    <>
      <PageHeader
        title="성장 현황"
        subtitle={
          data
            ? `${data.range.start} ~ ${data.range.end} · ${data.scope === 'admin' ? `직원 ${fmtNumber(data.staffCount)}명 전체` : '내 영상'} 기준`
            : '조회수와 업로드가 어떻게 흘러가는지, 지금 무엇을 봐야 하는지 한눈에 봅니다.'
        }
        actions={<PeriodToggle value={period} onChange={setPeriod} disabled={loading} />}
      />
      <Toast toast={toast} />

      {/* 1) 한 줄 요약 + 다음에 볼 곳 */}
      <section className={`panel v4-hero tone-${insight?.tone || 'neutral'}`} aria-live="polite">
        {insight ? (
          <>
            <div className="v4-hero-kicker">한눈에 요약</div>
            <p className="v4-hero-headline">{insight.headline}</p>
            {insight.detail ? <p className="v4-hero-detail">{insight.detail}</p> : null}
            <div className="v4-hero-next">
              <Link className="button" href={insight.next.href}>
                {insight.next.label}
              </Link>
              <span className="v4-hero-why">{insight.next.why}</span>
            </div>
          </>
        ) : (
          <>
            <div className="v4-hero-kicker">한눈에 요약</div>
            <p className="v4-hero-headline muted">{loading ? '불러오는 중이에요…' : '요약을 불러오지 못했어요.'}</p>
            {!loading ? (
              <div className="v4-hero-next">
                <button className="button secondary" onClick={() => void load(period)}>
                  다시 불러오기
                </button>
              </div>
            ) : null}
          </>
        )}
        {data ? (
          <div className={`v4-hero-sync ${syncStale ? 'stale' : ''}`}>
            <span>
              조회수 기준 시각:{' '}
              {data.lastSyncedAt ? fmtRelative(data.lastSyncedAt) : '아직 받은 적 없음'}
              {syncStale ? ' · 오래됐어요' : ''}
            </span>
            {isAdmin ? (
              <button className="button secondary v4-mini" onClick={syncStats} disabled={syncing || loading} title="유튜브에서 모든 영상의 최신 조회수·좋아요·댓글을 다시 가져옵니다">
                {syncing ? '받는 중…' : '유튜브에서 최신 조회수 받기'}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 2) 핵심 숫자 4개 — 각각 "그래서 무슨 뜻인지" 한 줄 */}
      <div className="grid grid-4">
        <KpiCard title="총 조회수" value={fmtNumber(kpis?.totalViews)} meta={`영상 1개당 평균 ${fmtNumber(kpis?.avgViews)}회 봤어요`} tone="indigo" />
        <KpiCard
          title="올린 영상"
          value={`${fmtNumber(kpis?.videoCount)}개`}
          meta={data ? `하루 평균 ${perDay.toFixed(1)}개 · 하루 목표 ${fmtNumber(data.targetPerDay)}개` : '하루 평균 -'}
          tone="emerald"
        />
        <KpiCard
          title="좋아요 비율"
          value={fmtPercent(kpis?.likeRate, 1)}
          meta={kpis ? `조회 100번 중 ${(kpis.likeRate * 100).toFixed(1)}번 좋아요` : '조회 100번 중 -번 좋아요'}
          tone="amber"
        />
        <KpiCard
          title="댓글 비율"
          value={fmtPercent(kpis?.commentRate, 2)}
          meta={kpis ? `조회 1,000번 중 ${(kpis.commentRate * 1000).toFixed(1)}번 댓글` : '조회 1,000번 중 -번 댓글'}
          tone="rose"
        />
      </div>

      {/* 3) 하루하루의 흐름 */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">하루하루의 흐름</div>
            <p className="panel-subtitle">막대는 그날 올린 영상 수, 선은 그 영상들이 지금까지 받은 조회수 합계, 점선은 하루 목표예요.</p>
          </div>
        </div>
        {data ? (
          kpis && kpis.videoCount > 0 ? (
            <>
              <TimelineChart points={data.daily} target={data.targetPerDay} />
              <div className="v4-share-row">
                <div className="card-title">롱폼 · 숏폼 비중</div>
                <ShareBar a={kpis.longformCount} b={kpis.shortformCount} />
              </div>
            </>
          ) : (
            <EmptyState
              title="이 기간에 올린 영상이 없어요"
              action={
                <Link className="button" href="/v4/register">
                  영상 등록하러 가기
                </Link>
              }
            >
              영상을 등록하면 날마다 올린 개수와 조회수가 여기에 그려집니다. 기간을 넓혀 보는 것도 방법이에요.
            </EmptyState>
          )
        ) : (
          <div className="small muted">불러오는 중…</div>
        )}
      </div>

      {/* 4) 최근 등록 영상 */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">방금 올라온 영상</div>
            <p className="panel-subtitle">가장 최근에 등록된 영상 20개예요. 제목을 누르면 유튜브에서 열립니다.</p>
          </div>
          <Link className="button secondary v4-mini" href="/v4/ranking">
            성과 순위 보기
          </Link>
        </div>
        {data && data.feed.length === 0 ? (
          <EmptyState
            title="아직 등록된 영상이 없어요"
            action={
              <Link className="button" href="/v4/register">
                첫 영상 등록하기
              </Link>
            }
          >
            영상이 등록되면 이곳에 최신순으로 쌓입니다.
          </EmptyState>
        ) : null}
        {data && data.feed.length > 0 ? (
          <div className="v4-feed">
            {data.feed.map((item) => (
              <div className={`v4-feed-item ${item.contentType === 'shortform' ? 'short' : ''}`} key={item.id}>
                {item.thumbnailUrl ? (
                  <img className="v4-thumb" src={item.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <div className="v4-thumb-placeholder">썸네일 없음</div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="v4-feed-title">
                    {item.youtubeUrl ? (
                      <a href={item.youtubeUrl} target="_blank" rel="noopener noreferrer">
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </div>
                  <div className="v4-feed-meta">
                    <span>종목 {item.stockName}</span>
                    {data.scope === 'admin' ? <span>담당 {item.ownerName}</span> : null}
                    <span>{item.contentType === 'shortform' ? '숏폼' : '롱폼'}</span>
                  </div>
                </div>
                <div className="v4-feed-right">
                  <strong>{fmtNumber(item.viewCount)}회</strong>
                  {fmtRelative(item.createdAt)}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* 5) 이번 달 목표 — 평소엔 접어 두고, 필요할 때 펼쳐 본다 */}
      <details className="panel v4-goal">
        <summary>
          <span className="v4-goal-title">{goal?.month || '이번 달'} 목표</span>
          <span className="v4-goal-summary">{goalSummary}</span>
        </summary>
        <div className="v4-goal-body">
          <SampleBanner show={Boolean(goal?.sample)} what="이번 달 목표" />
          {goal && goal.scope !== 'none' ? (
            <>
              <p className="small muted">{GOAL_SCOPE_LABEL[goal.scope]} 기준으로, 이번 달 1일부터 오늘까지 얼마나 채웠는지 보여줘요.</p>
              <div className="v4-ring-row">
                <ProgressRing value={videoRatio} label="영상 수" sublabel={`${fmtNumber(goal.actualVideos)} / ${fmtNumber(goal.targetVideos)}개`} />
                <ProgressRing value={viewRatio} label="조회수" sublabel={`${fmtCompact(goal.actualViews)} / ${fmtCompact(goal.targetViews)}`} color="#10b981" />
              </div>
            </>
          ) : (
            <EmptyState title="이번 달 목표가 아직 없어요">
              {isAdmin ? '아래에서 팀 목표를 정하면 달성률이 여기에 표시됩니다.' : '관리자가 팀 목표를 정하면 나에게 맞게 나눈 목표가 표시됩니다.'}
            </EmptyState>
          )}

          {isAdmin && data ? (
            <div className="v4-goal-edit">
              <div className="panel-title">팀 목표 정하기</div>
              <p className="small muted">팀 전체가 이번 달에 달성할 영상 수와 조회수예요. 직원 화면에는 인원수로 나눈 값이 보입니다.</p>
              <div className="v4-goal-form">
                <div className="field">
                  <label className="label" htmlFor="v4-goal-videos">
                    목표 영상 수 (개)
                  </label>
                  <input id="v4-goal-videos" className="input" type="number" min={0} inputMode="numeric" value={goalVideos} onChange={(e) => setGoalVideos(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="v4-goal-views">
                    목표 조회수 (회)
                  </label>
                  <input id="v4-goal-views" className="input" type="number" min={0} inputMode="numeric" value={goalViews} onChange={(e) => setGoalViews(e.target.value)} />
                </div>
                <button className="button" onClick={saveGoal} disabled={savingGoal}>
                  {savingGoal ? '저장 중…' : '목표 저장'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </>
  )
}
