'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/v5/app-shell'
import { Badge, Drawer } from '@/components/v5/widget'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { AnswerBanner, EmptyBlock, FormField, LoadError, LoadingLine, SampleNote, fmtNum } from '@/lib/v5/page-parts'
import type { PlaybookEntry } from '@/lib/v5/types'

type VideoOption = { id: string; title: string | null; stock_name: string }

const EMPTY_FORM = { title: '', whenToUse: '', exampleVideoId: '', tags: '', effectNote: '' }
type FormErrors = Partial<Record<'title' | 'whenToUse', string>>

function validate(form: typeof EMPTY_FORM): FormErrors {
  const errors: FormErrors = {}
  if (!form.title.trim()) errors.title = '공식의 이름을 적어 주세요.'
  if (!form.whenToUse.trim()) errors.whenToUse = '어떤 때 쓰는지 한 줄로 적어 주세요.'
  return errors
}

function FormulaCard({ entry, rank, onUse, busy }: { entry: PlaybookEntry; rank?: number; onUse: () => void; busy: boolean }) {
  return (
    <article className="v5p-pb-card">
      <div className="v5p-pb-head">
        {rank ? <span className="v5-rank-badge top">{rank}</span> : null}
        <h3 className="v5p-pb-title">{entry.title}</h3>
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
      <div className="v5p-pb-foot">
        <span className="small muted">
          {fmtNum(entry.usage_count)}번 사용{entry.author_name ? ` · ${entry.author_name}` : ''}
        </span>
        <button className="button xs secondary" type="button" disabled={busy} onClick={onUse} title="이 공식으로 영상을 만들었다면 눌러서 기록해요">
          {busy ? '기록 중…' : '써봤어요 +1'}
        </button>
      </div>
    </article>
  )
}

export default function PlaybookPage() {
  const { toast, showSuccess, showError } = useToast()
  const [items, setItems] = useState<PlaybookEntry[]>([])
  const [sample, setSample] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [videoOptions, setVideoOptions] = useState<VideoOption[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = async () => {
    setLoading(true)
    setLoadError('')
    const res = await authedFetchJson<{ sample: boolean; items: PlaybookEntry[]; error?: string }>('/api/v5/playbook')
    if (res.ok) {
      setItems(res.data.items || [])
      setSample(Boolean(res.data.sample))
    } else {
      setLoadError(res.data?.error || '성공 공식을 불러오지 못했어요.')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const run = async () => {
      const res = await authedFetchJson<{ items: VideoOption[] }>('/api/v5/videos')
      if (res.ok) setVideoOptions(res.data.items || [])
    }
    void run()
  }, [])

  // 사용 횟수가 있는 공식 중 상위 3개.
  const top = useMemo(() => items.filter((e) => e.usage_count > 0).sort((a, b) => b.usage_count - a.usage_count).slice(0, 3), [items])
  const topIds = useMemo(() => new Set(top.map((e) => e.id)), [top])

  const searching = query.trim().length > 0
  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      return items.filter((e) => `${e.title} ${e.when_to_use} ${e.effect_note || ''} ${e.tags.join(' ')}`.toLowerCase().includes(q))
    }
    return items.filter((e) => !topIds.has(e.id))
  }, [items, query, topIds])

  const errors = useMemo(() => validate(form), [form])
  const showErr = (key: keyof FormErrors) => (submitted ? errors[key] : undefined)

  const openDrawer = () => {
    setForm({ ...EMPTY_FORM })
    setSubmitted(false)
    setDrawerOpen(true)
  }

  const onCreate = async () => {
    setSubmitted(true)
    if (Object.keys(validate(form)).length > 0) return

    setSaving(true)
    try {
      const res = await authedPostJson('/api/v5/playbook', {
        title: form.title.trim(),
        whenToUse: form.whenToUse.trim(),
        exampleVideoId: form.exampleVideoId || undefined,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        effectNote: form.effectNote.trim() || undefined
      })
      if (!res.ok) {
        showError((res.data as any)?.error || '저장하지 못했어요. 잠시 뒤 다시 해 주세요.')
        return
      }
      showSuccess('성공 공식을 추가했어요.')
      setDrawerOpen(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const onUse = async (id: string) => {
    setBusyId(id)
    try {
      const res = await authedPostJson(`/api/v5/playbook/${id}/use`, {})
      if (!res.ok) {
        showError((res.data as any)?.error || '기록하지 못했어요.')
        return
      }
      showSuccess('사용 횟수를 1 늘렸어요.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="성공 공식"
        subtitle="반응이 좋았던 영상의 공통점을 모아 두고, 다음 영상에 다시 써요."
        actions={
          <button className="button" onClick={openDrawer}>
            + 성공 공식 추가
          </button>
        }
      />

      <SampleNote show={sample} />

      {loadError ? (
        <LoadError message={loadError} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingLine />
      ) : items.length === 0 ? (
        <EmptyBlock
          title="아직 성공 공식이 없어요"
          action={
            <button className="button" onClick={openDrawer}>
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

          {top.length > 0 ? (
            <div className="v5p-pb-grid top">
              {top.map((entry, i) => (
                <FormulaCard key={entry.id} entry={entry} rank={i + 1} onUse={() => onUse(entry.id)} busy={busyId === entry.id} />
              ))}
            </div>
          ) : null}

          <div className="v5p-section-head" style={{ marginTop: 24 }}>
            <h2>
              {searching ? '검색 결과' : top.length > 0 ? '다른 성공 공식' : '전체 성공 공식'} <Badge tone="indigo">{fmtNum(others.length)}</Badge>
            </h2>
            {items.length > 4 ? (
              <input className="input v5p-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="찾기 (예: 실적, 숏폼)" aria-label="성공 공식 찾기" />
            ) : null}
          </div>
          {others.length === 0 ? (
            <div className="v5p-pick-empty">{searching ? '찾는 성공 공식이 없어요.' : '위에 보이는 공식이 전부예요.'}</div>
          ) : (
            <div className="v5p-pb-grid">
              {others.map((entry) => (
                <FormulaCard key={entry.id} entry={entry} onUse={() => onUse(entry.id)} busy={busyId === entry.id} />
              ))}
            </div>
          )}
        </>
      )}

      {drawerOpen ? (
        <Drawer
          title="성공 공식 추가"
          onClose={() => setDrawerOpen(false)}
          footer={
            <>
              <button className="button secondary" type="button" onClick={() => setDrawerOpen(false)}>
                취소
              </button>
              <button className="button" type="button" disabled={saving} onClick={onCreate}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </>
          }
        >
          <FormField label="공식 이름" error={showErr('title')} htmlFor="v5p-pb-title">
            <input id="v5p-pb-title" className="input" maxLength={100} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="예: 실적 발표 당일, 숫자를 제목 맨 앞에" />
          </FormField>
          <FormField label="언제 쓰나요?" error={showErr('whenToUse')} htmlFor="v5p-pb-when">
            <textarea id="v5p-pb-when" className="textarea" rows={3} maxLength={300} value={form.whenToUse} onChange={(e) => setForm((f) => ({ ...f, whenToUse: e.target.value }))} placeholder="예: 기업 실적 발표가 나온 날, 예상보다 잘 나왔을 때" />
          </FormField>
          <FormField label="잘 됐던 영상" optional hint="이 공식으로 만든 대표 영상이 있으면 골라 주세요." htmlFor="v5p-pb-video">
            <select id="v5p-pb-video" className="select" value={form.exampleVideoId} onChange={(e) => setForm((f) => ({ ...f, exampleVideoId: e.target.value }))}>
              <option value="">선택 안 함</option>
              {videoOptions.slice(0, 100).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.stock_name} · {(v.title || '(제목 없음)').slice(0, 36)}
                </option>
              ))}
            </select>
          </FormField>

          <details className="v5p-more">
            <summary>자세히 적기 (선택)</summary>
            <div className="v5p-more-body">
              <FormField label="결과 메모" optional hint="써 보니 어땠는지 한 줄로요." htmlFor="v5p-pb-effect">
                <input id="v5p-pb-effect" className="input" maxLength={200} value={form.effectNote} onChange={(e) => setForm((f) => ({ ...f, effectNote: e.target.value }))} placeholder="예: 평소보다 조회수가 40% 더 나왔어요" />
              </FormField>
              <FormField label="태그" optional hint="쉼표로 나눠 적어요. 나중에 찾을 때 쓰여요." htmlFor="v5p-pb-tags">
                <input id="v5p-pb-tags" className="input" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="예: 실적, 숏폼" />
              </FormField>
            </div>
          </details>
        </Drawer>
      ) : null}

      <Toast toast={toast} />
    </>
  )
}
