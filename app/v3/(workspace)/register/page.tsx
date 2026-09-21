'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { useV3Me } from '@/components/v3/auth-guard'
import { loginHref } from '@/components/v3/safe-next'
import { EmptyState, Section } from '@/components/v3/ui'
import { SegmentedType } from '@/components/v3/segmented'
import { Skel, VideoListSkeleton } from '@/components/v3/skeleton'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import { isTodayKst } from '@/lib/v3/engagement'
import { BulkRegister } from './bulk-register'
import { DailyProgress } from './daily-progress'
import { readDraft, writeDraft } from './draft'
import { MyVideosList, type MineVideo } from './my-videos'
import { analyzePaste, findYoutube } from './paste-parse'
import { callMyVideo, lookupVideo, registerVideo, type ContentType, type VideoLookup } from './register-api'
import {
  DEFAULT_GOAL,
  UNDO_IDLE,
  classifyRegisterFailure,
  duplicateAction,
  explainInvalidUrl,
  findDuplicate,
  groupByStock,
  parseGoal,
  registeredAtLabel,
  undoReduce,
  undoSecondsLeft,
  type Failure,
  type UndoPlan
} from './register-logic'
import { StatusSlot, type RegStatus } from './status-slot'
import { readStored, writeStored } from './youtube-url'

type PreviewResponse = {
  title?: string
  channelName?: string
  thumbnailUrl?: string | null
  error?: string
  code?: string
}

type DupInfo =
  | { mine: true; id: string; stock: string | null; type: ContentType; memo: string | null | undefined; at: string }
  | { mine: false; at: string }

type SubmitOptions = { auto?: boolean; url?: string; stock?: string; type?: ContentType }

const TYPE_KEY = 'v3.register.contentType'
const STOCKS_KEY = 'v3.register.recentStocks'
const GOAL_KEY = 'v3.register.goal'
const AUTO_KEY = 'v3.register.autoSubmit'
const STOCK_LIST_ID = 'v3-stock-suggestions'
const MAX_CHIPS = 8
const PREVIEW_DELAY_MS = 600
const HIGHLIGHT_MS = 4500
const LIST_PAGE_SIZE = 20 // /api/videos/mine 의 한 페이지 크기
const LIST_MAX_PAGES = 4
const LOOKUP_WAIT_MS = 2500
const PASTE_FALLBACK = '주소 칸을 누르고 Ctrl+V(맥은 ⌘+V)로 붙여넣어 주세요.'

function typeLabel(type: ContentType) {
  return type === 'shortform' ? '숏폼' : '롱폼'
}

function cleanStock(value: string) {
  return value.replace(/\s+/g, ' ').trim()
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

// 화면 안내용 실패 객체(서버가 아니라 화면에서 만든 안내)
function plainFailure(message: string, status: number): Failure {
  if (status === 401 || status === 0) return classifyRegisterFailure({ status, network: status === 0 })
  return { kind: 'server', message: `${message} 입력한 내용은 그대로예요.`, short: message, retry: false, focus: null }
}

export default function RegisterPage() {
  const me = useV3Me()
  const isAdmin = !!me?.isAdmin

  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [bulkOpened, setBulkOpened] = useState(false) // 한 번 열면 그대로 두어서(숨김) 붙여넣은 내용이 사라지지 않는다.
  const [bulkSeed, setBulkSeed] = useState<{ text: string; n: number } | null>(null)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [stockName, setStockName] = useState('')
  const [carriedStock, setCarriedStock] = useState('') // 직전 등록에서 그대로 남겨 둔 종목(안내 문구용)
  const [contentCategory, setContentCategory] = useState('')
  const [memoOpen, setMemoOpen] = useState(false)
  const [recentStocks, setRecentStocks] = useState<string[]>([])
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [autoSubmit, setAutoSubmit] = useState(false) // "주소만 붙이면 바로 등록" (기본 꺼짐)
  const [canPaste, setCanPaste] = useState(false)

  const [urlHint, setUrlHint] = useState('')
  const [urlNote, setUrlNote] = useState('') // 경고가 아닌 안내(붙여넣은 글에서 주소만 골랐어요 등)
  const [pasteHint, setPasteHint] = useState('')
  const [bulkOffer, setBulkOffer] = useState<{ text: string; count: number } | null>(null)
  const [stockHint, setStockHint] = useState('')
  const [status, setStatus] = useState<RegStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false) // Enter와 클릭이 겹쳐도 한 번만 등록되도록 화면 갱신을 기다리지 않는 잠금

  const [undo, dispatchUndo] = useReducer(undoReduce, UNDO_IDLE)
  const [clock, setClock] = useState(() => Date.now())
  const [lastRegId, setLastRegId] = useState<string | null>(null)

  const [preview, setPreview] = useState<{ id: string; data: PreviewResponse } | null>(null)
  const previewCache = useRef(new Map<string, PreviewResponse>())
  const previewToken = useRef(0)
  const noPreviewFor = useRef('') // 등록을 시도한 영상은 다시 미리보기를 부르지 않는다.

  // "이미 등록한 영상인지" 확인 결과(영상 번호별). 등록·수정·삭제가 있으면 비운다.
  const lookupCache = useRef(new Map<string, VideoLookup>())
  const lookupInflight = useRef(new Map<string, Promise<VideoLookup | null>>())
  const lookupGen = useRef(0)
  const [, setLookupVersion] = useState(0)

  const [videos, setVideos] = useState<MineVideo[] | null>(null)
  const [listError, setListError] = useState(false)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set())

  const { toast, showSuccess, showError } = useToast()

  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const statusId = useRef(0)
  const touchOnly = useRef(false) // 휴대폰: 저절로 커서를 옮기면 키보드가 화면을 가리므로 옮기지 않는다.
  const modeRef = useRef(mode)
  const draftReady = useRef(false)

  const normalized = useMemo(() => findYoutube(youtubeUrl), [youtubeUrl])
  const validId = normalized.ok ? normalized.videoId : ''

  const todayVideos = useMemo(() => (videos || []).filter((v) => isTodayKst(v.created_at)), [videos])
  const todayCount = todayVideos.length
  const todayGroups = useMemo(() => groupByStock(todayVideos), [todayVideos])

  // 오늘 이미 등록한 영상 번호(여러 개 등록에서 같은 영상을 건너뛰는 데 쓴다)
  const todayIds = useMemo(() => {
    const set = new Set<string>()
    for (const v of todayVideos) {
      const found = findYoutube(v.youtube_url || '')
      if (found.ok) set.add(found.videoId)
    }
    return set
  }, [todayVideos])

  // 이미 등록한 영상인지: 화면에 받아 둔 목록에서 먼저 찾고, 없으면 서버 확인 결과를 쓴다.
  const localDup = useMemo(() => findDuplicate(videos, validId), [videos, validId])
  const serverLookup = validId ? lookupCache.current.get(validId) : undefined
  let dup: DupInfo | null = null
  if (validId) {
    if (localDup) {
      dup = {
        mine: true,
        id: localDup.id,
        stock: localDup.stock_name,
        type: localDup.content_type,
        memo: serverLookup && serverLookup.found && serverLookup.mine ? serverLookup.video.content_category : undefined,
        at: localDup.created_at
      }
    } else if (serverLookup && serverLookup.found) {
      dup = serverLookup.mine
        ? {
            mine: true,
            id: serverLookup.video.id,
            stock: serverLookup.video.stock_name,
            type: serverLookup.video.content_type,
            memo: serverLookup.video.content_category,
            at: serverLookup.video.created_at
          }
        : { mine: false, at: serverLookup.registeredAt }
    }
  }
  const dupAction = dup && dup.mine ? duplicateAction(dup.stock, stockName) : null

  const focusUrl = () => {
    if (!touchOnly.current) urlRef.current?.focus()
  }

  const focusStock = () => {
    window.setTimeout(() => {
      stockRef.current?.focus()
      stockRef.current?.select()
    }, 0)
  }

  // ── 처음 열 때: 저장해 둔 형식·목표·설정, 쓰던 내용 불러오기, (마우스·키보드 환경에서는) 주소 칸에 커서 ──
  useEffect(() => {
    touchOnly.current = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
    const savedType = readStored(TYPE_KEY)
    if (savedType === 'longform' || savedType === 'shortform') setContentType(savedType)
    setRecentStocks(readRecentStocks())
    setGoal(parseGoal(readStored(GOAL_KEY)))
    setAutoSubmit(readStored(AUTO_KEY) === '1')
    setCanPaste(typeof navigator !== 'undefined' && !!navigator.clipboard && typeof navigator.clipboard.readText === 'function')

    // 로그인이 끊겨 다녀왔거나 새로고침했을 때, 쓰던 내용을 이어서 쓸 수 있게 한다.
    const draft = readDraft()
    if (draft) {
      setYoutubeUrl(draft.url)
      setStockName(draft.stock)
      setContentCategory(draft.memo)
      if (draft.memo) setMemoOpen(true)
      if (draft.url) setUrlNote('쓰던 내용을 불러왔어요. 이어서 등록하세요.')
    }
    // 급상승 영상 등의 "후속 영상 올리기" 링크(?stock=…&format=…)로 들어오면 종목·형식을 미리 채운다.
    try {
      const query = new URLSearchParams(window.location.search)
      const linkedStock = (query.get('stock') || '').trim().slice(0, 100)
      const linkedFormat = query.get('format')
      if (linkedStock) {
        setStockName(linkedStock)
        setUrlNote(`'${linkedStock}' 후속 영상이에요. 주소만 붙여 넣으면 됩니다.`)
      }
      if (linkedFormat === 'longform' || linkedFormat === 'shortform') setContentType(linkedFormat)
    } catch {
      // 주소를 읽지 못해도 등록은 그대로 쓸 수 있다.
    }
    const ready = window.setTimeout(() => {
      draftReady.current = true
    }, 0)
    focusUrl()
    return () => window.clearTimeout(ready)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!draftReady.current) return
    writeDraft({ url: youtubeUrl, stock: stockName, memo: contentCategory })
  }, [youtubeUrl, stockName, contentCategory])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const invalidateLookups = useCallback(() => {
    lookupGen.current++
    lookupCache.current.clear()
    lookupInflight.current.clear()
    setLookupVersion((v) => v + 1)
  }, [])

  const ensureLookup = useCallback((id: string): Promise<VideoLookup | null> => {
    const cached = lookupCache.current.get(id)
    if (cached) return Promise.resolve(cached)
    const running = lookupInflight.current.get(id)
    if (running) return running
    const gen = lookupGen.current
    const promise = lookupVideo(id).then((result) => {
      if (gen === lookupGen.current) {
        lookupInflight.current.delete(id)
        if (result) {
          lookupCache.current.set(id, result)
          setLookupVersion((v) => v + 1)
        }
      }
      return result
    })
    lookupInflight.current.set(id, promise)
    return promise
  }, [])

  // 주소가 들어오면 바로 "이미 등록했나?"를 확인해 둔다(가벼운 조회라 기다리지 않는다).
  useEffect(() => {
    if (validId && mode === 'single') void ensureLookup(validId)
  }, [validId, mode, ensureLookup])

  const loadMine = useCallback(async (): Promise<number | null> => {
    try {
      const all: MineVideo[] = []
      for (let page = 1; page <= LIST_MAX_PAGES; page++) {
        const { ok, data } = await authedFetchJson<{ items: MineVideo[] }>(`/api/videos/mine?page=${page}`)
        if (!ok) {
          if (page === 1) {
            setListError(true)
            return null
          }
          break
        }
        const items = data.items || []
        all.push(...items)
        // 한 페이지가 전부 오늘 등록한 것이면 다음 페이지도 오늘 것일 수 있으니 이어서 받는다.
        if (items.length < LIST_PAGE_SIZE || !isTodayKst(items[items.length - 1].created_at)) break
      }
      setListError(false)
      setVideos(all)
      setRecentStocks((prev) => mergeStocks(prev, all.map((v) => v.stock_name || '')))
      return all.filter((v) => isTodayKst(v.created_at)).length
    } catch {
      setListError(true)
      return null
    }
  }, [])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  // 링크 미리보기("이 영상이 맞나요?"): 붙여넣고 잠시 멈췄을 때만 1번 불러온다. 같은 영상은 다시 부르지 않고(결과·실패 모두 기억),
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
        const result: PreviewResponse = ok && !data?.error ? data : { error: data?.error || 'no-preview', code: data?.code }
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

  // 되돌리기 카운트다운(열려 있는 동안만 돈다)
  useEffect(() => {
    if (undo.phase !== 'open' && undo.phase !== 'done') return
    setClock(Date.now())
    const timer = window.setInterval(() => {
      const now = Date.now()
      setClock(now)
      dispatchUndo({ type: 'tick', now })
    }, 500)
    return () => window.clearInterval(timer)
  }, [undo.phase])

  // "/" 키: 글자를 입력 중이 아닐 때 어디서든 주소 칸으로
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      if (modeRef.current !== 'single') return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      e.preventDefault()
      urlRef.current?.focus()
      urlRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  const changeGoal = (next: number) => {
    setGoal(next)
    writeStored(GOAL_KEY, String(next))
  }

  const changeAutoSubmit = (on: boolean) => {
    setAutoSubmit(on)
    writeStored(AUTO_KEY, on ? '1' : '0')
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
    setPasteHint('')
    setBulkOffer(null)
    setStatus((s) => (s && s.kind === 'error' ? null : s)) // 지난 실패 안내는 주소를 고치기 시작하면 치운다.
  }

  // 붙여넣은 글(키보드 붙여넣기·붙여넣기 버튼 공통)을 읽어 칸을 채운다. 처리했으면 true.
  const applyPasted = (text: string, from: 'key' | 'button'): boolean => {
    const result = analyzePaste(text)
    if (result.kind === 'none') {
      if (from === 'button') {
        setUrlHint('')
        setUrlNote('')
        setPasteHint(
          text.trim() ? explainInvalidUrl(text) : '복사해 둔 내용이 없어요. 유튜브에서 영상 주소를 먼저 복사해 주세요.'
        )
        urlRef.current?.focus()
      }
      return false // 키보드 붙여넣기에서 주소가 아니면 그대로 붙여넣고, 아래 안내에 맡긴다.
    }

    setPasteHint('')
    // 서로 다른 영상 주소가 여러 개면 이 칸에 넣지 않고 여러 개 모드로 옮길 수 있게 안내한다.
    if (result.kind === 'multiple') {
      setUrlHint('')
      setUrlNote('')
      setBulkOffer({ text, count: result.count })
      return true
    }

    setYoutubeUrl(result.url)
    setUrlHint('')
    setBulkOffer(null)
    setStatus((s) => (s && s.kind === 'error' ? null : s))
    const nextType: ContentType = result.isShort ? 'shortform' : contentType
    if (result.isShort) setContentType('shortform')

    let nextStock = stockName
    let note = result.extracted ? '붙여넣은 글에서 유튜브 주소만 골랐어요.' : ''
    if (result.stockGuess && !stockName.trim()) {
      nextStock = result.stockGuess
      setStockName(result.stockGuess)
      setCarriedStock('')
      setStockHint('')
      note = `주소 뒤의 “${result.stockGuess}”을(를) 종목으로 넣었어요. 다르면 고쳐 주세요.`
    }
    setUrlNote(note)

    if (autoSubmit && nextStock.trim()) {
      // "주소만 붙이면 바로 등록": 종목이 채워져 있을 때만. (이미 등록한 영상이면 등록하지 않고 알려 준다)
      void submit({ auto: true, url: result.url, stock: nextStock, type: nextType })
    } else {
      // 붙여넣자마자 종목 칸으로 넘어가 바로 이어서 입력할 수 있게 한다. 채워진 종목은 선택돼 있어서 그냥 쓰면 바뀐다.
      focusStock()
    }
    return true
  }

  const onUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const handled = applyPasted(e.clipboardData.getData('text'), 'key')
    if (handled) e.preventDefault()
  }

  const pasteFromClipboard = async () => {
    if (savingRef.current) return
    setPasteHint('')
    try {
      const text = await navigator.clipboard.readText()
      applyPasted(text, 'button')
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError'
      setUrlHint('')
      setUrlNote('')
      setPasteHint(
        denied
          ? `브라우저에서 붙여넣기 권한이 꺼져 있어요. ${PASTE_FALLBACK}`
          : `복사한 내용을 읽지 못했어요. ${PASTE_FALLBACK}`
      )
      urlRef.current?.focus()
    }
  }

  const onUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape' && youtubeUrl && !saving) {
      // Esc: 주소 칸을 비우고 처음부터 다시
      e.preventDefault()
      setYoutubeUrl('')
      clearUrlMessages()
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && normalized.ok && !stockName.trim()) {
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
      setUrlHint(explainInvalidUrl(youtubeUrl))
    }
  }

  const clearStock = () => {
    setStockName('')
    setCarriedStock('')
    setStockHint('')
    stockRef.current?.focus()
  }

  const onStockKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.key !== 'Escape' || saving) return
    e.preventDefault()
    if (stockName) clearStock() // Esc 한 번으로 종목 비우기
    else urlRef.current?.focus()
  }

  const pickStock = (name: string) => {
    setStockName(name)
    setCarriedStock('')
    setStockHint('')
    // 주소가 채워져 있으면 곧바로 등록 버튼으로(Enter 한 번이면 등록), 아니면 주소 칸으로
    window.setTimeout(() => (normalized.ok ? submitRef.current : urlRef.current)?.focus(), 0)
  }

  const sayOk = (title: string, detail: string, count?: number, note?: string) => {
    const id = ++statusId.current
    setStatus({ id, kind: 'ok', title, detail, count, note })
    return id
  }

  const sayFailure = (failure: Failure) => {
    const id = ++statusId.current
    setStatus({ id, kind: 'error', failure })
    return id
  }

  // 등록 직후 "확인 → 다음 영상" 준비: 주소는 비우고, 형식·종목은 그대로 두고 커서를 주소 칸으로.
  const readyForNext = (stock: string) => {
    setYoutubeUrl('')
    setStockName(stock)
    setCarriedStock(stock)
    setContentCategory('')
    setPasteHint('')
    setPreview(null)
    focusUrl()
  }

  const resolveExisting = async (videoId: string) => {
    const wait = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), LOOKUP_WAIT_MS))
    return Promise.race([ensureLookup(videoId), wait])
  }

  const submit = async (opts: SubmitOptions = {}) => {
    if (savingRef.current) return

    const rawUrl = opts.url ?? youtubeUrl
    const target = opts.url !== undefined ? findYoutube(opts.url) : normalized
    if (!target.ok) {
      setUrlHint(explainInvalidUrl(rawUrl))
      urlRef.current?.focus()
      return
    }
    const stock = cleanStock(opts.stock ?? stockName)
    if (!stock) {
      setStockHint('종목을 입력하거나 아래에서 골라 주세요.')
      stockRef.current?.focus()
      return
    }
    const type = opts.type ?? contentType

    savingRef.current = true
    noPreviewFor.current = target.videoId
    setSaving(true)
    setStatus(null)
    clearUrlMessages()
    setStockHint('')
    try {
      // 이미 등록한 영상인지 확인(주소를 붙일 때 이미 요청해 둬서 보통 바로 끝난다). 확인이 안 되면 그냥 등록한다.
      const lookup = await resolveExisting(target.videoId)
      const listed = findDuplicate(videos, target.videoId)
      const existing =
        lookup && lookup.found && lookup.mine
          ? lookup.video
          : listed
            ? { id: listed.id, stock_name: listed.stock_name, content_type: listed.content_type, content_category: undefined as string | null | undefined }
            : null
      const takenFromOther = !!lookup && lookup.found && !lookup.mine

      if (opts.auto && (existing || takenFromOther)) {
        // 바로 등록을 켜 둬도, 이미 있는 영상을 덮어쓰지는 않는다. 안내 카드가 보이므로 종목 칸에서 멈춘다.
        focusStock()
        return
      }

      // 이미 있던 영상을 다시 등록하면 메모가 비워지지 않도록 기존 메모를 함께 보낸다.
      let memo = contentCategory
      if (!memo.trim() && existing) {
        if (existing.content_category !== undefined) {
          memo = existing.content_category || ''
        } else {
          const current = await callMyVideo<{ video?: { content_category?: string | null } }>(existing.id, 'GET')
          if (current.ok) memo = current.data?.video?.content_category || ''
        }
      }

      const result = await registerVideo({ url: target.url, contentType: type, stockName: stock, contentCategory: memo })
      if (!result.ok) {
        sayFailure(result.failure)
        if (result.failure.focus === 'url') urlRef.current?.focus()
        else if (result.failure.focus === 'stock') stockRef.current?.focus()
        return
      }

      rememberStock(stock)
      writeStored(TYPE_KEY, type)
      invalidateLookups()

      const plan: UndoPlan = !result.id
        ? { kind: 'none' }
        : existing
          ? { kind: 'restore', stock: existing.stock_name, type: existing.content_type }
          : takenFromOther
            ? { kind: 'none' }
            : { kind: 'delete' }
      if (result.id) setLastRegId(result.id)
      dispatchUndo({ type: 'registered', entry: { id: result.id || '', stock, plan }, now: Date.now() })

      const id = sayOk(existing ? '다시 등록했어요' : '등록됐어요', `${stock} · ${typeLabel(type)}`, existing ? undefined : todayCount + 1)
      flash(result.id)
      readyForNext(stock)

      // 목록을 새로 받아 오고, 서버 기준의 실제 "오늘 N번째"로 바로잡는다.
      void loadMine().then((count) => {
        if (count !== null) setStatus((s) => (s && s.kind === 'ok' && s.id === id && s.count !== undefined ? { ...s, count } : s))
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

  // 이미 등록한 영상: 다시 등록하지 않고 종목만 바꾼다.
  const changeStockOnly = async () => {
    if (savingRef.current || !dup || !dup.mine) return
    const stock = cleanStock(stockName)
    if (!stock) {
      setStockHint('바꿀 종목을 입력하거나 아래에서 골라 주세요.')
      stockRef.current?.focus()
      return
    }
    savingRef.current = true
    setSaving(true)
    setStatus(null)
    clearUrlMessages()
    setStockHint('')
    const before = { id: dup.id, stock: dup.stock, type: dup.type }
    try {
      const res = await callMyVideo<{ video?: { stock_name: string | null; content_type: ContentType } }>(before.id, 'PATCH', { stock_name: stock })
      if (!res.ok) {
        sayFailure(plainFailure(res.message, res.status))
        return
      }
      rememberStock(stock)
      invalidateLookups()
      setLastRegId(before.id)
      dispatchUndo({ type: 'registered', entry: { id: before.id, stock, plan: { kind: 'restore', stock: before.stock, type: before.type } }, now: Date.now() })
      sayOk('종목을 바꿨어요', `${stock} · ${typeLabel(res.data?.video?.content_type ?? before.type)}`)
      flash(before.id)
      readyForNext(stock)
      void loadMine()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // 방금 등록한 영상 되돌리기(새로 등록한 것은 지우고, 덮어쓴 것은 이전 종목·형식으로 돌린다)
  const onUndo = async () => {
    if (undo.phase !== 'open' && undo.phase !== 'failed') return
    const entry = undo.entry
    const now = Date.now()
    if (undoReduce(undo, { type: 'start', now }).phase !== 'working') {
      dispatchUndo({ type: 'tick', now }) // 시간이 막 지났다면 조용히 닫는다.
      return
    }
    dispatchUndo({ type: 'start', now })

    const plan = entry.plan
    let res
    if (plan.kind === 'delete') {
      res = await callMyVideo(entry.id, 'DELETE')
    } else if (plan.kind === 'restore') {
      const body: Record<string, string> = { content_type: plan.type }
      if (plan.stock) body.stock_name = plan.stock
      res = await callMyVideo(entry.id, 'PATCH', body)
    } else {
      return
    }

    if (!res.ok) {
      dispatchUndo({ type: 'failed', id: entry.id, message: res.message })
      return
    }
    dispatchUndo({ type: 'succeeded', id: entry.id, now: Date.now() })
    sayOk(plan.kind === 'restore' ? '이전 종목·형식으로 되돌렸어요' : '등록을 취소했어요', entry.stock, undefined, '다음 영상 주소를 붙여넣으세요.')
    invalidateLookups()
    if (plan.kind === 'delete') setVideos((prev) => (prev ? prev.filter((v) => v.id !== entry.id) : prev))
    setLastRegId(null)
    void loadMine()
    focusUrl()
  }

  // 수정·삭제 결과는 다시 받아 오지 않고 화면의 목록에 바로 반영한다.
  const onPatched = (id: string, patch: { stock_name: string | null; content_type: ContentType }) => {
    setVideos((prev) => (prev ? prev.map((v) => (v.id === id ? { ...v, ...patch } : v)) : prev))
    if (patch.stock_name) rememberStock(patch.stock_name)
    invalidateLookups()
    dispatchUndo({ type: 'dismiss' }) // 직접 고쳤다면 이전 되돌리기는 더 이상 맞지 않는다.
  }
  const onDeleted = (id: string) => {
    setVideos((prev) => (prev ? prev.filter((v) => v.id !== id) : prev))
    invalidateLookups()
    dispatchUndo({ type: 'dismiss' })
  }
  const onNotice = (text: string, tone: 'success' | 'error') => (tone === 'success' ? showSuccess(text) : showError(text))

  const showFallback = videos !== null && todayVideos.length === 0 && videos.length > 0
  const firstRun = videos !== null && videos.length === 0
  // 가장 최근에 등록한 줄(종목을 그 자리에서 고칠 수 있다)
  const quickFixId = todayVideos.some((v) => v.id === lastRegId) ? lastRegId : (videos && videos[0]?.id) || null

  // 화면에 보일 미리보기: 방금 받은 것, 아니면 이전에 받아 둔 같은 영상의 결과
  const shownPreview: PreviewResponse | null =
    mode === 'single' && validId ? (preview && preview.id === validId ? preview.data : previewCache.current.get(validId)) || null : null
  const previewPending = mode === 'single' && !!validId && !saving && noPreviewFor.current !== validId && shownPreview === null
  const urlMessage = urlHint || pasteHint || urlNote
  const carried = !!carriedStock && stockName === carriedStock
  const secondsLeft = undoSecondsLeft(undo, clock)

  const previewProblem = shownPreview?.error
    ? shownPreview.code === 'not-found'
      ? `${shownPreview.error} 주소가 맞는지 확인해 주세요.`
      : shownPreview.code === 'quota' || shownPreview.code === 'key'
        ? `${shownPreview.error} 등록이 안 될 수 있어요.`
        : shownPreview.error === 'no-preview' || shownPreview.code === 'bad-url'
          ? ''
          : shownPreview.error
    : ''
  const previewWarn = shownPreview?.code === 'not-found' || shownPreview?.code === 'quota' || shownPreview?.code === 'key'

  return (
    <>
      <PageHeader title="영상 등록" subtitle="유튜브 주소와 종목만 넣으면 등록됩니다. 제목·조회수는 자동으로 가져옵니다." />

      <datalist id={STOCK_LIST_ID}>
        {recentStocks.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div hidden={mode !== 'single'}>
        {!isAdmin ? <DailyProgress count={todayCount} goal={goal} groups={todayGroups} loaded={videos !== null} onGoalChange={changeGoal} /> : null}

        <form
          className="v3-reg"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          onKeyDown={(e) => {
            // Ctrl(맥은 ⌘)+Enter: 어느 칸에 있든 등록
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
          noValidate
        >
          <div className="field">
            <label className="label" htmlFor="v3-reg-url">유튜브 주소</label>
            <div className="v3-reg-urlrow">
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
                  if (urlHint || urlNote || pasteHint || bulkOffer || (status && status.kind === 'error')) clearUrlMessages()
                }}
                onPaste={onUrlPaste}
                onKeyDown={onUrlKeyDown}
                onBlur={onUrlBlur}
              />
              {canPaste ? (
                <button type="button" className="button secondary v3-reg-paste" disabled={saving} onClick={() => void pasteFromClipboard()}>
                  붙여넣기
                </button>
              ) : null}
            </div>
            <div id="v3-reg-url-hint" className={`v3-reg-hint ${urlHint || pasteHint ? 'warn' : ''}`} aria-live="polite">
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

          <div className="v3-reg-row">
            <div className="field">
              <label className="label" htmlFor="v3-reg-stock">종목</label>
              <div className="v3-reg-stockwrap">
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
                  onKeyDown={onStockKeyDown}
                />
                <button
                  type="button"
                  className={`v3-reg-clearx ${stockName ? '' : 'off'}`}
                  tabIndex={-1}
                  aria-label="종목 지우기"
                  disabled={saving}
                  onClick={clearStock}
                >
                  ×
                </button>
              </div>
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
              ) : dup && dup.mine ? (
                '다시 등록'
              ) : (
                '등록'
              )}
            </button>
          </div>
          <div id="v3-reg-stock-hint" className={`v3-reg-hint ${stockHint ? 'warn' : ''}`} aria-live="polite" style={{ marginTop: -6 }}>
            {stockHint || (carried ? '직전에 쓴 종목을 그대로 두었어요. 다르면 Esc(또는 ×)로 지우고 새로 적어 주세요.' : '')}
          </div>

          {/* 이 영상이 맞나요? — 등록 버튼 바로 아래에서 확인하고, 이미 등록한 영상이면 여기서 알려 준다. 등록을 막지는 않는다. */}
          <div className="v3-reg-confirm" aria-live="polite">
            {!validId ? (
              <span className="v3-reg-confirm-empty">주소를 붙여넣으면 영상 제목이 여기에 보여요.</span>
            ) : (
              <>
                <div className="v3-reg-confirm-video">
                  {shownPreview && !shownPreview.error && shownPreview.thumbnailUrl ? (
                    <img src={shownPreview.thumbnailUrl} alt="" width={64} height={36} />
                  ) : previewPending ? (
                    <Skel w={64} h={36} r={4} />
                  ) : (
                    <span className="v3-reg-thumb-empty" aria-hidden />
                  )}
                  <div className="v3-reg-confirm-text">
                    {shownPreview && !shownPreview.error ? (
                      <>
                        <span className="v3-reg-confirm-title">{shownPreview.title || '(제목 없음)'}</span>
                        <span className="v3-reg-confirm-sub">
                          {shownPreview.channelName ? `${shownPreview.channelName} · ` : ''}이 영상이 맞나요? 맞으면 등록을 눌러 주세요.
                        </span>
                      </>
                    ) : previewPending ? (
                      <>
                        <Skel w="60%" h={14} />
                        <span className="v3-reg-confirm-sub">영상 정보를 확인하는 중이에요…</span>
                      </>
                    ) : previewProblem ? (
                      <span className={`v3-reg-confirm-sub ${previewWarn ? 'warn' : ''}`}>{previewProblem}</span>
                    ) : (
                      <span className="v3-reg-confirm-sub">영상 제목은 등록할 때 함께 가져와요.</span>
                    )}
                  </div>
                </div>

                {dup && dup.mine ? (
                  <div className="v3-reg-dup">
                    <span>
                      <strong>이미 등록한 영상이에요</strong> ({registeredAtLabel(dup.at)}) · 종목 {dup.stock || '없음'} · {typeLabel(dup.type)}
                    </span>
                    {dupAction === 'change' ? (
                      <button type="button" className="button secondary xs" disabled={saving} onClick={() => void changeStockOnly()}>
                        종목만 ‘{cleanStock(stockName)}’(으)로 바꾸기
                      </button>
                    ) : dupAction === 'same' ? (
                      <span className="v3-reg-dup-note">종목도 같아서 다시 등록할 필요는 없어요.</span>
                    ) : (
                      <span className="v3-reg-dup-note">종목을 입력하면 종목만 바꿀 수 있어요. ‘다시 등록’은 종목·형식을 새로 저장해요.</span>
                    )}
                  </div>
                ) : dup && !dup.mine ? (
                  <div className="v3-reg-dup warn">
                    <span>
                      <strong>다른 직원이 이미 등록한 영상이에요</strong> ({registeredAtLabel(dup.at)}). 등록하면 내가 등록한 영상으로 바뀌어요.
                    </span>
                  </div>
                ) : null}
              </>
            )}
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

          <details className="v3-reg-more" open={memoOpen} onToggle={(e) => setMemoOpen(e.currentTarget.open)}>
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

          {/* 등록 결과 · 되돌리기 · 실패 안내: 항상 같은 높이의 칸이라 내용이 바뀌어도 화면이 밀리지 않는다. */}
          <StatusSlot
            status={status}
            undo={undo}
            secondsLeft={secondsLeft}
            busy={saving}
            loginHref={loginHref('/v3/register')}
            onUndo={() => void onUndo()}
            onRetry={() => void submit()}
          />

          <p className="v3-reg-keys">Enter 등록 · Ctrl(⌘)+Enter 어느 칸에서든 등록 · / 주소 칸으로 이동 · Esc 지금 칸 비우기</p>

          <label className="v3-reg-toggle">
            <input type="checkbox" checked={autoSubmit} onChange={(e) => changeAutoSubmit(e.target.checked)} />
            <span>
              주소만 붙이면 바로 등록
              <span className="v3-reg-toggle-help"> — 종목이 채워져 있을 때만 작동하고, 이미 등록한 영상은 건너뛰어요.</span>
            </span>
          </label>
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
              invalidateLookups()
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
        description={
          showFallback
            ? '오늘은 아직 등록한 영상이 없어서 최근 등록 내역을 보여드려요.'
            : '종목이 틀렸다면 맨 위 줄의 종목을 눌러 바로 고칠 수 있어요. 나머지는 줄 오른쪽의 수정·삭제를 쓰세요.'
        }
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
              <span>1. 유튜브 주소를 위 칸에 붙여넣기 (또는 ‘붙여넣기’ 버튼)</span>
              <span>2. 종목 입력 (다음부터는 아래 버튼으로 고르기)</span>
              <span>3. Enter 키로 등록 — 종목은 그대로 남아서 바로 다음 영상을 이어서 넣을 수 있어요</span>
            </div>
          </EmptyState>
        ) : (
          <div className="v3-mine">
            <MyVideosList
              videos={videos}
              highlightIds={highlightIds}
              quickFixId={quickFixId}
              stockListId={STOCK_LIST_ID}
              onPatched={onPatched}
              onDeleted={onDeleted}
              onNotice={onNotice}
            />
          </div>
        )}
      </Section>

      <Toast toast={toast} />
    </>
  )
}
