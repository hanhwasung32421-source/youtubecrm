'use client'

import '../analysis.css'
import Link from 'next/link'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { Section, Tag } from '@/components/v3/ui'
import { useV3Me } from '@/components/v3/auth-guard'
import { v3Request } from '@/lib/v3/api-client'
import { ConfirmButton, FieldError, InlineEditor } from '@/lib/v3/interact'
import { markDirtyV3, useV3Data } from '@/lib/v3/use-v3-data'
import { useUrlFilters } from '@/lib/v3/use-filters'
import { VIRAL_FILTERS, chipLabel, defaultFilters, optionsFor } from '@/lib/v3/filters'
import { formatCompactNumber, formatNumber } from '@/lib/v3/format'
import { buildWhy, suggestFollowUps, type WhyTeam } from '@/lib/v3/viral-why'
import { lifecycleHref, registerHref } from '@/lib/v3/links'
import { sortViralItems } from '@/lib/v3/sorting'
import { viralCsv } from '@/lib/v3/table-rows'
import {
  AnswerCard,
  AnswerSkeleton,
  CardsSkeleton,
  EmptyBlock,
  ErrorBlock,
  HowTo,
  MoreButton,
  RefreshFailed,
  RelTime,
  SectionSkeleton,
  SetupNote,
  SkeletonShell,
  StatCard,
  StatGrid,
  StatsSkeleton,
  useShowMore,
  withLoginLink
} from '../analysis-parts'
import { FilterBar, GlossaryHelp, ShareTools, Term, type FilterField } from '../analysis-tools'

type ViralItem = {
  id: string
  title: string
  stockName: string | null
  contentType: 'longform' | 'shortform'
  youtubeUrl: string | null
  viewCount: number | null
  publishedAt?: string | null
  velocity: number
  ratio: number
  note: string
  // 왜 떴는지 설명하는 재료(옛 응답에는 없을 수 있다)
  likeRatePct?: number | null
  commentRatePct?: number | null
  engagementPct?: number | null
  ageDays?: number | null
  ownerName?: string | null
  acknowledged: boolean
  actionNote: string | null
  ackedAt?: string | null
  ackedByName?: string | null
}

type ViralResponse = {
  insufficientData: boolean
  teamMedianVelocity: number
  teamMedianLikeRatePct?: number | null
  teamMedianCommentRatePct?: number | null
  teamSampleSize: number
  minSampleSize?: number
  thresholdMultiplier?: number
  acksAvailable: boolean
  matchedCount?: number
  maxItems?: number
  staffOptions?: { id: string; name: string }[]
  summary: string
  items: ViralItem[]
}

// 배수 표기: NaN/Infinity 가 들어와도 화면이 깨지지 않게
const fx = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—')

const FALLBACK_HEADER = <PageHeader icon="🔥" title="급상승 영상" subtitle="조회수가 평소보다 빠르게 오르는 영상을 찾아 줍니다." />

// useSearchParams 는 Suspense 안에서만 쓸 수 있다(Next 16).
export default function ViralPage() {
  return (
    <Suspense
      fallback={
        <>
          {FALLBACK_HEADER}
          <SkeletonShell label="급상승 영상을 찾는 중이에요…">
            <AnswerSkeleton />
            <StatsSkeleton count={3} />
          </SkeletonShell>
        </>
      }
    >
      <ViralView />
    </Suspense>
  )
}

function ViralView() {
  const me = useV3Me()
  const { toast, showSuccess, showError } = useToast()
  const f = useUrlFilters('viral', VIRAL_FILTERS)
  const { filters, set: setFilter } = f
  const isAdmin = !!me?.isAdmin

  const apiUrl = useMemo(() => {
    if (!f.ready) return null
    const q = new URLSearchParams()
    if (isAdmin && filters.staff) q.set('staffId', filters.staff)
    if (filters.format !== 'all') q.set('format', filters.format)
    if (filters.period !== '30') q.set('days', filters.period)
    const s = q.toString()
    return `/api/v3/viral${s ? `?${s}` : ''}`
  }, [f.ready, isAdmin, filters.staff, filters.format, filters.period])

  const res = useV3Data<ViralResponse>(apiUrl, { scope: me?.crmUserId, fallback: '급상승 영상을 불러오지 못했어요.' })
  const { data, reload, mutate } = res
  const [ackingId, setAckingId] = useState<string | null>(null)
  // 같은 카드를 빠르게 두 번 눌러도 저장이 한 번만 나가게 하는 즉시 잠금(상태는 다음 화면 갱신 뒤에야 바뀌기 때문)
  const ackLock = useRef(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  // 방금 확인한 영상: 몇 초 동안 화면 위에 "실행 취소"를 남겨 둔다.
  const [justAcked, setJustAcked] = useState<{ item: ViralItem } | null>(null)

  useEffect(() => {
    if (!justAcked) return
    const timer = window.setTimeout(() => setJustAcked(null), 12000)
    return () => window.clearTimeout(timer)
  }, [justAcked])

  // 저장해 둔 직원이 더는 목록에 없거나, 직원이 아닌 사람이 직원 필터를 들고 오면 전체로 되돌린다.
  useEffect(() => {
    if (!data || !me || !filters.staff) return
    if (!isAdmin || (data.staffOptions && !data.staffOptions.some((s) => s.id === filters.staff))) setFilter({ staff: '' })
  }, [data, me, isAdmin, filters.staff, setFilter])

  const setCardError = (id: string, message: string | null) =>
    setCardErrors((prev) => {
      const next = { ...prev }
      if (message) next[id] = message
      else delete next[id]
      return next
    })

  // 화면에서 먼저 바꿔 보여 준다(캐시에도 같이 반영). 저장이 끝난 뒤에는 다음 조회가 서버 최신 값을 받도록 표시해 둔다.
  const patchItem = (id: string, patch: Partial<ViralItem>) => {
    mutate((prev) => ({ ...prev, items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }))
    markDirtyV3('/api/v3/viral')
  }

  // 확인 표시: 화면에서 먼저 "확인 완료"로 옮기고, 저장에 실패하면 되돌린다.
  const ack = async (item: ViralItem) => {
    if (ackingId || ackLock.current) return
    ackLock.current = true
    const actionNote = (notes[item.id] || '').trim()
    setAckingId(item.id)
    setCardError(item.id, null)
    patchItem(item.id, { acknowledged: true, actionNote: actionNote || null, ackedAt: new Date().toISOString(), ackedByName: me?.name || null })
    const out = await v3Request('/api/v3/viral/ack', { method: 'POST', body: { videoId: item.id, actionNote: actionNote || undefined } }, '확인 표시를 저장하지 못했어요.')
    ackLock.current = false
    setAckingId(null)
    if (!out.ok) {
      patchItem(item.id, { acknowledged: false, actionNote: item.actionNote, ackedAt: item.ackedAt ?? null, ackedByName: item.ackedByName ?? null })
      setCardError(item.id, out.error)
      showError(out.error || '확인 표시를 저장하지 못했어요.')
      return
    }
    setJustAcked({ item })
    setNotes((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
  }

  const saveNote = async (item: ViralItem, value: string) => {
    setEditSaving(true)
    setEditError(null)
    const out = await v3Request('/api/v3/viral/ack', { method: 'PATCH', body: { videoId: item.id, actionNote: value || undefined } }, '메모를 저장하지 못했어요.')
    setEditSaving(false)
    if (!out.ok) {
      setEditError(out.error)
      return
    }
    patchItem(item.id, { actionNote: value || null })
    setEditingId(null)
    showSuccess('메모를 저장했어요.')
  }

  const undoAck = async (item: ViralItem) => {
    setUndoingId(item.id)
    setCardError(item.id, null)
    setJustAcked((cur) => (cur?.item.id === item.id ? null : cur))
    patchItem(item.id, { acknowledged: false, actionNote: null })
    const out = await v3Request('/api/v3/viral/ack', { method: 'DELETE', body: { videoId: item.id } }, '확인 취소에 실패했어요.')
    setUndoingId(null)
    if (!out.ok) {
      patchItem(item.id, { acknowledged: true, actionNote: item.actionNote })
      setCardError(item.id, out.error)
      showError(out.error || '확인 취소에 실패했어요.')
      return
    }
    // 예전 메모는 지워졌으니, 다시 확인할 때 빈 칸에서 시작한다.
    setNotes((prev) => ({ ...prev, [item.id]: '' }))
    showSuccess('확인을 취소했어요. 다시 ‘아직 확인 안 한 영상’에 있어요.')
  }

  const sorted = useMemo(() => sortViralItems(data?.items || [], filters.sort), [data, filters.sort])
  const pending = useMemo(() => sorted.filter((i) => !i.acknowledged), [sorted])
  const done = useMemo(() => sorted.filter((i) => i.acknowledged), [sorted])
  const pendingMore = useShowMore(pending, 5, 10)
  const doneMore = useShowMore(done, 5, 10)

  const team: WhyTeam = {
    medianVelocity: data?.teamMedianVelocity ?? 0,
    medianLikeRatePct: data?.teamMedianLikeRatePct ?? null,
    medianCommentRatePct: data?.teamMedianCommentRatePct ?? null
  }

  const staffOptions = data?.staffOptions || []
  const fields: FilterField[] = [
    ...(isAdmin && staffOptions.length > 0
      ? [{ key: 'staff', label: '직원', options: [{ value: '', label: '전체 팀' }, ...staffOptions.map((s) => ({ value: s.id, label: s.name }))] }]
      : []),
    { key: 'period', label: '올린 시기', options: optionsFor('viral', VIRAL_FILTERS, 'period') },
    { key: 'format', label: '형식', options: optionsFor('viral', VIRAL_FILTERS, 'format') },
    { key: 'sort', label: '정렬', options: optionsFor('viral', VIRAL_FILTERS, 'sort') }
  ]
  const chips = f.chips((key, value) => chipLabel('viral', key, value, (id) => staffOptions.find((s) => s.id === id)?.name || null))
  const filtered = chips.length > 0

  const filterBar = (
    <FilterBar
      fields={fields}
      filters={filters}
      defaults={defaultFilters(VIRAL_FILTERS)}
      chips={chips}
      onChange={(key, value) => f.set({ [key]: value })}
      onReset={f.reset}
    >
      <ShareTools
        getLink={() => f.shareUrl()}
        csv={{ baseName: '급상승 영상', rowCount: sorted.length, build: () => viralCsv(sorted, team, { showOwner: isAdmin }) }}
        notify={{ success: showSuccess, error: showError }}
      />
    </FilterBar>
  )

  const header = <PageHeader icon="🔥" title="급상승 영상" subtitle="조회수가 평소보다 빠르게 오르는 영상을 찾아 줍니다." />

  if (!data) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        <div style={{ marginBottom: 16 }}>{filterBar}</div>
        {res.error ? (
          <ErrorBlock message={res.error} status={res.status} onRetry={() => void reload(true)} />
        ) : (
          <SkeletonShell label="급상승 영상을 찾는 중이에요…">
            <AnswerSkeleton />
            <StatsSkeleton count={3} />
            <SectionSkeleton>
              <CardsSkeleton count={3} />
            </SectionSkeleton>
          </SkeletonShell>
        )}
      </>
    )
  }

  const threshold = data.thresholdMultiplier ?? 2
  const minSample = data.minSampleSize ?? 5
  const median = data.teamMedianVelocity
  const maxItems = data.maxItems ?? 30
  const matched = data.matchedCount ?? data.items.length

  const renderCard = (item: ViralItem) => {
    const inputId = `v3-ack-note-${item.id}`
    const busy = ackingId === item.id
    const why = buildWhy(
      { ratio: item.ratio, velocity: item.velocity, viewCount: item.viewCount, ageDays: item.ageDays ?? null, likeRatePct: item.likeRatePct ?? null, commentRatePct: item.commentRatePct ?? null },
      team
    )
    const followUps = suggestFollowUps(item)
    return (
      <div key={item.id} className={`v3a-card ${item.acknowledged ? 'done' : 'hot'}`}>
        <div className="v3a-card-head">
          <div className="v3a-card-title">
            {item.youtubeUrl ? (
              <a className="v3-link" href={item.youtubeUrl} target="_blank" rel="noreferrer" title={item.title}>
                {item.title}
              </a>
            ) : (
              item.title
            )}{' '}
            <Tag tone={item.contentType === 'shortform' ? 'violet' : 'blue'}>{item.contentType === 'shortform' ? '숏폼' : '롱폼'}</Tag>
            {item.stockName ? <Tag tone="gray">{item.stockName}</Tag> : null}
            {isAdmin && item.ownerName ? <Tag tone="green">{item.ownerName}</Tag> : null}
          </div>
          <span className="v3a-badge" title={`평소 영상의 하루 조회수보다 ${fx(item.ratio)}배 빠르게 늘고 있어요`}>
            <span aria-hidden>▲ </span>보통의 {fx(item.ratio)}배
          </span>
        </div>
        <div className="v3a-card-meta">
          {item.publishedAt ? (
            <span>
              올린 지 <RelTime value={item.publishedAt} />
            </span>
          ) : null}
          <span title={`${formatNumber(item.viewCount)}회`}>지금까지 조회수 {formatCompactNumber(item.viewCount)}회</span>
          <span>하루 평균 {formatNumber(item.velocity)}회씩 늘어요 (보통 영상은 {formatNumber(median)}회)</span>
        </div>
        <div className="v3a-why">
          <strong>왜 떴을까?</strong>
          {why.text}
        </div>
        {item.acknowledged ? null : (
          <div className="v3a-next">
            <span className="v3a-next-label">다음에 해볼 일</span>
            {followUps.map((fu, idx) => (
              <Link key={fu.format} className={idx === 0 ? 'button xs' : 'button secondary xs'} href={registerHref({ stock: fu.stock, format: fu.format })} title={fu.hint}>
                {fu.label}
              </Link>
            ))}
          </div>
        )}
        {item.acknowledged ? (
          <>
            <div className="v3a-check">
              ✓ 확인 완료
              {item.ackedByName || item.ackedAt ? (
                <>
                  {' ('}
                  {item.ackedByName ? item.ackedByName : null}
                  {item.ackedByName && item.ackedAt ? ' · ' : null}
                  {item.ackedAt ? <RelTime value={item.ackedAt} /> : null}
                  {')'}
                </>
              ) : null}
              {item.actionNote ? ` · ${item.actionNote}` : ''}
            </div>
            {editingId === item.id ? (
              <InlineEditor
                label="조치 메모 (선택)"
                initial={item.actionNote || ''}
                maxLength={200}
                placeholder="무엇을 했나요? 예: 후속 영상 제작 예정"
                saving={editSaving}
                error={editError}
                onSave={(value) => saveNote(item, value)}
                onCancel={() => {
                  setEditingId(null)
                  setEditError(null)
                }}
              />
            ) : (
              <div className="v3i-tools">
                <button
                  type="button"
                  className="button secondary xs"
                  disabled={undoingId === item.id}
                  onClick={() => {
                    setEditingId(item.id)
                    setEditError(null)
                  }}
                >
                  {item.actionNote ? '메모 수정' : '메모 남기기'}
                </button>
                <Link className="button secondary xs" href={lifecycleHref(item.id)}>
                  성장 곡선 보기
                </Link>
                <ConfirmButton
                  label="확인 취소"
                  question="확인 표시를 지울까요? 메모도 함께 지워져요."
                  confirmLabel="지우기"
                  busyLabel="지우는 중…"
                  busy={undoingId === item.id}
                  onConfirm={() => undoAck(item)}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <form
              className="v3i-ackform"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                void ack(item)
              }}
            >
              <div className="field">
                <label className="label" htmlFor={inputId}>
                  조치 메모 (선택)
                </label>
                <input
                  id={inputId}
                  className="input"
                  placeholder="무엇을 했나요? 예: 후속 영상 제작 예정"
                  maxLength={200}
                  value={notes[item.id] || ''}
                  disabled={busy || !data.acksAvailable}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                />
              </div>
              <button type="submit" className="button" disabled={busy || !data.acksAvailable}>
                {busy ? '저장 중…' : '확인했어요'}
              </button>
            </form>
            <div>
              <Link className="v3-link small" href={lifecycleHref(item.id)}>
                이 영상의 조회수 성장 곡선 보기
              </Link>
            </div>
          </>
        )}
        <FieldError>{withLoginLink(cardErrors[item.id])}</FieldError>
      </div>
    )
  }

  // ── 맨 위 한 문장 답 ──────────────────────────────────────
  const scopeLabel = isAdmin ? '팀 전체 기준' : '내 영상 기준'
  let answer: React.ReactNode
  if (data.insufficientData) {
    const short = data.teamSampleSize < minSample
    answer = (
      <AnswerCard
        eyebrow="아직 판단하기 어려워요"
        headline={
          short
            ? `비교할 영상이 아직 부족해요. 최근 30일에 등록한 영상이 ${minSample}개 이상이어야 “평소보다 빠른지” 알 수 있어요 (지금 ${formatNumber(data.teamSampleSize)}개).`
            : '영상들의 조회수가 아직 거의 없어서 비교하기 어려워요. 조회수가 쌓이면 다시 확인해 주세요.'
        }
        detail={short ? undefined : '유튜브 조회수를 가져오지 않았다면 ‘조회수 새로고침’을 눌러 주세요.'}
        action={
          short ? (
            <Link className="button" href="/v3/register">
              영상 등록하러 가기
            </Link>
          ) : (
            <Link className="button" href="/v3/lifecycle">
              조회수 새로고침 하러 가기
            </Link>
          )
        }
      />
    )
  } else if (data.items.length === 0) {
    answer = (
      <AnswerCard
        eyebrow={scopeLabel}
        headline={filtered ? '이 조건에는 급상승 영상이 없어요.' : '지금은 유독 빠르게 오르는 영상이 없어요. 평소처럼 등록하면 돼요.'}
        detail={`보통 영상은 하루 약 ${formatNumber(median)}회 조회돼요. 그보다 ${threshold}배 이상 빠른 영상이 생기면 여기에 나타나요.`}
        action={
          filtered ? (
            <button type="button" className="button secondary" onClick={f.reset}>
              필터 초기화
            </button>
          ) : null
        }
      />
    )
  } else if (pending.length > 0) {
    const top = pending[0]
    const topFollow = suggestFollowUps(top)[0]
    answer = (
      <AnswerCard
        tone="good"
        eyebrow={scopeLabel}
        headline={
          <>
            지금 눈여겨볼 영상이 {formatNumber(pending.length)}개 있어요. {filters.sort === 'ratio' ? '1위' : '맨 위'}는 “{top.title}” — 보통 영상보다 {fx(top.ratio)}배 빠르게 조회수가 오르고 있어요.
          </>
        }
        detail="이런 영상은 같은 종목의 후속 영상이나 비슷한 주제를 빨리 만들수록 효과가 커요."
        action={
          <>
            <Link className="button" href={registerHref({ stock: topFollow.stock, format: topFollow.format })}>
              후속 영상 올리러 가기
            </Link>
            {top.youtubeUrl ? (
              <a className="button secondary" href={top.youtubeUrl} target="_blank" rel="noreferrer">
                영상 열어보기
              </a>
            ) : null}
          </>
        }
      />
    )
  } else {
    answer = (
      <AnswerCard tone="good" eyebrow={scopeLabel} headline={`급상승 영상 ${formatNumber(done.length)}개를 모두 확인했어요. 새로 오르는 영상이 생기면 여기에 나타나요.`} />
    )
  }

  return (
    <>
      {header}
      <Toast toast={toast} />

      <div className="v3a-stack">
        {filterBar}
      <div className={`v3a-stack ${res.stale ? 'v3a-dim' : ''}`} aria-busy={res.refreshing || res.stale}>
        {res.error ? <RefreshFailed message={res.error} status={res.status} onRetry={() => void reload(true)} /> : null}
        {answer}

        {justAcked ? (
          <div className="v3i-notice good" role="status">
            <div>“{justAcked.item.title}”을(를) 확인한 영상으로 옮겼어요. 아래 ‘확인한 영상’에서 볼 수 있어요.</div>
            <button type="button" className="v3i-linkbtn" onClick={() => void undoAck(justAcked.item)}>
              실행 취소
            </button>
          </div>
        ) : null}

        {!data.acksAvailable && data.items.length > 0 ? <SetupNote>“확인했어요” 기록을 저장하려면 이 SQL을 먼저 실행해 주세요 —</SetupNote> : null}

        <StatGrid>
          <StatCard
            label="아직 확인 안 한 급상승 영상"
            value={`${formatNumber(pending.length)}개`}
            tone={pending.length > 0 ? 'good' : 'neutral'}
            hint={`보통 영상보다 ${threshold}배 이상 빠르게 조회수가 오르는데 아직 확인 표시를 하지 않은 영상이에요.`}
          />
          <StatCard
            label={
              <>
                보통 영상의 <Term k="dailyViews" />
              </>
            }
            value={`${formatNumber(median)}회`}
            hint="최근 30일 영상을 하루 조회수 순으로 줄 세웠을 때 한가운데(중앙값) 영상의 값이에요. 이 값이 ‘평소’ 기준이에요."
          />
          <StatCard label="비교한 영상 수" value={`${formatNumber(data.teamSampleSize)}개`} hint="최근 30일 동안 팀이 등록한 영상 수예요. 많을수록 기준이 정확해요." />
        </StatGrid>

        <GlossaryHelp page="viral" keys={['viralThreshold', 'median', 'dailyViews', 'engagement']} />

        <Section title={isAdmin ? '급상승 영상 목록' : '내 급상승 영상'} count={data.items.length} description="확인이 필요한 영상이 위에 있어요. 확인하고 나면 아래 ‘확인한 영상’으로 옮겨져요. 잘못 눌렀다면 ‘확인 취소’로 되돌릴 수 있어요.">
          {data.items.length === 0 ? (
            filtered ? (
              <EmptyBlock title="이 조건에 맞는 급상승 영상이 없어요" actionLabel="필터 초기화" onAction={f.reset} secondaryLabel="조회수 새로고침 하러 가기" secondaryHref="/v3/lifecycle">
                기간·직원·형식 조건을 좁혀 두었어요. 조건을 풀면 다른 급상승 영상이 보일 수 있어요.
              </EmptyBlock>
            ) : (
              <EmptyBlock title="아직 급상승 영상이 없어요" actionLabel="조회수 새로고침 누르기" actionHref="/v3/lifecycle" secondaryLabel="영상 등록하러 가기" secondaryHref="/v3/register">
                조회수가 오래된 값이면 새로 오르는 영상을 찾지 못해요. 먼저 ‘조회수 새로고침’을 눌러 최신 조회수를 가져오면, 평소보다 {threshold}배 이상 빠르게 오르는 영상을 자동으로 찾아 여기에 보여드려요.
              </EmptyBlock>
            )
          ) : (
            <>
              {matched > maxItems ? <p className="v3a-sub-note">조건에 맞는 영상이 {formatNumber(matched)}개예요. 그중 많이 빠른 순으로 {formatNumber(maxItems)}개만 보여드려요. 형식·기간·직원 조건을 걸어 좁혀 보세요.</p> : null}
              {pending.length === 0 ? (
                <EmptyBlock compact title="확인이 필요한 영상은 모두 처리했어요" actionLabel="새 영상 등록하러 가기" actionHref="/v3/register">
                  아래 ‘확인한 영상’에서 메모를 고치거나 확인을 취소할 수 있어요.
                </EmptyBlock>
              ) : (
                <div className="v3a-cards">
                  {pendingMore.visible.map(renderCard)}
                  <MoreButton remaining={pendingMore.remaining} onClick={pendingMore.more} />
                </div>
              )}
              {done.length > 0 ? (
                <details className="v3a-fold">
                  <summary>확인한 영상 {formatNumber(done.length)}개 보기</summary>
                  <div className="v3a-fold-body">
                    <div className="v3a-cards">
                      {doneMore.visible.map(renderCard)}
                      <MoreButton remaining={doneMore.remaining} onClick={doneMore.more} />
                    </div>
                  </div>
                </details>
              ) : null}
            </>
          )}
        </Section>

        <HowTo>
          <p>하루 조회수 = 조회수 ÷ 올린 지 지난 날짜 (최소 1일)</p>
          <p>최근 30일 동안 팀이 올린 영상의 하루 조회수를 줄 세워 한가운데 값을 ‘평소’로 삼아요.</p>
          <p>그 평소 값의 {threshold}배 이상이면 급상승 영상으로 보여줘요. 배수가 높은 순으로 최대 {maxItems}개까지 나와요.</p>
          <p>‘왜 떴을까?’의 비교 기준(좋아요·댓글 비율의 중앙값)도 같은 팀 영상에서 구해요. ‘3.2배’는 팀 중앙값의 3.2배라는 뜻이에요.</p>
        </HowTo>
      </div>
      </div>
    </>
  )
}
