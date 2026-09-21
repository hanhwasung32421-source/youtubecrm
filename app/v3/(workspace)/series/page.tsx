'use client'

import '../analysis.css'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { Toast, useToast } from '@/components/toast'
import { SampleBanner, Section, Tag } from '@/components/v3/ui'
import { v3Request } from '@/lib/v3/api-client'
import { ConfirmButton, FieldError, InlineEditor, Req, useLatest } from '@/lib/v3/interact'
import { formatCompactNumber, formatNumber, formatPct } from '@/lib/v3/format'
import { pctChange } from '@/lib/v3/engagement'
import { SAMPLE_STOCK_NAMES } from '@/lib/v3/sample-data'
import { AnswerCard, EmptyBlock, ErrorBlock, HowTo, LoadingBlock, MoreButton, describeChange, useShowMore, type Tone } from '../analysis-parts'

type FormatStat = { label: string; contentType: string; count: number; avgEngagementPct: number; avgVelocity: number; totalViews: number }

type SeriesRow = {
  id: string
  name: string
  stockName: string | null
  videoCount: number
  avgEngagementPct: number
  avgVelocity: number
  baselineEngagementPct: number
  baselineVelocity: number
  members: { id: string; title: string }[]
  createdByName: string | null
  canEdit: boolean
}

type EligibleVideo = { id: string; title: string; stockName: string | null; contentType: string }
type MovableVideo = EligibleVideo & { seriesId: string; seriesName: string }

type FormatSeriesResponse = {
  sample: boolean
  formatStats: { longform: FormatStat; shortform: FormatStat }
  series: SeriesRow[]
  eligibleVideos: EligibleVideo[]
  movableVideos?: MovableVideo[]
}

// 형식(롱폼/숏폼) 비교 결과를 한 문장으로
function summarizeFormats(lf: FormatStat, sf: FormatStat): { tone: Tone; headline: string; detail?: string } | null {
  if (lf.count === 0 && sf.count === 0) return null
  if (lf.count === 0 || sf.count === 0) {
    const missing = lf.count === 0 ? '롱폼' : '숏폼'
    const have = lf.count === 0 ? sf : lf
    return {
      tone: 'neutral',
      headline: `아직 ${missing} 영상이 없어서 두 형식을 비교할 수 없어요.`,
      detail: `지금은 ${have.label} 영상 ${formatNumber(have.count)}개만 있어요. ${missing}도 몇 개 등록하면 어느 쪽이 반응이 좋은지 알려드려요.`
    }
  }
  const engDiff = pctChange(Math.max(lf.avgEngagementPct, sf.avgEngagementPct), Math.min(lf.avgEngagementPct, sf.avgEngagementPct))
  const velDiff = pctChange(Math.max(lf.avgVelocity, sf.avgVelocity), Math.min(lf.avgVelocity, sf.avgVelocity))
  const engWin = sf.avgEngagementPct > lf.avgEngagementPct ? sf : lf
  const velWin = sf.avgVelocity > lf.avgVelocity ? sf : lf
  const small = (engDiff ?? 0) < 5 && (velDiff ?? 0) < 5
  const fewNote = lf.count < 5 || sf.count < 5 ? `영상 수가 적어서(롱폼 ${lf.count}개, 숏폼 ${sf.count}개) 참고용으로만 봐 주세요.` : undefined

  if (small) return { tone: 'neutral', headline: '롱폼과 숏폼의 차이가 크지 않아요. 지금은 어느 쪽이 더 좋다고 말하기 어려워요.', detail: fewNote }
  if (engWin === velWin) {
    return { tone: 'good', headline: `${engWin.label}이 반응(참여율)도, 조회수가 늘어나는 속도도 더 좋아요.`, detail: fewNote }
  }
  return {
    tone: 'neutral',
    headline: `시청자 반응(참여율)은 ${engWin.label}이, 조회수가 늘어나는 속도는 ${velWin.label}이 더 좋아요.`,
    detail: fewNote
  }
}

// 시리즈가 같은 종목의 시리즈 밖 영상보다 나은지 판정
function seriesVerdict(s: SeriesRow, engChange: number | null, velChange: number | null): { tone: 'green' | 'red' | 'gray'; label: string } {
  if (s.videoCount === 0) return { tone: 'gray', label: '영상 없음' }
  if (engChange === null && velChange === null) return { tone: 'gray', label: '비교할 기준 영상 없음' }
  const e = engChange ?? 0
  const v = velChange ?? 0
  if (e >= 5 && v >= 5) return { tone: 'green', label: '시리즈 효과 있음' }
  if (e <= -5 && v <= -5) return { tone: 'red', label: '일반 영상보다 반응이 낮음' }
  return { tone: 'gray', label: '결과가 엇갈려요' }
}

export default function SeriesPage() {
  const { toast, showSuccess, showError } = useToast()
  const [data, setData] = useState<FormatSeriesResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 새 시리즈 폼
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [name, setName] = useState('')
  const [stockName, setStockName] = useState('')
  const [videoQuery, setVideoQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // 카드별 작업
  const [addPickers, setAddPickers] = useState<Record<string, string>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  const [openMembers, setOpenMembers] = useState<Record<string, boolean>>({})

  const setCardError = (id: string, message: string | null) =>
    setCardErrors((prev) => {
      const next = { ...prev }
      if (message) next[id] = message
      else delete next[id]
      return next
    })

  const showErrorRef = useLatest(showError)
  const load = useCallback(async () => {
    const res = await v3Request<FormatSeriesResponse>('/api/v3/format-series', {}, '비교 결과를 불러오지 못했어요.')
    if (!res.ok) {
      // 이미 화면이 떠 있으면 그대로 두고 알림만 띄운다(화면이 사라졌다 나타나며 튀지 않게).
      setLoadError(res.error)
      showErrorRef.current(res.error || '비교 결과를 불러오지 못했어요.')
      return
    }
    setLoadError(null)
    setData(res.data)
  }, [showErrorRef])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (showForm) nameRef.current?.focus()
  }, [showForm])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const nameError = attempted && !name.trim() ? '시리즈 이름을 입력해 주세요. 예: 삼성전자 실적 브리핑 시리즈' : null

  const closeForm = () => {
    setShowForm(false)
    setAttempted(false)
    setFormError(null)
  }

  const createSeries = async (e?: FormEvent) => {
    e?.preventDefault()
    if (creating) return
    setAttempted(true)
    setFormError(null)
    if (!name.trim()) {
      nameRef.current?.focus()
      return
    }
    setCreating(true)
    const res = await v3Request<{ moved?: number }>(
      '/api/v3/series',
      { method: 'POST', body: { name: name.trim(), stockName: stockName.trim() || undefined, videoIds: selectedIds } },
      '시리즈를 만들지 못했어요.'
    )
    setCreating(false)
    if (!res.ok) {
      setFormError(res.error)
      nameRef.current?.focus()
      return
    }
    // 새 카드가 목록에 바로 나타나므로 "만들었어요" 알림은 생략. 다른 시리즈에서 옮겨온 경우만 알려 준다.
    if (res.data?.moved) showSuccess(`영상 ${res.data.moved}개를 다른 시리즈에서 옮겨 왔어요.`)
    setName('')
    setStockName('')
    setSelectedIds([])
    setVideoQuery('')
    setAttempted(false)
    await load()
    nameRef.current?.focus()
  }

  const addToSeries = async (s: SeriesRow) => {
    const videoId = addPickers[s.id]
    if (!videoId || busyKey) return
    setBusyKey(`add:${s.id}`)
    setCardError(s.id, null)
    const res = await v3Request<{ moved?: boolean; already?: boolean; fromSeriesName?: string }>(
      `/api/v3/series/${s.id}/members`,
      { method: 'POST', body: { videoId } },
      '영상을 추가하지 못했어요.'
    )
    setBusyKey(null)
    if (!res.ok) {
      setCardError(s.id, res.error)
      return
    }
    if (res.data?.moved) showSuccess(`“${res.data.fromSeriesName || '다른 시리즈'}”에서 이 시리즈로 옮겼어요.`)
    setAddPickers((prev) => ({ ...prev, [s.id]: '' }))
    setOpenMembers((prev) => ({ ...prev, [s.id]: true }))
    await load()
    document.getElementById(`v3-series-add-${s.id}`)?.focus()
  }

  const removeMember = async (s: SeriesRow, member: { id: string; title: string }) => {
    if (busyKey) return
    setBusyKey(`rm:${s.id}:${member.id}`)
    setCardError(s.id, null)
    // 먼저 화면에서 빼고, 실패하면 되돌린다.
    setData((prev) =>
      prev ? { ...prev, series: prev.series.map((x) => (x.id === s.id ? { ...x, members: x.members.filter((m) => m.id !== member.id), videoCount: Math.max(x.videoCount - 1, 0) } : x)) } : prev
    )
    const res = await v3Request(`/api/v3/series/${s.id}/members`, { method: 'DELETE', body: { videoId: member.id } }, '영상을 빼지 못했어요.')
    setBusyKey(null)
    if (!res.ok) {
      setData((prev) =>
        prev ? { ...prev, series: prev.series.map((x) => (x.id === s.id && !x.members.some((m) => m.id === member.id) ? { ...x, members: [...x.members, member], videoCount: x.videoCount + 1 } : x)) } : prev
      )
      setCardError(s.id, res.error)
      return
    }
    await load()
  }

  const renameSeries = async (s: SeriesRow, value: string) => {
    if (value === s.name) {
      setRenamingId(null)
      return
    }
    setRenameSaving(true)
    setRenameError(null)
    const res = await v3Request(`/api/v3/series/${s.id}`, { method: 'PATCH', body: { name: value } }, '이름을 바꾸지 못했어요.')
    setRenameSaving(false)
    if (!res.ok) {
      setRenameError(res.error)
      return
    }
    setData((prev) => (prev ? { ...prev, series: prev.series.map((x) => (x.id === s.id ? { ...x, name: value } : x)) } : prev))
    setRenamingId(null)
    await load()
  }

  const deleteSeries = async (s: SeriesRow) => {
    setBusyKey(`del:${s.id}`)
    setCardError(s.id, null)
    const res = await v3Request(`/api/v3/series/${s.id}`, { method: 'DELETE' }, '시리즈를 삭제하지 못했어요.')
    setBusyKey(null)
    // 이미 지워진 시리즈(404)도 목록에서는 사라져야 하므로 새로 불러온다.
    if (!res.ok && res.status !== 404) {
      setCardError(s.id, res.error)
      return
    }
    showSuccess(`“${s.name}” 시리즈를 삭제했어요. 영상은 그대로 남아 있어요.`)
    await load()
  }

  // 종목을 입력했다면 그 종목 영상이 위로 오도록, 검색어가 있으면 걸러서 보여준다.
  const pickable = useMemo(() => {
    const q = videoQuery.trim().toLowerCase()
    const stock = stockName.trim()
    let items = data?.eligibleVideos || []
    if (q) items = items.filter((v) => v.title.toLowerCase().includes(q) || (v.stockName || '').toLowerCase().includes(q))
    if (stock) items = [...items].sort((a, b) => Number(b.stockName === stock) - Number(a.stockName === stock))
    return items
  }, [data, videoQuery, stockName])
  const pickMore = useShowMore(pickable, 8, 10)
  const seriesMore = useShowMore(data?.series || [], 5, 10)

  const header = <PageHeader icon="🧩" title="롱폼·숏폼·시리즈 비교" subtitle="어떤 형식과 시리즈가 반응을 더 잘 얻는지 비교합니다." />

  if (!data) {
    return (
      <>
        {header}
        <Toast toast={toast} />
        {loadError ? <ErrorBlock message={loadError} onRetry={() => void load()} /> : <LoadingBlock>비교 결과를 불러오는 중이에요…</LoadingBlock>}
      </>
    )
  }

  const { longform: lf, shortform: sf } = data.formatStats
  const formatAnswer = summarizeFormats(lf, sf)
  const noVideos = lf.count === 0 && sf.count === 0
  const engWinner = lf.count > 0 && sf.count > 0 && lf.avgEngagementPct !== sf.avgEngagementPct ? (lf.avgEngagementPct > sf.avgEngagementPct ? 'longform' : 'shortform') : null
  const velWinner = lf.count > 0 && sf.count > 0 && lf.avgVelocity !== sf.avgVelocity ? (lf.avgVelocity > sf.avgVelocity ? 'longform' : 'shortform') : null
  const movable = data.movableVideos || []

  return (
    <>
      {header}
      <Toast toast={toast} />

      <div className="v3a-stack">
        <SampleBanner show={data.sample} />

        {noVideos ? (
          <EmptyBlock title="아직 비교할 영상이 없어요" actionHref="/v3/register" actionLabel="영상 등록하러 가기">
            롱폼과 숏폼 영상이 함께 쌓이면, 어느 형식이 시청자 반응을 더 잘 얻는지 여기에서 바로 알려드려요.
          </EmptyBlock>
        ) : (
          <>
            {formatAnswer ? <AnswerCard tone={formatAnswer.tone} eyebrow="롱폼 vs 숏폼" headline={formatAnswer.headline} detail={formatAnswer.detail} /> : null}

            <Section title="롱폼 vs 숏폼" description="영상이 몇 개인지가 아니라, 시청자가 얼마나 반응하고 조회수가 얼마나 빨리 느는지를 비교해요. ▲는 더 좋은 쪽이에요.">
              <table className="v3a-compare">
                <thead>
                  <tr>
                    <th />
                    <th>롱폼</th>
                    <th>숏폼</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">영상 수</th>
                    <td>{formatNumber(lf.count)}개</td>
                    <td>{formatNumber(sf.count)}개</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      시청자 반응률
                      <small>조회수 대비 좋아요+댓글 비율</small>
                    </th>
                    <td className={engWinner === 'longform' ? 'win' : undefined}>{lf.count ? formatPct(lf.avgEngagementPct, 2) : '—'}</td>
                    <td className={engWinner === 'shortform' ? 'win' : undefined}>{sf.count ? formatPct(sf.avgEngagementPct, 2) : '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      하루 평균 조회수
                      <small>올린 뒤 하루에 평균 몇 번 보였는지</small>
                    </th>
                    <td className={velWinner === 'longform' ? 'win' : undefined}>{lf.count ? `${formatNumber(Math.round(lf.avgVelocity))}회` : '—'}</td>
                    <td className={velWinner === 'shortform' ? 'win' : undefined}>{sf.count ? `${formatNumber(Math.round(sf.avgVelocity))}회` : '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row">
                      총 조회수
                      <small>모든 영상의 조회수를 더한 값</small>
                    </th>
                    <td title={formatNumber(lf.totalViews)}>{formatCompactNumber(lf.totalViews)}회</td>
                    <td title={formatNumber(sf.totalViews)}>{formatCompactNumber(sf.totalViews)}회</td>
                  </tr>
                </tbody>
              </table>
            </Section>
          </>
        )}

        <Section
          title="시리즈"
          count={data.series.length}
          description="같은 주제로 이어지는 영상 묶음이에요. 같은 종목의 시리즈 밖 영상과 비교해서, 묶어 만든 효과가 있는지 알려드려요."
          actions={
            <>
              {data.sample ? <span className="small muted">SQL 실행 후 만들 수 있어요</span> : null}
              <button
                type="button"
                className={showForm ? 'button secondary' : 'button'}
                disabled={data.sample && !showForm}
                onClick={() => (showForm ? closeForm() : setShowForm(true))}
              >
                {showForm ? '닫기' : '새 시리즈 만들기'}
              </button>
            </>
          }
        >
          {showForm ? (
            <form
              className="v3-inline-form"
              noValidate
              onSubmit={(e) => void createSeries(e)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !creating) closeForm()
              }}
            >
              <div className="v3-form-grid">
                <div className="field">
                  <label className="label" htmlFor="v3-series-name">
                    시리즈 이름
                    <Req />
                  </label>
                  <input
                    id="v3-series-name"
                    ref={nameRef}
                    className="input"
                    value={name}
                    maxLength={200}
                    disabled={creating}
                    aria-invalid={!!(nameError || formError)}
                    aria-describedby="v3-series-name-err"
                    onChange={(e) => {
                      setName(e.target.value)
                      if (formError) setFormError(null)
                    }}
                    placeholder="예: 삼성전자 실적 브리핑 시리즈"
                  />
                  <FieldError id="v3-series-name-err">{nameError || formError}</FieldError>
                </div>
                <div className="field">
                  <label className="label" htmlFor="v3-series-stock">
                    종목 (선택)
                  </label>
                  <input
                    id="v3-series-stock"
                    className="input"
                    list="v3-series-stock-suggestions"
                    value={stockName}
                    maxLength={100}
                    disabled={creating}
                    onChange={(e) => setStockName(e.target.value)}
                    placeholder="예: 삼성전자"
                  />
                  <p className="v3a-field-help">넣으면 같은 종목의 다른 영상과 비교해요. 비워도 돼요.</p>
                  <datalist id="v3-series-stock-suggestions">
                    {SAMPLE_STOCK_NAMES.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="v3-series-video-search">
                  묶을 영상 고르기 (선택) · 지금 {selectedIds.length}개 골랐어요
                </label>
                <input
                  id="v3-series-video-search"
                  className="input v3a-search"
                  type="search"
                  placeholder="제목이나 종목으로 찾기"
                  value={videoQuery}
                  disabled={creating}
                  onChange={(e) => setVideoQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // 검색칸에서 Enter 를 눌러도 시리즈가 만들어지지 않게 한다.
                    if (e.key === 'Enter') e.preventDefault()
                  }}
                />
                <div className="v3a-picker scroll">
                  {pickable.length === 0 ? (
                    <div className="v3a-empty compact">
                      <div className="v3a-empty-text">{(data.eligibleVideos || []).length === 0 ? '묶을 수 있는 영상이 아직 없어요. 시리즈만 먼저 만들고 나중에 추가해도 돼요.' : '검색 결과가 없어요.'}</div>
                    </div>
                  ) : (
                    <>
                      {pickMore.visible.map((v) => (
                        <button key={v.id} type="button" className={`v3a-pick check ${selectedIds.includes(v.id) ? 'selected' : ''}`} disabled={creating} aria-pressed={selectedIds.includes(v.id)} onClick={() => toggleSelect(v.id)}>
                          <span className="v3a-pick-title">
                            {v.title}
                            {v.stockName ? <span className="v3a-row-sub">· {v.stockName}</span> : null}
                          </span>
                          <span className="small muted">{selectedIds.includes(v.id) ? '✓ 선택됨' : ''}</span>
                        </button>
                      ))}
                      <MoreButton remaining={pickMore.remaining} onClick={pickMore.more} />
                    </>
                  )}
                </div>
                <p className="v3a-field-help">영상은 나중에 시리즈 카드에서 더 추가할 수 있어요. 이미 다른 시리즈에 들어간 영상은 여기서 보이지 않아요.</p>
              </div>
              <div className="v3a-lead-actions">
                <button type="submit" className="button" disabled={creating}>
                  {creating ? '저장 중…' : '시리즈 만들기'}
                </button>
                <button type="button" className="button secondary" disabled={creating} onClick={closeForm}>
                  취소
                </button>
              </div>
            </form>
          ) : null}

          {data.series.length === 0 ? (
            <EmptyBlock title="아직 만든 시리즈가 없어요" actionLabel="첫 시리즈 만들기" onAction={() => setShowForm(true)}>
              예를 들어 “삼성전자 실적 브리핑”처럼 같은 주제로 이어지는 영상을 묶어 두세요. 묶어 두면 시리즈가 일반 영상보다 반응이 좋은지 자동으로 비교해 드려요.
            </EmptyBlock>
          ) : (
            <div className="v3a-cards">
              {seriesMore.visible.map((s) => {
                const engChange = pctChange(s.avgEngagementPct, s.baselineEngagementPct)
                const velChange = pctChange(s.avgVelocity, s.baselineVelocity)
                const engText = describeChange(engChange, '시리즈 밖 영상')
                const velText = describeChange(velChange, '시리즈 밖 영상')
                const verdict = seriesVerdict(s, engChange, velChange)
                const otherMovable = movable.filter((v) => v.seriesId !== s.id)
                const canAdd = !data.sample && s.canEdit && (data.eligibleVideos.length > 0 || otherMovable.length > 0)
                const cardBusy = !!busyKey && busyKey.includes(s.id)
                const isRenaming = renamingId === s.id
                return (
                  <div className="v3a-card" key={s.id}>
                    <div className="v3a-card-head">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        {isRenaming ? (
                          <InlineEditor
                            label="시리즈 이름"
                            initial={s.name}
                            maxLength={200}
                            required
                            saving={renameSaving}
                            error={renameError}
                            onSave={(value) => renameSeries(s, value)}
                            onCancel={() => {
                              setRenamingId(null)
                              setRenameError(null)
                            }}
                          />
                        ) : (
                          <div className="v3a-card-title">
                            {s.name} {data.sample ? <Tag tone="amber">예시</Tag> : null}
                          </div>
                        )}
                        <div className="v3-cell-sub">
                          {s.stockName || '종목 무관'} · 영상 {formatNumber(s.videoCount)}개{s.createdByName ? ` · 만든 사람 ${s.createdByName}` : ''}
                        </div>
                      </div>
                      <Tag tone={verdict.tone}>{verdict.label}</Tag>
                    </div>
                    {s.videoCount === 0 ? (
                      <p className="v3a-note">아직 이 시리즈에 묶인 영상이 없어요. 아래에서 영상을 추가하면 효과를 계산해요.</p>
                    ) : (
                      <div className="v3a-series-lines">
                        <div className="v3a-series-line">
                          시청자 반응률
                          <strong>{formatPct(s.avgEngagementPct, 2)}</strong>
                          <span className={`v3a-tone-${engText.tone}`}>
                            {engChange === null ? '비교할 기준 영상이 없어요' : `${engText.text} (${formatPct(s.baselineEngagementPct, 2)})`}
                          </span>
                        </div>
                        <div className="v3a-series-line">
                          하루 평균 조회수
                          <strong>{formatNumber(Math.round(s.avgVelocity))}회</strong>
                          <span className={`v3a-tone-${velText.tone}`}>
                            {velChange === null ? '비교할 기준 영상이 없어요' : `${velText.text} (${formatNumber(Math.round(s.baselineVelocity))}회)`}
                          </span>
                        </div>
                      </div>
                    )}

                    {s.members.length > 0 ? (
                      <div>
                        <button type="button" className="v3i-linkbtn" aria-expanded={!!openMembers[s.id]} onClick={() => setOpenMembers((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}>
                          {openMembers[s.id] ? '묶인 영상 접기' : `묶인 영상 ${formatNumber(s.members.length)}개 보기`}
                        </button>
                        {openMembers[s.id] ? (
                          <ul className="v3i-members">
                            {s.members.map((m) => (
                              <li key={m.id} className="v3i-member">
                                <span className="v3i-member-title" title={m.title}>
                                  {m.title}
                                </span>
                                {s.canEdit ? (
                                  <button type="button" className="v3i-linkbtn" disabled={!!busyKey} onClick={() => void removeMember(s, m)} aria-label={`${m.title} 시리즈에서 빼기`}>
                                    {busyKey === `rm:${s.id}:${m.id}` ? '빼는 중…' : '시리즈에서 빼기'}
                                  </button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}

                    {canAdd ? (
                      <div className="v3a-series-add">
                        <select
                          id={`v3-series-add-${s.id}`}
                          className="select"
                          aria-label={`${s.name}에 추가할 영상`}
                          value={addPickers[s.id] || ''}
                          disabled={busyKey === `add:${s.id}`}
                          onChange={(e) => setAddPickers((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        >
                          <option value="">추가할 영상 고르기…</option>
                          {data.eligibleVideos.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.title}
                            </option>
                          ))}
                          {otherMovable.length > 0 ? (
                            <optgroup label="다른 시리즈에서 옮기기">
                              {otherMovable.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.title} (지금: {v.seriesName})
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </select>
                        <button type="button" className="button secondary xs" disabled={busyKey === `add:${s.id}` || !addPickers[s.id]} onClick={() => void addToSeries(s)}>
                          {busyKey === `add:${s.id}` ? '저장 중…' : '이 시리즈에 추가'}
                        </button>
                      </div>
                    ) : null}

                    {s.canEdit && !data.sample ? (
                      <div className="v3i-tools">
                        {!isRenaming ? (
                          <button type="button" className="button secondary xs" disabled={cardBusy} onClick={() => { setRenamingId(s.id); setRenameError(null) }}>
                            이름 바꾸기
                          </button>
                        ) : null}
                        <ConfirmButton
                          label="시리즈 삭제"
                          question="정말 삭제할까요? 영상은 남고 묶음만 사라져요."
                          confirmLabel="삭제"
                          busyLabel="삭제 중…"
                          danger
                          busy={busyKey === `del:${s.id}`}
                          disabled={cardBusy && busyKey !== `del:${s.id}`}
                          onConfirm={() => deleteSeries(s)}
                        />
                      </div>
                    ) : !s.canEdit && !data.sample ? (
                      <p className="v3i-inline-note">{s.createdByName ? `${s.createdByName}님이 만든 시리즈라서 볼 수만 있어요.` : '만든 사람이 없는 시리즈라서 관리자만 고칠 수 있어요.'}</p>
                    ) : null}
                    <FieldError>{cardErrors[s.id]}</FieldError>
                  </div>
                )
              })}
              <MoreButton remaining={seriesMore.remaining} onClick={seriesMore.more} label="시리즈 더 보기" />
            </div>
          )}
        </Section>

        <HowTo>
          <p>시청자 반응률 = (좋아요 + 댓글) ÷ 조회수 × 100</p>
          <p>하루 평균 조회수 = 조회수 ÷ 올린 지 지난 날짜 (최소 1일)</p>
          <p>시리즈 효과: 시리즈에 묶인 영상들의 평균을, 같은 종목이면서 시리즈에 속하지 않은 영상들의 평균(괄호 안 숫자)과 비교해요. 두 지표가 모두 5% 이상 높으면 ‘시리즈 효과 있음’이에요.</p>
          <p>영상은 한 시리즈에만 들어갈 수 있어요. 다른 시리즈에 있는 영상을 추가하면 그쪽에서 옮겨 와요.</p>
        </HowTo>
      </div>
    </>
  )
}
