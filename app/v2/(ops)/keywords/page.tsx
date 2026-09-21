'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/v2/app-shell'
import { useV2Me } from '@/components/v2/session-context'
import { KeywordStatusTag, PriorityTag } from '@/components/v2/tags'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { Answer, EmptyGuide, HowTo, Kpi, KpiRow, LoadingLine, MoreButton, SampleNote } from '@/lib/v2/analysis-ui'
import { authedDeleteJson, authedPatchJson } from '@/lib/v2/client'
import { formatKstDateTime } from '@/lib/v2/dates'
import { shortText } from '@/lib/v2/format'
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
type Filter = 'open' | 'waiting' | 'in_progress' | 'done' | 'all'

const EMPTY: KeywordsPayload = { items: [], recentStocks: [] }
const PAGE_STEP = 15
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 }

function initialForm(): Form {
  return { stockName: '', keyword: '', sourceUrl: '', priority: 'normal' }
}

function normalize(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

export default function KeywordsPage() {
  const me = useV2Me()
  const { toast, showSuccess, showError } = useToast()
  const [payload, setPayload] = useState<KeywordsPayload>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState<Form>(initialForm)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<Filter>('open')
  const [visible, setVisible] = useState(PAGE_STEP)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    const { ok, data } = await authedFetchJson<KeywordsPayload>('/api/v2/keywords')
    setLoaded(true)
    if (!ok) {
      showError(data?.error || '키워드 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      return
    }
    setPayload(data)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const guardSample = () => {
    if (payload.sample) {
      showError(V2_MISSING_TABLE_MESSAGE)
      return true
    }
    return false
  }

  const recentHit = payload.recentStocks.find((r) => form.stockName.trim() && normalize(r.stock_name) === normalize(form.stockName))
  const sameKeyword =
    form.stockName.trim() && form.keyword.trim()
      ? payload.items.find((i) => normalize(i.stock_name) === normalize(form.stockName) && normalize(i.keyword) === normalize(form.keyword))
      : undefined

  // 입력칸 옆에 바로 보여줄 검증 메시지 (제출을 시도한 뒤부터)
  const errors = {
    stockName: form.stockName.trim() ? '' : '종목명을 입력해 주세요.',
    keyword: form.keyword.trim() ? '' : '어떤 내용으로 만들지 키워드를 적어 주세요.',
    sourceUrl: form.sourceUrl.trim() && !/^https?:\/\/\S+\.\S+/i.test(form.sourceUrl.trim()) ? '주소가 https:// 로 시작해야 해요.' : ''
  }
  const hasError = Boolean(errors.stockName || errors.keyword || errors.sourceUrl)

  const create = async () => {
    setSubmitted(true)
    if (hasError) return
    if (guardSample()) return
    setSaving(true)
    try {
      const { ok, data } = await authedPostJson<{ ok?: boolean; error?: string }>('/api/v2/keywords', {
        stockName: form.stockName.trim(),
        keyword: form.keyword.trim(),
        sourceUrl: form.sourceUrl.trim() || null,
        priority: form.priority
      })
      if (!ok) {
        showError(data?.error || '키워드를 등록하지 못했어요. 다시 시도해 주세요.')
        return
      }
      setForm(initialForm())
      setSubmitted(false)
      setFilter('open')
      showSuccess('키워드를 추가했어요.')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (item: KeywordRadarItem, status: KeywordStatus) => {
    if (guardSample()) return
    setBusyId(item.id)
    try {
      const { ok, data } = await authedPatchJson<{ ok?: boolean; error?: string }>('/api/v2/keywords', { id: item.id, status })
      if (!ok) {
        showError(data?.error || '상태를 바꾸지 못했어요. 다시 시도해 주세요.')
        return
      }
      showSuccess(`${item.stock_name} → ${KEYWORD_STATUS_LABELS[status]}`)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (item: KeywordRadarItem) => {
    if (guardSample()) return
    if (!window.confirm(`"${item.keyword}" 키워드를 삭제할까요?`)) return
    setBusyId(item.id)
    try {
      const { ok, data } = await authedDeleteJson<{ ok?: boolean; error?: string }>(`/api/v2/keywords?id=${item.id}`)
      if (!ok) {
        showError(data?.error || '삭제하지 못했어요. 다시 시도해 주세요.')
        return
      }
      showSuccess('삭제했어요.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const counts = useMemo(() => {
    const c = { waiting: 0, in_progress: 0, done: 0 }
    for (const item of payload.items) c[item.status] += 1
    return c
  }, [payload.items])

  // 급한(우선순위 높은) 것부터, 같으면 최근에 올라온 것부터
  const sorted = useMemo(
    () => [...payload.items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.created_at < b.created_at ? 1 : -1)),
    [payload.items]
  )
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
    { key: 'done', label: '완료', count: counts.done },
    { key: 'all', label: '전체', count: payload.items.length }
  ]

  return (
    <>
      <PageHeader title="키워드 모음" subtitle="지금 다루면 좋은 검색어를 팀이 함께 모아 두고, 누가 작업 중인지 확인하는 곳이에요." />
      <Toast toast={toast} />
      <SampleNote show={payload.sample} />

      {!loaded ? (
        <LoadingLine />
      ) : (
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
            <p className="panel-subtitle">누구나 추가할 수 있어요. 최근에 다룬 종목이면 아래에 알려 드려요.</p>
          </div>
        </div>
        <div className="v2-form-grid">
          <div className="field">
            <label className="label" htmlFor="kw-stock">
              종목명
            </label>
            <input
              id="kw-stock"
              className={`input compact ${submitted && errors.stockName ? 'invalid' : ''}`}
              value={form.stockName}
              placeholder="예: SK하이닉스"
              onChange={(e) => setForm({ ...form, stockName: e.target.value })}
            />
            {submitted && errors.stockName ? <span className="v2a-field-error">{errors.stockName}</span> : null}
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label className="label" htmlFor="kw-keyword">
              어떤 내용으로 만들까요?
            </label>
            <input
              id="kw-keyword"
              className={`input compact ${submitted && errors.keyword ? 'invalid' : ''}`}
              value={form.keyword}
              placeholder="예: 엔비디아 실적 발표 후 시간외 급등"
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
            />
            {submitted && errors.keyword ? <span className="v2a-field-error">{errors.keyword}</span> : null}
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
              className={`input compact ${submitted && errors.sourceUrl ? 'invalid' : ''}`}
              value={form.sourceUrl}
              placeholder="예: https://news.example.com/article/123"
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            />
            {submitted && errors.sourceUrl ? <span className="v2a-field-error">{errors.sourceUrl}</span> : null}
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button className="button" type="submit" disabled={saving}>
              {saving ? '추가하는 중…' : '키워드 추가'}
            </button>
          </div>
        </div>
        {sameKeyword ? (
          <div className="v2a-field-warn" style={{ marginTop: 10 }}>
            이미 같은 키워드가 있어요 ({KEYWORD_STATUS_LABELS[sameKeyword.status]}). 그래도 필요하면 그대로 추가하세요.
          </div>
        ) : recentHit ? (
          <div className="v2a-field-warn" style={{ marginTop: 10 }}>
            {recentHit.stock_name}은(는) 최근 7일 동안 {recentHit.count}번 다뤘어요 (마지막 {formatKstDateTime(recentHit.last_at)}). 다른 각도의 내용인지 확인해 주세요.
          </div>
        ) : null}
      </form>

      <div className="panel">
        <div className="v2a-toolbar">
          <div>
            <div className="panel-title">키워드 목록</div>
            <p className="panel-subtitle" style={{ marginTop: 4 }}>
              급한 것부터 보여줘요. 대기 → 작업중 → 완료 순서로 진행해요.
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

        {!loaded ? null : items.length === 0 ? (
          payload.items.length === 0 ? (
            <EmptyGuide title="아직 모아 둔 키워드가 없어요">위 입력칸에 종목과 내용을 적고 ‘키워드 추가’를 누르면 팀 모두가 볼 수 있는 목록이 만들어져요.</EmptyGuide>
          ) : (
            <EmptyGuide title="이 목록은 비어 있어요">
              {filter === 'open' ? '할 일이 모두 끝났어요. ‘완료’ 탭에서 지난 키워드를 볼 수 있어요.' : '다른 탭을 눌러 보세요.'}
            </EmptyGuide>
          )
        ) : (
          <div className="list">
            {shown.map((item) => {
              const busy = busyId === item.id
              const canEdit = me.isAdmin || item.created_by === me.crmUserId
              return (
                <div className="list-item" key={item.id}>
                  <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="v2-card-title">
                        <span>{item.stock_name}</span>
                        <PriorityTag priority={item.priority} />
                        <KeywordStatusTag status={item.status} />
                      </div>
                      <div className="v2-card-issue" style={{ marginTop: 4 }}>
                        {item.keyword}
                      </div>
                      <div className="v2-card-meta" style={{ marginTop: 6 }}>
                        <span>추가한 사람 {item.created_by_name || '-'}</span>
                        <span>{formatKstDateTime(item.created_at)}</span>
                        {item.source_url ? (
                          <a className="link" href={item.source_url} target="_blank" rel="noreferrer">
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
                        <button className="button secondary xs" disabled={busy} style={{ color: '#f87171' }} onClick={() => void remove(item)}>
                          삭제
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}

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
                <span key={r.stock_name} className={`v2-chip ${recentHit && recentHit.stock_name === r.stock_name ? 'hit' : ''}`} title={`마지막 ${formatKstDateTime(r.last_at)}`}>
                  {r.stock_name}
                  <b>{r.count}</b>
                </span>
              ))}
            </div>
            {payload.recentStocks.length > 12 ? (
              <HowTo title={`나머지 ${payload.recentStocks.length - 12}종목 더 보기`}>
                <div className="v2-chips">
                  {payload.recentStocks.slice(12, 60).map((r) => (
                    <span key={r.stock_name} className="v2-chip" title={`마지막 ${formatKstDateTime(r.last_at)}`}>
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
