'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v2/app-shell'
import { useV2Me } from '@/components/v2/session-context'
import { KeywordStatusTag, PriorityTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { Answer, EmptyGuide, FieldError, HowTo, InlineConfirm, Kpi, KpiRow, LoadError, MoreButton, RefreshNote, Req, SampleNote, SkeletonList, SkeletonSummary, Stamp } from '@/lib/v2/analysis-ui'
import { v2Delete, v2Patch, v2Post } from '@/lib/v2/client'
import { formatKstStamp } from '@/lib/v2/dates'
import { shortText } from '@/lib/v2/format'
import { useV2Query } from '@/lib/v2/swr'
import { useRememberedState } from '@/lib/v2/use-remembered'
import { V2_MISSING_TABLE_MESSAGE } from '@/lib/v2/tables'
import {
  KEYWORD_STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type KeywordRadarItem,
  type KeywordStatus,
  type KeywordsPayload,
  type Priority
} from '@/lib/v2/types'

type Form = { stockName: string; keyword: string; sourceUrl: string; priority: Priority }
type FormErrors = { stockName: string; keyword: string; sourceUrl: string }
type Filter = 'open' | 'waiting' | 'in_progress' | 'done' | 'all'

const FILTERS = ['open', 'waiting', 'in_progress', 'done', 'all'] as const
const EMPTY: KeywordsPayload = { items: [], recentStocks: [] }
const isPayload = (data: unknown) => {
  const d = data as { items?: unknown; recentStocks?: unknown } | null
  return Array.isArray(d?.items) && Array.isArray(d?.recentStocks)
}
const PAGE_STEP = 15
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 }
const LOAD_ERROR = '키워드 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'

function initialForm(): Form {
  return { stockName: '', keyword: '', sourceUrl: '', priority: 'normal' }
}

function normalize(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

function validate(form: Form): FormErrors {
  return {
    stockName: form.stockName.trim() ? '' : '종목명을 입력해 주세요.',
    keyword: form.keyword.trim() ? '' : '어떤 내용으로 만들지 키워드를 적어 주세요.',
    sourceUrl: form.sourceUrl.trim() && !/^https?:\/\/\S+\.\S+/i.test(form.sourceUrl.trim()) ? '주소가 https:// 로 시작해야 해요.' : ''
  }
}

// 상태 → 우선순위 → 최근 순. 끝난 것은 항상 아래.
function sortItems(items: KeywordRadarItem[]) {
  return [...items].sort(
    (a, b) =>
      Number(a.status === 'done') - Number(b.status === 'done') ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.created_at < b.created_at ? 1 : -1)
  )
}

export default function KeywordsPage() {
  const me = useV2Me()
  const { toast, showError } = useToast()
  const query = useV2Query<KeywordsPayload>('/api/v2/keywords', { fallback: LOAD_ERROR, validate: isPayload })
  const payload = query.data ?? EMPTY
  const loaded = !query.loading
  const loadError = query.error
  const [form, setForm] = useState<Form>(initialForm)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useRememberedState<Filter>('kw.filter', 'open', FILTERS)
  const [visible, setVisible] = useState(PAGE_STEP)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Form>(initialForm)
  const [editSubmitted, setEditSubmitted] = useState(false)
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const stockRef = useRef<HTMLInputElement>(null)
  const keywordRef = useRef<HTMLInputElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const editStockRef = useRef<HTMLInputElement>(null)
  // 버튼을 빠르게 두 번 눌러도 한 번만 보내도록, 상태보다 먼저 바뀌는 표시를 함께 둔다.
  const creatingRef = useRef(false)
  const editingRef = useRef(false)
  const busyRef = useRef<Set<string>>(new Set())
  const deletingRef = useRef(false)

  // 수정 칸이 열리면 첫 입력칸으로 포커스
  useEffect(() => {
    if (editId) editStockRef.current?.focus()
  }, [editId])

  const guardSample = () => {
    if (payload.sample) {
      showError(V2_MISSING_TABLE_MESSAGE)
      return true
    }
    return false
  }

  const setItems = (fn: (items: KeywordRadarItem[]) => KeywordRadarItem[], doneDelta = 0) => {
    query.setData((prev) => ({
      ...prev,
      items: fn(prev.items),
      doneTotal: prev.doneTotal === undefined ? undefined : Math.max(0, prev.doneTotal + doneDelta)
    }))
  }

  const recentHit = payload.recentStocks.find((r) => form.stockName.trim() && normalize(r.stock_name) === normalize(form.stockName))
  const sameKeyword =
    form.stockName.trim() && form.keyword.trim()
      ? payload.items.find((i) => normalize(i.stock_name) === normalize(form.stockName) && normalize(i.keyword) === normalize(form.keyword))
      : undefined

  // 입력칸 바로 아래에 보여줄 검증 메시지 (제출을 시도한 뒤부터)
  const errors = validate(form)
  const hasError = Boolean(errors.stockName || errors.keyword || errors.sourceUrl)
  const editErrors = validate(editForm)
  const editHasError = Boolean(editErrors.stockName || editErrors.keyword || editErrors.sourceUrl)

  const create = async () => {
    setSubmitted(true)
    setFormError('')
    if (hasError) {
      ;(errors.stockName ? stockRef : errors.keyword ? keywordRef : urlRef).current?.focus()
      return
    }
    if (guardSample() || creatingRef.current) return
    creatingRef.current = true
    setSaving(true)
    const res = await v2Post<{ ok?: boolean; item?: KeywordRadarItem }>(
      '/api/v2/keywords',
      { stockName: form.stockName.trim(), keyword: form.keyword.trim(), sourceUrl: form.sourceUrl.trim() || null, priority: form.priority },
      '키워드를 저장하지 못했어요. 다시 시도해 주세요.'
    )
    creatingRef.current = false
    setSaving(false)
    query.noteStatus(res.status)
    if (!res.ok || !res.data.item) {
      setFormError(res.error || '키워드를 저장하지 못했어요. 다시 시도해 주세요.')
      return
    }
    const item = res.data.item
    setItems((items) => [item, ...items.filter((i) => i.id !== item.id)])
    // 목록을 아직 못 받은 상태에서 추가했다면(드물게) 서버 값으로 다시 맞춘다.
    if (!query.data) query.reload()
    setForm(initialForm())
    setSubmitted(false)
    // 새 키워드는 '대기'로 들어가므로, 안 보이는 탭이면 '할 일'로 옮겨 바로 보이게 한다.
    if (filter === 'in_progress' || filter === 'done') setFilter('open')
    stockRef.current?.focus()
  }

  // 상태 변경: 누르면 바로 바뀌고, 저장에 실패하면 원래대로 되돌린다.
  const setStatus = async (item: KeywordRadarItem, status: KeywordStatus) => {
    if (guardSample() || busyIds.has(item.id) || busyRef.current.has(item.id)) return
    busyRef.current.add(item.id)
    const before = item.status
    const delta = (status === 'done' ? 1 : 0) - (before === 'done' ? 1 : 0)
    setBusyIds((prev) => new Set(prev).add(item.id))
    setItems((items) => items.map((i) => (i.id === item.id ? { ...i, status } : i)), delta)
    const res = await v2Patch('/api/v2/keywords', { id: item.id, status }, '상태를 바꾸지 못했어요. 다시 시도해 주세요.')
    busyRef.current.delete(item.id)
    query.noteStatus(res.status)
    setBusyIds((prev) => {
      const copy = new Set(prev)
      copy.delete(item.id)
      return copy
    })
    if (!res.ok) {
      setItems((items) => items.map((i) => (i.id === item.id ? { ...i, status: before } : i)), -delta)
      showError(res.error)
      if (res.status === 404) query.reload()
    }
  }

  const openEdit = (item: KeywordRadarItem) => {
    setEditId(item.id)
    setEditForm({ stockName: item.stock_name, keyword: item.keyword, sourceUrl: item.source_url || '', priority: item.priority })
    setEditSubmitted(false)
    setEditError('')
  }

  const closeEdit = () => {
    setEditId(null)
    setEditError('')
  }

  const saveEdit = async (item: KeywordRadarItem) => {
    if (editSaving || editingRef.current) return
    setEditSubmitted(true)
    setEditError('')
    if (editHasError) return
    if (guardSample()) return
    editingRef.current = true
    setEditSaving(true)
    const res = await v2Patch<{ ok?: boolean; item?: KeywordRadarItem }>(
      '/api/v2/keywords',
      {
        id: item.id,
        stockName: editForm.stockName.trim(),
        keyword: editForm.keyword.trim(),
        sourceUrl: editForm.sourceUrl.trim() || null,
        priority: editForm.priority
      },
      '키워드를 저장하지 못했어요. 다시 시도해 주세요.'
    )
    editingRef.current = false
    setEditSaving(false)
    query.noteStatus(res.status)
    if (!res.ok || !res.data.item) {
      setEditError(res.error || '키워드를 저장하지 못했어요. 다시 시도해 주세요.')
      if (res.status === 404) {
        closeEdit()
        query.reload()
      }
      return
    }
    const saved = res.data.item
    setItems((items) => items.map((i) => (i.id === saved.id ? { ...i, ...saved } : i)))
    closeEdit()
  }

  const remove = async (item: KeywordRadarItem) => {
    if (guardSample() || deletingRef.current) return
    deletingRef.current = true
    setDeletingId(item.id)
    const res = await v2Delete(`/api/v2/keywords?id=${encodeURIComponent(item.id)}`, '삭제하지 못했어요. 다시 시도해 주세요.')
    deletingRef.current = false
    setDeletingId(null)
    query.noteStatus(res.status)
    if (!res.ok) {
      showError(res.error)
      return
    }
    setItems((items) => items.filter((i) => i.id !== item.id), item.status === 'done' ? -1 : 0)
  }

  const counts = useMemo(() => {
    const c = { waiting: 0, in_progress: 0, done: 0 }
    for (const item of payload.items) c[item.status] += 1
    return c
  }, [payload.items])
  const doneCount = Math.max(counts.done, payload.doneTotal ?? 0)

  const sorted = useMemo(() => sortItems(payload.items), [payload.items])
  const openItems = sorted.filter((i) => i.status !== 'done')
  const items = sorted.filter((i) => (filter === 'all' ? true : filter === 'open' ? i.status !== 'done' : i.status === filter))
  const shown = items.slice(0, visible)
  const nextUp = openItems.find((i) => i.status === 'waiting') || openItems[0]

  const pickFilter = (next: Filter) => {
    setFilter(next)
    setVisible(PAGE_STEP)
  }

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'open', label: '할 일', count: counts.waiting + counts.in_progress },
    { key: 'waiting', label: '대기', count: counts.waiting },
    { key: 'in_progress', label: '작업중', count: counts.in_progress },
    { key: 'done', label: '완료', count: doneCount },
    { key: 'all', label: '전체', count: counts.waiting + counts.in_progress + doneCount }
  ]

  return (
    <>
      <PageHeader title="키워드 모음" subtitle="지금 다루면 좋은 검색어를 팀이 함께 모아 두고, 누가 작업 중인지 확인하는 곳이에요." />
      <Toast toast={toast} />
      <SampleNote show={payload.sample} />
      {(loaded && loadError) || query.expired ? <LoadError message={loadError} expired={query.expired} onRetry={query.reload} /> : null}
      <RefreshNote show={query.refreshing} />

      {!loaded ? (
        <SkeletonSummary />
      ) : loadError && payload.items.length === 0 ? null : (
        <Answer>
          {openItems.length === 0 ? (
            <>지금 기다리는 키워드가 없어요. 아래에서 다음에 다룰 키워드를 추가해 보세요.</>
          ) : (
            <>
              지금 다룰 수 있는 키워드가 <b>{openItems.length.toLocaleString('ko-KR')}개</b> 있어요.
              {nextUp ? (
                <>
                  {' '}
                  먼저 볼 것은 「{nextUp.stock_name} — {shortText(nextUp.keyword, 30)}」
                  {nextUp.priority === 'high' ? ' (급함)' : ''}
                </>
              ) : null}
            </>
          )}
        </Answer>
      )}

      {loaded ? (
        <KpiRow>
          <Kpi label="대기 중" value={counts.waiting.toLocaleString('ko-KR')} unit="개" tone={counts.waiting > 0 ? 'warn' : 'neutral'} hint="아직 아무도 시작하지 않은 키워드예요." />
          <Kpi label="작업중" value={counts.in_progress.toLocaleString('ko-KR')} unit="개" hint="누군가 영상을 만들고 있는 키워드예요." />
          <Kpi label="최근 7일 다룬 종목" value={payload.recentStocks.length.toLocaleString('ko-KR')} unit="종목" hint="같은 종목이 겹치지 않게 아래에서 확인해요." />
        </KpiRow>
      ) : null}

      <form
        className="panel"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!saving) void create()
        }}
      >
        <div className="panel-header">
          <div>
            <div className="panel-title">새 키워드 추가</div>
            <p className="panel-subtitle">
              누구나 추가할 수 있어요. 최근에 다룬 종목이면 아래에 알려 드려요. <Req /> 표시는 꼭 적어야 해요.
            </p>
          </div>
        </div>
        <div className="v2-form-grid" style={{ alignItems: 'start' }}>
          <div className="field">
            <label className="label" htmlFor="kw-stock">
              종목명
              <Req />
            </label>
            <input
              id="kw-stock"
              ref={stockRef}
              className={`input compact ${submitted && errors.stockName ? 'invalid' : ''}`}
              value={form.stockName}
              maxLength={80}
              placeholder="예: SK하이닉스"
              aria-invalid={submitted && Boolean(errors.stockName)}
              aria-describedby={submitted && errors.stockName ? 'kw-stock-err' : undefined}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, stockName: e.target.value })}
            />
            <FieldError id="kw-stock-err">{submitted ? errors.stockName : ''}</FieldError>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label className="label" htmlFor="kw-keyword">
              어떤 내용으로 만들까요?
              <Req />
            </label>
            <input
              id="kw-keyword"
              ref={keywordRef}
              className={`input compact ${submitted && errors.keyword ? 'invalid' : ''}`}
              value={form.keyword}
              maxLength={120}
              placeholder="예: 엔비디아 실적 발표 후 시간외 급등"
              aria-invalid={submitted && Boolean(errors.keyword)}
              aria-describedby={submitted && errors.keyword ? 'kw-keyword-err' : undefined}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
            />
            <FieldError id="kw-keyword-err">{submitted ? errors.keyword : ''}</FieldError>
          </div>
          <div className="field">
            <label className="label" htmlFor="kw-priority">
              얼마나 급한가요?
            </label>
            <select id="kw-priority" className="select compact" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label className="label" htmlFor="kw-url">
              참고 기사 주소 (선택)
            </label>
            <input
              id="kw-url"
              ref={urlRef}
              className={`input compact ${submitted && errors.sourceUrl ? 'invalid' : ''}`}
              value={form.sourceUrl}
              maxLength={500}
              inputMode="url"
              placeholder="예: https://news.example.com/article/123"
              aria-invalid={submitted && Boolean(errors.sourceUrl)}
              aria-describedby={submitted && errors.sourceUrl ? 'kw-url-err' : undefined}
              autoComplete="off"
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            />
            <FieldError id="kw-url-err">{submitted ? errors.sourceUrl : ''}</FieldError>
          </div>
          <div className="field">
            <span className="label" aria-hidden="true">
              &nbsp;
            </span>
            <button className="button" type="submit" disabled={saving}>
              {saving ? '저장 중…' : '키워드 추가'}
            </button>
          </div>
        </div>
        <FieldError>{formError}</FieldError>
        {sameKeyword ? (
          <div className="v2a-field-warn" style={{ marginTop: 10 }}>
            이미 같은 키워드가 있어요 ({KEYWORD_STATUS_LABELS[sameKeyword.status]}). 그래도 필요하면 그대로 추가하세요.
          </div>
        ) : recentHit ? (
          <div className="v2a-field-warn" style={{ marginTop: 10 }}>
            {recentHit.stock_name}은(는) 최근 7일 동안 {recentHit.count}번 다뤘어요 (마지막 {formatKstStamp(recentHit.last_at)}). 다른 각도의 내용인지 확인해 주세요.
          </div>
        ) : null}
      </form>

      <div className="panel">
        <div className="v2a-toolbar">
          <div>
            <div className="panel-title">키워드 목록</div>
            <p className="panel-subtitle" style={{ marginTop: 4 }}>
              급한 것부터 보여줘요. 대기 → 작업중 → 완료 순서로 진행하고, 수정·삭제는 추가한 사람과 관리자만 할 수 있어요.
            </p>
          </div>
          <div className="v2-seg" role="tablist" aria-label="키워드 보기">
            {tabs.map((tab) => (
              <button key={tab.key} role="tab" aria-selected={filter === tab.key} className={filter === tab.key ? 'active' : ''} onClick={() => pickFilter(tab.key)}>
                {tab.label} {tab.count}
              </button>
            ))}
          </div>
        </div>

        {!loaded ? (
          <SkeletonList rows={3} />
        ) : items.length === 0 ? (
          payload.items.length === 0 ? (
            loadError ? null : (
              <EmptyGuide title="아직 모아 둔 키워드가 없어요">위 입력칸에 종목과 내용을 적고 ‘키워드 추가’를 누르면 팀 모두가 볼 수 있는 목록이 만들어져요.</EmptyGuide>
            )
          ) : (
            <EmptyGuide title="이 목록은 비어 있어요">
              {filter === 'open' ? '할 일이 모두 끝났어요. ‘완료’ 탭에서 지난 키워드를 볼 수 있어요.' : '다른 탭을 눌러 보세요.'}
            </EmptyGuide>
          )
        ) : (
          <div className="list">
            {shown.map((item) => {
              const busy = busyIds.has(item.id)
              const canEdit = me.isAdmin || item.created_by === me.crmUserId
              const editing = editId === item.id
              return (
                <div className="list-item" key={item.id}>
                  {editing ? (
                    <form
                      className="v2a-inline-edit"
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault()
                        void saveEdit(item)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          closeEdit()
                        }
                      }}
                    >
                      <div className="field">
                        <label className="label" htmlFor={`ed-stock-${item.id}`}>
                          종목명
                          <Req />
                        </label>
                        <input
                          id={`ed-stock-${item.id}`}
                          ref={editStockRef}
                          className={`input compact ${editSubmitted && editErrors.stockName ? 'invalid' : ''}`}
                          value={editForm.stockName}
                          maxLength={80}
                          autoComplete="off"
                          onChange={(e) => setEditForm({ ...editForm, stockName: e.target.value })}
                        />
                        <FieldError>{editSubmitted ? editErrors.stockName : ''}</FieldError>
                      </div>
                      <div className="field">
                        <label className="label" htmlFor={`ed-prio-${item.id}`}>
                          얼마나 급한가요?
                        </label>
                        <select id={`ed-prio-${item.id}`} className="select compact" value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value as Priority })}>
                          {PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                              {PRIORITY_LABELS[p]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field wide">
                        <label className="label" htmlFor={`ed-kw-${item.id}`}>
                          어떤 내용으로 만들까요?
                          <Req />
                        </label>
                        <input
                          id={`ed-kw-${item.id}`}
                          className={`input compact ${editSubmitted && editErrors.keyword ? 'invalid' : ''}`}
                          value={editForm.keyword}
                          maxLength={120}
                          autoComplete="off"
                          onChange={(e) => setEditForm({ ...editForm, keyword: e.target.value })}
                        />
                        <FieldError>{editSubmitted ? editErrors.keyword : ''}</FieldError>
                      </div>
                      <div className="field wide">
                        <label className="label" htmlFor={`ed-url-${item.id}`}>
                          참고 기사 주소 (선택)
                        </label>
                        <input
                          id={`ed-url-${item.id}`}
                          className={`input compact ${editSubmitted && editErrors.sourceUrl ? 'invalid' : ''}`}
                          value={editForm.sourceUrl}
                          maxLength={500}
                          inputMode="url"
                          autoComplete="off"
                          onChange={(e) => setEditForm({ ...editForm, sourceUrl: e.target.value })}
                        />
                        <FieldError>{editSubmitted ? editErrors.sourceUrl : ''}</FieldError>
                      </div>
                      <div className="v2a-inline-actions">
                        <button className="button success xs" type="submit" disabled={editSaving}>
                          {editSaving ? '저장 중…' : '저장'}
                        </button>
                        <button className="button secondary xs" type="button" disabled={editSaving} onClick={closeEdit}>
                          취소
                        </button>
                        <FieldError>{editError}</FieldError>
                      </div>
                    </form>
                  ) : (
                    <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="v2-card-title">
                          <span>{item.stock_name}</span>
                          <PriorityTag priority={item.priority} />
                          <KeywordStatusTag status={item.status} />
                        </div>
                        <div className="v2a-kw-issue" style={{ marginTop: 4 }}>
                          {item.keyword}
                        </div>
                        <div className="v2-card-meta" style={{ marginTop: 6 }}>
                          <span>추가한 사람 {item.created_by_name || '-'}</span>
                          <span>
                            <Stamp iso={item.created_at} />
                          </span>
                          {item.source_url ? (
                            <a className="link" href={item.source_url} target="_blank" rel="noreferrer noopener">
                              참고 기사 ↗
                            </a>
                          ) : null}
                        </div>
                      </div>
                      {canEdit ? (
                        <div className="v2-card-actions" style={{ justifyContent: 'flex-end' }}>
                          {item.status === 'waiting' ? (
                            <button className="button secondary xs" disabled={busy} onClick={() => void setStatus(item, 'in_progress')}>
                              작업 시작
                            </button>
                          ) : null}
                          {item.status === 'in_progress' ? (
                            <button className="button secondary xs" disabled={busy} onClick={() => void setStatus(item, 'waiting')}>
                              대기로 돌리기
                            </button>
                          ) : null}
                          {item.status !== 'done' ? (
                            <button className="button success xs" disabled={busy} onClick={() => void setStatus(item, 'done')}>
                              완료
                            </button>
                          ) : (
                            <button className="button secondary xs" disabled={busy} onClick={() => void setStatus(item, 'waiting')}>
                              다시 열기
                            </button>
                          )}
                          <button className="button secondary xs" disabled={busy} onClick={() => openEdit(item)}>
                            수정
                          </button>
                          <InlineConfirm prompt="이 키워드를 삭제할까요?" busy={deletingId === item.id} disabled={busy} onConfirm={() => void remove(item)} />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {filter === 'done' && doneCount > counts.done ? <p className="v2a-note" style={{ marginTop: 10 }}>완료한 키워드는 최근 것부터 {counts.done}개만 보여드려요.</p> : null}

        <MoreButton shown={shown.length} total={items.length} step={PAGE_STEP} onMore={() => setVisible((v) => v + PAGE_STEP)} />
      </div>

      <div className="panel soft">
        <div className="v2-section-title">최근 7일 이미 다룬 종목</div>
        {payload.recentStocks.length === 0 ? (
          <div className="small muted">최근 7일 동안 등록된 영상이 없어요. 영상이 등록되면 여기에 종목별로 모여요.</div>
        ) : (
          <>
            <div className="v2-chips">
              {payload.recentStocks.slice(0, 12).map((r) => (
                <span key={r.stock_name} aria-label={`${r.stock_name} 최근 7일 ${r.count}번`} className={`v2-chip ${recentHit && recentHit.stock_name === r.stock_name ? 'hit' : ''}`} title={`마지막 ${formatKstStamp(r.last_at)}`}>
                  {r.stock_name}
                  <b>{r.count}</b>
                </span>
              ))}
            </div>
            {payload.recentStocks.length > 12 ? (
              <HowTo title={`나머지 ${payload.recentStocks.length - 12}종목 더 보기`}>
                <div className="v2-chips">
                  {payload.recentStocks.slice(12, 60).map((r) => (
                    <span key={r.stock_name} aria-label={`${r.stock_name} 최근 7일 ${r.count}번`} className="v2-chip" title={`마지막 ${formatKstStamp(r.last_at)}`}>
                      {r.stock_name}
                      <b>{r.count}</b>
                    </span>
                  ))}
                </div>
              </HowTo>
            ) : null}
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              종목 옆 숫자는 최근 7일 동안 그 종목으로 등록한 영상 수예요. 숫자가 클수록 이미 많이 다룬 종목이에요.
            </p>
          </>
        )}
      </div>
    </>
  )
}
