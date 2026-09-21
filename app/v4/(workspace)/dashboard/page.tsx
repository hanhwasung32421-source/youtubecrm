'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { ProgressRing, ShareBar, TimelineChart } from '@/components/v4/charts'
import { EmptyState, KpiCard, PeriodToggle, SampleBanner } from '@/components/v4/ui'
import { ChartSkeleton, HeroSkeleton, KpiSkeleton, ListSkeleton } from '@/components/v4/skeleton'
import { clearDashboardCache, dashboardCache, dashboardKey } from '@/components/v4/dashboard-cache'
import { computeDelta } from '@/components/v4/delta'
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
  previousRange?: { start: string; end: string } | null
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
  const { me, isAdmin } = useV4Me()
  const userId = me?.crmUserId || ''
  const { toast, showSuccess, showError } = useToast()
  const [period, setPeriod] = useState<PeriodDays>(30)
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [fetching, setFetching] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [goalVideos, setGoalVideos] = useState('')
  const [goalViews, setGoalViews] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef(0)
  const goalDirtyRef = useRef(false)

  const applyGoalInputs = useCallback((res: DashboardResponse) => {
    // 관리자가 고치는 중인 칸은 새로 받은 값으로 덮어쓰지 않는다.
    if (goalDirtyRef.current) return
    if (res.goal.teamGoal) {
      setGoalVideos(String(res.goal.teamGoal.targetVideos))
      setGoalViews(String(res.goal.teamGoal.targetViews))
    }
  }, [])

  // 기간별 응답을 60초 동안 기억한다: 있으면 바로 보여 주고, 오래됐으면 화면은 그대로 둔 채 뒤에서 새로 받는다.
  // 기간을 빠르게 바꾸면 이전 요청은 취소하고 마지막 요청만 반영한다.
  const load = useCallback(
    async (days: PeriodDays, force = false) => {
      const key = dashboardKey(userId, days)
      const cached = dashboardCache.get(key)
      if (cached) {
        setData(cached.value as DashboardResponse)
        setLoadError('')
        applyGoalInputs(cached.value as DashboardResponse)
        if (cached.fresh && !force) {
          abortRef.current?.abort()
          setFetching(false)
          return
        }
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const requestId = ++requestRef.current
      setFetching(true)
      setLoadError('')
      try {
        const { ok, data: res } = await authedFetchJson<DashboardResponse>(`/api/v4/dashboard?period=${days}`, { signal: controller.signal })
        if (requestId !== requestRef.current) return
        if (!ok || res?.error) {
          const message = res?.error || '성장 현황을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
          if (!cached) setLoadError(message)
          showError(message)
          return
        }
        dashboardCache.set(key, res)
        setData(res)
        applyGoalInputs(res)
      } catch (e: any) {
        if (e?.name === 'AbortError' || requestId !== requestRef.current) return
        const message = '인터넷 연결을 확인하고 다시 시도해 주세요.'
        if (!cached) setLoadError(message)
        showError(message)
      } finally {
        if (requestId === requestRef.current) setFetching(false)
      }
    },
    // showError 는 렌더마다 새로 만들어지지만 동작은 같다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, applyGoalInputs]
  )

  useEffect(() => {
    void load(period)
  }, [period, load])

  useEffect(() => () => abortRef.current?.abort(), [])

  // 화면에 그릴 값: 고른 기간과 같은 기간의 응답만 쓴다 (다른 기간 숫자가 잠깐 비치지 않게).
  const view = data && data.period === period ? data : null
  const loading = !view && !loadError

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
    clearDashboardCache(userId)
    void load(period, true)
  }

  const saveGoal = async () => {
    if (!view || savingGoal) return
    setSavingGoal(true)
    const { ok, data: res } = await authedPostJson<{ error?: string }>('/api/v4/goals', {
      month: view.goal.month,
      userId: null,
      targetVideos: Number(goalVideos || 0),
      targetViews: Number(goalViews || 0)
    })
    setSavingGoal(false)
    if (!ok || res?.error) {
      showError(res?.error || '목표를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
      return
    }
    goalDirtyRef.current = false
    showSuccess('이번 달 팀 목표를 저장했어요.')
    clearDashboardCache(userId)
    void load(period, true)
  }

  const kpis = view?.kpis
  const prev = view?.previousKpis || null
  const goal = view?.goal
  const videoRatio = goal && goal.targetVideos > 0 ? goal.actualVideos / goal.targetVideos : 0
  const viewRatio = goal && goal.targetViews > 0 ? goal.actualViews / goal.targetViews : 0
  const perDay = view && kpis ? kpis.videoCount / view.period : 0
  const insight = view && kpis ? buildInsight({ days: view.period, scope: view.scope, kpis, daily: view.daily, targetPerDay: view.targetPerDay, previousKpis: view.previousKpis }) : null

  // 지난 기간 대비 칩: 지난 기간 값이 없으면 칩을 아예 보이지 않는다.
  const deltas = useMemo(() => {
    if (!view || !kpis || !prev) return null
    const days = view.period
    return {
      views: computeDelta(kpis.totalViews, prev.totalViews, days),
      videos: computeDelta(kpis.videoCount, prev.videoCount, days),
      likes: computeDelta(kpis.likeRate, prev.likeRate, days),
      comments: computeDelta(kpis.commentRate, prev.commentRate, days)
    }
  }, [view, kpis, prev])
  const compareLabel = view ? `지난 ${view.period}일 대비` : undefined

  const staleHours = view?.lastSyncedAt ? (Date.now() - new Date(view.lastSyncedAt).getTime()) / 3600000 : null
  const syncStale = Boolean(view) && (staleHours === null || staleHours > STALE_HOURS)

  const goalSummary =
    goal && goal.scope !== 'none'
      ? `영상 ${Math.round(videoRatio * 100)}% · 조회수 ${Math.round(viewRatio * 100)}% 달성`
      : '아직 목표가 없어요'

  return (
    <>
      <PageHeader
        title="성장 현황"
        subtitle={
          view
            ? `${view.range.start} ~ ${view.range.end} · ${view.scope === 'admin' ? `직원 ${fmtNumber(view.staffCount)}명 전체` : '내 영상'} 기준`
            : '조회수와 업로드가 어떻게 흘러가는지, 지금 무엇을 봐야 하는지 한눈에 봅니다.'
        }
        actions={<PeriodToggle value={period} onChange={setPeriod} />}
      />
      <Toast toast={toast} />

      {/* 1) 한 줄 요약 + 다음에 볼 곳 */}
      <section className={`panel v4-hero tone-${insight?.tone || 'neutral'}`} aria-live="polite" aria-busy={loading || undefined} aria-label="한눈에 요약">
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
        ) : loadError ? (
          <>
            <div className="v4-hero-kicker">한눈에 요약</div>
            <p className="v4-hero-headline muted" role="alert">
              요약을 불러오지 못했어요. {loadError}
            </p>
            <div className="v4-hero-next">
              <button type="button" className="button secondary" onClick={() => void load(period, true)}>
                다시 불러오기
              </button>
            </div>
          </>
        ) : (
          <HeroSkeleton />
        )}
        {view ? (
          <div className={`v4-hero-sync ${syncStale ? 'stale' : ''}`}>
            <span>
              조회수 기준 시각:{' '}
              {view.lastSyncedAt ? fmtRelative(view.lastSyncedAt) : '아직 받은 적 없음'}
              {syncStale ? ' · 오래됐어요' : ''}
              {fetching ? ' · 새로 확인하는 중…' : ''}
            </span>
            {isAdmin ? (
              <button type="button" className="button secondary v4-mini" onClick={syncStats} disabled={syncing || fetching} title="유튜브에서 모든 영상의 최신 조회수·좋아요·댓글을 다시 가져옵니다">
                {syncing ? '받는 중…' : '유튜브에서 최신 조회수 받기'}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 2) 핵심 숫자 4개 — 각각 "그래서 무슨 뜻인지" 한 줄 + 지난 기간 대비 */}
      {view && kpis ? (
        <div className="grid grid-4">
          <KpiCard title="총 조회수" value={fmtNumber(kpis.totalViews)} meta={`영상 1개당 평균 ${fmtNumber(kpis.avgViews)}회 봤어요`} tone="indigo" delta={deltas?.views} compareLabel={compareLabel} />
          <KpiCard
            title="올린 영상"
            value={`${fmtNumber(kpis.videoCount)}개`}
            meta={`하루 평균 ${perDay.toFixed(1)}개 · 하루 목표 ${fmtNumber(view.targetPerDay)}개`}
            tone="emerald"
            delta={deltas?.videos}
            compareLabel={compareLabel}
          />
          <KpiCard
            title="좋아요 비율"
            value={fmtPercent(kpis.likeRate, 1)}
            meta={`조회 100번 중 ${(kpis.likeRate * 100).toFixed(1)}번 좋아요`}
            tone="amber"
            delta={deltas?.likes}
            compareLabel={compareLabel}
          />
          <KpiCard
            title="댓글 비율"
            value={fmtPercent(kpis.commentRate, 2)}
            meta={`조회 1,000번 중 ${(kpis.commentRate * 1000).toFixed(1)}번 댓글`}
            tone="rose"
            delta={deltas?.comments}
            compareLabel={compareLabel}
          />
        </div>
      ) : loadError ? null : (
        <SkeletonKpis />
      )}

      {/* 3) 하루하루의 흐름 */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">하루하루의 흐름</div>
            <p className="panel-subtitle">막대는 그날 올린 영상 수, 선은 그 영상들이 지금까지 받은 조회수 합계, 점선은 하루 목표예요.</p>
          </div>
        </div>
        {view ? (
          kpis && kpis.videoCount > 0 ? (
            <>
              <TimelineChart points={view.daily} target={view.targetPerDay} />
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
        ) : loadError ? (
          <div className="small muted">불러오지 못해서 그래프를 그릴 수 없어요. 위의 &quot;다시 불러오기&quot;를 눌러 주세요.</div>
        ) : (
          <ChartSkeleton height={230} />
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
        {!view && !loadError ? <ListSkeleton rows={6} thumb /> : null}
        {view && view.feed.length === 0 ? (
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
        {view && view.feed.length > 0 ? (
          <ul className="v4-feed">
            {view.feed.map((item) => (
              <li className={`v4-feed-item ${item.contentType === 'shortform' ? 'short' : ''}`} key={item.id}>
                {item.thumbnailUrl ? (
                  <img className="v4-thumb" src={item.thumbnailUrl} alt="" loading="lazy" width={72} height={42} />
                ) : (
                  <div className="v4-thumb-placeholder" aria-hidden="true">
                    썸네일 없음
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="v4-feed-title">
                    {item.youtubeUrl ? (
                      <a href={item.youtubeUrl} target="_blank" rel="noopener noreferrer" title={item.title}>
                        {item.title}
                      </a>
                    ) : (
                      item.title
                    )}
                  </div>
                  <div className="v4-feed-meta">
                    <span>종목 {item.stockName}</span>
                    {view.scope === 'admin' ? <span>담당 {item.ownerName}</span> : null}
                    <span>{item.contentType === 'shortform' ? '숏폼' : '롱폼'}</span>
                  </div>
                </div>
                <div className="v4-feed-right">
                  <strong>{fmtNumber(item.viewCount)}회</strong>
                  {fmtRelative(item.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 5) 이번 달 목표 — 평소엔 접어 두고, 필요할 때 펼쳐 본다 */}
      <details className="panel v4-goal">
        <summary>
          <span className="v4-goal-title">{goal?.month || '이번 달'} 목표</span>
          <span className="v4-goal-summary">{view ? goalSummary : ''}</span>
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
          ) : view ? (
            <EmptyState title="이번 달 목표가 아직 없어요">
              {isAdmin ? '아래에서 팀 목표를 정하면 달성률이 여기에 표시됩니다.' : '관리자가 팀 목표를 정하면 나에게 맞게 나눈 목표가 표시됩니다.'}
            </EmptyState>
          ) : (
            <div className="small muted">{loadError ? '목표를 불러오지 못했어요.' : '불러오는 중…'}</div>
          )}

          {isAdmin && view ? (
            <form
              className="v4-goal-edit"
              onSubmit={(e) => {
                e.preventDefault()
                void saveGoal()
              }}
            >
              <div className="panel-title">팀 목표 정하기</div>
              <p className="small muted">팀 전체가 이번 달에 달성할 영상 수와 조회수예요. 직원 화면에는 인원수로 나눈 값이 보입니다.</p>
              <div className="v4-goal-form">
                <div className="field">
                  <label className="label" htmlFor="v4-goal-videos">
                    목표 영상 수 (개)
                  </label>
                  <input
                    id="v4-goal-videos"
                    className="input"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    autoComplete="off"
                    value={goalVideos}
                    onChange={(e) => {
                      goalDirtyRef.current = true
                      setGoalVideos(e.target.value)
                    }}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="v4-goal-views">
                    목표 조회수 (회)
                  </label>
                  <input
                    id="v4-goal-views"
                    className="input"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    autoComplete="off"
                    value={goalViews}
                    onChange={(e) => {
                      goalDirtyRef.current = true
                      setGoalViews(e.target.value)
                    }}
                  />
                </div>
                <button type="submit" className="button" disabled={savingGoal}>
                  {savingGoal ? '저장 중…' : '목표 저장'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </details>
    </>
  )
}

function SkeletonKpis() {
  return (
    <div className="grid grid-4" role="status" aria-busy="true">
      <span className="v4-sr">숫자를 불러오는 중</span>
      <KpiSkeleton />
      <KpiSkeleton />
      <KpiSkeleton />
      <KpiSkeleton />
    </div>
  )
}
