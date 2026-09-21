'use client'

import '../analysis.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { Tag } from '@/components/v3/ui'
import { LineGrowthChart, type GrowthPoint } from '@/components/v3/charts'
import { useV3Me } from '@/components/v3/auth-guard'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { formatCompactNumber, formatDateTime, formatNumber } from '@/lib/v3/format'
import { AnswerCard, EmptyBlock, ErrorBlock, HowTo, LoadingBlock, MoreButton, useShowMore, type Tone } from '../analysis-parts'

type ListItem = {
  id: string
  title: string
  stockName: string | null
  contentType: 'longform' | 'shortform'
  viewCount: number | null
  publishedAt: string | null
  youtubeUrl: string | null
  snapshotCount: number
}

type ListResponse = { items: ListItem[]; staffOptions: { id: string; name: string }[] }

type Snapshot = { snapshotAt: string; viewCount: number; likeCount: number; commentCount: number; day: number }

type DetailResponse = {
  video: { id: string; title: string; stockName: string | null; contentType: string; youtubeUrl: string | null; publishedAt: string | null; viewCount: number | null; lastSyncedAt: string | null }
  snapshots: Snapshot[]
  enough: boolean
}

function formatSpan(days: number): string {
  if (days >= 1) return `${days.toFixed(1)}일`
  return `${Math.max(Math.round(days * 24), 1)}시간`
}

// 최근 기록 구간의 증가 속도를 "올린 뒤 평균 속도"와 비교해 한 문장으로 답한다.
function summarizeGrowth(snapshots: Snapshot[]): { tone: Tone; headline: string; detail?: string } {
  const last = snapshots[snapshots.length - 1]
  const prev = snapshots[snapshots.length - 2]
  const gain = last.viewCount - prev.viewCount
  const span = last.day - prev.day
  const avgRate = last.viewCount / Math.max(last.day, 1)

  if (span < 0.25) {
    return {
      tone: 'neutral',
      headline: `마지막 두 기록의 간격이 ${formatSpan(span)}뿐이라 아직 ‘크는 중인지’ 말하기 어려워요.`,
      detail: '하루쯤 지난 뒤 통계를 다시 새로고침하면 정확히 알려드려요.'
    }
  }

  const recentRate = Math.max(gain, 0) / span
  const ratio = avgRate > 0 ? recentRate / avgRate : 0
  const gained = `마지막 기록 이후 ${formatSpan(span)} 동안 조회수가 ${formatNumber(Math.max(gain, 0))}회 늘었어요.`
  const detail = `올린 뒤 평균은 하루 ${formatNumber(Math.round(avgRate))}회, 최근에는 하루 ${formatNumber(Math.round(recentRate))}회 속도예요.`

  if (ratio >= 0.7) return { tone: 'good', headline: `아직 잘 크고 있는 영상이에요. ${gained}`, detail }
  if (ratio >= 0.25) return { tone: 'neutral', headline: `성장 속도가 느려지고 있어요. ${gained}`, detail }
  return { tone: 'neutral', headline: `조회수가 거의 멈춘 영상이에요. ${gained}`, detail }
}

export default function LifecyclePage() {
  const me = useV3Me()
  const { toast, showSuccess, showError } = useToast()
  const [staffId, setStaffId] = useState('')
  const [list, setList] = useState<ListResponse | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [query, setQuery] = useState('')
  const detailSeq = useRef(0)

  const loadList = useCallback(
    async (filter: string) => {
      const qs = filter ? `?staffId=${filter}` : ''
      const { ok, data } = await authedFetchJson<ListResponse>(`/api/v3/lifecycle${qs}`)
      if (!ok) {
        const message = (data as any)?.error || '영상 목록을 불러오지 못했습니다.'
        setListError(message)
        showError(message)
        return
      }
      setListError(null)
      setList(data)
      // 현재 고른 영상이 목록에 없으면(직원 필터 변경 등) 가장 최근 영상으로 바꾼다.
      setSelectedId((prev) => (prev && data.items.some((i) => i.id === prev) ? prev : data.items[0]?.id ?? null))
    },
    [showError]
  )

  const loadDetail = useCallback(
    async (videoId: string) => {
      const seq = ++detailSeq.current
      const { ok, data } = await authedFetchJson<DetailResponse>(`/api/v3/lifecycle?videoId=${videoId}`)
      if (seq !== detailSeq.current) return
      if (!ok) {
        const message = (data as any)?.error || '조회수 기록을 불러오지 못했습니다.'
        setDetailError(message)
        showError(message)
        return
      }
      setDetailError(null)
      setDetail(data)
    },
    [showError]
  )

  useEffect(() => {
    void loadList(staffId)
  }, [staffId, loadList])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  const syncAll = async () => {
    setSyncing(true)
    try {
      const { ok, data } = await authedPostJson<{ updated: number; total: number; error?: string }>('/api/v3/lifecycle/sync', {})
      if (!ok) {
        showError(data?.error || '통계 새로고침에 실패했습니다.')
        return
      }
      showSuccess(
        data.total === 0
          ? '새로고침할 영상이 없어요.'
          : `최근 영상 ${data.updated}개의 조회수를 새로 기록했어요.${data.updated < data.total ? ` (${data.total - data.updated}개는 실패)` : ''}`
      )
      await loadList(staffId)
      if (selectedId) await loadDetail(selectedId)
    } finally {
      setSyncing(false)
    }
  }

  const syncOne = async () => {
    if (!selectedId) return
    setSyncing(true)
    try {
      const { ok, data } = await authedPostJson<{ updated: number; error?: string }>('/api/v3/lifecycle/sync', { videoId: selectedId })
      if (!ok) {
        showError(data?.error || '통계 새로고침에 실패했습니다.')
        return
      }
      showSuccess(data.updated > 0 ? '이 영상의 조회수를 새로 기록했어요.' : '이 영상은 유튜브 주소가 없어 새로고침하지 못했어요.')
      await loadDetail(selectedId)
      await loadList(staffId)
    } finally {
      setSyncing(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items = list?.items || []
    if (!q) return items
    return items.filter((i) => i.title.toLowerCase().includes(q) || (i.stockName || '').toLowerCase().includes(q))
  }, [list, query])
  const more = useShowMore(filtered, 8, 10)

  const shownDetail = detail && detail.video.id === selectedId ? detail : null
  const points: GrowthPoint[] = (shownDetail?.snapshots || []).map((s) => ({ day: s.day, views: s.viewCount, snapshotAt: s.snapshotAt }))
  const growth = shownDetail && shownDetail.enough ? summarizeGrowth(shownDetail.snapshots) : null

  const header = (
    <PageHeader
      icon="📈"
      title="조회수 성장"
      subtitle="영상을 올린 뒤 조회수가 어떻게 늘어나는지 봅니다."
      actions={
        <div className="row">
          {me?.isAdmin && list?.staffOptions?.length ? (
            <select className="select" aria-label="보는 범위" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">전체 팀</option>
              {list.staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          <button className="button secondary" disabled={syncing} onClick={syncAll} title="유튜브에서 최신 조회수를 가져와 기록을 하나 남겨요. 최근 등록한 영상 10개까지 한 번에 처리해요.">
            {syncing ? '새로고침 중…' : '최근 영상 10개 조회수 새로고침'}
          </button>
        </div>
      }
    />
  )

  if (!list) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        {listError ? <ErrorBlock message={listError} onRetry={() => void loadList(staffId)} /> : <LoadingBlock>영상 목록을 불러오는 중이에요…</LoadingBlock>}
      </>
    )
  }

  if (list.items.length === 0) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        <EmptyBlock title="아직 등록된 영상이 없어요" actionHref="/v3/register" actionLabel="영상 등록하러 가기">
          영상을 등록한 뒤 ‘조회수 새로고침’을 누르면 기록이 하나씩 쌓이고, 며칠 지나면 조회수가 어떻게 늘어나는지 그래프로 보여드려요.
        </EmptyBlock>
      </>
    )
  }

  return (
    <>
      {header}
      <Toast toast={toast} />

      <div className="v3a-split">
        {/* 왼쪽: 영상 고르기 */}
        <div className="v3a-pane">
          <h2 className="v3a-pane-title">
            영상 고르기 <span className="v3a-count">{formatNumber(list.items.length)}</span>
          </h2>
          <input className="input v3a-search" type="search" aria-label="영상 검색" placeholder="제목이나 종목으로 찾기 (예: 삼성전자)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <p className="v3a-field-help">조회수 기록은 ‘새로고침’을 누를 때마다 하나씩 쌓여요. 기록이 2개 이상이어야 그래프가 그려져요.</p>
          {filtered.length === 0 ? (
            <div className="v3a-empty compact">
              <div className="v3a-empty-text">“{query}”에 맞는 영상이 없어요.</div>
              <button type="button" className="button secondary" onClick={() => setQuery('')}>
                검색어 지우기
              </button>
            </div>
          ) : (
            <div className="v3a-picker">
              {more.visible.map((item) => (
                <button key={item.id} type="button" className={`v3a-pick ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)} aria-pressed={selectedId === item.id}>
                  <span className="v3a-pick-title">{item.title}</span>
                  <span className="v3a-pick-meta">
                    <span>{item.contentType === 'shortform' ? '숏폼' : '롱폼'}</span>
                    {item.stockName ? <span>{item.stockName}</span> : null}
                    <span>조회수 {formatCompactNumber(item.viewCount)}</span>
                    <span>{item.snapshotCount >= 2 ? `기록 ${item.snapshotCount}번` : `기록 ${item.snapshotCount}번 (부족)`}</span>
                  </span>
                </button>
              ))}
              <MoreButton remaining={more.remaining} onClick={more.more} />
            </div>
          )}
        </div>

        {/* 오른쪽: 선택한 영상의 답 */}
        <div className="v3a-pane">
          {detailError && !shownDetail ? (
            <ErrorBlock message={detailError} onRetry={() => selectedId && void loadDetail(selectedId)} />
          ) : !shownDetail ? (
            <LoadingBlock>조회수 기록을 불러오는 중이에요…</LoadingBlock>
          ) : (
            <>
              <div className="v3a-video-head">
                <h2 className="v3a-video-title">
                  {shownDetail.video.youtubeUrl ? (
                    <a className="v3-link" href={shownDetail.video.youtubeUrl} target="_blank" rel="noreferrer">
                      {shownDetail.video.title}
                    </a>
                  ) : (
                    shownDetail.video.title
                  )}{' '}
                  <Tag tone={shownDetail.video.contentType === 'shortform' ? 'violet' : 'blue'}>{shownDetail.video.contentType === 'shortform' ? '숏폼' : '롱폼'}</Tag>
                </h2>
                <div className="v3a-video-meta">
                  {shownDetail.video.stockName || '종목 미상'} · 지금 조회수 {formatNumber(shownDetail.video.viewCount)}회 · 마지막 새로고침 {formatDateTime(shownDetail.video.lastSyncedAt)}
                </div>
              </div>

              {growth ? (
                <AnswerCard
                  tone={growth.tone}
                  headline={growth.headline}
                  detail={growth.detail}
                  action={
                    <button className="button secondary" disabled={syncing} onClick={syncOne}>
                      {syncing ? '새로고침 중…' : '이 영상 새로고침'}
                    </button>
                  }
                />
              ) : (
                <AnswerCard
                  headline={
                    shownDetail.snapshots.length === 0
                      ? '아직 조회수 기록이 없어서 그래프를 그릴 수 없어요.'
                      : '조회수 기록이 1번뿐이라 아직 그래프를 그릴 수 없어요.'
                  }
                  detail="새로고침을 누르면 지금 조회수가 기록돼요. 하루쯤 지나 한 번 더 누르면 얼마나 늘었는지 보여드려요."
                  action={
                    <button className="button" disabled={syncing} onClick={syncOne}>
                      {syncing ? '새로고침 중…' : '지금 조회수 기록하기'}
                    </button>
                  }
                />
              )}

              {shownDetail.enough ? <LineGrowthChart points={points} /> : null}

              {shownDetail.snapshots.length > 0 ? (
                <HowTo title="기록을 표로 보기">
                  <table className="v3-print-table">
                    <thead>
                      <tr>
                        <th>기록한 날</th>
                        <th className="num">올린 뒤</th>
                        <th className="num">조회수</th>
                        <th className="num">이전 기록보다</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownDetail.snapshots.map((s, i) => (
                        <tr key={s.snapshotAt}>
                          <td>{formatDateTime(s.snapshotAt)}</td>
                          <td className="num">{s.day.toFixed(1)}일</td>
                          <td className="num">{formatNumber(s.viewCount)}</td>
                          <td className="num">{i === 0 ? '—' : `+${formatNumber(Math.max(s.viewCount - shownDetail.snapshots[i - 1].viewCount, 0))}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </HowTo>
              ) : null}

              <HowTo>
                <p>가로는 영상을 올린 뒤 지난 날짜, 세로는 그때 기록된 조회수예요. 점 하나가 ‘새로고침’ 한 번이에요.</p>
                <p>최근 속도 = 마지막 두 기록 사이에 늘어난 조회수 ÷ 그 사이 날짜. 올린 뒤 평균 속도(조회수 ÷ 지난 날짜)의 70% 이상이면 ‘잘 크는 중’, 25% 미만이면 ‘거의 멈춤’으로 봐요.</p>
              </HowTo>
            </>
          )}
        </div>
      </div>
    </>
  )
}
