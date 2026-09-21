'use client'

import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/v5/app-shell'
import { Badge } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { authedDeleteJson, authedPatchJson, errorText, v5Get, v5Post } from '@/lib/v5/client'
import { PLAYBOOK_SPEC, type PlaybookSort } from '@/lib/v5/filters'
import { ActiveFilters, CopyLinkButton, GlossaryTip, UndoBar, useUndoSlot, type FilterChip } from '@/lib/v5/insight-parts'
import { AnswerBanner, EmptyBlock, ErrorText, FormField, LoadError, RelTime, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import { CardGridSkeleton } from '@/lib/v5/skeleton'
import { playbookTitleSuggestion } from '@/lib/v5/suggest'
import { useV5Query } from '@/lib/v5/swr'
import { ConfirmDelete, FormDrawer, useSingleFlight } from '@/lib/v5/ui'
import { useUrlFilters } from '@/lib/v5/use-filters'
import { VideoPicker, type PickedVideo } from '@/lib/v5/video-picker'
import type { PlaybookEntry } from '@/lib/v5/types'

type FormState = { title: string; whenToUse: string; video: PickedVideo[]; tags: string; effectNote: string }
const EMPTY_FORM: FormState = { title: '', whenToUse: '', video: [], tags: '', effectNote: '' }
type FormErrors = Partial<Record<'title' | 'whenToUse', string>>

const FILTER_KEY = 'v5.playbook.filters.v1'
const ONE_SHOT_PARAMS = ['new', 'video', 'note']
const TAG_PREVIEW = 12
// 한 번에 그리는 카드 수(그 이상은 "더 보기")
const CARD_PAGE = 30
const SORT_LABEL: Record<PlaybookSort, string> = { usage: '자주 쓴 순', recent: '최근 순' }

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.title.trim()) errors.title = '공식의 이름을 적어 주세요.'
  if (!form.whenToUse.trim()) errors.whenToUse = '어떤 때 쓰는지 한 줄로 적어 주세요.'
  return errors
}

const parseTags = (text: string) =>
  text
    .split(/[,，\n]/)
    .map((t) => t.trim().replace(/^#+/, '').trim())
    .filter(Boolean)

const hasTag = (entry: PlaybookEntry, tag: string) => entry.tags.some((t) => t.toLowerCase() === tag.toLowerCase())

// memo: 카드가 많아도 "바뀐 카드만" 다시 그린다(핸들러는 부모에서 고정된 함수를 넘긴다).
const FormulaCard = memo(function FormulaCard({
  entry,
  rank,
  busy,
  recorded,
  error,
  canUse,
  canEdit,
  activeTags,
  onUse,
  onTag,
  onEdit,
  onDelete
}: {
  entry: PlaybookEntry
  rank?: number
  busy: boolean
  recorded: boolean
  error?: string
  canUse: boolean
  canEdit: boolean
  activeTags: string[]
  onUse: (entry: PlaybookEntry) => void
  onTag: (tag: string) => void
  onEdit: (entry: PlaybookEntry) => void
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <article className="v5p-pb-card">
      <div className="v5p-pb-head">
        {rank ? <span className="v5-rank-badge top">{rank}</span> : null}
        <h3 className="v5p-pb-title" title={entry.title}>{entry.title}</h3>
      </div>
      <p className="v5p-pb-when">
        <span className="v5p-card-key">이럴 때 써요</span>
        {entry.when_to_use}
      </p>
      {entry.effect_note ? (
        <p className="v5p-pb-line">
          <span className="v5p-card-key">결과</span>
          {entry.effect_note}
        </p>
      ) : null}
      {entry.example_video_title ? (
        <p className="v5p-pb-line">
          <span className="v5p-card-key">예시 영상</span>
          {entry.example_video_title}
        </p>
      ) : entry.example_video_id ? (
        <p className="v5p-pb-line muted">
          <span className="v5p-card-key">예시 영상</span>
          지워진 영상이에요
        </p>
      ) : null}
      {entry.tags.length > 0 ? (
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {entry.tags.map((t) => {
            const on = activeTags.some((a) => a.toLowerCase() === t.toLowerCase())
            return (
              <button key={t} type="button" className={`v5-tag v5p-tag-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onTag(t)} title={on ? '이 태그 필터 끄기' : `“${t}” 태그가 있는 공식만 보기`}>
                {t}
              </button>
            )
          })}
        </div>
      ) : null}
      {error ? (
        <div className="v5p-field-error" role="alert">
          <ErrorText message={error} />
        </div>
      ) : null}
      <div className="v5p-pb-foot">
        <span className="small muted v5p-pb-meta">
          <span className="v5p-num v5p-usage">{fmtNum(entry.usage_count)}번 써봤어요</span>
          {entry.author_name ? <span className="v5p-ell"> · {entry.author_name}</span> : null}
          <span> · <RelTime value={entry.created_at} /></span>
        </span>
        {canUse ? (
          <button className="button xs secondary" type="button" disabled={busy} onClick={() => onUse(entry)} title="이 공식으로 영상을 만들었다면 눌러서 기록해요. 잘못 눌렀다면 5초 안에 되돌릴 수 있어요.">
            {busy ? '기록 중…' : recorded ? '기록했어요 ✓' : '써봤어요 +1'}
          </button>
        ) : null}
      </div>
      {canEdit ? (
        <div className="v5p-pb-manage">
          <button type="button" className="button xs secondary" disabled={busy} onClick={() => onEdit(entry)}>
            고치기
          </button>
          <ConfirmDelete busy={busy} onConfirm={() => onDelete(entry.id)} />
        </div>
      ) : null}
    </article>
  )
})

function PlaybookView() {
  const { toast, showSuccess, showError } = useToast()
  // showError 는 렌더마다 바뀔 수 있으므로 effect/콜백 의존성에 넣지 않고 ref 로만 쓴다.
  const showErrorRef = useRef(showError)
  showErrorRef.current = showError
  const q = useV5Query<{ sample?: boolean; items: PlaybookEntry[]; truncated?: boolean }>('/api/v5/playbook', { errorFallback: '성공 공식을 불러오지 못했어요.' })
  const { update: updateData, reload } = q
  const items = useMemo(() => q.data?.items || [], [q.data])
  const sample = Boolean(q.data?.sample)
  const once = useSingleFlight()
  const { slot: undoSlot, show: showUndo, dismiss: dismissUndo } = useUndoSlot()
  // 저장 결과를 화면과 캐시에 함께 반영한다.
  const setItems = useCallback((fn: (prev: PlaybookEntry[]) => PlaybookEntry[]) => updateData((d) => ({ ...d, items: fn(d.items || []) })), [updateData])

  const { filters, setFilters, reset, ready: filtersReady, params, stripParams, shareUrl } = useUrlFilters(PLAYBOOK_SPEC, FILTER_KEY)
  const { q: query, tags: tagFilter, sort } = filters
  // 입력칸은 바로바로 보이고, 필터(주소)에는 잠깐 멈췄을 때 반영한다.
  const [draft, setDraft] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)
  const [cardLimit, setCardLimit] = useState(CARD_PAGE)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState<FormState>(EMPTY_FORM)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [cardError, setCardError] = useState<{ id: string; text: string } | null>(null)
  const flashTimer = useRef<number | null>(null)
  const usingRef = useRef(false)
  const handledNewRef = useRef(false)

  // 화면을 떠날 때 남은 타이머 정리
  useEffect(() => {
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
    }
  }, [])

  // 필터 값(주소·되돌리기·초기화)이 바뀌면 입력칸도 맞춘다. 입력을 멈추면 필터에 반영한다.
  // (입력 중인 글자의 끝 공백까지 지워 버리지 않게, 이미 같은 검색어면 그대로 둔다)
  useEffect(() => {
    setDraft((d) => (d.trim() === query ? d : query))
  }, [query])
  useEffect(() => {
    if (draft.trim() === query) return
    const t = window.setTimeout(() => setFilters({ q: draft.trim() }), 300)
    return () => window.clearTimeout(t)
  }, [draft, query, setFilters])

  // 걸러 보는 조건이 바뀌면 처음(30개)부터 다시 보여 준다.
  const tagKey = tagFilter.join(',')
  useEffect(() => {
    setCardLimit(CARD_PAGE)
  }, [query, tagKey, sort])

  // 사용 횟수가 있는 공식 중 상위 3개.
  const top = useMemo(() => items.filter((e) => e.usage_count > 0).sort((a, b) => b.usage_count - a.usage_count).slice(0, 3), [items])
  const topIds = useMemo(() => new Set(top.map((e) => e.id)), [top])

  const filtering = query !== '' || tagFilter.length > 0
  const others = useMemo(() => {
    const ql = query.toLowerCase()
    let base = filtering ? items : items.filter((e) => !topIds.has(e.id))
    if (ql) base = base.filter((e) => `${e.title} ${e.when_to_use} ${e.effect_note || ''} ${e.tags.join(' ')}`.toLowerCase().includes(ql))
    if (tagFilter.length > 0) base = base.filter((e) => tagFilter.every((t) => hasTag(e, t)))
    const sorted = base.slice()
    if (sort === 'recent') sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
    else sorted.sort((a, b) => b.usage_count - a.usage_count || b.created_at.localeCompare(a.created_at))
    return sorted
  }, [items, query, tagFilter, filtering, topIds, sort])

  // 태그 칩: 많이 쓰인 순(같으면 가나다순)
  const tagCounts = useMemo(() => {
    const counts = new Map<string, { label: string; n: number }>()
    for (const e of items) {
      for (const t of e.tags) {
        const key = t.toLowerCase()
        const cur = counts.get(key)
        if (cur) cur.n += 1
        else counts.set(key, { label: t, n: 1 })
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'ko'))
  }, [items])
  const shownTags = showAllTags ? tagCounts : tagCounts.slice(0, TAG_PREVIEW)
  // 태그를 새로 적을 때 참고할 수 있게 자주 쓰인 태그를 보여 준다.
  const popularTags = useMemo(() => tagCounts.slice(0, 8).map((t) => t.label), [tagCounts])

  const toggleTag = useCallback(
    (tag: string) => {
      const on = tagFilter.some((t) => t.toLowerCase() === tag.toLowerCase())
      setFilters({ tags: on ? tagFilter.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tagFilter, tag] })
    },
    [tagFilter, setFilters]
  )

  const errors = useMemo(() => validate(form), [form])
  const showErr = (key: keyof FormErrors) => (submitted ? errors[key] : undefined)
  const formDirty = JSON.stringify(form) !== JSON.stringify(initialForm)

  const openCreate = (prefill?: Partial<FormState>) => {
    const next = { ...EMPTY_FORM, ...prefill }
    setEditingId(null)
    setForm(next)
    setInitialForm(next)
    setSubmitted(false)
    setFormError('')
    setMoreOpen(Boolean(next.effectNote || next.tags))
    setDrawerOpen(true)
  }

  const openEdit = useCallback((entry: PlaybookEntry) => {
    const next: FormState = {
      title: entry.title,
      whenToUse: entry.when_to_use,
      video: entry.example_video_id ? [{ id: entry.example_video_id, title: entry.example_video_title || null, stock_name: '' }] : [],
      tags: entry.tags.join(', '),
      effectNote: entry.effect_note || ''
    }
    setEditingId(entry.id)
    setForm(next)
    setInitialForm(next)
    setSubmitted(false)
    setFormError('')
    setMoreOpen(Boolean(next.effectNote || next.tags))
    setDrawerOpen(true)
  }, [])

  // 점수판 등에서 "성공 공식으로 저장"으로 들어온 경우: /v5/playbook?new=1&video=ID&note=…
  useEffect(() => {
    if (!filtersReady) return
    if (params.get('new') !== '1') {
      handledNewRef.current = false
      return
    }
    if (handledNewRef.current) return
    handledNewRef.current = true
    const videoId = params.get('video')
    const note = (params.get('note') || '').trim().slice(0, 200)
    openCreate({ effectNote: note })
    stripParams(ONE_SHOT_PARAMS)
    if (videoId) {
      void (async () => {
        const res = await v5Get<{ items: PickedVideo[] }>(`/api/v5/videos?id=${encodeURIComponent(videoId)}`)
        const found = res.ok ? res.data.items?.[0] : null
        if (!found) {
          showErrorRef.current('영상 정보를 불러오지 못했어요. 아래에서 예시 영상을 직접 골라 주세요.')
          return
        }
        const picked: PickedVideo = { id: found.id, title: found.title, stock_name: found.stock_name }
        const withVideo = (f: FormState): FormState => (f.video.length === 0 ? { ...f, video: [picked], title: f.title || playbookTitleSuggestion(found) } : f)
        setForm(withVideo)
        setInitialForm(withVideo)
      })()
    }
  }, [filtersReady, params, stripParams])

  const addTag = (tag: string) => {
    setForm((f) => {
      const current = parseTags(f.tags)
      if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) return f
      return { ...f, tags: [...current, tag].join(', ') }
    })
  }

  const onSubmit = () =>
    once(async () => {
      setSubmitted(true)
      setFormError('')
      if (Object.keys(validate(form)).length > 0) return

      setSaving(true)
      try {
        const body = {
          title: form.title.trim(),
          whenToUse: form.whenToUse.trim(),
          exampleVideoId: form.video[0]?.id || null,
          tags: parseTags(form.tags),
          effectNote: form.effectNote.trim()
        }
        const res = editingId
          ? await authedPatchJson<{ item: PlaybookEntry }>(`/api/v5/playbook/${editingId}`, body)
          : await v5Post<{ item: PlaybookEntry }>('/api/v5/playbook', body)
        if (!res.ok) {
          setFormError(errorText(res, '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'))
          return
        }
        const saved = res.data.item
        setItems((prev) => (editingId ? prev.map((e) => (e.id === editingId ? saved : e)) : [saved, ...prev]))
        setDrawerOpen(false)
        if (!editingId) showSuccess('성공 공식을 추가했어요.')
      } finally {
        setSaving(false)
      }
    }, 'submit')

  // 방금 누른 "써봤어요" 취소: 화면에서 먼저 1 줄이고, 서버에서도 1 줄인다(0 아래로는 내려가지 않는다). 실패하면 다시 늘린다.
  const undoUse = useCallback(
    async (id: string) => {
      setItems((prev) => prev.map((e) => (e.id === id ? { ...e, usage_count: Math.max(e.usage_count - 1, 0) } : e)))
      setFlashId((cur) => (cur === id ? null : cur))
      const res = await authedDeleteJson<{ item: PlaybookEntry }>(`/api/v5/playbook/${id}/use`)
      if (res.ok) {
        const saved = res.data.item
        setItems((prev) => prev.map((e) => (e.id === id ? saved : e)))
      } else if (res.status === 404) {
        // 그 사이 지워진 공식
        setItems((prev) => prev.filter((e) => e.id !== id))
        showErrorRef.current(errorText(res, '되돌리지 못했어요.'))
      } else {
        setItems((prev) => prev.map((e) => (e.id === id ? { ...e, usage_count: e.usage_count + 1 } : e)))
        showErrorRef.current(errorText(res, '되돌리지 못했어요. 횟수는 그대로예요.'))
      }
    },
    [setItems]
  )

  // "써봤어요": 눌렀다는 게 바로 보이도록 먼저 올리고(낙관적), 서버가 알려 주는 실제 값으로 맞춘다. 실패하면 되돌린다.
  // 성공하면 5초 동안 "되돌리기"를 보여 준다(잘못 눌렀을 때).
  const onUse = useCallback(
    async (entry: PlaybookEntry) => {
      const id = entry.id
      // ref 로 막으므로 같은 순간의 두 번째 클릭도 무시된다(state 는 다음 그림에서야 바뀐다).
      if (usingRef.current) return
      usingRef.current = true
      setBusyId(id)
      setCardError(null)
      setItems((prev) => prev.map((e) => (e.id === id ? { ...e, usage_count: e.usage_count + 1 } : e)))
      const res = await v5Post<{ item: PlaybookEntry }>(`/api/v5/playbook/${id}/use`, {})
      if (res.ok) {
        const saved = res.data.item
        setItems((prev) => prev.map((e) => (e.id === id ? saved : e)))
        setFlashId(id)
        if (flashTimer.current) window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setFlashId(null), 1800)
        showUndo(`“${entry.title}” 써봤어요를 기록했어요.`, () => undoUse(id))
      } else {
        setItems((prev) => prev.map((e) => (e.id === id ? { ...e, usage_count: Math.max(e.usage_count - 1, 0) } : e)))
        if (res.status === 404) setItems((prev) => prev.filter((e) => e.id !== id))
        setCardError({ id, text: errorText(res, '기록하지 못했어요. 잠시 뒤 다시 눌러 주세요.') })
      }
      setBusyId(null)
      usingRef.current = false
    },
    [setItems, showUndo, undoUse]
  )

  const onDelete = useCallback(
    async (id: string) => {
      await once(async () => {
        setBusyId(id)
        setCardError(null)
        const res = await authedDeleteJson(`/api/v5/playbook/${id}`)
        if (res.ok) setItems((prev) => prev.filter((e) => e.id !== id))
        else setCardError({ id, text: errorText(res, '지우지 못했어요. 잠시 뒤 다시 해 주세요.') })
        setBusyId(null)
      }, `del-${id}`)
    },
    [once, setItems]
  )

  const renderCard = (entry: PlaybookEntry, rank?: number) => (
    <FormulaCard
      key={entry.id}
      entry={entry}
      rank={rank}
      busy={busyId === entry.id}
      recorded={flashId === entry.id}
      error={cardError?.id === entry.id ? cardError.text : undefined}
      canUse={!sample}
      canEdit={!sample && Boolean(entry.can_edit)}
      activeTags={tagFilter}
      onUse={onUse}
      onTag={toggleTag}
      onEdit={openEdit}
      onDelete={onDelete}
    />
  )

  const chips: FilterChip[] = []
  if (query) chips.push({ key: 'q', label: `검색: ${query}`, onClear: () => setFilters({ q: '' }) })
  for (const t of tagFilter) chips.push({ key: `tag-${t}`, label: `태그: ${t}`, onClear: () => toggleTag(t) })
  if (sort !== PLAYBOOK_SPEC.defaults.sort) chips.push({ key: 'sort', label: `정렬: ${SORT_LABEL[sort]}`, onClear: () => setFilters({ sort: 'usage' }) })

  const ready = Boolean(q.data) && filtersReady

  return (
    <>
      <PageHeader
        title="성공 공식"
        subtitle="반응이 좋았던 영상의 공통점을 모아 두고, 다음 영상에 다시 써요."
        actions={
          <button className="button" onClick={() => openCreate()}>
            + 성공 공식 추가
          </button>
        }
      />

      <SampleNote show={sample} />

      {q.error ? <LoadError message={q.error} status={q.status} onRetry={reload} /> : null}
      {!ready && !q.error ? <CardGridSkeleton /> : null}

      {ready ? (
        <div className={q.validating ? 'v5p-refreshing' : undefined} aria-busy={q.validating}>
          {items.length === 0 ? (
            <EmptyBlock
              title="성공 공식이란, 잘 된 영상에서 찾은 “다음에도 통하는 방법”이에요"
              action={
                <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
                  <button className="button" onClick={() => openCreate()}>
                    첫 성공 공식 적기
                  </button>
                  <Link className="button secondary" href="/v5/scoreboard">
                    점수판에서 잘 나간 영상 찾기
                  </Link>
                </span>
              }
            >
              <div className="v5p-example" aria-label="성공 공식 예시">
                <span className="v5p-example-tag">예시</span>
                <div className="v5p-example-title">실적 발표 당일, 숫자를 제목 맨 앞에</div>
                <div className="v5p-example-line">
                  <span className="v5p-card-key">이럴 때 써요</span> 기업 실적 발표가 나온 날, 예상보다 잘 나왔을 때
                </div>
                <div className="v5p-example-line">
                  <span className="v5p-card-key">결과</span> 평소보다 조회수가 40% 더 나왔어요
                </div>
              </div>
              <p style={{ margin: '10px 0 0' }}>
                이렇게 한 줄로 남겨 두면 다음에 같은 상황이 왔을 때 팀 모두가 그대로 따라 할 수 있어요. 아직 잘 된 영상이 없다면 먼저 영상을 <Link href="/v5/register">등록</Link>해 주세요. <GlossaryTip term="playbook" />
              </p>
            </EmptyBlock>
          ) : (
            <>
              <AnswerBanner label="가장 자주 쓴 성공 공식 (상위 3개)">
                {top.length > 0 ? (
                  <>
                    1등은 <strong>{top[0].title}</strong> · {fmtNum(top[0].usage_count)}번 써봤어요
                  </>
                ) : (
                  <>
                    성공 공식 <strong>{fmtNum(items.length)}개</strong>가 있어요. 영상에 써 봤다면 “써봤어요”를 눌러 기록하면 여기에 순위가 생겨요.
                  </>
                )}
              </AnswerBanner>

              {!filtering && top.length > 0 ? <div className="v5p-pb-grid top">{top.map((entry, i) => renderCard(entry, i + 1))}</div> : null}

              <div className="v5p-pb-filters">
                <div className="v5p-section-head" style={{ marginTop: 24 }}>
                  <h2>
                    {filtering ? '찾은 성공 공식' : top.length > 0 ? '다른 성공 공식' : '전체 성공 공식'} <Badge tone="indigo">{fmtNum(others.length)}</Badge>
                  </h2>
                  <span className="v5p-toolbar-right">
                    <select className="select v5p-owner-select" value={sort} onChange={(e) => setFilters({ sort: e.target.value as PlaybookSort })} aria-label="정렬">
                      <option value="usage">{SORT_LABEL.usage}</option>
                      <option value="recent">{SORT_LABEL.recent}</option>
                    </select>
                    <input
                      className="input v5p-search"
                      type="search"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setDraft('')
                          setFilters({ q: '' })
                        }
                      }}
                      placeholder="찾기 (예: 실적, 숏폼)"
                      aria-label="성공 공식 찾기"
                    />
                    <CopyLinkButton getUrl={shareUrl} />
                  </span>
                </div>

                {tagCounts.length > 0 ? (
                  <div className="v5p-chips v5p-tagbar" role="group" aria-label="태그로 걸러 보기">
                    <span className="small muted">태그</span>
                    {shownTags.map((t) => {
                      const on = tagFilter.some((x) => x.toLowerCase() === t.label.toLowerCase())
                      return (
                        <button key={t.label} type="button" className={`v5p-chip sm ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleTag(t.label)}>
                          #{t.label} <span className="v5p-num">{fmtNum(t.n)}</span>
                        </button>
                      )
                    })}
                    {tagCounts.length > TAG_PREVIEW ? (
                      <button type="button" className="button xs ghost" onClick={() => setShowAllTags((v) => !v)}>
                        {showAllTags ? '태그 접기' : `태그 ${fmtNum(tagCounts.length - TAG_PREVIEW)}개 더 보기`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <ActiveFilters chips={chips} onReset={reset} />
              </div>

              {others.length === 0 ? (
                <div className="v5p-pick-empty">
                  {filtering ? (
                    <>
                      찾는 성공 공식이 없어요. 검색어나 태그를 줄여 보거나{' '}
                      <button type="button" className="button xs secondary" onClick={reset}>
                        필터 초기화
                      </button>
                      를 눌러 보세요.
                    </>
                  ) : (
                    '위에 보이는 공식이 전부예요.'
                  )}
                </div>
              ) : (
                <>
                  <div className="v5p-pb-grid">{others.slice(0, cardLimit).map((entry) => renderCard(entry))}</div>
                  {others.length > cardLimit ? (
                    <button type="button" className="button secondary sm" style={{ marginTop: 12 }} onClick={() => setCardLimit((n) => n + CARD_PAGE)}>
                      더 보기 ({fmtNum(others.length - cardLimit)}개 남음)
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      ) : null}

      {drawerOpen ? (
        <FormDrawer
          title={editingId ? '성공 공식 고치기' : '성공 공식 추가'}
          formId="v5p-pb-form"
          dirty={formDirty}
          saving={saving}
          submitLabel="저장"
          onSubmit={onSubmit}
          onClose={() => setDrawerOpen(false)}
        >
          {formError ? (
            <div className="v5p-error" role="alert" style={{ marginTop: 0 }}>
              <ErrorText message={formError} />
            </div>
          ) : null}
          <FormField label="공식 이름" required error={showErr('title')} htmlFor="v5p-pb-title">
            <input id="v5p-pb-title" className="input" maxLength={100} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="예: 실적 발표 당일, 숫자를 제목 맨 앞에" />
          </FormField>
          <FormField label="언제 쓰나요?" required hint="한 줄로 적어요." error={showErr('whenToUse')} htmlFor="v5p-pb-when">
            <input id="v5p-pb-when" className="input" maxLength={300} value={form.whenToUse} onChange={(e) => setForm((f) => ({ ...f, whenToUse: e.target.value }))} placeholder="예: 기업 실적 발표가 나온 날, 예상보다 잘 나왔을 때" />
          </FormField>
          <FormField label="잘 됐던 영상" optional hint="이 공식으로 만든 대표 영상이 있으면 골라 주세요." htmlFor="v5p-pb-video">
            <VideoPicker selected={form.video} onChange={(video) => setForm((f) => ({ ...f, video }))} max={1} searchId="v5p-pb-video" />
          </FormField>

          <details className="v5p-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>자세히 적기 (선택)</summary>
            <div className="v5p-more-body">
              <FormField label="결과 메모" optional hint="써 보니 어땠는지 한 줄로요." htmlFor="v5p-pb-effect">
                <input id="v5p-pb-effect" className="input" maxLength={200} value={form.effectNote} onChange={(e) => setForm((f) => ({ ...f, effectNote: e.target.value }))} placeholder="예: 평소보다 조회수가 40% 더 나왔어요" />
              </FormField>
              <FormField label="태그" optional hint="쉼표로 나눠 적어요. 나중에 찾을 때 쓰여요." htmlFor="v5p-pb-tags">
                <input id="v5p-pb-tags" className="input" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="예: 실적, 숏폼" />
                {popularTags.length > 0 ? (
                  <div className="v5p-chips v5p-tag-suggest" aria-label="자주 쓰인 태그">
                    {popularTags.map((t) => (
                      <button key={t} type="button" className="v5p-chip sm" onClick={() => addTag(t)}>
                        + {t}
                      </button>
                    ))}
                  </div>
                ) : null}
              </FormField>
            </div>
          </details>
        </FormDrawer>
      ) : null}

      <UndoBar slot={undoSlot} onDismiss={dismissUndo} />
      <Toast toast={toast} />
    </>
  )
}

export default function PlaybookPage() {
  // useSearchParams 를 쓰는 화면은 Suspense 로 감싸야 한다(Next 16).
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <PlaybookView />
    </Suspense>
  )
}
