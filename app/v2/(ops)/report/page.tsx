'use client'

import { useEffect, useMemo, useState } from 'react'
import { AdminOnly } from '@/components/v2/auth-guard'
import { PageHeader } from '@/components/v2/app-shell'
import { ContentTypeTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { Answer, EmptyGuide, HowTo, Kpi, KpiRow, LoadError, LoadingLine, MoreButton, SampleNote } from '@/lib/v2/analysis-ui'
import { v2Get } from '@/lib/v2/client'
import { readRemembered, useRememberedState } from '@/lib/v2/use-remembered'
import { formatKstDate } from '@/lib/v2/dates'
import { formatCount, shortText } from '@/lib/v2/format'
import { LIKE_RATE_TARGET, VIEW_VELOCITY_TARGET_PER_DAY, type DiscoverabilityRow, type ReportPayload } from '@/lib/v2/types'

const EMPTY: ReportPayload = { items: [], insight: '' }
const PAGE_STEP = 20
const PERIODS = ['week', 'all'] as const
const ORDERS = ['best', 'worst'] as const
const LOAD_ERROR = '성과 요약을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function scoreTone(score: number) {
  if (score >= 70) return 'high'
  if (score >= 40) return ''
  return 'low'
}

function scoreWord(score: number) {
  if (score >= 70) return { text: '좋음', cls: 'high' }
  if (score >= 40) return { text: '보통', cls: 'mid' }
  return { text: '낮음', cls: 'low' }
}

function likePercent(row: DiscoverabilityRow) {
  const views = row.video.view_count || 0
  return views > 0 ? ((row.video.like_count || 0) / views) * 100 : 0
}

function ReportBody() {
  const { toast } = useToast()
  const [payload, setPayload] = useState<ReportPayload>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [period, setPeriod] = useRememberedState<'week' | 'all'>('rep.period', 'week', PERIODS)
  const [order, setOrder] = useRememberedState<'best' | 'worst'>('rep.order', 'best', ORDERS)
  const [owner, setOwner] = useRememberedState<string>('rep.owner', '')
  const [visible, setVisible] = useState(PAGE_STEP)

  const load = async () => {
    const res = await v2Get<ReportPayload>('/api/v2/report', LOAD_ERROR)
    setLoaded(true)
    if (!res.ok) {
      setLoadError(res.error)
      return
    }
    setLoadError('')
    setPayload(res.data)
    // 저장해 둔 기간이 없고 최근 7일에 등록·발행된 영상도 없으면 처음부터 전체를 보여준다.
    if (readRemembered('rep.period') === null) {
      const since = Date.now() - WEEK_MS
      const hasRecent = res.data.items.some((row) => new Date(row.video.published_at || row.video.created_at).getTime() >= since)
      if (!hasRecent) setPeriod('all')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const all = payload.items
  const recent = useMemo(() => {
    const since = Date.now() - WEEK_MS
    return all.filter((row) => new Date(row.video.published_at || row.video.created_at).getTime() >= since)
  }, [all])

  const owners = useMemo(() => [...new Set(all.map((row) => row.ownerName).filter((name) => name && name !== '-'))].sort((a, b) => a.localeCompare(b, 'ko')), [all])

  const pool = period === 'week' ? recent : all
  // 저장해 둔 담당자가 지금 목록에 없으면 전체로 본다.
  const ownerNow = owners.includes(owner) ? owner : ''
  const scoped = ownerNow ? pool.filter((row) => row.ownerName === ownerNow) : pool
  const list = order === 'best' ? scoped : [...scoped].reverse()
  const shown = list.slice(0, visible)

  // 요약 숫자는 담당자 필터와 상관없이 "보는 기간" 전체 기준
  const good = pool.filter((row) => row.score >= 70).length
  const weak = pool.filter((row) => row.score < 40).length
  const avgViewsPerDay = pool.length > 0 ? pool.reduce((sum, row) => sum + row.viewsPerDay, 0) / pool.length : 0

  const headlineRow = recent[0] || all[0]
  const headlineIsRecent = recent.length > 0

  const pick = <T,>(setter: (v: T) => void, value: T) => {
    setter(value)
    setVisible(PAGE_STEP)
  }

  return (
    <>
      <PageHeader title="성과 요약" subtitle="어떤 영상과 담당자가 검색·조회에서 잘 되고 있는지 순위로 보여줍니다." />
      <Toast toast={toast} />
      <SampleNote show={payload.sample} />
      {loaded && loadError ? <LoadError message={loadError} onRetry={() => void load()} /> : null}

      {!loaded ? (
        <LoadingLine />
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
                  하루 평균 {Math.round(headlineRow.viewsPerDay).toLocaleString('ko-KR')}회 조회 · 반응 점수 {headlineRow.score}점 (100점 만점)
                </span>
              </>
            ) : null}
          </Answer>

          <KpiRow>
            <Kpi label="반응이 좋은 영상" value={good.toLocaleString('ko-KR')} unit="개" tone={good > 0 ? 'good' : 'neutral'} hint="반응 점수가 70점 이상인 영상 수예요." />
            <Kpi label="손봐야 할 영상" value={weak.toLocaleString('ko-KR')} unit="개" tone={weak > 0 ? 'bad' : 'good'} hint="반응 점수가 40점 미만이라 제목·썸네일 점검이 필요한 영상이에요." />
            <Kpi label="영상 1개당 하루 조회" value={formatCount(avgViewsPerDay)} unit="회" hint={`${period === 'week' ? '최근 7일' : '전체'} 영상이 하루에 평균 몇 번 조회되는지예요.`} />
          </KpiRow>

          <div className="panel">
            <div className="v2a-toolbar">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <div className="v2-seg" aria-label="기간">
                  <button className={period === 'week' ? 'active' : ''} onClick={() => pick(setPeriod, 'week')}>
                    최근 7일 {recent.length}
                  </button>
                  <button className={period === 'all' ? 'active' : ''} onClick={() => pick(setPeriod, 'all')}>
                    전체 {all.length}
                  </button>
                </div>
                <div className="v2-seg" aria-label="정렬">
                  <button className={order === 'best' ? 'active' : ''} onClick={() => pick(setOrder, 'best')}>
                    잘 된 순
                  </button>
                  <button className={order === 'worst' ? 'active' : ''} onClick={() => pick(setOrder, 'worst')}>
                    손볼 순
                  </button>
                </div>
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

            {payload.capped ? <p className="v2a-note">가장 최근에 등록한 영상 위주로 계산해요. 더 오래된 영상은 순위에 나오지 않을 수 있어요.</p> : null}

            {list.length === 0 ? (
              <EmptyGuide title="이 조건에 맞는 영상이 없어요">
                {period === 'week' ? '위의 ‘전체’ 탭을 누르면 지난 영상도 볼 수 있어요.' : '담당자 선택을 ‘전체’로 바꿔 보세요.'}
              </EmptyGuide>
            ) : (
              <div>
                <div className="v2a-rank head">
                  <div>#</div>
                  <div>영상</div>
                  <div className="num" title="발행 후 하루 평균 조회수예요.">
                    하루 조회
                  </div>
                  <div className="num hide-sm" title="조회한 사람 100명 중 좋아요를 누른 사람 수예요.">
                    좋아요 비율
                  </div>
                  <div className="num hide-sm" title="SEO 체크리스트 4칸 중 완료한 칸 수예요.">
                    점검
                  </div>
                  <div className="num" title="조회·좋아요·점검을 합친 100점 만점 점수예요.">
                    반응 점수
                  </div>
                </div>
                {shown.map((row, index) => {
                  const word = scoreWord(row.score)
                  return (
                    <div className="v2a-rank" key={row.video.id}>
                      <div className="muted">{order === 'best' ? index + 1 : list.length - index}</div>
                      <div className="v2a-rank-title">
                        <div className="t" title={row.video.title || ''}>
                          {row.video.title || '(제목 수집 대기)'}
                        </div>
                        <div className="s">
                          <ContentTypeTag contentType={row.video.content_type} /> {row.video.stock_name} · {row.ownerName} · {formatKstDate(row.video.published_at)}
                        </div>
                      </div>
                      <div className="num" title={`${Math.round(row.viewsPerDay).toLocaleString('ko-KR')}회/일`}>
                        {formatCount(row.viewsPerDay)}회
                      </div>
                      <div className="num hide-sm">{likePercent(row).toFixed(1)}%</div>
                      <div className="num hide-sm">{row.checklistDone}/4</div>
                      <div className="v2a-score">
                        <b>{row.score}</b>
                        <div className="v2-score-bar-track" style={{ width: 48 }}>
                          <div className={`v2-score-bar-fill ${scoreTone(row.score)}`} style={{ width: `${row.score}%` }} />
                        </div>
                        <span className={`v2a-score-word ${word.cls}`}>{word.text}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <MoreButton shown={shown.length} total={list.length} step={PAGE_STEP} onMore={() => setVisible((v) => v + PAGE_STEP)} />

            <HowTo>
              <p>반응 점수(0~100점) = 하루 조회 점수 × 40% + 좋아요 비율 점수 × 30% + SEO 체크리스트 점수 × 30%</p>
              <p>· 하루 조회 점수: 발행 후 하루 평균 조회수 ÷ {VIEW_VELOCITY_TARGET_PER_DAY.toLocaleString('ko-KR')}회 × 100 (최대 100점)</p>
              <p>· 좋아요 비율 점수: 좋아요 수 ÷ 조회수 ÷ {(LIKE_RATE_TARGET * 100).toFixed(0)}% × 100 (최대 100점)</p>
              <p>· SEO 체크리스트 점수: 4칸 중 완료한 칸 수 ÷ 4 × 100</p>
              <p>70점 이상이면 ‘좋음’, 40점 미만이면 ‘낮음’으로 표시해요. 기준 조회수·좋아요 비율은 채널 규모에 맞춰 나중에 조정할 수 있어요.</p>
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
