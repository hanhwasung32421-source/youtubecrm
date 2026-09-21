'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v5/app-shell'
import { Badge } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { authedDeleteJson, authedPatchJson, errorText, v5Post } from '@/lib/v5/client'
import { AnswerBanner, EmptyBlock, ErrorText, FormField, LoadError, RelTime, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import { CardGridSkeleton } from '@/lib/v5/skeleton'
import { useV5Query } from '@/lib/v5/swr'
import { ConfirmDelete, FormDrawer, usePref, useSingleFlight } from '@/lib/v5/ui'
import { VideoPicker, type PickedVideo } from '@/lib/v5/video-picker'
import type { PlaybookEntry } from '@/lib/v5/types'

type FormState = { title: string; whenToUse: string; video: PickedVideo[]; tags: string; effectNote: string }
const EMPTY_FORM: FormState = { title: '', whenToUse: '', video: [], tags: '', effectNote: '' }
type FormErrors = Partial<Record<'title' | 'whenToUse', string>>
type SortMode = 'usage' | 'recent'

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

function FormulaCard({
  entry,
  rank,
  busy,
  recorded,
  error,
  canUse,
  canEdit,
  onUse,
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
  onUse: () => void
  onEdit: () => void
  onDelete: () => Promise<void>
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
          {entry.tags.map((t) => (
            <span className="v5-tag" key={t}>
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="v5p-field-error" role="alert">
          <ErrorText message={error} />
        </div>
      ) : null}
      <div className="v5p-pb-foot">
        <span className="small muted v5p-pb-meta">
          <span className="v5p-num">{fmtNum(entry.usage_count)}번 사용</span>
          {entry.author_name ? <span className="v5p-ell"> · {entry.author_name}</span> : null}
          <span> · <RelTime value={entry.created_at} /></span>
        </span>
        {canUse ? (
          <button className="button xs secondary" type="button" disabled={busy} onClick={onUse} title="이 공식으로 영상을 만들었다면 눌러서 기록해요">
            {busy ? '기록 중…' : recorded ? '기록했어요 ✓' : '써봤어요 +1'}
          </button>
        ) : null}
      </div>
      {canEdit ? (
        <div className="v5p-pb-manage">
          <button type="button" className="button xs secondary" disabled={busy} onClick={onEdit}>
            고치기
          </button>
          <ConfirmDelete busy={busy} onConfirm={onDelete} />
        </div>
      ) : null}
    </article>
  )
}

export default function PlaybookPage() {
  const { toast, showSuccess } = useToast()
  const q = useV5Query<{ sample?: boolean; items: PlaybookEntry[]; truncated?: boolean }>('/api/v5/playbook', { errorFallback: '성공 공식을 불러오지 못했어요.' })
  const { update: updateData, reload } = q
  const items = useMemo(() => q.data?.items || [], [q.data])
  const sample = Boolean(q.data?.sample)
  const once = useSingleFlight()
  // 저장 결과를 화면과 캐시에 함께 반영한다.
  const setItems = useCallback((fn: (prev: PlaybookEntry[]) => PlaybookEntry[]) => updateData((d) => ({ ...d, items: fn(d.items || []) })), [updateData])
  const [sort, setSort, sortReady] = usePref<SortMode>('v5.playbook.sort', 'usage', (v): v is SortMode => v === 'usage' || v === 'recent')
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
  const [query, setQuery] = useState('')
  const flashTimer = useRef<number | null>(null)
  const usingRef = useRef(false)

  // 화면을 떠날 때 남은 타이머 정리
  useEffect(() => {
    return () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
    }
  }, [])

  // 사용 횟수가 있는 공식 중 상위 3개.
  const top = useMemo(() => items.filter((e) => e.usage_count > 0).sort((a, b) => b.usage_count - a.usage_count).slice(0, 3), [items])
  const topIds = useMemo(() => new Set(top.map((e) => e.id)), [top])

  const searching = query.trim().length > 0
  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q
      ? items.filter((e) => `${e.title} ${e.when_to_use} ${e.effect_note || ''} ${e.tags.join(' ')}`.toLowerCase().includes(q))
      : items.filter((e) => !topIds.has(e.id))
    const sorted = base.slice()
    if (sort === 'recent') sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
    else sorted.sort((a, b) => b.usage_count - a.usage_count || b.created_at.localeCompare(a.created_at))
    return sorted
  }, [items, query, topIds, sort])

  // 태그를 새로 적을 때 참고할 수 있게 자주 쓰인 태그를 보여 준다.
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of items) for (const t of e.tags) counts.set(t, (counts.get(t) || 0) + 1)
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t)
  }, [items])

  const errors = useMemo(() => validate(form), [form])
  const showErr = (key: keyof FormErrors) => (submitted ? errors[key] : undefined)
  const formDirty = JSON.stringify(form) !== JSON.stringify(initialForm)

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setInitialForm(EMPTY_FORM)
    setSubmitted(false)
    setFormError('')
    setMoreOpen(false)
    setDrawerOpen(true)
  }

  const openEdit = (entry: PlaybookEntry) => {
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
  }

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

  const onUse = async (id: string) => {
    // ref 로 막으므로 같은 순간의 두 번째 클릭도 무시된다(state 는 다음 그림에서야 바뀐다).
    if (usingRef.current) return
    usingRef.current = true
    setBusyId(id)
    setCardError(null)
    // 눌렀다는 게 바로 보이도록 먼저 올려 두고, 서버가 알려 주는 실제 값으로 맞춘다. 실패하면 되돌린다.
    setItems((prev) => prev.map((e) => (e.id === id ? { ...e, usage_count: e.usage_count + 1 } : e)))
    const res = await v5Post<{ item: PlaybookEntry }>(`/api/v5/playbook/${id}/use`, {})
    if (res.ok) {
      const saved = res.data.item
      setItems((prev) => prev.map((e) => (e.id === id ? saved : e)))
      setFlashId(id)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlashId(null), 1800)
    } else {
      setItems((prev) => prev.map((e) => (e.id === id ? { ...e, usage_count: Math.max(e.usage_count - 1, 0) } : e)))
      setCardError({ id, text: errorText(res, '기록하지 못했어요. 잠시 뒤 다시 눌러 주세요.') })
    }
    setBusyId(null)
    usingRef.current = false
  }

  const onDelete = async (id: string) => {
    await once(async () => {
      setBusyId(id)
      setCardError(null)
      const res = await authedDeleteJson(`/api/v5/playbook/${id}`)
      if (res.ok) setItems((prev) => prev.filter((e) => e.id !== id))
      else setCardError({ id, text: errorText(res, '지우지 못했어요. 잠시 뒤 다시 해 주세요.') })
      setBusyId(null)
    }, `del-${id}`)
  }

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
      onUse={() => void onUse(entry.id)}
      onEdit={() => openEdit(entry)}
      onDelete={() => onDelete(entry.id)}
    />
  )

  const ready = Boolean(q.data) && sortReady

  return (
    <>
      <PageHeader
        title="성공 공식"
        subtitle="반응이 좋았던 영상의 공통점을 모아 두고, 다음 영상에 다시 써요."
        actions={
          <button className="button" onClick={openCreate}>
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
              title="아직 성공 공식이 없어요"
              action={
                <button className="button" onClick={openCreate}>
                  첫 성공 공식 적기
                </button>
              }
            >
              잘 된 영상이 하나 있다면 “왜 잘 됐는지”를 한 줄로 남겨 보세요. 예: “실적 발표 당일, 숫자를 제목 맨 앞에 넣었다.”
              <br />
              다음에 같은 상황이 오면 팀 모두가 그대로 따라 할 수 있어요.
            </EmptyBlock>
          ) : (
            <>
              <AnswerBanner label="가장 자주 쓰인 성공 공식 Top 3">
                {top.length > 0 ? (
                  <>
                    1등은 <strong>{top[0].title}</strong> · {fmtNum(top[0].usage_count)}번 사용
                  </>
                ) : (
                  <>
                    성공 공식 <strong>{fmtNum(items.length)}개</strong>가 있어요. 영상에 써 봤다면 “써봤어요”를 눌러 기록하면 여기에 순위가 생겨요.
                  </>
                )}
              </AnswerBanner>

              {top.length > 0 ? <div className="v5p-pb-grid top">{top.map((entry, i) => renderCard(entry, i + 1))}</div> : null}

              <div className="v5p-section-head" style={{ marginTop: 24 }}>
                <h2>
                  {searching ? '검색 결과' : top.length > 0 ? '다른 성공 공식' : '전체 성공 공식'} <Badge tone="indigo">{fmtNum(others.length)}</Badge>
                </h2>
                <span className="v5p-toolbar-right">
                  <select className="select v5p-owner-select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)} aria-label="정렬">
                    <option value="usage">많이 쓴 순</option>
                    <option value="recent">최근에 추가한 순</option>
                  </select>
                  {items.length > 4 ? (
                    <input
                      className="input v5p-search"
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setQuery('')
                      }}
                      placeholder="찾기 (예: 실적, 숏폼)"
                      aria-label="성공 공식 찾기"
                    />
                  ) : null}
                </span>
              </div>
              {others.length === 0 ? (
                <div className="v5p-pick-empty">{searching ? '찾는 성공 공식이 없어요.' : '위에 보이는 공식이 전부예요.'}</div>
              ) : (
                <div className="v5p-pb-grid">{others.map((entry) => renderCard(entry))}</div>
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

      <Toast toast={toast} />
    </>
  )
}
