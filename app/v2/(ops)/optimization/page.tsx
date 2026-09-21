'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v2/app-shell'
import { ContentTypeTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { useV2Me } from '@/components/v2/session-context'
import { Answer, EmptyGuide, FieldError, HowTo, InlineConfirm, Kpi, KpiRow, LoadError, MoreButton, RefreshNote, SampleNote, SkeletonList, SkeletonSummary, Stamp } from '@/lib/v2/analysis-ui'
import { v2Delete, v2Patch, v2Post } from '@/lib/v2/client'
import { formatCountOrDash, formatExact, shortText } from '@/lib/v2/format'
import { useV2Query } from '@/lib/v2/swr'
import { useRememberedState } from '@/lib/v2/use-remembered'
import { V2_MISSING_TABLE_MESSAGE } from '@/lib/v2/tables'
import {
  SEO_CHECKLIST_FIELDS,
  SEO_CHECKLIST_LABELS,
  checklistDoneCount,
  improvementScoreOf,
  type OptimizationPayload,
  type OptimizationRow,
  type SeoChecklistField,
  type ThumbnailReview
} from '@/lib/v2/types'

const EMPTY: OptimizationPayload = { items: [] }
const isPayload = (data: unknown) => Array.isArray((data as { items?: unknown } | null)?.items)
const PAGE_STEP = 15
const VIEWS = ['todo', 'all'] as const
const RATING_HINT: Record<number, string> = { 1: '눈에 안 띄어요', 2: '아쉬워요', 3: '보통이에요', 4: '눈에 띄어요', 5: '클릭하고 싶어요' }
const LOAD_ERROR = '영상 점검 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'

// 고칠 점을 쉬운 말로 풀어 쓴다. 심각한 것(빨강)과 주의(노랑)를 구분.
function problemsOf(row: OptimizationRow): { text: string; bad?: boolean }[] {
  const list: { text: string; bad?: boolean }[] = []
  if (row.titleLength === 0) list.push({ text: '제목을 아직 못 가져왔어요', bad: true })
  else if (!row.titleLengthOk) list.push({ text: `제목이 너무 길어요 (${row.titleLength}자, 60자 이내 권장)` })
  if (!row.titleHasStock) list.push({ text: '제목에 종목명이 없어요', bad: true })
  if (!row.hasDescription) list.push({ text: '설명란이 비어 있어요' })
  if (!row.latestReview) list.push({ text: '썸네일 평가를 아직 안 했어요' })
  else if (row.latestReview.rating < 3) list.push({ text: `썸네일 평가가 낮아요 (${row.latestReview.rating}점)` })
  return list
}

function StarPicker({ value, onPick, disabled }: { value: number; onPick?: (rating: number) => void; disabled?: boolean }) {
  return (
    <span className="v2-stars" role={onPick ? 'radiogroup' : undefined} aria-label="썸네일 별점">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`v2-star ${n <= value ? 'filled' : ''}`}
          data-active={n === value ? 'true' : undefined}
          disabled={disabled || !onPick}
          onClick={() => onPick?.(n)}
          role={onPick ? 'radio' : undefined}
          aria-checked={onPick ? n === value : undefined}
          aria-label={`${n}점`}
          title={RATING_HINT[n]}
        >
          ★
        </button>
      ))}
    </span>
  )
}

export default function OptimizationPage() {
  const me = useV2Me()
  const { toast, showError } = useToast()
  const query = useV2Query<OptimizationPayload>('/api/v2/optimization', { fallback: LOAD_ERROR, validate: isPayload })
  const payload = query.data ?? EMPTY
  const loaded = !query.loading
  const loadError = query.error
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftRating, setDraftRating] = useState(3)
  const [draftNote, setDraftNote] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingChecks, setPendingChecks] = useState<Set<string>>(() => new Set())
  const [view, setView] = useRememberedState<'todo' | 'all'>('opt.view', 'todo', VIEWS)
  const [owner, setOwner] = useRememberedState<string>('opt.owner', '')
  const [visible, setVisible] = useState(PAGE_STEP)
  const formRef = useRef<HTMLFormElement>(null)
  // 저장 버튼을 빠르게 두 번 눌러도 한 번만 보내도록 상태보다 먼저 바뀌는 표시를 함께 둔다.
  const savingRef = useRef(false)
  const pendingRef = useRef<Set<string>>(new Set())

  // 별점 입력이 열리면 현재 별점 버튼으로 바로 포커스를 옮긴다.
  useEffect(() => {
    if (!openId) return
    formRef.current?.querySelector<HTMLButtonElement>('.v2-star[data-active="true"]')?.focus()
  }, [openId])

  const owners = useMemo(() => {
    const set = new Set<string>()
    for (const row of payload.items) if (row.video.owner_name) set.add(row.video.owner_name)
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [payload.items])

  // 저장해 둔 담당자가 지금 목록에 없으면 전체로 본다.
  const ownerNow = owners.includes(owner) ? owner : ''
  const scoped = useMemo(() => (ownerNow ? payload.items.filter((row) => row.video.owner_name === ownerNow) : payload.items), [payload.items, ownerNow])
  const todo = useMemo(() => scoped.filter((row) => row.improvementScore > 0), [scoped])
  const urgent = scoped.filter((row) => row.improvementScore >= 3).length
  const noStock = scoped.filter((row) => !row.titleHasStock).length
  const noReview = scoped.filter((row) => !row.latestReview).length
  const list = view === 'todo' ? todo : scoped
  const shown = list.slice(0, visible)
  const top = todo[0]

  const patchRow = (videoId: string, fn: (row: OptimizationRow) => OptimizationRow) => {
    query.setData((prev) => ({ ...prev, items: prev.items.map((row) => (row.video.id === videoId ? fn(row) : row)) }))
  }

  const openReview = (row: OptimizationRow) => {
    setOpenId(row.video.id)
    setDraftRating(row.latestReview?.rating || 3)
    setDraftNote('')
    setFormError('')
  }

  const closeReview = () => {
    setOpenId(null)
    setFormError('')
  }

  const submitReview = async (row: OptimizationRow) => {
    if (saving || savingRef.current) return
    if (payload.sample) {
      setFormError(V2_MISSING_TABLE_MESSAGE)
      return
    }
    savingRef.current = true
    setSaving(true)
    setFormError('')
    const res = await v2Post<{ ok?: boolean; item?: ThumbnailReview }>(
      '/api/v2/thumbnail-reviews',
      { videoId: row.video.id, rating: draftRating, note: draftNote.trim() || null },
      '썸네일 평가를 저장하지 못했어요. 다시 시도해 주세요.'
    )
    savingRef.current = false
    setSaving(false)
    query.noteStatus(res.status)
    if (!res.ok || !res.data.item) {
      setFormError(res.error || '썸네일 평가를 저장하지 못했어요. 다시 시도해 주세요.')
      return
    }
    const item = res.data.item
    // 목록을 다시 불러오지 않고 그 자리에서 바로 바꾼다 (화면이 움직이지 않도록).
    patchRow(row.video.id, (r) => ({ ...r, latestReview: item, improvementScore: improvementScoreOf({ ...r, latestReview: item }) }))
    closeReview()
  }

  const deleteReview = async (row: OptimizationRow) => {
    const review = row.latestReview
    if (!review || deletingId) return
    setDeletingId(review.id)
    const res = await v2Delete(`/api/v2/thumbnail-reviews?id=${encodeURIComponent(review.id)}`, '평가를 지우지 못했어요. 다시 시도해 주세요.')
    setDeletingId(null)
    query.noteStatus(res.status)
    if (!res.ok) {
      showError(res.error)
      return
    }
    // 이전에 남긴 평가가 있으면 그것이 다시 최신이 되므로 서버 값으로 맞춘다.
    query.reload()
  }

  // 체크리스트 칸: 누르면 바로 바뀌고, 저장에 실패하면 원래대로 되돌린다.
  const toggleCheck = async (row: OptimizationRow, field: SeoChecklistField) => {
    const key = `${row.video.id}:${field}`
    if (pendingChecks.has(key) || pendingRef.current.has(key)) return
    if (payload.sample) {
      showError(V2_MISSING_TABLE_MESSAGE)
      return
    }
    pendingRef.current.add(key)
    const next = !row.checklist[field]
    patchRow(row.video.id, (r) => ({ ...r, checklist: { ...r.checklist, [field]: next } }))
    setPendingChecks((prev) => new Set(prev).add(key))
    const res = await v2Patch('/api/v2/seo-checklists', { videoId: row.video.id, patch: { [field]: next } }, '체크리스트를 저장하지 못했어요. 다시 시도해 주세요.')
    query.noteStatus(res.status)
    pendingRef.current.delete(key)
    setPendingChecks((prev) => {
      const copy = new Set(prev)
      copy.delete(key)
      return copy
    })
    if (!res.ok) {
      patchRow(row.video.id, (r) => ({ ...r, checklist: { ...r.checklist, [field]: !next } }))
      showError(res.error)
    }
  }

  const who = me.isAdmin ? '전체 영상' : '내 영상'

  return (
    <>
      <PageHeader title="영상 점검" subtitle="제목·설명·썸네일이 검색에 잘 걸리는지 확인하고, 고칠 곳이 많은 영상부터 보여줍니다." />
      <Toast toast={toast} />
      <SampleNote show={payload.sample} />
      {(loaded && loadError) || query.expired ? <LoadError message={loadError} expired={query.expired} onRetry={query.reload} /> : null}
      <RefreshNote show={query.refreshing} />

      {!loaded ? (
        <>
          <SkeletonSummary />
          <div className="panel">
            <SkeletonList rows={4} />
          </div>
        </>
      ) : payload.items.length === 0 ? (
        loadError ? null : (
          <EmptyGuide title={me.isAdmin ? '점검할 영상이 아직 없어요' : '아직 등록한 영상이 없어요'} href="/v2/register" action="영상 등록하러 가기">
            유튜브 주소와 종목을 등록하면 이 화면에서 제목·설명·썸네일을 자동으로 점검해 드려요.
          </EmptyGuide>
        )
      ) : (
        <>
          <Answer tone={todo.length === 0 ? 'good' : urgent > 0 ? 'bad' : 'neutral'}>
            {todo.length === 0 ? (
              <>{who} {scoped.length.toLocaleString('ko-KR')}개 모두 점검을 통과했어요. 새 영상을 등록하면 여기서 다시 확인할 수 있어요.</>
            ) : (
              <>
                지금 고칠 곳이 있는 영상이 <b>{todo.length.toLocaleString('ko-KR')}개</b> 있어요. 가장 급한 영상은 「{shortText(top?.video.title)}」
                {top ? ` — ${problemsOf(top)[0]?.text}` : ''}
              </>
            )}
          </Answer>

          <KpiRow>
            <Kpi label="먼저 고칠 영상" value={urgent.toLocaleString('ko-KR')} unit="개" tone={urgent > 0 ? 'bad' : 'good'} hint="고칠 곳이 3가지 이상인 영상 수예요." />
            <Kpi label="제목에 종목명이 없는 영상" value={noStock.toLocaleString('ko-KR')} unit="개" tone={noStock > 0 ? 'warn' : 'good'} hint="제목에 종목명이 있어야 검색할 때 잘 나와요." />
            <Kpi label="썸네일 평가 기다리는 영상" value={noReview.toLocaleString('ko-KR')} unit="개" tone={noReview > 0 ? 'warn' : 'good'} hint="별점을 아직 남기지 않은 영상 수예요." />
          </KpiRow>

          <div className="panel">
            <div className="v2a-toolbar">
              <div className="v2-seg" role="tablist" aria-label="보기">
                <button role="tab" aria-selected={view === 'todo'} className={view === 'todo' ? 'active' : ''} onClick={() => { setView('todo'); setVisible(PAGE_STEP) }}>
                  고칠 영상 {todo.length}
                </button>
                <button role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'active' : ''} onClick={() => { setView('all'); setVisible(PAGE_STEP) }}>
                  전체 {scoped.length}
                </button>
              </div>
              {me.isAdmin && owners.length > 1 ? (
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" htmlFor="opt-owner">
                    담당자
                  </label>
                  <select id="opt-owner" className="select compact" value={ownerNow} onChange={(e) => { setOwner(e.target.value); setVisible(PAGE_STEP) }}>
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

            {payload.capped ? <p className="v2a-note">가장 최근에 등록한 영상 위주로 보여드려요. 더 오래된 영상은 이 목록에 나오지 않을 수 있어요.</p> : null}

            {list.length === 0 ? (
              <EmptyGuide title="이 조건에 맞는 영상이 없어요">위의 탭에서 ‘전체’를 눌러 모든 영상을 볼 수 있어요.</EmptyGuide>
            ) : (
              <div className="list">
                {shown.map((row) => {
                  const done = checklistDoneCount(row.checklist)
                  const problems = problemsOf(row)
                  const isOpen = openId === row.video.id
                  const review = row.latestReview
                  const canDeleteReview = Boolean(review && (me.isAdmin || review.reviewed_by === me.crmUserId))
                  return (
                    <div className="list-item" key={row.video.id}>
                      <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="v2-card-title">
                            <span className="v2a-clamp2" title={row.video.title || ''}>
                              {row.video.youtube_url ? (
                                <a href={row.video.youtube_url} target="_blank" rel="noreferrer noopener">
                                  {row.video.title || '(제목 수집 대기)'}
                                </a>
                              ) : (
                                row.video.title || '(제목 수집 대기)'
                              )}
                            </span>
                            <ContentTypeTag contentType={row.video.content_type} />
                          </div>
                          <div className="v2-card-meta" style={{ marginTop: 6 }}>
                            <span>{row.video.stock_name}</span>
                            {me.isAdmin && row.video.owner_name ? <span>담당 {row.video.owner_name}</span> : null}
                            <span>
                              발행 <Stamp iso={row.video.published_at} />
                            </span>
                            <span title={row.video.view_count == null ? '아직 조회수를 가져오지 못했어요' : `${formatExact(row.video.view_count)}회`}>
                              조회 {row.video.view_count == null ? '-' : `${formatCountOrDash(row.video.view_count)}회`}
                            </span>
                          </div>
                        </div>
                        <span className={`pill ${problems.length === 0 ? 'success' : problems.length >= 3 ? 'danger' : 'warning'}`} style={{ flex: 'none' }}>
                          {problems.length === 0 ? '✓ 문제 없음' : `${problems.length >= 3 ? '▼ ' : ''}고칠 곳 ${problems.length}개`}
                        </span>
                      </div>

                      <div className="v2a-reasons" style={{ marginTop: 10 }}>
                        {problems.length === 0 ? (
                          <span className="v2a-reason ok">제목·설명·썸네일 모두 괜찮아요</span>
                        ) : (
                          problems.map((p) => (
                            <span key={p.text} className={`v2a-reason ${p.bad ? 'bad' : ''}`}>
                              {p.text}
                            </span>
                          ))
                        )}
                      </div>

                      <div className="row-between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 10 }}>
                        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                          <span className="small muted" title="썸네일만 보고 클릭하고 싶은지 별점으로 남기는 자가 평가예요.">
                            썸네일 평가
                          </span>
                          {review ? (
                            <>
                              <StarPicker value={review.rating} disabled />
                              {review.note ? <span className="small muted">“{review.note}”</span> : null}
                            </>
                          ) : (
                            <span className="small muted">아직 없어요</span>
                          )}
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {canDeleteReview && !isOpen ? (
                            <InlineConfirm label="평가 지우기" prompt="이 평가를 지울까요?" confirmLabel="지우기" busyLabel="지우는 중…" busy={deletingId === review?.id} onConfirm={() => void deleteReview(row)} />
                          ) : null}
                          <button className="button secondary xs" onClick={() => (isOpen ? closeReview() : openReview(row))}>
                            {isOpen ? '닫기' : review ? '다시 평가하기' : '썸네일 평가하기'}
                          </button>
                        </div>
                      </div>

                      {isOpen ? (
                        <form
                          ref={formRef}
                          className="v2-card-form"
                          style={{ marginTop: 10 }}
                          noValidate
                          onSubmit={(e) => {
                            e.preventDefault()
                            void submitReview(row)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              closeReview()
                              return
                            }
                            // 숫자 1~5 를 누르면 별점 선택 (입력칸에서 글을 쓰는 중에는 제외)
                            if (/^[1-5]$/.test(e.key) && (e.target as HTMLElement).tagName !== 'INPUT') setDraftRating(Number(e.key))
                          }}
                        >
                          <div className="field" style={{ gap: 6 }}>
                            <span className="label">이 썸네일, 눈에 띄나요?</span>
                            <div className="row" style={{ gap: 10 }}>
                              <StarPicker value={draftRating} onPick={setDraftRating} />
                              <span className="small muted">
                                {draftRating}점 · {RATING_HINT[draftRating]}
                              </span>
                            </div>
                          </div>
                          <div className="field" style={{ gap: 6, marginTop: 10 }}>
                            <label className="label" htmlFor={`note-${row.video.id}`}>
                              메모 (선택)
                            </label>
                            <div className="row" style={{ gap: 8 }}>
                              <input
                                id={`note-${row.video.id}`}
                                className="input compact"
                                style={{ flex: 1 }}
                                maxLength={300}
                                placeholder="예: 글자가 작아서 잘 안 보여요"
                                value={draftNote}
                                onChange={(e) => setDraftNote(e.target.value)}
                              />
                              <button className="button success xs" type="submit" disabled={saving}>
                                {saving ? '저장 중…' : '저장'}
                              </button>
                              <button className="button secondary xs" type="button" disabled={saving} onClick={closeReview}>
                                취소
                              </button>
                            </div>
                            <FieldError>{formError}</FieldError>
                          </div>
                        </form>
                      ) : null}

                      <details className="v2a-howto" style={{ marginTop: 8 }}>
                        <summary>SEO 체크리스트 {done}/4</summary>
                        <div className="v2a-howto-body">
                          <div className="v2a-checks">
                            {SEO_CHECKLIST_FIELDS.map((field) => {
                              const checked = Boolean(row.checklist[field])
                              const pending = pendingChecks.has(`${row.video.id}:${field}`)
                              return (
                                <label key={field} className={`v2a-check ${checked ? 'on' : ''} ${pending ? 'pending' : ''}`}>
                                  <input type="checkbox" checked={checked} disabled={pending} onChange={() => void toggleCheck(row, field)} />
                                  {SEO_CHECKLIST_LABELS[field]}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      </details>
                    </div>
                  )
                })}
              </div>
            )}

            <MoreButton shown={shown.length} total={list.length} step={PAGE_STEP} onMore={() => setVisible((v) => v + PAGE_STEP)} />

            <HowTo title="‘고칠 곳’은 어떻게 세나요? (계산 방법 보기)">
              <p>아래 4가지를 하나씩 확인해서, 해당하는 것만큼 ‘고칠 곳’이 늘어나요. 많을수록 위에 보여요.</p>
              <p>1) 제목이 60자를 넘거나 비어 있음 · 2) 제목에 종목명이 없음 · 3) 설명란이 비어 있음 · 4) 썸네일 평가가 없거나 3점 미만</p>
              <p>SEO 체크리스트(4칸)는 영상 등록 화면에서도 채울 수 있고, 여기서 칸을 눌러 바로 체크하거나 풀 수도 있어요. 점수 계산에는 반영되지 않고 성과 요약의 반응 점수에 쓰여요.</p>
            </HowTo>
          </div>
        </>
      )}
    </>
  )
}
