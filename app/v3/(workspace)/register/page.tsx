'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { EmptyState, Section } from '@/components/v3/ui'
import { SegmentedType } from '@/components/v3/segmented'
import { PreviewSkeleton, VideoListSkeleton } from '@/components/v3/skeleton'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import { isTodayKst } from '@/lib/v3/engagement'
import { BulkRegister } from './bulk-register'
import { MyVideosList, type MineVideo } from './my-videos'
import { analyzePaste, findYoutube } from './paste-parse'
import { registerVideo, type ContentType } from './register-api'
import { readStored, videoIdFromStoredUrl, writeStored } from './youtube-url'

type PreviewResponse = {
  title?: string
  channelName?: string
  thumbnailUrl?: string | null
  error?: string
}

type Status = { id: number; kind: 'ok' | 'error'; text: string; count?: number }

const TYPE_KEY = 'v3.register.contentType'
const STOCKS_KEY = 'v3.register.recentStocks'
const STOCK_LIST_ID = 'v3-stock-suggestions'
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
  const [bulkOpened, setBulkOpened] = useState(false) // 한 번 열면 그대로 두어서(숨김) 붙여넣은 내용이 사라지지 않는다.
  const [bulkSeed, setBulkSeed] = useState<{ text: string; n: number } | null>(null)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [stockName, setStockName] = useState('')
  const [contentCategory, setContentCategory] = useState('')
  const [recentStocks, setRecentStocks] = useState<string[]>([])

  const [urlHint, setUrlHint] = useState('')
  const [urlNote, setUrlNote] = useState('') // 경고가 아닌 안내(붙여넣은 글에서 주소만 골랐어요 등)
  const [bulkOffer, setBulkOffer] = useState<{ text: string; count: number } | null>(null)
  const [stockHint, setStockHint] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false) // Enter와 클릭이 겹쳐도 한 번만 등록되도록 화면 갱신을 기다리지 않는 잠금

  const [preview, setPreview] = useState<{ id: string; data: PreviewResponse } | null>(null)
  const previewCache = useRef(new Map<string, PreviewResponse>())
  const previewToken = useRef(0)
  const noPreviewFor = useRef('') // 등록을 시도한 영상은 다시 미리보기를 부르지 않는다.

  const [videos, setVideos] = useState<MineVideo[] | null>(null)
  const [listError, setListError] = useState(false)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set())

  const { toast, showSuccess, showError } = useToast()

  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const statusId = useRef(0)
  const touchOnly = useRef(false) // 휴대폰: 저절로 커서를 옮기면 키보드가 화면을 가리므로 옮기지 않는다.

  const normalized = useMemo(() => findYoutube(youtubeUrl), [youtubeUrl])
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

  const focusUrl = () => {
    if (!touchOnly.current) urlRef.current?.focus()
  }

  // 저장해 둔 형식·종목 불러오기 + (마우스·키보드 환경에서는) 첫 화면에서 바로 주소 칸에 커서
  useEffect(() => {
    touchOnly.current = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
    const savedType = readStored(TYPE_KEY)
    if (savedType === 'longform' || savedType === 'shortform') setContentType(savedType)
    setRecentStocks(readRecentStocks())
    focusUrl()
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

  // 링크 미리보기: 붙여넣고 잠시 멈췄을 때만 1번 불러온다. 같은 영상은 다시 부르지 않고(결과·실패 모두 기억),
  // 등록을 눌러 저장이 시작되면(=빠르게 입력한 경우) 아예 부르지 않는다. 여러 개 모드에서는 부르지 않는다.
  useEffect(() => {
    if (!validId || saving || mode !== 'single' || noPreviewFor.current === validId) {
      setPreview(null)
      return
    }
    if (previewCache.current.has(validId)) {
      setPreview(null) // 이미 받아 둔 결과는 아래에서 바로 꺼내 쓴다.
      return
    }
    setPreview(null)
    const token = ++previewToken.current
    const timer = window.setTimeout(async () => {
      const target = findYoutube(youtubeUrl)
      if (!target.ok || target.videoId !== validId) return
      try {
        const { ok, data } = await authedFetchJson<PreviewResponse>(`/api/v3/link-preview?url=${encodeURIComponent(target.url)}`)
        if (token !== previewToken.current) return
        const result: PreviewResponse = ok && !data?.error ? data : { error: data?.error || 'no-preview' }
        previewCache.current.set(target.videoId, result)
        setPreview({ id: target.videoId, data: result })
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

  const switchMode = (next: 'single' | 'bulk', seedText?: string) => {
    setMode(next)
    if (next === 'bulk') {
      setBulkOpened(true)
      if (seedText) setBulkSeed((prev) => ({ text: seedText, n: (prev?.n || 0) + 1 }))
      setBulkOffer(null)
    } else {
      window.setTimeout(focusUrl, 0)
    }
  }

  const clearUrlMessages = () => {
    setUrlHint('')
    setUrlNote('')
    setBulkOffer(null)
  }

  const onUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    const result = analyzePaste(pasted)
    if (result.kind === 'none') return // 주소가 아니면 그대로 붙여넣고 아래 안내에 맡긴다.

    e.preventDefault()
    // 서로 다른 영상 주소가 여러 개면 이 칸에 넣지 않고 여러 개 모드로 옮길 수 있게 안내한다.
    if (result.kind === 'multiple') {
      setUrlHint('')
      setUrlNote('')
      setBulkOffer({ text: pasted, count: result.count })
      return
    }

    setYoutubeUrl(result.url)
    setUrlHint('')
    setBulkOffer(null)
    if (result.isShort) setContentType('shortform')

    let note = result.extracted ? '붙여넣은 글에서 유튜브 주소만 골랐어요.' : ''
    if (result.stockGuess && !stockName.trim()) {
      setStockName(result.stockGuess)
      setStockHint('')
      note = `주소 뒤의 “${result.stockGuess}”을(를) 종목으로 넣었어요. 다르면 고쳐 주세요.`
    }
    setUrlNote(note)
    // 붙여넣자마자 종목 칸으로 넘어가 바로 이어서 입력할 수 있게 한다. (종목이 이미 채워졌다면 등록 버튼으로)
    const filled = !!(result.stockGuess || stockName.trim())
    window.setTimeout(() => (filled ? submitRef.current : stockRef.current)?.focus(), 0)
  }

  const onUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape' && youtubeUrl && !saving) {
      // Esc: 주소 칸을 비우고 처음부터 다시
      e.preventDefault()
      setYoutubeUrl('')
      clearUrlMessages()
    } else if (e.key === 'Enter' && normalized.ok && !stockName.trim()) {
      // 주소는 됐고 종목이 비어 있으면 오류 대신 종목 칸으로 넘어간다.
      e.preventDefault()
      stockRef.current?.focus()
    }
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
    if (savingRef.current) return

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

    savingRef.current = true
    noPreviewFor.current = normalized.videoId
    setSaving(true)
    setStatus(null)
    clearUrlMessages()
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
      focusUrl()

      // 목록을 새로 받아 오고, 서버 기준의 실제 "오늘 N번째"로 바로잡는다.
      void loadMine().then((count) => {
        if (count !== null) setStatus((s) => (s && s.id === id ? { ...s, count } : s))
      })
    } finally {
      savingRef.current = false
      setSaving(false)
      window.setTimeout(() => {
        // 저장이 끝나면 (성공이든 실패든) 곧바로 다음 입력을 이어갈 수 있게 커서를 돌려준다.
        if (document.activeElement === document.body) focusUrl()
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
  // 화면에 보일 미리보기: 방금 받은 것, 아니면 이전에 받아 둔 같은 영상의 결과
  const shownPreview: PreviewResponse | null =
    mode === 'single' && !saving && validId
      ? (preview && preview.id === validId ? preview.data : previewCache.current.get(validId)) || null
      : null
  const previewPending = mode === 'single' && !!validId && !saving && noPreviewFor.current !== validId && shownPreview === null
  const urlMessage = urlHint || (isDuplicate ? '오늘 이미 등록한 영상이에요. 다시 등록하면 종목·형식이 바뀝니다.' : '') || urlNote

  return (
    <>
      <PageHeader title="영상 등록" subtitle="유튜브 주소와 종목만 넣으면 등록됩니다. 제목·조회수는 자동으로 가져옵니다." />

      <datalist id={STOCK_LIST_ID}>
        {recentStocks.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div hidden={mode !== 'single'}>
        <form className="v3-reg" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label className="label" htmlFor="v3-reg-url">유튜브 주소</label>
            <input
              id="v3-reg-url"
              ref={urlRef}
              className={`input ${urlHint ? 'invalid' : ''}`}
              type="text"
              inputMode="url"
              enterKeyHint="next"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="주소를 붙여넣으세요"
              value={youtubeUrl}
              readOnly={saving}
              aria-invalid={!!urlHint}
              aria-describedby="v3-reg-url-hint"
              onChange={(e) => {
                setYoutubeUrl(e.target.value)
                if (urlHint || urlNote || bulkOffer) clearUrlMessages()
              }}
              onPaste={onUrlPaste}
              onKeyDown={onUrlKeyDown}
              onBlur={onUrlBlur}
            />
            <div id="v3-reg-url-hint" className={`v3-reg-hint ${urlHint || isDuplicate ? 'warn' : ''}`} aria-live="polite">
              {urlMessage}
            </div>
            {bulkOffer ? (
              <div className="v3-reg-offer" role="status">
                <span>서로 다른 주소가 {bulkOffer.count}개 있어요.</span>
                <button type="button" className="v3-text-button" onClick={() => switchMode('bulk', bulkOffer.text)}>
                  여러 개 붙여넣기로 옮기기 ›
                </button>
              </div>
            ) : null}
          </div>

          {shownPreview && !shownPreview.error ? (
            <div className="v3-reg-preview">
              {shownPreview.thumbnailUrl ? <img src={shownPreview.thumbnailUrl} alt="" width={64} height={36} /> : null}
              <span>
                {shownPreview.title || '(제목 없음)'}
                {shownPreview.channelName ? ` · ${shownPreview.channelName}` : ''}
              </span>
            </div>
          ) : previewPending ? (
            <PreviewSkeleton />
          ) : null}

          <div className="v3-reg-row">
            <div className="field">
              <label className="label" htmlFor="v3-reg-stock">종목</label>
              <input
                id="v3-reg-stock"
                ref={stockRef}
                className={`input ${stockHint ? 'invalid' : ''}`}
                type="text"
                inputMode="text"
                enterKeyHint="done"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                list={STOCK_LIST_ID}
                placeholder="예: 삼성전자"
                value={stockName}
                readOnly={saving}
                aria-invalid={!!stockHint}
                aria-describedby="v3-reg-stock-hint"
                onChange={(e) => {
                  setStockName(e.target.value)
                  if (stockHint) setStockHint('')
                }}
              />
            </div>
            <div className="field">
              <span className="label" id="v3-reg-type-label">형식</span>
              <SegmentedType value={contentType} onChange={chooseType} disabled={saving} labelledBy="v3-reg-type-label" />
            </div>
            <button ref={submitRef} className="button v3-reg-submit" type="submit" disabled={saving}>
              {saving ? (
                <>
                  <span className="v3-spinner" aria-hidden /> 등록 중…
                </>
              ) : (
                '등록'
              )}
            </button>
          </div>
          <div id="v3-reg-stock-hint" className={`v3-reg-hint ${stockHint ? 'warn' : ''}`} aria-live="polite" style={{ marginTop: -6 }}>
            {stockHint}
          </div>

          {recentStocks.length > 0 ? (
            <div className="v3-reg-chips" role="group" aria-label="최근 쓴 종목">
              <span className="v3-reg-chips-label" aria-hidden>최근 종목</span>
              {recentStocks.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={`v3-tag blue v3-tag-button ${stockName === name ? 'active' : ''}`}
                  aria-pressed={stockName === name}
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
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setContentCategory(e.target.value)}
              placeholder="예: 실적 브리핑"
              aria-label="메모"
            />
          </details>

          {/* 등록 결과: 항상 화면에 있는 안내 영역이라 내용이 바뀔 때 스크린리더가 읽어 준다. */}
          <div aria-live="polite" aria-atomic="true">
            {status && status.kind === 'ok' ? (
              <div className="v3-reg-status">
                <span>
                  <strong>등록됨</strong>
                  {status.count ? ` · 오늘 ${status.count}번째` : ''} · {status.text}
                </span>
              </div>
            ) : null}
          </div>
          <div role="alert">
            {status && status.kind === 'error' ? (
              <div className="v3-reg-status error">
                <span>{status.text}</span>
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

      {bulkOpened ? (
        <div className="v3-reg-bulkwrap" hidden={mode !== 'bulk'}>
          <div className="v3-reg-modelink" style={{ marginTop: 0 }}>
            <button type="button" className="v3-text-button" onClick={() => switchMode('single')}>
              ‹ 하나씩 등록하기
            </button>
          </div>
          <BulkRegister
            active={mode === 'bulk'}
            seed={bulkSeed}
            stockListId={STOCK_LIST_ID}
            touchOnly={touchOnly}
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
        count={videos === null || showFallback ? undefined : todayVideos.length}
        description={showFallback ? '오늘은 아직 등록한 영상이 없어서 최근 등록 내역을 보여드려요.' : '종목이나 형식이 잘못됐다면 줄 오른쪽의 수정·삭제로 바로 고칠 수 있어요.'}
      >
        {listError && videos === null ? (
          <EmptyState title="목록을 불러오지 못했어요" action={<button className="button secondary" onClick={() => void loadMine()}>다시 불러오기</button>}>
            등록은 그대로 하실 수 있어요.
          </EmptyState>
        ) : videos === null ? (
          <div className="v3-mine">
            <VideoListSkeleton rows={3} />
          </div>
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
            <MyVideosList videos={videos} highlightIds={highlightIds} stockListId={STOCK_LIST_ID} onPatched={onPatched} onDeleted={onDeleted} onNotice={onNotice} />
          </div>
        )}
      </Section>

      <Toast toast={toast} />
    </>
  )
}
