'use client'

import '../analysis.css'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { Section, Tag } from '@/components/v3/ui'
import { useV3Me } from '@/components/v3/auth-guard'
import { v3Request } from '@/lib/v3/api-client'
import { ConfirmButton, FieldError, InlineEditor, useLatest } from '@/lib/v3/interact'
import { formatCompactNumber, formatDateTime, formatNumber } from '@/lib/v3/format'
import { AnswerCard, EmptyBlock, ErrorBlock, HowTo, LoadingBlock, MoreButton, SetupNote, StatCard, StatGrid, useShowMore } from '../analysis-parts'

type ViralItem = {
  id: string
  title: string
  stockName: string | null
  contentType: 'longform' | 'shortform'
  youtubeUrl: string | null
  viewCount: number | null
  velocity: number
  ratio: number
  note: string
  acknowledged: boolean
  actionNote: string | null
  ackedAt?: string | null
  ackedByName?: string | null
}

type ViralResponse = {
  insufficientData: boolean
  teamMedianVelocity: number
  teamSampleSize: number
  minSampleSize?: number
  thresholdMultiplier?: number
  acksAvailable: boolean
  summary: string
  items: ViralItem[]
}

export default function ViralPage() {
  const me = useV3Me()
  const { toast, showError } = useToast()
  const showErrorRef = useLatest(showError)
  const [data, setData] = useState<ViralResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ackingId, setAckingId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})

  const setCardError = (id: string, message: string | null) =>
    setCardErrors((prev) => {
      const next = { ...prev }
      if (message) next[id] = message
      else delete next[id]
      return next
    })

  const load = useCallback(async () => {
    const res = await v3Request<ViralResponse>('/api/v3/viral', {}, '급상승 영상을 불러오지 못했어요.')
    if (!res.ok) {
      setLoadError(res.error)
      showErrorRef.current(res.error || '급상승 영상을 불러오지 못했어요.')
      return
    }
    setLoadError(null)
    setData(res.data)
  }, [showErrorRef])

  useEffect(() => {
    void load()
  }, [load])

  const patchItem = (id: string, patch: Partial<ViralItem>) =>
    setData((prev) => (prev ? { ...prev, items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) } : prev))

  // 확인 표시: 화면에서 먼저 "확인 완료"로 옮기고, 저장에 실패하면 되돌린다.
  const ack = async (item: ViralItem) => {
    if (ackingId) return
    const actionNote = (notes[item.id] || '').trim()
    setAckingId(item.id)
    setCardError(item.id, null)
    patchItem(item.id, { acknowledged: true, actionNote: actionNote || null, ackedAt: new Date().toISOString(), ackedByName: me?.name || null })
    const res = await v3Request('/api/v3/viral/ack', { method: 'POST', body: { videoId: item.id, actionNote: actionNote || undefined } }, '확인 표시를 저장하지 못했어요.')
    setAckingId(null)
    if (!res.ok) {
      patchItem(item.id, { acknowledged: false, actionNote: item.actionNote, ackedAt: item.ackedAt ?? null, ackedByName: item.ackedByName ?? null })
      setCardError(item.id, res.error)
      return
    }
    setNotes((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
  }

  const saveNote = async (item: ViralItem, value: string) => {
    setEditSaving(true)
    setEditError(null)
    const res = await v3Request('/api/v3/viral/ack', { method: 'PATCH', body: { videoId: item.id, actionNote: value || undefined } }, '메모를 저장하지 못했어요.')
    setEditSaving(false)
    if (!res.ok) {
      setEditError(res.error)
      return
    }
    patchItem(item.id, { actionNote: value || null })
    setEditingId(null)
  }

  const undoAck = async (item: ViralItem) => {
    setUndoingId(item.id)
    setCardError(item.id, null)
    patchItem(item.id, { acknowledged: false, actionNote: null })
    const res = await v3Request('/api/v3/viral/ack', { method: 'DELETE', body: { videoId: item.id } }, '확인 취소에 실패했어요.')
    setUndoingId(null)
    if (!res.ok) {
      patchItem(item.id, { acknowledged: true, actionNote: item.actionNote })
      setCardError(item.id, res.error)
      return
    }
    // 예전 메모는 지워졌으니, 다시 확인할 때 빈 칸에서 시작한다.
    setNotes((prev) => ({ ...prev, [item.id]: '' }))
  }

  const pending = (data?.items || []).filter((i) => !i.acknowledged)
  const done = (data?.items || []).filter((i) => i.acknowledged)
  const pendingMore = useShowMore(pending, 5, 10)
  const doneMore = useShowMore(done, 5, 10)

  const header = <PageHeader icon="🔥" title="급상승 영상" subtitle="조회수가 평소보다 빠르게 오르는 영상을 찾아 줍니다." />

  if (!data) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        {loadError ? <ErrorBlock message={loadError} onRetry={() => void load()} /> : <LoadingBlock>급상승 영상을 찾는 중이에요…</LoadingBlock>}
      </>
    )
  }

  const isAdmin = !!me?.isAdmin
  const threshold = data.thresholdMultiplier ?? 2
  const minSample = data.minSampleSize ?? 5
  const median = data.teamMedianVelocity

  const renderCard = (item: ViralItem) => {
    const inputId = `v3-ack-note-${item.id}`
    const busy = ackingId === item.id
    return (
      <div key={item.id} className={`v3a-card ${item.acknowledged ? 'done' : 'hot'}`}>
        <div className="v3a-card-head">
          <div className="v3a-card-title">
            {item.youtubeUrl ? (
              <a className="v3-link" href={item.youtubeUrl} target="_blank" rel="noreferrer">
                {item.title}
              </a>
            ) : (
              item.title
            )}{' '}
            <Tag tone={item.contentType === 'shortform' ? 'violet' : 'blue'}>{item.contentType === 'shortform' ? '숏폼' : '롱폼'}</Tag>
            {item.stockName ? <Tag tone="gray">{item.stockName}</Tag> : null}
          </div>
          <span className="v3a-badge">보통의 {item.ratio.toFixed(1)}배</span>
        </div>
        <div className="v3a-card-meta">
          <span>지금까지 조회수 {formatCompactNumber(item.viewCount)}회</span>
          <span>하루 평균 {formatNumber(item.velocity)}회씩 늘어요 (보통 영상은 {formatNumber(median)}회)</span>
        </div>
        {item.acknowledged ? (
          <>
            <div className="v3a-check">
              ✓ 확인 완료
              {item.ackedByName || item.ackedAt ? ` (${[item.ackedByName, item.ackedAt ? formatDateTime(item.ackedAt) : null].filter(Boolean).join(' · ')})` : ''}
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
        )}
        <FieldError>{cardErrors[item.id]}</FieldError>
      </div>
    )
  }

  // ── 맨 위 한 문장 답 ──────────────────────────────────────
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
        action={
          short ? (
            <Link className="button" href="/v3/register">
              영상 등록하러 가기
            </Link>
          ) : null
        }
      />
    )
  } else if (data.items.length === 0) {
    answer = (
      <AnswerCard
        eyebrow={isAdmin ? '팀 전체 기준' : '내 영상 기준'}
        headline="지금은 유독 빠르게 오르는 영상이 없어요. 평소처럼 등록하면 돼요."
        detail={`보통 영상은 하루 약 ${formatNumber(median)}회 조회돼요. 그보다 ${threshold}배 이상 빠른 영상이 생기면 여기에 나타나요.`}
      />
    )
  } else if (pending.length > 0) {
    const top = pending[0]
    answer = (
      <AnswerCard
        tone="good"
        eyebrow={isAdmin ? '팀 전체 기준' : '내 영상 기준'}
        headline={
          <>
            지금 눈여겨볼 영상이 {formatNumber(pending.length)}개 있어요. 1위는 “{top.title}” — 보통 영상보다 {top.ratio.toFixed(1)}배 빠르게 조회수가 오르고 있어요.
          </>
        }
        detail="이런 영상은 같은 종목의 후속 영상이나 비슷한 주제를 빨리 만들수록 효과가 커요."
        action={
          top.youtubeUrl ? (
            <a className="button" href={top.youtubeUrl} target="_blank" rel="noreferrer">
              1위 영상 열어보기
            </a>
          ) : null
        }
      />
    )
  } else {
    answer = (
      <AnswerCard tone="good" eyebrow={isAdmin ? '팀 전체 기준' : '내 영상 기준'} headline={`급상승 영상 ${formatNumber(done.length)}개를 모두 확인했어요. 새로 오르는 영상이 생기면 여기에 나타나요.`} />
    )
  }

  return (
    <>
      {header}
      <Toast toast={toast} />

      <div className="v3a-stack">
        {answer}

        {!data.acksAvailable && data.items.length > 0 ? <SetupNote>“확인했어요” 기록을 저장하려면 이 SQL을 먼저 실행해 주세요 —</SetupNote> : null}

        <StatGrid>
          <StatCard
            label="아직 확인 안 한 급상승 영상"
            value={`${formatNumber(pending.length)}개`}
            tone={pending.length > 0 ? 'good' : 'neutral'}
            hint={`보통 영상보다 ${threshold}배 이상 빠르게 조회수가 오르는데 아직 확인 표시를 하지 않은 영상이에요.`}
          />
          <StatCard
            label="보통 영상의 하루 조회수"
            value={`${formatNumber(median)}회`}
            hint="최근 30일 영상을 하루 조회수 순으로 줄 세웠을 때 한가운데 영상의 값이에요. 이 값이 ‘평소’ 기준이에요."
          />
          <StatCard label="비교한 영상 수" value={`${formatNumber(data.teamSampleSize)}개`} hint="최근 30일 동안 팀이 등록한 영상 수예요. 많을수록 기준이 정확해요." />
        </StatGrid>

        <Section title={isAdmin ? '급상승 영상 목록' : '내 급상승 영상'} count={data.items.length} description="확인이 필요한 영상이 위에 있어요. 확인하고 나면 아래 ‘확인한 영상’으로 옮겨져요. 잘못 눌렀다면 ‘확인 취소’로 되돌릴 수 있어요.">
          {data.items.length === 0 ? (
            <EmptyBlock title="아직 급상승 영상이 없어요">
              영상이 등록되고 조회수가 쌓이면, 평소보다 {threshold}배 이상 빠르게 오르는 영상을 자동으로 찾아 여기에 보여드려요. 따로 할 일은 없어요.
            </EmptyBlock>
          ) : (
            <>
              {pending.length === 0 ? (
                <p className="v3a-note">확인이 필요한 영상은 모두 처리했어요.</p>
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
          <p>그 평소 값의 {threshold}배 이상이면 급상승 영상으로 보여줘요. 배수가 높은 순으로 최대 30개까지 나와요.</p>
        </HowTo>
      </div>
    </>
  )
}
