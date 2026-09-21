'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/v5/app-shell'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { authedPatchJson } from '@/lib/v5/client'
import { formatDate, isoWeekLabel, isoWeekRangeText } from '@/lib/v5/format'
import { AnswerBanner, EmptyBlock, FormField, LoadError, LoadingLine, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import type { RetroActionItem, WeeklyRetro } from '@/lib/v5/types'

function RetroCard({ retro, highlight, onToggle }: { retro: WeeklyRetro; highlight?: boolean; onToggle: (idx: number) => void }) {
  const done = retro.action_items.filter((a) => a.done).length
  return (
    <article className={`v5p-retro-card ${highlight ? 'current' : ''}`}>
      <header className="v5p-retro-head">
        <h3>{isoWeekRangeText(retro.week_label)}</h3>
        <span className="small muted">
          {retro.author_name || '관리자'} · {formatDate(retro.created_at)} 작성
        </span>
      </header>
      {retro.went_well ? (
        <div className="v5p-retro-block">
          <div className="v5p-card-key">잘된 점</div>
          <div>{retro.went_well}</div>
        </div>
      ) : null}
      {retro.to_improve ? (
        <div className="v5p-retro-block">
          <div className="v5p-card-key">고칠 점</div>
          <div>{retro.to_improve}</div>
        </div>
      ) : null}
      {retro.action_items.length > 0 ? (
        <div className="v5p-retro-block">
          <div className="v5p-card-key">
            다음 주 할 일 · {fmtNum(done)}/{fmtNum(retro.action_items.length)} 완료
          </div>
          <ul className="v5p-todo">
            {retro.action_items.map((item, idx) => (
              <li key={idx}>
                <label className={item.done ? 'done' : ''}>
                  <input type="checkbox" checked={item.done} onChange={() => onToggle(idx)} />
                  <span>{item.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <footer className="v5p-retro-foot small muted">
        쓸 당시 최근 7일 기록: 영상 {fmtNum(retro.kpi_snapshot.totalVideos)}편 · 조회수 합계 {fmtNum(retro.kpi_snapshot.totalViews)}
      </footer>
    </article>
  )
}

export default function RetrosPage() {
  const { toast, showSuccess, showError } = useToast()
  const [items, setItems] = useState<WeeklyRetro[]>([])
  const [sample, setSample] = useState(false)
  const [thisWeek, setThisWeek] = useState(() => isoWeekLabel())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [wentWell, setWentWell] = useState('')
  const [toImprove, setToImprove] = useState('')
  const [actionDraft, setActionDraft] = useState('')
  const [actionItems, setActionItems] = useState<RetroActionItem[]>([])
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setLoadError('')
    const res = await authedFetchJson<{ sample: boolean; items: WeeklyRetro[]; thisWeekLabel?: string; error?: string }>('/api/v5/retros')
    if (res.ok) {
      setItems(res.data.items || [])
      setSample(Boolean(res.data.sample))
      if (res.data.thisWeekLabel) setThisWeek(res.data.thisWeekLabel)
    } else {
      setLoadError(res.data?.error || '회고를 불러오지 못했어요.')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const current = useMemo(() => items.find((r) => r.week_label === thisWeek) || null, [items, thisWeek])
  const previous = useMemo(() => items.filter((r) => r.week_label !== thisWeek), [items, thisWeek])
  const lastRetro = previous[0] || null
  const carryOver = useMemo(() => (lastRetro ? lastRetro.action_items.map((a, idx) => ({ ...a, idx })).filter((a) => !a.done) : []), [lastRetro])

  const addActionItem = () => {
    const text = actionDraft.trim()
    if (!text) return
    setActionItems((prev) => [...prev, { text, done: false }])
    setActionDraft('')
    setFormError('')
  }

  const onCreate = async () => {
    // 입력 중이던 할 일도 놓치지 않게 함께 저장한다.
    const draft = actionDraft.trim()
    const finalActions = draft ? [...actionItems, { text: draft, done: false }] : actionItems
    if (!wentWell.trim() && !toImprove.trim() && finalActions.length === 0) {
      setFormError('한 줄이라도 적어 주세요. 예: “숏폼 조회수가 늘었어요.”')
      return
    }
    setFormError('')

    setSaving(true)
    try {
      const res = await authedPostJson('/api/v5/retros', { wentWell: wentWell.trim() || undefined, toImprove: toImprove.trim() || undefined, actionItems: finalActions })
      if (!res.ok) {
        showError((res.data as any)?.error || '저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
        if (res.status === 409) await load()
        return
      }
      showSuccess('이번 주 회고를 저장했어요.')
      setWentWell('')
      setToImprove('')
      setActionDraft('')
      setActionItems([])
      await load()
    } finally {
      setSaving(false)
    }
  }

  const onToggle = async (retroId: string, idx: number) => {
    const target = items.find((r) => r.id === retroId)
    if (!target) return
    const nextItems = target.action_items.map((item, i) => (i === idx ? { ...item, done: !item.done } : item))
    setItems((prev) => prev.map((r) => (r.id === retroId ? { ...r, action_items: nextItems } : r)))
    const res = await authedPatchJson(`/api/v5/retros/${retroId}`, { actionItems: nextItems })
    if (!res.ok) {
      showError((res.data as any)?.error || '체크를 저장하지 못했어요.')
      await load()
    }
  }

  const weekRange = isoWeekRangeText(thisWeek)
  const doneCount = current ? current.action_items.filter((a) => a.done).length : 0

  return (
    <>
      <PageHeader title="주간 회고" subtitle="한 주를 돌아보며 잘된 점, 고칠 점, 다음 주 할 일을 남겨요." />

      <SampleNote show={sample} />

      {loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingLine />
      ) : (
        <>
          <AnswerBanner
            label={`이번 주 (${weekRange})`}
            tone={current ? 'good' : 'neutral'}
            aside={
              !current && lastRetro ? (
                <span className="small muted">
                  지난 회고 ({isoWeekRangeText(lastRetro.week_label)}){lastRetro.went_well ? ` · 잘된 점: ${lastRetro.went_well.slice(0, 50)}${lastRetro.went_well.length > 50 ? '…' : ''}` : ''}
                </span>
              ) : null
            }
          >
            {current ? (
              <>
                이번 주 회고를 <strong>이미 썼어요</strong>
                {current.action_items.length > 0 ? ` · 다음 주 할 일 ${fmtNum(doneCount)}/${fmtNum(current.action_items.length)} 완료` : ''}
              </>
            ) : items.length === 0 ? (
              <>아직 쓴 회고가 없어요. 이번 주 것부터 한 줄만 적어 볼까요?</>
            ) : (
              <>
                이번 주 회고를 <strong>아직 안 썼어요</strong>
                {carryOver.length > 0 ? ` · 지난주에 못 끝낸 할 일 ${fmtNum(carryOver.length)}개` : ''}
              </>
            )}
          </AnswerBanner>

          {!current && carryOver.length > 0 && lastRetro ? (
            <section className="v5p-carry" aria-label="지난주에 못 끝낸 할 일">
              <div className="v5p-section-head">
                <h2>지난주에 못 끝낸 할 일</h2>
                <span className="small muted">끝냈다면 체크해 두세요</span>
              </div>
              <ul className="v5p-todo">
                {carryOver.map((a) => (
                  <li key={a.idx}>
                    <label>
                      <input type="checkbox" checked={false} onChange={() => void onToggle(lastRetro.id, a.idx)} />
                      <span>{a.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!current ? (
            <section className="v5p-retro-form" aria-label="이번 주 회고 쓰기">
              <div className="v5p-section-head">
                <h2>이번 주 회고 쓰기</h2>
                <span className="small muted">한 줄이면 충분해요 · 그 주의 조회수·영상 수는 저장할 때 자동으로 함께 남아요</span>
              </div>
              <div className="v5p-form-cols">
                <FormField label="잘된 점" hint="이번 주 반응이 좋았던 것" htmlFor="v5p-well">
                  <textarea id="v5p-well" className="textarea" rows={3} value={wentWell} onChange={(e) => { setWentWell(e.target.value); setFormError('') }} placeholder="예: 반도체 종목 영상 조회수가 평소보다 컸어요" />
                </FormField>
                <FormField label="고칠 점" hint="아쉬웠던 것" htmlFor="v5p-imp">
                  <textarea id="v5p-imp" className="textarea" rows={3} value={toImprove} onChange={(e) => { setToImprove(e.target.value); setFormError('') }} placeholder="예: 숏폼은 앞 3초에 시선을 못 잡았어요" />
                </FormField>
              </div>
              <FormField label="다음 주 할 일" optional hint="하나 쓰고 Enter 키를 누르면 목록에 추가돼요." htmlFor="v5p-act">
                <div className="row">
                  <input
                    id="v5p-act"
                    className="input"
                    value={actionDraft}
                    maxLength={200}
                    onChange={(e) => setActionDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        addActionItem()
                      }
                    }}
                    placeholder="예: 숏폼 첫 3초 훅 다시 만들어 보기"
                  />
                  <button className="button secondary nowrap" type="button" onClick={addActionItem}>
                    추가
                  </button>
                </div>
                {actionItems.length > 0 ? (
                  <ul className="v5p-todo added">
                    {actionItems.map((item, idx) => (
                      <li key={idx}>
                        <span>{item.text}</span>
                        <button type="button" className="button xs ghost" onClick={() => setActionItems((prev) => prev.filter((_, i) => i !== idx))} aria-label={`“${item.text}” 빼기`}>
                          빼기
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </FormField>
              {formError ? (
                <div className="v5p-field-error" role="alert">
                  {formError}
                </div>
              ) : null}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="button" type="button" disabled={saving} onClick={onCreate}>
                  {saving ? '저장 중…' : '이번 주 회고 저장'}
                </button>
              </div>
            </section>
          ) : null}

          <section style={{ marginTop: 24 }} aria-label="회고 기록">
            <div className="v5p-section-head">
              <h2>{current ? '회고 기록' : '지난 회고'}</h2>
            </div>
            {(current ? items : previous).length === 0 ? (
              <EmptyBlock title="아직 지난 회고가 없어요">회고를 저장하면 여기에 주마다 쌓여요.</EmptyBlock>
            ) : (
              <div className="v5p-retro-grid">
                {(current ? items : previous).map((retro) => (
                  <RetroCard key={retro.id} retro={retro} highlight={retro.week_label === thisWeek} onToggle={(idx) => void onToggle(retro.id, idx)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <Toast toast={toast} />
    </>
  )
}
