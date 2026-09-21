'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { EmptyState, Section } from '@/components/v3/ui'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import { isTodayKst } from '@/lib/v3/engagement'
import { BulkRegister } from './bulk-register'
import { MyVideosList, type MineVideo } from './my-videos'
import { registerVideo, type ContentType } from './register-api'
import { normalizeYoutubeUrl, readStored, videoIdFromStoredUrl, writeStored } from './youtube-url'

type PreviewResponse = {
  title?: string
  channelName?: string
  thumbnailUrl?: string | null
  error?: string
}

type Status = { id: number; kind: 'ok' | 'error'; text: string; count?: number }

const TYPE_KEY = 'v3.register.contentType'
const STOCKS_KEY = 'v3.register.recentStocks'
const MAX_CHIPS = 8
const PREVIEW_DELAY_MS = 900
const HIGHLIGHT_MS = 4500

function typeLabel(type: ContentType) {
  return type === 'shortform' ? '숏폼' : '롱폼'
}

function readRecentStocks(): string[] {
  const raw = readStored(STOCKS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_CHIPS) : []
  } catch {
    return []
  }
}

function mergeStocks(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const name of list) {
      const key = name.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(key)
    }
  }
  return out.slice(0, MAX_CHIPS)
}

export default function RegisterPage() {
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [stockName, setStockName] = useState('')
  const [contentCategory, setContentCategory] = useState('')
  const [recentStocks, setRecentStocks] = useState<string[]>([])

  const [urlHint, setUrlHint] = useState('')
  const [stockHint, setStockHint] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [saving, setSaving] = useState(false)

  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const previewCache = useRef(new Map<string, PreviewResponse>())
  const previewToken = useRef(0)

  const [videos, setVideos] = useState<MineVideo[] | null>(null)
  const [listError, setListError] = useState(false)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set())

  const { toast, showSuccess, showError } = useToast()

  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const statusId = useRef(0)

  const normalized = useMemo(() => normalizeYoutubeUrl(youtubeUrl), [youtubeUrl])
  const validId = normalized.ok ? normalized.videoId : ''

  const todayVideos = useMemo(() => (videos || []).filter((v) => isTodayKst(v.created_at)), [videos])
  const todayCount = todayVideos.length

  // 오늘 이미 등록한 영상인지(같은 주소를 두 번 넣는 실수 방지용 안내)
  const todayIds = useMemo(() => {
    const set = new Set<string>()
    for (const v of todayVideos) {
      const id = videoIdFromStoredUrl(v.youtube_url)
      if (id) set.add(id)
    }
    return set
  }, [todayVideos])
  const isDuplicate = !!validId && todayIds.has(validId)

  // 저장해 둔 형식·종목 불러오기 + 첫 화면에서 바로 주소 칸에 커서
  useEffect(() => {
    const savedType = readStored(TYPE_KEY)
    if (savedType === 'longform' || savedType === 'shortform') setContentType(savedType)
    setRecentStocks(readRecentStocks())
    urlRef.current?.focus()
  }, [])

  const loadMine = useCallback(async (): Promise<number | null> => {
    try {
      const { ok, data } = await authedFetchJson<{ items: MineVideo[] }>('/api/videos/mine?page=1')
      if (!ok) {
        setListError(true)
        return null
      }
      setListError(false)
      const items = data.items || []
      setVideos(items)
      setRecentStocks((prev) => mergeStocks(prev, items.map((v) => v.stock_name || '')))
      return items.filter((v) => isTodayKst(v.created_at)).length
    } catch {
      setListError(true)
      return null
    }
  }, [])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  // 링크 미리보기: 붙여넣고 잠시 멈췄을 때만 1번 불러온다. 같은 영상은 다시 부르지 않고,
  // 등록을 눌러 저장이 시작되면(=빠르게 입력한 경우) 아예 부르지 않는다. 여러 개 모드에서는 부르지 않는다.
  useEffect(() => {
    if (!validId || saving || mode !== 'single') {
      setPreview(null)
      return
    }
    const cached = previewCache.current.get(validId)
    if (cached) {
      setPreview(cached)
      return
    }
    setPreview(null)
    const token = ++previewToken.current
    const timer = window.setTimeout(async () => {
      const target = normalizeYoutubeUrl(youtubeUrl)
      if (!target.ok) return
      try {
        const { ok, data } = await authedFetchJson<PreviewResponse>(`/api/v3/link-preview?url=${encodeURIComponent(target.url)}`)
        if (token !== previewToken.current) return
        const result: PreviewResponse = ok && !data?.error ? data : { error: data?.error || 'no-preview' }
        previewCache.current.set(target.videoId, result)
        setPreview(result)
      } catch {
        // 미리보기는 없어도 등록에는 영향이 없다.
      }
    }, PREVIEW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      previewToken.current++
    }
    // youtubeUrl은 validId가 바뀔 때만 의미가 있으므로 의존성에서 제외한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validId, saving, mode])

  const chooseType = (type: ContentType) => {
    setContentType(type)
    writeStored(TYPE_KEY, type)
  }

  const rememberStock = (name: string) => {
    setRecentStocks((prev) => {
      const next = mergeStocks([name], prev)
      writeStored(STOCKS_KEY, JSON.stringify(next))
      return next
    })
  }

  // 방금 등록한 줄을 잠깐 강조한다.
  const flash = (id: string | null) => {
    if (!id) return
    setHighlightIds((prev) => new Set(prev).add(id))
    window.setTimeout(() => {
      setHighlightIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, HIGHLIGHT_MS)
  }

  const switchMode = (next: 'single' | 'bulk') => {
    setMode(next)
    if (next === 'single') window.setTimeout(() => urlRef.current?.focus(), 0)
  }

  const onUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    // 여러 줄(주소가 2개 이상)을 붙여넣으면 여러 개 모드로 안내한다.
    const lineCount = pasted.split(/\r?\n/).filter((line) => normalizeYoutubeUrl(line).ok).length
    if (lineCount >= 2) {
      setUrlHint('주소가 여러 개예요. 아래 "여러 개 붙여넣기"를 이용해 주세요.')
      return
    }
    const result = normalizeYoutubeUrl(pasted)
    if (!result.ok) return // 주소가 아니면 그대로 붙여넣고 아래 안내에 맡긴다.
    e.preventDefault()
    setYoutubeUrl(result.url)
    setUrlHint('')
    if (result.isShort) setContentType('shortform')
    // 붙여넣자마자 종목 칸으로 넘어가 바로 이어서 입력할 수 있게 한다.
    window.setTimeout(() => stockRef.current?.focus(), 0)
  }

  const onUrlBlur = () => {
    if (normalized.ok) {
      if (youtubeUrl !== normalized.url) setYoutubeUrl(normalized.url)
      setUrlHint('')
    } else if (!normalized.empty) {
      setUrlHint('유튜브 영상 주소가 맞는지 확인해 주세요. (예: youtube.com/watch?v=… 또는 youtu.be/…)')
    }
  }

  const pickStock = (name: string) => {
    setStockName(name)
    setStockHint('')
    // 주소가 채워져 있으면 곧바로 등록 버튼으로(Enter 한 번이면 등록), 아니면 주소 칸으로
    window.setTimeout(() => (normalized.ok ? submitRef.current : urlRef.current)?.focus(), 0)
  }

  const say = (kind: Status['kind'], text: string, count?: number) => {
    const id = ++statusId.current
    setStatus({ id, kind, text, count })
    return id
  }

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return

    if (!normalized.ok) {
      setUrlHint(normalized.empty ? '유튜브 영상 주소를 붙여넣어 주세요.' : '유효하지 않은 주소예요. 유튜브 영상 주소가 맞는지 확인해 주세요.')
      urlRef.current?.focus()
      return
    }
    const stock = stockName.replace(/\s+/g, ' ').trim()
    if (!stock) {
      setStockHint('종목을 입력하거나 아래에서 골라 주세요.')
      stockRef.current?.focus()
      return
    }

    setSaving(true)
    setStatus(null)
    setUrlHint('')
    setStockHint('')
    try {
      const result = await registerVideo({ url: normalized.url, contentType, stockName: stock, contentCategory })
      if (!result.ok) {
        say('error', `등록하지 못했어요. ${result.message} 입력한 내용은 그대로 남아 있어요.`)
        return
      }

      rememberStock(stock)
      writeStored(TYPE_KEY, contentType)
      const id = say('ok', `${stock} · ${typeLabel(contentType)}`, todayCount + 1)
      flash(result.id)
      setYoutubeUrl('')
      setStockName('')
      setContentCategory('')
      setPreview(null)
      urlRef.current?.focus()

      // 목록을 새로 받아 오고, 서버 기준의 실제 "오늘 N번째"로 바로잡는다.
      void loadMine().then((count) => {
        if (count !== null) setStatus((s) => (s && s.id === id ? { ...s, count } : s))
      })
    } finally {
      setSaving(false)
      window.setTimeout(() => {
        // 저장이 끝나면 (성공이든 실패든) 곧바로 다음 입력을 이어갈 수 있게 커서를 돌려준다.
        if (document.activeElement === document.body) urlRef.current?.focus()
      }, 0)
    }
  }

  // 수정·삭제 결과는 다시 받아 오지 않고 화면의 목록에 바로 반영한다.
  const onPatched = (id: string, patch: { stock_name: string | null; content_type: ContentType }) => {
    setVideos((prev) => (prev ? prev.map((v) => (v.id === id ? { ...v, ...patch } : v)) : prev))
    if (patch.stock_name) rememberStock(patch.stock_name)
  }
  const onDeleted = (id: string) => {
    setVideos((prev) => (prev ? prev.filter((v) => v.id !== id) : prev))
  }
  const onNotice = (text: string, tone: 'success' | 'error') => (tone === 'success' ? showSuccess(text) : showError(text))

  const showFallback = videos !== null && todayVideos.length === 0 && videos.length > 0
  const firstRun = videos !== null && videos.length === 0

  return (
    <>
      <PageHeader title="영상 등록" subtitle="유튜브 주소와 종목만 넣으면 등록됩니다. 제목·조회수는 자동으로 가져옵니다." />

      <div hidden={mode !== 'single'}>
        <form className="v3-reg" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="v3-reg-url">유튜브 주소</label>
            <input
              id="v3-reg-url"
              ref={urlRef}
              className="input"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              placeholder="주소를 붙여넣으세요 (Ctrl+V)"
              value={youtubeUrl}
              readOnly={saving}
              onChange={(e) => {
                setYoutubeUrl(e.target.value)
                if (urlHint) setUrlHint('')
              }}
              onPaste={onUrlPaste}
              onBlur={onUrlBlur}
            />
            <div className={`v3-reg-hint ${urlHint || isDuplicate ? 'warn' : ''}`} aria-live="polite">
              {urlHint || (isDuplicate ? '오늘 이미 등록한 영상이에요. 다시 등록하면 종목·형식이 바뀝니다.' : '')}
            </div>
          </div>

          {preview && !preview.error ? (
            <div className="v3-reg-preview">
              {preview.thumbnailUrl ? <img src={preview.thumbnailUrl} alt="" /> : null}
              <span>
                {preview.title || '(제목 없음)'}
                {preview.channelName ? ` · ${preview.channelName}` : ''}
              </span>
            </div>
          ) : null}

          <div className="v3-reg-row">
            <div className="field">
              <label className="label" htmlFor="v3-reg-stock">종목</label>
              <input
                id="v3-reg-stock"
                ref={stockRef}
                className="input"
                type="text"
                autoComplete="off"
                placeholder="예: 삼성전자"
                value={stockName}
                readOnly={saving}
                onChange={(e) => {
                  setStockName(e.target.value)
                  if (stockHint) setStockHint('')
                }}
              />
            </div>
            <div className="field">
              <span className="label" id="v3-reg-type-label">형식</span>
              <div className="v3-seg" role="group" aria-labelledby="v3-reg-type-label">
                {(['longform', 'shortform'] as const).map((type) => (
                  <button key={type} type="button" aria-pressed={contentType === type} disabled={saving} onClick={() => chooseType(type)}>
                    {typeLabel(type)}
                  </button>
                ))}
              </div>
            </div>
            <button ref={submitRef} className="button" type="submit" disabled={saving} style={{ height: 44 }}>
              {saving ? '등록 중…' : '등록'}
            </button>
          </div>
          <div className={`v3-reg-hint ${stockHint ? 'warn' : ''}`} aria-live="polite" style={{ marginTop: -6 }}>
            {stockHint}
          </div>

          {recentStocks.length > 0 ? (
            <div className="v3-reg-chips" aria-label="최근 쓴 종목">
              <span className="v3-reg-chips-label">최근 종목</span>
              {recentStocks.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={`v3-tag blue v3-tag-button ${stockName === name ? 'active' : ''}`}
                  disabled={saving}
                  onClick={() => pickStock(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          ) : null}

          <details className="v3-reg-more">
            <summary>메모 추가 (선택)</summary>
            <input
              className="input"
              value={contentCategory}
              readOnly={saving}
              onChange={(e) => setContentCategory(e.target.value)}
              placeholder="예: 실적 브리핑"
              aria-label="메모"
            />
          </details>

          <div role="status" aria-live="polite">
            {status ? (
              <div className={`v3-reg-status ${status.kind === 'error' ? 'error' : ''}`}>
                {status.kind === 'ok' ? (
                  <span>
                    <strong>등록됨</strong>
                    {status.count ? ` · 오늘 ${status.count}번째` : ''} · {status.text}
                  </span>
                ) : (
                  <span>{status.text}</span>
                )}
              </div>
            ) : null}
          </div>
        </form>

        <div className="v3-reg-modelink">
          <button type="button" className="v3-text-button" onClick={() => switchMode('bulk')}>
            여러 개를 한꺼번에 등록하기 (여러 개 붙여넣기) ›
          </button>
        </div>
      </div>

      {mode === 'bulk' ? (
        <div className="v3-reg-bulkwrap">
          <div className="v3-reg-modelink" style={{ marginTop: 0 }}>
            <button type="button" className="v3-text-button" onClick={() => switchMode('single')}>
              ‹ 하나씩 등록하기
            </button>
          </div>
          <BulkRegister
            contentType={contentType}
            onChooseType={chooseType}
            recentStocks={recentStocks}
            todayIds={todayIds}
            onRegistered={({ stock }) => rememberStock(stock)}
            onBatchDone={async (ids) => {
              await loadMine()
              // 목록에 나타난 뒤에 강조해야 눈에 띈다.
              ids.forEach((id) => flash(id))
            }}
          />
        </div>
      ) : null}

      <Section
        title={showFallback ? '최근 등록한 영상' : '오늘 등록한 영상'}
        count={showFallback ? undefined : todayVideos.length}
        description={showFallback ? '오늘은 아직 등록한 영상이 없어서 최근 등록 내역을 보여드려요.' : '종목이나 형식이 잘못됐다면 줄 오른쪽의 수정·삭제로 바로 고칠 수 있어요.'}
      >
        {listError && videos === null ? (
          <EmptyState title="목록을 불러오지 못했어요" action={<button className="button secondary" onClick={() => void loadMine()}>다시 불러오기</button>}>
            등록은 그대로 하실 수 있어요.
          </EmptyState>
        ) : videos === null ? (
          <div className="small muted">불러오는 중…</div>
        ) : firstRun ? (
          <EmptyState title="아직 등록한 영상이 없어요">
            <div className="v3-reg-guide">
              <span>1. 유튜브 주소를 위 칸에 붙여넣기</span>
              <span>2. 종목 입력 (다음부터는 아래 버튼으로 고르기)</span>
              <span>3. Enter 키로 등록 — 바로 다음 영상을 이어서 넣을 수 있어요</span>
            </div>
          </EmptyState>
        ) : (
          <div className="v3-mine">
            <MyVideosList videos={videos} highlightIds={highlightIds} onPatched={onPatched} onDeleted={onDeleted} onNotice={onNotice} />
          </div>
        )}
      </Section>

      <Toast toast={toast} />
    </>
  )
}
