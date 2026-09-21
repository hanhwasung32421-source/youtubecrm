'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/v2/app-shell'
import { ContentTypeTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { useV2Me } from '@/components/v2/session-context'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { Answer, EmptyGuide, HowTo, Kpi, KpiRow, LoadingLine, MoreButton, SampleNote } from '@/lib/v2/analysis-ui'
import { formatCount, shortText } from '@/lib/v2/format'
import { formatKstDate } from '@/lib/v2/dates'
import { V2_MISSING_TABLE_MESSAGE } from '@/lib/v2/tables'
import { SEO_CHECKLIST_LABELS, checklistDoneCount, type OptimizationPayload, type OptimizationRow } from '@/lib/v2/types'

const EMPTY: OptimizationPayload = { items: [] }
const PAGE_STEP = 15
const RATING_HINT: Record<number, string> = { 1: '눈에 안 띄어요', 2: '아쉬워요', 3: '보통이에요', 4: '눈에 띄어요', 5: '클릭하고 싶어요' }

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
    <span className="v2-stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`v2-star ${n <= value ? 'filled' : ''}`}
          disabled={disabled || !onPick}
          onClick={() => onPick?.(n)}
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
  const { toast, showSuccess, showError } = useToast()
  const [payload, setPayload] = useState<OptimizationPayload>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftRating, setDraftRating] = useState(3)
  const [draftNote, setDraftNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'todo' | 'all'>('todo')
  const [owner, setOwner] = useState('')
  const [visible, setVisible] = useState(PAGE_STEP)

  const load = async () => {
    const { ok, data } = await authedFetchJson<OptimizationPayload>('/api/v2/optimization')
    setLoaded(true)
    if (!ok) {
      showError(data?.error || '영상 점검 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      return
    }
    setPayload(data)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const owners = useMemo(() => {
    const set = new Set<string>()
    for (const row of payload.items) if (row.video.owner_name) set.add(row.video.owner_name)
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [payload.items])

  const scoped = useMemo(() => (owner ? payload.items.filter((row) => row.video.owner_name === owner) : payload.items), [payload.items, owner])
  const todo = useMemo(() => scoped.filter((row) => row.improvementScore > 0), [scoped])
  const urgent = scoped.filter((row) => row.improvementScore >= 3).length
  const noStock = scoped.filter((row) => !row.titleHasStock).length
  const noReview = scoped.filter((row) => !row.latestReview).length
  const list = view === 'todo' ? todo : scoped
  const shown = list.slice(0, visible)
  const top = todo[0]

  const openReview = (row: OptimizationRow) => {
    setOpenId(row.video.id)
    setDraftRating(row.latestReview?.rating || 3)
    setDraftNote('')
  }

  const submitReview = async (row: OptimizationRow) => {
    if (payload.sample) {
      showError(V2_MISSING_TABLE_MESSAGE)
      return
    }
    setSaving(true)
    try {
      const { ok, data } = await authedPostJson<{ ok?: boolean; error?: string }>('/api/v2/thumbnail-reviews', {
        videoId: row.video.id,
        rating: draftRating,
        note: draftNote.trim() || null
      })
      if (!ok) {
        showError(data?.error || '썸네일 평가를 저장하지 못했어요. 다시 시도해 주세요.')
        return
      }
      setOpenId(null)
      showSuccess('썸네일 평가를 저장했어요.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const who = me.isAdmin ? '전체 영상' : '내 영상'

  return (
    <>
      <PageHeader title="영상 점검" subtitle="제목·설명·썸네일이 검색에 잘 걸리는지 확인하고, 고칠 곳이 많은 영상부터 보여줍니다." />
      <Toast toast={toast} />
      <SampleNote show={payload.sample} />

      {!loaded ? (
        <LoadingLine />
      ) : payload.items.length === 0 ? (
        <EmptyGuide title={me.isAdmin ? '점검할 영상이 아직 없어요' : '아직 등록한 영상이 없어요'} href="/v2/register" action="영상 등록하러 가기">
          유튜브 주소와 종목을 등록하면 이 화면에서 제목·설명·썸네일을 자동으로 점검해 드려요.
        </EmptyGuide>
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
              <div className="v2-seg">
                <button className={view === 'todo' ? 'active' : ''} onClick={() => { setView('todo'); setVisible(PAGE_STEP) }}>
                  고칠 영상 {todo.length}
                </button>
                <button className={view === 'all' ? 'active' : ''} onClick={() => { setView('all'); setVisible(PAGE_STEP) }}>
                  전체 {scoped.length}
                </button>
              </div>
              {me.isAdmin && owners.length > 1 ? (
                <div className="row" style={{ gap: 8 }}>
                  <label className="small muted" htmlFor="opt-owner">
                    담당자
                  </label>
                  <select id="opt-owner" className="select compact" value={owner} onChange={(e) => { setOwner(e.target.value); setVisible(PAGE_STEP) }}>
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

            {list.length === 0 ? (
              <EmptyGuide title="이 조건에 맞는 영상이 없어요">위의 탭에서 ‘전체’를 눌러 모든 영상을 볼 수 있어요.</EmptyGuide>
            ) : (
              <div className="list">
                {shown.map((row) => {
                  const done = checklistDoneCount(row.checklist)
                  const problems = problemsOf(row)
                  const isOpen = openId === row.video.id
                  return (
                    <div className="list-item" key={row.video.id}>
                      <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="v2-card-title">
                            <span>{row.video.title || '(제목 수집 대기)'}</span>
                            <ContentTypeTag contentType={row.video.content_type} />
                          </div>
                          <div className="v2-card-meta" style={{ marginTop: 6 }}>
                            <span>{row.video.stock_name}</span>
                            {me.isAdmin && row.video.owner_name ? <span>담당 {row.video.owner_name}</span> : null}
                            <span>발행 {formatKstDate(row.video.published_at)}</span>
                            <span title={`${(row.video.view_count ?? 0).toLocaleString('ko-KR')}회`}>조회 {formatCount(row.video.view_count)}회</span>
                          </div>
                        </div>
                        <span className={`pill ${problems.length === 0 ? 'success' : problems.length >= 3 ? 'danger' : 'warning'}`}>
                          {problems.length === 0 ? '문제 없음' : `고칠 곳 ${problems.length}개`}
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
                          {row.latestReview ? (
                            <>
                              <StarPicker value={row.latestReview.rating} disabled />
                              {row.latestReview.note ? <span className="small muted">“{row.latestReview.note}”</span> : null}
                            </>
                          ) : (
                            <span className="small muted">아직 없어요</span>
                          )}
                        </div>
                        <button className="button secondary xs" onClick={() => (isOpen ? setOpenId(null) : openReview(row))}>
                          {isOpen ? '닫기' : row.latestReview ? '다시 평가하기' : '썸네일 평가하기'}
                        </button>
                      </div>

                      {isOpen ? (
                        <div className="v2-card-form" style={{ marginTop: 10 }}>
                          <div className="field" style={{ gap: 6 }}>
                            <label className="label">이 썸네일, 눈에 띄나요?</label>
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
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !saving) void submitReview(row)
                                }}
                              />
                              <button className="button success xs" disabled={saving} onClick={() => void submitReview(row)}>
                                {saving ? '저장 중…' : '저장'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <details className="v2a-howto" style={{ marginTop: 8 }}>
                        <summary>SEO 체크리스트 {done}/4</summary>
                        <div className="v2a-howto-body">
                          <div className="v2-card-meta">
                            {Object.entries(SEO_CHECKLIST_LABELS).map(([field, label]) => {
                              const checked = Boolean(row.checklist[field as keyof typeof row.checklist])
                              return (
                                <span key={field} style={{ color: checked ? '#4ade80' : undefined }}>
                                  {checked ? '✓' : '○'} {label}
                                </span>
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
              <p>SEO 체크리스트(4칸)는 영상 등록 화면에서 채우며, 여기서는 진행 상황만 보여줘요.</p>
            </HowTo>
          </div>
        </>
      )}
    </>
  )
}
