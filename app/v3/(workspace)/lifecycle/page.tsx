'use client'

import '../analysis.css'
import '@/lib/v3/interact.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { Tag } from '@/components/v3/ui'
import { useV3Me } from '@/components/v3/auth-guard'
import { v3Request } from '@/lib/v3/api-client'
import { usePref } from '@/lib/v3/prefs'
import { invalidateV3, useV3Data } from '@/lib/v3/use-v3-data'
import { formatCompactNumber, formatDays, formatKstDateTime, formatNumber } from '@/lib/v3/format'
import {
  AnswerCard,
  AnswerSkeleton,
  ChartSkeleton,
  EmptyBlock,
  ErrorBlock,
  HowTo,
  MoreButton,
  RefreshFailed,
  RelTime,
  Skel,
  SkeletonShell,
  useShowMore,
  withLoginLink,
  type Tone
} from '../analysis-parts'
import { GrowthChart, type GrowthPoint } from '../analysis-charts'

type ListItem = {
  id: string
  title: string
  stockName: string | null
  contentType: 'longform' | 'shortform'
  viewCount: number | null
  publishedAt: string | null
  youtubeUrl: string | null
  // 기록 개수를 세지 않은 영상(목록 뒤쪽)은 null
  snapshotCount: number | null
}

type ListResponse = { items: ListItem[]; staffOptions: { id: string; name: string }[] }

type Snapshot = { snapshotAt: string; viewCount: number; likeCount: number; commentCount: number; day: number; gain?: number | null }

type DetailResponse = {
  video: { id: string; title: string; stockName: string | null; contentType: string; youtubeUrl: string | null; publishedAt: string | null; viewCount: number | null; lastSyncedAt: string | null }
  snapshots: Snapshot[]
  totalSnapshots?: number
  sampled?: boolean
  enough: boolean
}

// 최근 기록 구간의 증가 속도를 "올린 뒤 평균 속도"와 비교해 한 문장으로 답한다.
function summarizeGrowth(snapshots: Snapshot[]): { tone: Tone; headline: string; detail?: string } {
  const last = snapshots[snapshots.length - 1]
  const prev = snapshots[snapshots.length - 2]
  const gain = last.viewCount - prev.viewCount
  const span = last.day - prev.day
  const avgRate = last.viewCount / Math.max(last.day, 1)

  if (!Number.isFinite(span) || span < 0.25) {
    return {
      tone: 'neutral',
      headline: `마지막 두 기록의 간격이 ${formatDays(Number.isFinite(span) ? span : 0)}뿐이라 아직 ‘크는 중인지’ 말하기 어려워요.`,
      detail: '하루쯤 지난 뒤 통계를 다시 새로고침하면 정확히 알려드려요.'
    }
  }

  const recentRate = Math.max(gain, 0) / span
  const ratio = avgRate > 0 ? recentRate / avgRate : 0
  const gained = `마지막 기록 이후 ${formatDays(span)} 동안 조회수가 ${formatNumber(Math.max(gain, 0))}회 늘었어요.`
  const detail = `올린 뒤 평균은 하루 ${formatNumber(Math.round(avgRate))}회, 최근에는 하루 ${formatNumber(Math.round(recentRate))}회 속도예요.`

  if (ratio >= 0.7) return { tone: 'good', headline: `아직 잘 크고 있는 영상이에요. ${gained}`, detail }
  if (ratio >= 0.25) return { tone: 'neutral', headline: `성장 속도가 느려지고 있어요. ${gained}`, detail }
  return { tone: 'neutral', headline: `조회수가 거의 멈춘 영상이에요. ${gained}`, detail }
}

type SyncResponse = {
  updated: number
  total: number
  skipped?: number
  remaining?: number
  results: { id: string; title: string; ok: boolean; skipped?: boolean; error?: string }[]
}

type SyncNotice = { tone: 'good' | 'warn' | 'neutral'; text: string; failures: string[] }

// 실제 화면과 같은 모양의 뼈대(왼쪽 목록 + 오른쪽 답·그래프)
function LifecycleSkeleton() {
  return (
    <SkeletonShell label="영상 목록을 불러오는 중이에요…">
      <div className="v3a-split" aria-hidden>
        <div className="v3a-pane">
          <Skel w={130} h={18} />
          <Skel h={36} r={8} />
          <Skel w="90%" h={12} />
          <div className="v3a-picker">
            {Array.from({ length: 6 }, (_, i) => (
              <div className="v3a-pick" key={i}>
                <Skel w={`${88 - (i % 3) * 14}%`} h={14} />
                <Skel w="60%" h={12} />
              </div>
            ))}
          </div>
        </div>
        <DetailSkeleton />
      </div>
    </SkeletonShell>
  )
}

function DetailSkeleton() {
  return (
    <div className="v3a-pane" aria-hidden>
      <Skel w="62%" h={20} />
      <Skel w="48%" h={12} />
      <AnswerSkeleton />
      <ChartSkeleton height={270} />
    </div>
  )
}

export default function LifecyclePage() {
  const me = useV3Me()
  const { toast, showError } = useToast()
  // 마지막에 고른 직원 필터를 기억한다(관리자). 저장된 값을 읽은 뒤(ready)에 첫 목록을 불러온다.
  const [staffId, setStaffId, prefReady] = usePref('lifecycle:staff')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const syncLock = useRef(false)
  const [syncNotice, setSyncNotice] = useState<SyncNotice | null>(null)
  const [query, setQuery] = useState('')
  const resultRef = useRef<HTMLDivElement>(null)

  const listUrl = prefReady ? `/api/v3/lifecycle${staffId ? `?staffId=${encodeURIComponent(staffId)}` : ''}` : null
  const list = useV3Data<ListResponse>(listUrl, { scope: me?.crmUserId, fallback: '영상 목록을 불러오지 못했어요.' })
  const detailUrl = selectedId ? `/api/v3/lifecycle?videoId=${encodeURIComponent(selectedId)}` : null
  const detail = useV3Data<DetailResponse>(detailUrl, { scope: me?.crmUserId, fallback: '조회수 기록을 불러오지 못했어요.' })
  const listData = list.data
  const reloadList = list.reload
  const reloadDetail = detail.reload

  // 목록이 바뀌면(필터 변경·새로고침) 고른 영상이 아직 있는지 확인하고, 없으면 가장 최근 영상으로 바꾼다.
  // 저장해 둔 직원이 더는 목록에 없으면(퇴사 등) 전체 팀으로 되돌린다.
  useEffect(() => {
    if (!listData) return
    if (staffId && !listData.staffOptions.some((s) => s.id === staffId)) {
      setStaffId('')
      return
    }
    setSelectedId((prev) => (prev && listData.items.some((i) => i.id === prev) ? prev : listData.items[0]?.id ?? null))
  }, [listData, staffId, setStaffId])

  const refreshAll = async () => {
    // 조회수가 바뀌면 급상승·참여·비교 화면의 계산도 달라지므로 그쪽 저장본도 함께 비운다.
    invalidateV3('/api/v3/lifecycle', '/api/v3/viral', '/api/v3/engagement', '/api/v3/format-series')
    await Promise.all([reloadList(true), selectedId ? reloadDetail(true) : Promise.resolve(null)])
  }

  // 여러 영상 새로고침: 기록이 가장 오래된 영상부터 10개. 결과는 사라지지 않는 안내 상자로 보여준다.
  const syncAll = async () => {
    if (syncLock.current) return
    syncLock.current = true
    setSyncing(true)
    setSyncNotice(null)
    const res = await v3Request<SyncResponse>('/api/v3/lifecycle/sync', { method: 'POST', body: staffId ? { staffId } : {} }, '조회수를 새로고침하지 못했어요.')
    if (!res.ok) {
      setSyncNotice({ tone: 'warn', text: res.error || '조회수를 새로고침하지 못했어요.', failures: [] })
      syncLock.current = false
      setSyncing(false)
      return
    }
    const { updated, total, remaining = 0, results } = res.data
    const failures = results.filter((r) => !r.ok).map((r) => `${r.title} — ${r.error || '실패'}`)
    if (total === 0) {
      setSyncNotice({ tone: 'neutral', text: '지금 새로 기록할 영상이 없어요. 최근 30일 영상은 모두 방금 기록됐어요.', failures: [] })
    } else {
      const parts = [`영상 ${formatNumber(updated)}개의 조회수를 새로 기록했어요.`]
      if (failures.length > 0) parts.push(`${formatNumber(failures.length)}개는 기록하지 못했어요.`)
      if (remaining > 0) parts.push(`아직 ${formatNumber(remaining)}개가 남았어요. 버튼을 한 번 더 누르면 이어서 기록해요.`)
      setSyncNotice({ tone: failures.length > 0 ? 'warn' : 'good', text: parts.join(' '), failures })
    }
    await refreshAll()
    syncLock.current = false
    setSyncing(false)
  }

  const syncOne = async () => {
    if (!selectedId || syncLock.current) return
    syncLock.current = true
    setSyncing(true)
    setSyncNotice(null)
    const res = await v3Request<SyncResponse>('/api/v3/lifecycle/sync', { method: 'POST', body: { videoId: selectedId } }, '조회수를 새로고침하지 못했어요.')
    if (!res.ok) {
      showError(res.error || '조회수를 새로고침하지 못했어요.')
      syncLock.current = false
      setSyncing(false)
      return
    }
    // 성공하면 아래 표와 그래프가 바로 바뀌므로 알림은 "건너뜀/실패"일 때만 띄운다.
    const row = res.data.results[0]
    if (row?.skipped) showError('방금 기록한 영상이에요. 몇 분 뒤에 다시 눌러 주세요.')
    else if (row && !row.ok) showError(row.error || '이 영상은 새로고침하지 못했어요.')
    await refreshAll()
    syncLock.current = false
    setSyncing(false)
  }

  // 검색은 이미 받아 둔 목록을 화면에서 거르기만 한다(서버에 다시 묻지 않는다).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const items = listData?.items || []
    if (!q) return items
    return items.filter((i) => i.title.toLowerCase().includes(q) || (i.stockName || '').toLowerCase().includes(q))
  }, [listData, query])
  const more = useShowMore(filtered, 8, 10)

  const pick = (id: string) => {
    setSelectedId(id)
    // 좁은 화면에서는 목록 아래에 결과가 있으므로, 고르면 결과 쪽으로 부드럽게 내려 준다.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }))
    }
  }

  const shownDetail = detail.data && detail.data.video.id === selectedId ? detail.data : null
  const points: GrowthPoint[] = useMemo(() => (shownDetail?.snapshots || []).map((s) => ({ day: s.day, views: s.viewCount, snapshotAt: s.snapshotAt })), [shownDetail])
  const growth = shownDetail && shownDetail.enough && shownDetail.snapshots.length >= 2 ? summarizeGrowth(shownDetail.snapshots) : null
  const totalSnapshots = shownDetail ? shownDetail.totalSnapshots ?? shownDetail.snapshots.length : 0

  const header = (
    <PageHeader
      icon="📈"
      title="조회수 성장"
      subtitle="영상을 올린 뒤 조회수가 어떻게 늘어나는지 봅니다."
      actions={
        <div className="row">
          {me?.isAdmin && listData?.staffOptions?.length ? (
            <select className="select" aria-label="보는 범위" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">전체 팀</option>
              {listData.staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="button secondary"
            disabled={syncing}
            onClick={() => void syncAll()}
            title="유튜브에서 최신 조회수를 가져와 기록을 하나 남겨요. 기록이 가장 오래된 영상부터 10개씩 처리해요."
          >
            {syncing ? '새로고침 중…' : '조회수 새로고침 (10개씩)'}
          </button>
        </div>
      }
    />
  )

  const noticeEl = syncNotice ? (
    <div className={`v3i-notice ${syncNotice.tone === 'neutral' ? '' : syncNotice.tone}`} role="status">
      <div>
        <div>{withLoginLink(syncNotice.text)}</div>
        {syncNotice.failures.length > 0 ? (
          <ul>
            {syncNotice.failures.slice(0, 5).map((f) => (
              <li key={f}>{f}</li>
            ))}
            {syncNotice.failures.length > 5 ? <li>그 밖에 {syncNotice.failures.length - 5}개</li> : null}
          </ul>
        ) : null}
      </div>
      <button type="button" className="v3i-linkbtn" onClick={() => setSyncNotice(null)}>
        닫기
      </button>
    </div>
  ) : null

  if (!listData) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        {noticeEl}
        {list.error ? <ErrorBlock message={list.error} status={list.status} onRetry={() => void reloadList(true)} /> : <LifecycleSkeleton />}
      </>
    )
  }

  if (listData.items.length === 0) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        {noticeEl}
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
      {noticeEl ? <div style={{ marginBottom: 16 }}>{noticeEl}</div> : null}
      {list.error ? (
        <div style={{ marginBottom: 16 }}>
          <RefreshFailed message={list.error} status={list.status} onRetry={() => void reloadList(true)} />
        </div>
      ) : null}

      <div className={`v3a-split ${list.stale ? 'v3a-dim' : ''}`} aria-busy={list.stale || list.refreshing}>
        {/* 왼쪽: 영상 고르기 */}
        <div className="v3a-pane">
          <h2 className="v3a-pane-title">
            영상 고르기 <span className="v3a-count">{formatNumber(listData.items.length)}</span>
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
            <div className="v3a-picker tall">
              {more.visible.map((item) => (
                <button key={item.id} type="button" className={`v3a-pick ${selectedId === item.id ? 'selected' : ''}`} onClick={() => pick(item.id)} aria-pressed={selectedId === item.id} title={item.title}>
                  <span className="v3a-pick-title">{item.title}</span>
                  <span className="v3a-pick-meta">
                    <span>{item.contentType === 'shortform' ? '숏폼' : '롱폼'}</span>
                    {item.stockName ? <span>{item.stockName}</span> : null}
                    <span title={`${formatNumber(item.viewCount)}회`}>조회수 {formatCompactNumber(item.viewCount)}</span>
                    {item.publishedAt ? (
                      <span>
                        <RelTime value={item.publishedAt} />
                      </span>
                    ) : null}
                    {item.snapshotCount === null ? null : <span>{item.snapshotCount >= 2 ? `기록 ${item.snapshotCount}번` : `기록 ${item.snapshotCount}번 (부족)`}</span>}
                  </span>
                </button>
              ))}
              <MoreButton remaining={more.remaining} onClick={more.more} />
            </div>
          )}
        </div>

        {/* 오른쪽: 선택한 영상의 답 */}
        <div className="v3a-pane" ref={resultRef}>
          {detail.error && !shownDetail ? (
            <ErrorBlock message={detail.error} status={detail.status} onRetry={() => void reloadDetail(true)} />
          ) : !shownDetail ? (
            <>
              <span className="v3a-sr" role="status">
                조회수 기록을 불러오는 중이에요…
              </span>
              <DetailSkeleton />
            </>
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
                  {shownDetail.video.stockName || '종목 미상'} · 지금 조회수 {formatNumber(shownDetail.video.viewCount)}회 · 마지막 새로고침 <RelTime value={shownDetail.video.lastSyncedAt} fallback="아직 없음" />
                </div>
              </div>

              {detail.error ? <RefreshFailed message={detail.error} status={detail.status} onRetry={() => void reloadDetail(true)} /> : null}

              {growth ? (
                <AnswerCard
                  tone={growth.tone}
                  headline={growth.headline}
                  detail={growth.detail}
                  action={
                    <button type="button" className="button secondary" disabled={syncing} onClick={() => void syncOne()}>
                      {syncing ? '새로고침 중…' : '이 영상 새로고침'}
                    </button>
                  }
                />
              ) : (
                <AnswerCard
                  headline={totalSnapshots === 0 ? '아직 조회수 기록이 없어서 그래프를 그릴 수 없어요.' : '조회수 기록이 1번뿐이라 아직 그래프를 그릴 수 없어요.'}
                  detail="새로고침을 누르면 지금 조회수가 기록돼요. 하루쯤 지나 한 번 더 누르면 얼마나 늘었는지 보여드려요."
                  action={
                    <button type="button" className="button" disabled={syncing} onClick={() => void syncOne()}>
                      {syncing ? '새로고침 중…' : '지금 조회수 기록하기'}
                    </button>
                  }
                />
              )}

              {shownDetail.enough ? <GrowthChart points={points} /> : null}

              {shownDetail.snapshots.length > 0 ? (
                <HowTo title={`기록을 표로 보기 (${formatNumber(totalSnapshots)}번)`}>
                  {shownDetail.sampled ? <p className="v3a-note-strong">기록이 많아서 그 가운데 {formatNumber(shownDetail.snapshots.length)}개만 보여드려요. 가장 최근 기록이 맨 위에 있어요.</p> : null}
                  <div className="v3a-table-scroll" tabIndex={0} role="region" aria-label="조회수 기록 표">
                    <table className="v3a-table">
                      <thead>
                        <tr>
                          <th scope="col">기록한 시각</th>
                          <th scope="col" className="num">
                            올린 뒤
                          </th>
                          <th scope="col" className="num">
                            조회수
                          </th>
                          <th scope="col" className="num">
                            이전 기록보다
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...shownDetail.snapshots].reverse().map((s) => (
                          <tr key={s.snapshotAt}>
                            <td data-label="기록한 시각" title={s.snapshotAt}>
                              {formatKstDateTime(s.snapshotAt)}
                            </td>
                            <td data-label="올린 뒤" className="num">
                              {formatDays(s.day)}
                            </td>
                            <td data-label="조회수" className="num">
                              {formatNumber(s.viewCount)}
                            </td>
                            <td data-label="이전 기록보다" className="num">
                              {s.gain === null || s.gain === undefined ? (
                                '—'
                              ) : s.gain > 0 ? (
                                <>
                                  <span className="up-mark" aria-hidden>
                                    ▲
                                  </span>
                                  {formatNumber(s.gain)}
                                </>
                              ) : (
                                '변화 없음'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
