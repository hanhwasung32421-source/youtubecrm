'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v2/app-shell'
import { SampleBanner } from '@/components/v2/sample-banner'
import { BulkRegister } from '@/components/v2/bulk-register'
import { MyVideoRow, type RowMode } from '@/components/v2/my-video-row'
import { friendlyRegisterError, normalizeYoutubeUrl, youtubeVideoId } from '@/components/v2/register-utils'
import { useV2Me } from '@/components/v2/session-context'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { authedPatchJson } from '@/lib/v2/client'
import { kstYmd } from '@/lib/v2/dates'
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  emptyChecklist,
  titleKeywordSuggestions,
  type ContentType,
  type MineVideoItem,
  type MineVideosPayload,
  type SeoChecklist,
  type SeoChecklistField
} from '@/lib/v2/types'

const TYPE_KEY = 'v2.register.contentType'
const STOCKS_KEY = 'v2.register.recentStocks'
const MAX_RECENT_STOCKS = 8
const EARLIER_PREVIEW = 5
const HIGHLIGHT_MS = 6000

// ---- 브라우저 저장소(없거나 막혀 있어도 화면은 정상 동작) ----
function readStoredType(): ContentType {
  try {
    const v = window.localStorage.getItem(TYPE_KEY)
    return v === 'shortform' ? 'shortform' : 'longform'
  } catch {
    return 'longform'
  }
}

function readStoredStocks(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STOCKS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string' && s.trim() !== '').slice(0, MAX_RECENT_STOCKS) : []
  } catch {
    return []
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 저장소를 못 써도 등록 자체에는 영향 없음
  }
}

type Notice = { field: 'url' | 'stock' | 'server'; text: string } | null
type Confirmed = { stock: string; type: ContentType; count: number } | null

export default function RegisterPage() {
  const me = useV2Me()
  const { toast, showSuccess, showError } = useToast()

  const [url, setUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>(readStoredType)
  const [stock, setStock] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [confirmed, setConfirmed] = useState<Confirmed>(null)
  const [typeHint, setTypeHint] = useState('')
  const [recentStocks, setRecentStocks] = useState<string[]>(readStoredStocks)

  const [videos, setVideos] = useState<MineVideoItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [checklists, setChecklists] = useState<Record<string, SeoChecklist>>({})
  const [checklistSample, setChecklistSample] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [sessionCount, setSessionCount] = useState(0)
  const [bulkMode, setBulkMode] = useState(false)
  const [activeRow, setActiveRow] = useState<{ id: string; mode: Exclude<RowMode, null> } | null>(null)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())
  const highlightTimers = useRef<number[]>([])

  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)

  const today = kstYmd()
  const todayVideos = useMemo(() => videos.filter((v) => kstYmd(new Date(v.created_at)) === today), [videos, today])
  const earlierVideos = useMemo(() => videos.filter((v) => kstYmd(new Date(v.created_at)) !== today), [videos, today])
  const todayCount = todayVideos.length
  const registeredIds = useMemo(() => {
    const ids = new Set<string>()
    for (const v of videos) {
      const id = v.youtube_url ? youtubeVideoId(v.youtube_url) : null
      if (id) ids.add(id)
    }
    return ids
  }, [videos])
  const suggestions = useMemo(() => titleKeywordSuggestions(stock), [stock])

  // 이미 등록된 영상인지 미리 알려 준다(같은 영상을 다시 등록하면 종목·형식이 덮어써진다).
  const existing = useMemo(() => {
    const id = youtubeVideoId(normalizeYoutubeUrl(url))
    if (!id) return null
    return videos.find((v) => v.youtube_url && youtubeVideoId(v.youtube_url) === id) || null
  }, [url, videos])

  // 종목 칩: 방금 쓴 종목 → 내가 등록한 영상의 종목 순서로 중복 없이
  const stockChips = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const name of [...recentStocks, ...videos.map((v) => v.stock_name)]) {
      const n = (name || '').trim()
      if (!n || seen.has(n)) continue
      seen.add(n)
      out.push(n)
      if (out.length >= MAX_RECENT_STOCKS) break
    }
    return out
  }, [recentStocks, videos])

  const loadChecklists = async (videoIds: string[]) => {
    if (videoIds.length === 0) {
      setChecklists({})
      return
    }
    const { ok, data } = await authedFetchJson<{ items: SeoChecklist[]; sample?: boolean }>(`/api/v2/seo-checklists?videoIds=${videoIds.join(',')}`)
    if (!ok) return
    setChecklistSample(Boolean(data.sample))
    const map: Record<string, SeoChecklist> = {}
    for (const item of data.items) map[item.video_id] = item
    setChecklists(map)
  }

  const load = async () => {
    const { ok, data } = await authedFetchJson<MineVideosPayload>('/api/videos/mine?page=1')
    setLoaded(true)
    if (!ok) {
      showError(data?.error || '등록한 영상 목록을 불러오지 못했어요.')
      return
    }
    setVideos(data.items)
    await loadChecklists(data.items.map((v) => v.id))
  }

  useEffect(() => {
    urlRef.current?.focus()
    void load()
    const timers = highlightTimers.current
    return () => {
      for (const t of timers) window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 최근 종목은 바뀔 때마다 브라우저에 저장
  useEffect(() => {
    writeStored(STOCKS_KEY, JSON.stringify(recentStocks))
  }, [recentStocks])

  // Esc: 열려 있는 수정/삭제 확인 창 닫기
  useEffect(() => {
    if (!activeRow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveRow(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeRow])

  // 방금 등록·수정한 줄을 몇 초 동안 강조
  const flash = (ids: string[]) => {
    setHighlightIds((prev) => new Set([...prev, ...ids]))
    const timer = window.setTimeout(() => {
      setHighlightIds((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
    }, HIGHLIGHT_MS)
    highlightTimers.current.push(timer)
  }

  const rememberStock = (name: string) => {
    setRecentStocks((prev) => [name, ...prev.filter((s) => s !== name)].slice(0, MAX_RECENT_STOCKS))
  }

  const onUrlChange = (value: string) => {
    setUrl(value)
    if (notice?.field === 'url' || notice?.field === 'server') setNotice(null)
    if (/\/shorts\//i.test(value) && contentType !== 'shortform') {
      setContentType('shortform')
      setTypeHint('쇼츠 주소라서 형식을 숏폼으로 바꿨어요.')
    } else if (!value) {
      setTypeHint('')
    }
  }

  const pickStock = (name: string) => {
    setStock(name)
    if (notice?.field === 'stock') setNotice(null)
    if (url.trim()) submitRef.current?.focus()
    else urlRef.current?.focus()
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return

    const cleanUrl = normalizeYoutubeUrl(url)
    const cleanStock = stock.trim().replace(/\s+/g, ' ')

    if (!cleanUrl) {
      setNotice({ field: 'url', text: '유튜브 주소를 붙여 넣어 주세요.' })
      urlRef.current?.focus()
      return
    }
    if (!youtubeVideoId(cleanUrl)) {
      setNotice({ field: 'url', text: '유튜브 영상 주소가 맞는지 확인해 주세요. (예: https://www.youtube.com/watch?v=…)' })
      urlRef.current?.focus()
      return
    }
    if (!cleanStock) {
      setNotice({ field: 'stock', text: '어떤 종목 영상인지 종목명을 적어 주세요.' })
      stockRef.current?.focus()
      return
    }

    setUrl(cleanUrl)
    setNotice(null)
    setSaving(true)
    try {
      const { ok, status, data } = await authedPostJson<{ ok?: boolean; video?: { id: string }; error?: string }>('/api/videos/create', {
        youtubeUrl: youtubeVideoId(cleanUrl) ? `https://www.youtube.com/watch?v=${youtubeVideoId(cleanUrl)}` : cleanUrl,
        contentType,
        stockName: cleanStock,
        contentCategory: note.trim() || null
      })
      if (!ok || !data.video) {
        setNotice({ field: 'server', text: friendlyRegisterError(data?.error, status) })
        return
      }

      // SEO 점검표 행을 기본값으로 만들어 둔다. 테이블이 없으면 조용히 넘어간다.
      void authedPatchJson('/api/v2/seo-checklists', { videoId: data.video.id, patch: {} }).catch(() => undefined)

      const count = Math.max(todayCount, sessionCount) + 1
      setSessionCount(count)
      setConfirmed({ stock: cleanStock, type: contentType, count })
      writeStored(TYPE_KEY, contentType)
      rememberStock(cleanStock)
      flash([data.video.id])

      // 다음 영상을 바로 붙여 넣을 수 있게 비우고 주소 칸으로 돌아간다.
      setUrl('')
      setStock('')
      setNote('')
      setTypeHint('')
      urlRef.current?.focus()
      void load()
    } catch {
      setNotice({ field: 'server', text: '네트워크가 불안정해요. 잠시 후 다시 시도해 주세요.' })
    } finally {
      setSaving(false)
      urlRef.current?.focus()
    }
  }

  const saveChecklist = async (video: MineVideoItem, patch: Partial<Record<SeoChecklistField, boolean>>) => {
    setBusyId(video.id)
    try {
      const { ok, data } = await authedPatchJson<{ ok?: boolean; item?: SeoChecklist; error?: string }>('/api/v2/seo-checklists', {
        videoId: video.id,
        patch
      })
      if (!ok) {
        showError(data?.error || '점검 내용을 저장하지 못했어요.')
        return
      }
      if (data.item) setChecklists((prev) => ({ ...prev, [video.id]: data.item as SeoChecklist }))
    } finally {
      setBusyId(null)
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showSuccess('복사했어요.')
    } catch {
      showError('복사하지 못했어요. 직접 선택해서 복사해 주세요.')
    }
  }

  const visibleEarlier = showAll ? earlierVideos : earlierVideos.slice(0, EARLIER_PREVIEW)

  const notify = (tone: 'success' | 'error', text: string) => (tone === 'success' ? showSuccess(text) : showError(text))

  const onPatched = (id: string, patch: { stock_name: string; content_type: ContentType }) => {
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)))
    rememberStock(patch.stock_name)
    flash([id])
  }

  const onDeleted = (id: string) => {
    const gone = videos.find((v) => v.id === id)
    setVideos((prev) => prev.filter((v) => v.id !== id))
    setActiveRow(null)
    setOpenId((cur) => (cur === id ? null : cur))
    if (gone && kstYmd(new Date(gone.created_at)) === today) setSessionCount((c) => Math.max(0, c - 1))
  }

  const renderRow = (video: MineVideoItem) => (
    <MyVideoRow
      key={video.id}
      video={video}
      checklist={checklists[video.id] || emptyChecklist(video.id)}
      isNew={highlightIds.has(video.id)}
      mode={activeRow?.id === video.id ? activeRow.mode : null}
      onMode={(mode) => setActiveRow(mode ? { id: video.id, mode } : null)}
      checklistOpen={openId === video.id}
      onToggleChecklist={() => setOpenId(openId === video.id ? null : video.id)}
      checklistBusy={busyId === video.id}
      onSaveChecklist={(patch) => void saveChecklist(video, patch)}
      onPatched={onPatched}
      onDeleted={onDeleted}
      onNotify={notify}
    />
  )

  return (
    <>
      <PageHeader title="영상 등록" subtitle="유튜브 주소와 종목만 넣으면 조회수·좋아요는 자동으로 가져옵니다." />
      <Toast toast={toast} />

      {bulkMode ? (
        <BulkRegister
          defaultType={contentType}
          stockChips={stockChips}
          registeredIds={registeredIds}
          onRegistered={({ videoId, stock: name }) => {
            setSessionCount((c) => c + 1)
            rememberStock(name)
            flash([videoId])
          }}
          onFinished={() => void load()}
          onClose={() => {
            setBulkMode(false)
            window.setTimeout(() => urlRef.current?.focus(), 0)
          }}
        />
      ) : (
      <div className="panel v2-register">
        <form onSubmit={submit} noValidate className="v2-register-form">
          <div className="field">
            <label className="label" htmlFor="v2-reg-url">
              유튜브 주소
            </label>
            <input
              id="v2-reg-url"
              ref={urlRef}
              className="input v2-url-input"
              placeholder="주소를 붙여 넣으세요 (https://www.youtube.com/watch?v=…)"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text')
                if (!text.trim()) return
                e.preventDefault()
                onUrlChange(normalizeYoutubeUrl(text))
              }}
              onBlur={() => {
                if (url.trim()) setUrl(normalizeYoutubeUrl(url))
              }}
              aria-invalid={notice?.field === 'url' || undefined}
            />
            {notice?.field === 'url' ? <div className="v2-hint">{notice.text}</div> : null}
            {!notice && existing ? (
              <div className="v2-hint">
                이미 등록한 영상이에요 ({existing.stock_name}). 다시 등록하면 종목과 형식이 새로 적은 내용으로 바뀝니다.
              </div>
            ) : null}
            {!notice && !existing && typeHint ? <div className="v2-hint quiet">{typeHint}</div> : null}
          </div>

          <div className="v2-reg-row">
            <div className="field">
              <span className="label" id="v2-reg-type-label">
                형식
              </span>
              <div className="v2-seg" role="group" aria-labelledby="v2-reg-type-label">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`v2-seg-btn ${contentType === type ? 'active' : ''}`}
                    aria-pressed={contentType === type}
                    disabled={saving}
                    onClick={() => {
                      setContentType(type)
                      setTypeHint('')
                    }}
                  >
                    {CONTENT_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            <div className="field v2-reg-stock">
              <label className="label" htmlFor="v2-reg-stock">
                종목명
              </label>
              <input
                id="v2-reg-stock"
                ref={stockRef}
                className="input"
                placeholder="예: 삼성전자"
                autoComplete="off"
                value={stock}
                onChange={(e) => {
                  setStock(e.target.value)
                  if (notice?.field === 'stock') setNotice(null)
                }}
                aria-invalid={notice?.field === 'stock' || undefined}
              />
            </div>

            <button ref={submitRef} type="submit" className="button v2-reg-submit" disabled={saving}>
              {saving ? '등록 중…' : '등록'}
            </button>
          </div>

          {notice?.field === 'stock' ? <div className="v2-hint">{notice.text}</div> : null}

          {stockChips.length > 0 ? (
            <div className="v2-recent">
              <span className="small muted">최근 종목</span>
              <div className="v2-chips">
                {stockChips.map((name) => (
                  <button key={name} type="button" className={`v2-chip v2-chip-btn ${stock.trim() === name ? 'on' : ''}`} disabled={saving} onClick={() => pickStock(name)}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <details className="v2-more">
            <summary>메모 남기기 (선택)</summary>
            <input className="input compact" placeholder="나중에 알아보기 위한 내부 메모" value={note} onChange={(e) => setNote(e.target.value)} />
          </details>

          {suggestions.length > 0 ? (
            <details className="v2-more">
              <summary>제목에 넣으면 좋은 표현 보기</summary>
              <div className="small muted" style={{ marginBottom: 6 }}>
                누르면 복사돼요. 제목에 종목명과 이런 검색어를 함께 쓰면 검색에 더 잘 걸립니다.
              </div>
              <div className="v2-chips">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="v2-chip v2-chip-btn" onClick={() => void copyText(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </details>
          ) : null}

          <div className="v2-status" aria-live="polite">
            {notice?.field === 'server' ? <span className="v2-hint">{notice.text}</span> : null}
            {!notice && confirmed ? (
              <span className="v2-confirm">
                <span aria-hidden="true">✓</span> 등록됨 · 오늘 {confirmed.count}번째
                <span className="muted">
                  {' '}
                  · {confirmed.stock} · {CONTENT_TYPE_LABELS[confirmed.type]}
                </span>
              </span>
            ) : null}
          </div>
        </form>
        <div className="v2-mode-switch">
          <button type="button" className="v2-text-btn" disabled={saving} onClick={() => setBulkMode(true)}>
            영상이 많나요? 여러 개 한 번에 붙여넣기 →
          </button>
        </div>
      </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">{me.isAdmin ? '최근 등록된 영상' : '내가 등록한 영상'}</div>
            <p className="panel-subtitle">
              {loaded && videos.length > 0
                ? `오늘 ${Math.max(todayCount, sessionCount)}개 등록 · 종목·형식이 틀렸으면 「수정」, 잘못 올린 영상은 「삭제」를 누르세요.`
                : '등록하면 여기에 쌓여요.'}
            </p>
          </div>
        </div>
        <SampleBanner show={checklistSample} />

        {!loaded ? (
          <div className="small muted">불러오는 중…</div>
        ) : videos.length === 0 ? (
          <div className="empty-state">
            <div style={{ color: 'var(--text)', fontWeight: 700, marginBottom: 6 }}>아직 등록한 영상이 없어요</div>
            <p className="small" style={{ margin: '0 0 14px' }}>
              위 칸에 유튜브 주소와 종목명을 넣고 Enter를 누르면 첫 영상이 등록돼요.
            </p>
            <button
              type="button"
              className="button"
              onClick={() => {
                setBulkMode(false)
                window.setTimeout(() => urlRef.current?.focus(), 0)
              }}
            >
              주소 입력하러 가기
            </button>
          </div>
        ) : (
          <div className="list v2-vlist">
            {todayVideos.length > 0 ? <div className="v2-group-label">오늘 · {todayVideos.length}개</div> : null}
            {todayVideos.map(renderRow)}
            {earlierVideos.length > 0 ? <div className="v2-group-label">이전 등록</div> : null}
            {visibleEarlier.map(renderRow)}
            {!showAll && earlierVideos.length > EARLIER_PREVIEW ? (
              <button type="button" className="button secondary" onClick={() => setShowAll(true)}>
                {earlierVideos.length - EARLIER_PREVIEW}개 더 보기
              </button>
            ) : null}
          </div>
        )}
      </div>
    </>
  )
}
