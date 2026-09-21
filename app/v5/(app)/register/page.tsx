'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { MyVideosSkeleton, MyVideosTable, type MineVideo } from '@/components/v5/my-videos-table'
import { toBulkText } from '@/components/v5/paste-detect'
import { FeedbackSlot, KeyboardHint, TodayGoal, TodayStocks, type Feedback } from '@/components/v5/register-parts'
import {
  DRAFT_MAX_AGE_MS,
  UNDO_DELETE_MAX_AGE_SEC,
  UNDO_IDLE,
  UNDO_WINDOW_MS,
  decideDuplicate,
  dupNotice,
  groupStocks,
  interpretClipboard,
  loginHref,
  parseDraft,
  parseDupResponse,
  parseStockCounts,
  serializeDraft,
  shouldAutoSubmit,
  undoReduce,
  type ClipboardOutcome,
  type DupState,
  type StockCount,
  type UndoEntry,
  type UndoState
} from '@/components/v5/register-logic'
import { SegmentedChoice } from '@/components/v5/segmented'
import {
  CONTENT_TYPE_LABEL,
  DAILY_GOAL,
  TIMEOUT_MS,
  authedFetchJsonTimeout,
  classifyError,
  describeUrlProblem,
  extractVideoId,
  kstYmd,
  normalizeUrl,
  registerVideo,
  type ContentType,
  type RegisterErrorInfo
} from '@/components/v5/register-utils'
import { Badge, EmptyState, Skeleton, SkeletonRegion } from '@/components/v5/widget'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'

// 여러 개 붙여넣기 화면은 쓰는 사람만 내려받는다(한 개씩 등록이 기본이라 대부분은 필요 없다).
const BulkRegister = dynamic(() => import('@/components/v5/bulk-register').then((m) => m.BulkRegister), {
  ssr: false,
  loading: () => (
    <SkeletonRegion label="여러 개 붙여넣기 화면을 불러오는 중" className="v5-bulk-skel">
      <Skeleton height={44} radius={10} />
      <Skeleton height={120} radius={10} />
    </SkeletonRegion>
  )
})

type PlaybookOption = { id: string; title: string; usage_count: number }

// 붙여넣은 글에 대한 안내(여러 개를 붙였거나, 주소 말고 다른 글이 함께 붙었을 때).
type PasteNote = { kind: 'multi'; text: string; count: number } | { kind: 'extra'; text: string; leftover: string; multiLine: boolean }

const LS_TYPE = 'v5.register.contentType'
const LS_STOCKS = 'v5.register.recentStocks'
const LS_AUTO = 'v5.register.autoSubmit'
const SS_DRAFT = 'v5.register.draft'
const MAX_RECENT_STOCKS = 8
const DUP_CACHE_MS = 60_000
const REGISTER_PATH = '/v5/register'

// ---- 작은 도우미들 --------------------------------------------------------

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {}
}

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch {}
}

// ---- 화면 ----------------------------------------------------------------

export default function RegisterPage() {
  const me = useV5Me()
  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)

  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkSeed, setBulkSeed] = useState<{ key: number; text: string; dropped: number } | null>(null)
  const [pasteNote, setPasteNote] = useState<PasteNote | null>(null)
  const [clipHint, setClipHint] = useState('')
  const [canReadClipboard, setCanReadClipboard] = useState(false)
  const [autoSubmit, setAutoSubmit] = useState(false)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [autoTypeNote, setAutoTypeNote] = useState(false) // 주소가 숏폼이라서 형식을 자동으로 바꾼 상태
  const [stockName, setStockName] = useState('')
  const [recentStocks, setRecentStocks] = useState<string[]>([])
  const [contentCategory, setContentCategory] = useState('')
  const [playbookOptions, setPlaybookOptions] = useState<PlaybookOption[]>([])
  const [usedPlaybookId, setUsedPlaybookId] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [undo, dispatchUndo] = useReducer(undoReduce, UNDO_IDLE)
  const [dup, setDup] = useState<DupState>({ status: 'idle' })

  const [items, setItems] = useState<MineVideo[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [listError, setListError] = useState<false | 'auth' | 'other'>(false)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [teamToday, setTeamToday] = useState<number | null>(null)
  const [todayStocks, setTodayStocks] = useState<StockCount[] | null>(null)

  const savingRef = useRef(false) // 화면이 다시 그려지기 전에 Enter 를 두 번 눌러도 한 번만 보낸다.
  const pageRef = useRef(1)
  const refreshTimer = useRef<number | null>(null)
  const highlightTimers = useRef(new Set<number>())
  const manualTypeRef = useRef<ContentType>('longform') // 사용자가 직접 고른 형식(주소가 숏폼이면 잠깐 바뀌었다가 돌아온다)
  const dupCache = useRef(new Map<string, { state: DupState; at: number }>())
  const feedbackSeq = useRef(0)
  const undoRef = useRef<UndoState>(UNDO_IDLE) // 콜백 안에서 "지금" 되돌리기 상태를 읽기 위한 사본
  const undoBusyRef = useRef(false) // 되돌리기 요청을 두 번 보내지 않는다
  const urlValueRef = useRef('') // 주소칸의 지금 내용(요청을 기다리는 사이 바뀔 수 있다)
  const recentRef = useRef<string[]>([])
  const loadSeq = useRef(0) // 목록 요청이 뒤섞여 돌아와도 가장 최근 것만 화면에 반영한다
  const todaySeq = useRef(0)

  const isAdmin = Boolean(me?.isAdmin)

  const nextKey = () => {
    feedbackSeq.current += 1
    return `f${feedbackSeq.current}`
  }

  // 마지막으로 쓴 형식·최근 종목·자동 등록 설정을 기억해 둔 값으로 채운다(저장소를 못 쓰면 조용히 건너뜀).
  // 로그인이 풀려 잠깐 나갔다 온 경우에는 입력하던 주소·종목도 되살린다.
  useEffect(() => {
    const savedType = readStorage(LS_TYPE)
    if (savedType === 'longform' || savedType === 'shortform') {
      setContentType(savedType)
      manualTypeRef.current = savedType
    }
    try {
      const parsed = JSON.parse(readStorage(LS_STOCKS) || '[]')
      if (Array.isArray(parsed)) {
        const saved = Array.from(new Set(parsed.filter((s): s is string => typeof s === 'string' && s.trim() !== ''))).slice(0, MAX_RECENT_STOCKS)
        recentRef.current = saved
        setRecentStocks(saved)
      }
    } catch {}
    setAutoSubmit(readStorage(LS_AUTO) === '1')
    setCanReadClipboard(typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function')

    const draft = parseDraft(readSession(SS_DRAFT), Date.now(), DRAFT_MAX_AGE_MS)
    writeSession(SS_DRAFT, null)
    if (draft) {
      setYoutubeUrl(draft.url)
      setStockName(draft.stock)
      setContentType(draft.type)
      setFeedback({ kind: 'info', key: 'restored', message: '다시 로그인됐어요. 입력하던 주소와 종목을 그대로 채워 두었으니 이어서 등록하세요.' })
      window.setTimeout(() => (draft.url && draft.stock ? submitRef.current : draft.url ? stockRef.current : urlRef.current)?.focus(), 0)
    } else {
      urlRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    pageRef.current = page
  }, [page])

  useEffect(() => {
    undoRef.current = undo
  }, [undo])

  useEffect(() => {
    urlValueRef.current = youtubeUrl
  }, [youtubeUrl])

  useEffect(() => {
    const timers = highlightTimers.current
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
    }
  }, [])

  // "/" 키: 다른 칸에 글을 쓰고 있지 않을 때 어디서든 주소칸으로 돌아온다.
  useEffect(() => {
    if (mode !== 'single') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      urlRef.current?.focus()
      urlRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  const loadMine = useCallback(async (targetPage: number) => {
    type Res = { items: MineVideo[]; pagination: { page: number; pageSize: number; totalCount: number } }
    loadSeq.current += 1
    const seq = loadSeq.current
    try {
      const res = await authedFetchJsonTimeout<Res>(`/api/v5/my-videos?page=${targetPage}`, {}, TIMEOUT_MS.list)
      if (seq !== loadSeq.current) return null // 더 최근 요청이 있으면 이 답은 버린다
      if (!res.ok) {
        setListError(res.status === 401 ? 'auth' : 'other')
        setLoadedOnce(true)
        return null
      }
      setListError(false)
      const rows = res.data.items || []
      setItems(rows)
      setTotalCount(res.data.pagination?.totalCount || 0)
      setLoadedOnce(true)
      return rows
    } catch {
      if (seq !== loadSeq.current) return null
      setListError('other')
      setLoadedOnce(true)
      return null
    }
  }, [])

  // "오늘 N번째"와 진행 막대의 기준 숫자: 서버가 한국 시간 기준으로 센 값.
  const refreshToday = useCallback(async (): Promise<number | null> => {
    todaySeq.current += 1
    const seq = todaySeq.current
    try {
      const res = await authedFetchJsonTimeout<{ count: number; teamCount?: number; stocks?: unknown }>('/api/v5/my-today', {}, TIMEOUT_MS.list)
      if (!res.ok) return null
      if (seq !== todaySeq.current) return res.data.count || 0 // 더 최근에 읽은 값이 있으면 화면은 그대로 둔다
      setTodayCount(res.data.count || 0)
      setTeamToday(typeof res.data.teamCount === 'number' ? res.data.teamCount : null)
      setTodayStocks(parseStockCounts(res.data.stocks))
      return res.data.count || 0
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void loadMine(page)
  }, [page, loadMine])

  useEffect(() => {
    void refreshToday()
  }, [refreshToday])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await authedFetchJson<{ items: PlaybookOption[] }>('/api/v5/playbook')
        if (!cancelled && res.ok) setPlaybookOptions((res.data.items || []).slice(0, 20))
      } catch {
        // 성공 공식 목록은 없어도 등록에는 지장이 없다.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const highlight = useCallback((id: string) => {
    setHighlightIds((prev) => new Set(prev).add(id))
    const timer = window.setTimeout(() => {
      highlightTimers.current.delete(timer)
      setHighlightIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 3000)
    highlightTimers.current.add(timer)
  }, [])

  // 목록 맨 위(1쪽)와 오늘 숫자를 새로 읽는다. 여러 개 등록 중에는 몰아서 한 번만.
  const refreshAll = useCallback(() => {
    if (pageRef.current !== 1) setPage(1)
    else void loadMine(1)
    void refreshToday()
  }, [loadMine, refreshToday])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(refreshAll, 700)
  }, [refreshAll])

  const registeredIds = useMemo(() => {
    const set = new Set<string>()
    for (const v of items) {
      const id = extractVideoId(v.youtube_url)
      if (id) set.add(id)
    }
    return set
  }, [items])

  // 오늘 등록한 종목별 개수: 서버 값이 있으면 그것을, 없으면 지금 보이는 목록에서 직접 센다.
  const stocksToday = useMemo<StockCount[]>(() => {
    if (todayStocks) return todayStocks
    const today = kstYmd(new Date())
    return groupStocks(items.filter((v) => kstYmd(v.created_at) === today).map((v) => v.stock_name))
  }, [todayStocks, items])

  // ---- 입력 검사(붉은 벽 대신 입력칸 아래 한 줄 힌트) ----
  const cleanUrl = normalizeUrl(youtubeUrl)
  const urlProblem = !cleanUrl ? (touched ? '유튜브 주소를 붙여 넣어 주세요.' : '') : describeUrlProblem(cleanUrl)
  const videoId = cleanUrl && !urlProblem ? extractVideoId(cleanUrl) : null
  const stockProblem = touched && !stockName.trim() ? '종목명을 적어 주세요.' : ''

  // ---- 이미 등록한 영상인지 미리 확인 ----
  // fresh=true: 저장해 둔 답을 쓰지 않고 지금 서버에 다시 묻는다. "새 영상"이라고 믿고 등록·되돌리기를 하기 직전에는
  // 반드시 이렇게 한다(그 사이 다른 팀원이 올렸거나 여러 개 붙여넣기로 올렸을 수 있다).
  const lookupDup = useCallback(async (id: string, fresh = false): Promise<DupState> => {
    const cached = dupCache.current.get(id)
    if (!fresh && cached && Date.now() - cached.at < DUP_CACHE_MS) return cached.state
    if (fresh) dupCache.current.delete(id)
    try {
      const res = await authedFetchJsonTimeout<unknown>(`/api/v5/my-videos?videoId=${encodeURIComponent(id)}`, {}, TIMEOUT_MS.lookup)
      if (!res.ok) return { status: 'unknown', videoId: id }
      const parsed = parseDupResponse(res.data)
      if (!parsed.ok) return { status: 'unknown', videoId: id }
      const state: DupState = parsed.info ? { status: 'found', videoId: id, info: parsed.info } : { status: 'none', videoId: id }
      dupCache.current.set(id, { state, at: Date.now() })
      return state
    } catch {
      return { status: 'unknown', videoId: id }
    }
  }, [])

  useEffect(() => {
    if (!videoId) {
      setDup({ status: 'idle' })
      return
    }
    let cancelled = false
    setDup({ status: 'checking', videoId })
    void lookupDup(videoId).then((state) => {
      if (!cancelled) setDup(state)
    })
    return () => {
      cancelled = true
    }
  }, [videoId, lookupDup])

  const dupFound = dup.status === 'found' && dup.videoId === videoId ? dup : null
  // 종목이 비어 있으면 아직 정할 수 없으므로 그냥 '등록'으로 본다(Enter 는 종목 칸으로 보낸다).
  const decision = decideDuplicate(stockName.trim() ? (dupFound ?? { status: 'idle' }) : { status: 'idle' }, stockName)
  const dupHelp = !dupFound || !dupFound.info.mine
    ? ''
    : !stockName.trim()
      ? ' 종목을 바꾸려면 종목 칸에 새 이름을 적고 Enter를 누르세요.'
      : decision.action === 'update-stock'
        ? ` Enter를 누르면 종목만 ‘${stockName.trim()}’(으)로 바꿔요.`
        : ' 종목이 같아서 바꿀 것이 없어요.'

  const chooseType = (t: ContentType) => {
    setContentType(t)
    manualTypeRef.current = t
    setAutoTypeNote(false)
    writeStorage(LS_TYPE, t)
  }

  const rememberStocks = (stocks: string[]) => {
    const fresh = Array.from(new Set(stocks.map((s) => s.trim()).filter(Boolean))).reverse()
    if (fresh.length === 0) return
    const next = [...fresh, ...recentRef.current.filter((s) => !fresh.includes(s))].slice(0, MAX_RECENT_STOCKS)
    recentRef.current = next
    setRecentStocks(next)
    writeStorage(LS_STOCKS, JSON.stringify(next))
  }

  const pickChip = (stock: string) => {
    setStockName(stock)
    if (cleanUrl && !urlProblem) submitRef.current?.focus()
    else urlRef.current?.focus()
  }

  const toggleAutoSubmit = (on: boolean) => {
    setAutoSubmit(on)
    writeStorage(LS_AUTO, on ? '1' : '0')
  }

  // 붙여 넣은 글을 "여러 개 붙여넣기" 화면으로 옮긴다(주소 없는 줄은 빼고).
  const switchToBulk = (text: string) => {
    if (saving || savingRef.current) return
    const converted = toBulkText(text)
    setBulkSeed({ key: Date.now(), text: converted.text, dropped: converted.droppedLines })
    setPasteNote(null)
    setYoutubeUrl('')
    dispatchUndo({ type: 'dismiss' })
    setMode('bulk')
  }

  // 로그인이 풀렸을 때: 입력하던 값을 잠깐 보관했다가 로그인 뒤 다시 채운다.
  const stashDraft = (url: string, stock: string, type: ContentType) => {
    writeSession(SS_DRAFT, serializeDraft({ url, stock, type, savedAt: Date.now() }))
  }

  const failWith = (error: RegisterErrorInfo, url: string, stock: string, type: ContentType) => {
    if (error.kind === 'auth') stashDraft(url, stock, type)
    setFeedback({ kind: 'error', key: nextKey(), error, loginHref: error.kind === 'auth' ? loginHref(REGISTER_PATH) : undefined })
  }

  // 다음 영상을 바로 붙여 넣을 수 있게: 주소만 비우고 종목·형식은 그대로 둔 채 주소칸으로 돌아간다.
  const resetForNext = () => {
    setYoutubeUrl('')
    setContentCategory('')
    setUsedPlaybookId('')
    setTouched(false)
    setPasteNote(null)
    setClipHint('')
    if (autoTypeNote) {
      setContentType(manualTypeRef.current)
      setAutoTypeNote(false)
    }
    urlRef.current?.focus()
  }

  const afterChange = (videoIdForCache: string, highlightId?: string) => {
    dupCache.current.delete(videoIdForCache)
    void (async () => {
      const countPromise = refreshToday()
      if (pageRef.current !== 1) setPage(1)
      else await loadMine(1)
      const count = await countPromise
      if (count !== null) {
        setFeedback((prev) => {
          if (!prev || prev.kind !== 'ok' || (highlightId && prev.id !== highlightId)) return prev
          return prev.headline.startsWith('✓ 등록됨') ? { ...prev, headline: `✓ 등록됨 · 오늘 ${count.toLocaleString('ko-KR')}번째` } : prev
        })
      }
      if (highlightId) highlight(highlightId)
    })()
  }

  // ---- 등록 ----
  // opts.url / opts.type: 붙여넣은 직후처럼 아직 화면 상태에 반영되지 않은 값을 바로 쓸 때.
  // opts.refresh: 이미 등록한 영상의 정보를 새로 가져와 다시 등록(종목·형식·메모가 이 화면의 값으로 덮어써진다).
  // opts.auto: "주소만 붙이면 바로 등록" — 새 영상이 확실할 때만 진행한다.
  const submit = async (opts: { url?: string; type?: ContentType; refresh?: boolean; auto?: boolean } = {}) => {
    if (saving || savingRef.current) return
    setTouched(true)
    const url = opts.url ?? cleanUrl
    const type = opts.type ?? contentType
    const problem = url ? describeUrlProblem(url) : 'empty'
    const id = url && !problem ? extractVideoId(url) : null
    if (!id) {
      urlRef.current?.focus()
      return
    }
    const stock = stockName.trim()
    if (!stock) {
      stockRef.current?.focus()
      return
    }

    savingRef.current = true
    setSaving(true)
    try {
      const known = await lookupDup(id, true)
      setDup(known)

      if (opts.auto && known.status !== 'none') {
        // 자동 등록은 "새 영상"이 확실할 때만. 아니면 주소만 넣어 두고 사람이 확인하게 한다.
        if (known.status === 'unknown') {
          setFeedback({ kind: 'info', key: nextKey(), message: '이미 등록한 영상인지 확인하지 못해서 자동 등록은 멈췄어요. 종목을 확인하고 Enter를 눌러 주세요.' })
        }
        stockRef.current?.focus()
        stockRef.current?.select()
        return
      }

      const found = known.status === 'found' ? known.info : null
      const action = opts.refresh ? (found && !found.mine ? 'takeover' : 'register') : decideDuplicate(known, stock).action

      if (action === 'already-same' && found) {
        setFeedback({ kind: 'info', key: nextKey(), message: `이미 ‘${found.stock}’ 종목으로 등록돼 있어요. 바꿀 것이 없으니 다음 영상 주소를 붙여 넣어 주세요.` })
        resetForNext()
        return
      }

      if (action === 'update-stock' && found) {
        type PatchRes = { ok?: boolean; error?: string }
        let res: Awaited<ReturnType<typeof authedFetchJson<PatchRes>>>
        try {
          res = await authedFetchJsonTimeout<PatchRes>(
            `/api/v5/my-videos/${found.id}`,
            { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stock_name: stock }) },
            TIMEOUT_MS.save
          )
        } catch (e) {
          failWith(classifyError(e), url, stock, type)
          return
        }
        if (!res.ok) {
          failWith(classifyError(res.data?.error || '', res.status), url, stock, type)
          return
        }
        rememberStocks([stock])
        const entry: UndoEntry = {
          id: found.id,
          kind: 'restore',
          videoId: id,
          url,
          stock,
          type: found.type,
          prev: { stock: found.stock, type: found.type, category: found.category },
          expiresAt: Date.now() + UNDO_WINDOW_MS
        }
        dispatchUndo({ type: 'offer', entry })
        setItems((prev) => prev.map((v) => (v.id === found.id ? { ...v, stock_name: stock } : v)))
        setFeedback({
          kind: 'ok',
          key: nextKey(),
          id: found.id,
          stock,
          headline: `✓ 종목을 ‘${stock}’로 바꿨어요 (이전: ${found.stock})`,
          detail: '영상 정보는 그대로 두고 종목만 고쳤어요.'
        })
        resetForNext()
        afterChange(id, found.id)
        return
      }

      // 새로 등록(또는 이미 있는 영상을 다시 등록해 정보를 갱신)
      const res = await registerVideo({ videoId: id, contentType: type, stockName: stock, contentCategory: contentCategory.trim() }, { diagnose: true })
      if (!res.ok) {
        failWith(res.error, url, stock, type)
        return
      }

      if (usedPlaybookId) {
        // 성공 공식 사용 횟수 기록은 실패해도 등록 결과에 영향을 주지 않는다.
        void authedPostJson(`/api/v5/playbook/${usedPlaybookId}/use`, {})
      }

      rememberStocks([stock])

      // 되돌리기: 새로 만든 영상이 확실하면 삭제, 내가 이미 등록했던 영상이면 이전 값 복원.
      // 다른 팀원 것이었거나(담당이 바뀜) 새 영상인지 확인하지 못했다면 위험하므로 제공하지 않는다.
      const base = { id: res.id, videoId: id, url, stock, type, expiresAt: Date.now() + UNDO_WINDOW_MS }
      if (known.status === 'none') dispatchUndo({ type: 'offer', entry: { ...base, kind: 'delete' } })
      else if (found && found.mine) dispatchUndo({ type: 'offer', entry: { ...base, kind: 'restore', prev: { stock: found.stock, type: found.type, category: found.category } } })
      else dispatchUndo({ type: 'dismiss' })

      const refreshed = Boolean(found)
      setTodayCount((n) => (refreshed ? n : n + 1))
      setFeedback({
        kind: 'ok',
        key: nextKey(),
        id: res.id,
        stock,
        headline: refreshed ? '✓ 다시 등록됨 · 정보를 새로 갱신했어요' : `✓ 등록됨 · 오늘 ${(todayCount + 1).toLocaleString('ko-KR')}번째`,
        detail: `${stock} · ${CONTENT_TYPE_LABEL[type]}${res.title ? ` · ${res.title}` : ''}`
      })
      resetForNext()
      afterChange(id, res.id)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // ---- 되돌리기 ----
  const runUndo = async () => {
    if (undoBusyRef.current) return // 빠르게 두 번 눌러도 한 번만 보낸다
    const current = undoRef.current
    if (current.phase !== 'offer' && current.phase !== 'failed') return
    const entry = current.entry
    if (Date.now() >= entry.expiresAt) {
      dispatchUndo({ type: 'tick', now: Date.now() })
      return
    }
    undoBusyRef.current = true
    dispatchUndo({ type: 'begin', now: Date.now() })
    try {
      const res =
        entry.kind === 'delete'
          ? // 방금 새로 만든 영상만 지운다: 서버가 "만든 지 UNDO_DELETE_MAX_AGE_SEC 초 안"인지 한 번 더 확인한다.
            await authedFetchJsonTimeout<{ ok?: boolean; error?: string }>(
              `/api/v5/my-videos/${entry.id}?createdWithinSec=${UNDO_DELETE_MAX_AGE_SEC}`,
              { method: 'DELETE' },
              TIMEOUT_MS.undo
            )
          : await authedFetchJsonTimeout<{ ok?: boolean; error?: string }>(
              `/api/v5/my-videos/${entry.id}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  stock_name: entry.prev?.stock ?? entry.stock,
                  content_type: entry.prev?.type ?? entry.type,
                  content_category: entry.prev?.category ?? null
                })
              },
              TIMEOUT_MS.undo
            )
      if (!res.ok && !(entry.kind === 'delete' && res.status === 404)) {
        const info = classifyError(res.data?.error || '', res.status)
        dispatchUndo({ type: 'fail', message: `되돌리지 못했어요. ${info.message}` })
        return
      }
    } catch (e) {
      dispatchUndo({ type: 'fail', message: `되돌리지 못했어요. ${classifyError(e).message}` })
      return
    } finally {
      undoBusyRef.current = false
    }
    dispatchUndo({ type: 'done' })

    if (entry.kind === 'delete') {
      // 지운 영상의 주소·종목을 입력칸에 되돌려 놓아, 고쳐서 바로 다시 등록할 수 있게 한다.
      setItems((prev) => prev.filter((v) => v.id !== entry.id))
      setTotalCount((n) => Math.max(n - 1, 0))
      setTodayCount((n) => Math.max(n - 1, 0))
      // 기다리는 사이 다음 영상 주소를 이미 붙여 넣었다면 그 내용은 건드리지 않는다.
      if (!urlValueRef.current.trim()) {
        setYoutubeUrl(entry.url)
        setStockName(entry.stock)
        setFeedback({ kind: 'info', key: nextKey(), message: `되돌렸어요. ‘${entry.stock}’ 영상을 목록에서 뺐고, 주소와 종목은 입력칸에 다시 채워 뒀어요.` })
        window.setTimeout(() => stockRef.current?.focus(), 0)
      } else {
        setFeedback({ kind: 'info', key: nextKey(), message: `되돌렸어요. ‘${entry.stock}’ 영상을 목록에서 뺐어요.` })
      }
    } else {
      setItems((prev) => prev.map((v) => (v.id === entry.id ? { ...v, stock_name: entry.prev?.stock ?? v.stock_name, content_type: entry.prev?.type ?? v.content_type } : v)))
      setFeedback({ kind: 'info', key: nextKey(), message: `되돌렸어요. 종목을 ‘${entry.prev?.stock ?? entry.stock}’(으)로 다시 바꿨어요.` })
    }
    afterChange(entry.videoId)
  }

  // ---- 방금 등록한 영상의 종목 고치기(결과 자리에서) ----
  const quickFixStock = async (id: string, next: string): Promise<string | null> => {
    try {
      const res = await authedFetchJsonTimeout<{ ok?: boolean; error?: string }>(
        `/api/v5/my-videos/${id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stock_name: next }) },
        TIMEOUT_MS.save
      )
      if (!res.ok) return classifyError(res.data?.error || '', res.status).message
    } catch (e) {
      return classifyError(e).message
    }
    const before = feedback && feedback.kind === 'ok' ? feedback.stock : ''
    setItems((prev) => prev.map((v) => (v.id === id ? { ...v, stock_name: next } : v)))
    setFeedback((prev) =>
      prev && prev.kind === 'ok' && prev.id === id
        ? { ...prev, stock: next, detail: prev.detail.replace(prev.stock, next) }
        : prev
    )
    if (before && stockName.trim() === before) setStockName(next)
    rememberStocks([next])
    highlight(id)
    void refreshToday()
    return null
  }

  // ---- 붙여넣기(Ctrl+V 와 "붙여넣기" 버튼이 같은 규칙을 쓴다) ----
  // 반환: 붙여넣기를 우리가 처리했으면 true(기본 붙여넣기를 막아야 한다).
  const applyClipboard = (text: string, source: 'paste' | 'button'): boolean => {
    if (saving || savingRef.current) return true // 등록 중에는 주소칸을 바꾸지 않는다
    const outcome: ClipboardOutcome = interpretClipboard(text)
    setClipHint('')

    if (outcome.kind === 'empty') {
      if (source === 'button') setClipHint('복사해 둔 내용이 없어요. 유튜브 영상에서 주소를 복사(공유 → 링크 복사)한 뒤 다시 눌러 주세요.')
      return false
    }
    if (outcome.kind === 'none') {
      if (source === 'button') setClipHint('복사해 둔 글에 유튜브 주소가 없어요. 영상 주소를 복사한 뒤 다시 눌러 주세요.')
      return false
    }
    if (outcome.kind === 'multi') {
      setPasteNote({ kind: 'multi', text, count: outcome.count })
      return true
    }
    if (outcome.kind === 'bad') {
      setYoutubeUrl(outcome.url)
      setPasteNote(null)
      return true
    }

    // 주소 하나: 칸에 넣고, 형식을 맞추고, 종목으로 넘어가거나(자동 등록을 켰다면) 바로 등록한다.
    setYoutubeUrl(outcome.url)
    setPasteNote(outcome.info.kind === 'text-with-url' ? { kind: 'extra', text, leftover: outcome.info.leftover, multiLine: outcome.info.lineCount >= 2 } : null)
    let type = contentType
    if (outcome.shorts && contentType !== 'shortform') {
      type = 'shortform'
      setContentType('shortform')
      setAutoTypeNote(true)
    } else if (!outcome.shorts && autoTypeNote) {
      type = manualTypeRef.current
      setContentType(type)
      setAutoTypeNote(false)
    }

    if (shouldAutoSubmit({ enabled: autoSubmit, stock: stockName, outcome })) {
      void submit({ url: outcome.url, type, auto: true })
    } else {
      window.setTimeout(() => {
        stockRef.current?.focus()
        stockRef.current?.select() // 종목이 미리 채워져 있어도 바로 타이핑하면 덮어쓴다. 그대로면 Enter.
      }, 0)
    }
    return true
  }

  const pasteFromClipboard = async () => {
    if (saving || savingRef.current) return
    setClipHint('')
    try {
      const text = await navigator.clipboard.readText()
      applyClipboard(text, 'button')
    } catch {
      setClipHint('브라우저가 붙여넣기를 막았어요. 주소칸을 누르고 Ctrl+V(폰은 길게 눌러 ‘붙여넣기’)로 넣어 주세요.')
      urlRef.current?.focus()
    }
  }

  // 표는 memo 로 감싸 두었으므로(글자를 칠 때마다 20줄을 다시 그리지 않게) 넘기는 함수는 항상 같은 것이어야 한다.
  const onRowUpdated = useCallback(
    (id: string, patch: Partial<MineVideo>) => {
      setItems((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)))
      highlight(id)
      void refreshToday()
    },
    [highlight, refreshToday]
  )

  const onRowDeleted = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((v) => v.id !== id))
      setTotalCount((n) => Math.max(n - 1, 0))
      const u = undoRef.current
      if (u.phase !== 'idle' && u.entry.id === id) dispatchUndo({ type: 'dismiss' })
      void (async () => {
        const rows = await loadMine(pageRef.current)
        if (rows && rows.length === 0 && pageRef.current > 1) setPage(pageRef.current - 1)
        void refreshToday()
      })()
    },
    [loadMine, refreshToday]
  )

  // 여러 개 등록으로 이미 올라간 영상이 "방금 등록 되돌리기" 대상이었다면 그 제안은 접는다(같은 영상을 다시 올린 경우 지우지 않게).
  const onBulkRegistered = useCallback(
    (id: string) => {
      const u = undoRef.current
      if (u.phase !== 'idle' && u.entry.id === id) dispatchUndo({ type: 'dismiss' })
      highlight(id)
      scheduleRefresh()
    },
    [highlight, scheduleRefresh]
  )

  const totalPages = Math.max(Math.ceil(totalCount / 20), 1)

  return (
    <>
      <PageHeader
        title="영상 등록"
        subtitle="유튜브 주소를 붙여 넣고 종목을 적은 뒤 Enter. 제목·조회수·좋아요·댓글은 자동으로 가져와요."
        actions={
          isAdmin ? (
            <Badge tone="indigo">
              오늘 전체 등록 {(teamToday ?? todayCount).toLocaleString('ko-KR')}개
              {teamToday !== null && todayCount > 0 ? ` (내가 ${todayCount.toLocaleString('ko-KR')}개)` : ''}
            </Badge>
          ) : (
            <TodayGoal count={todayCount} goal={DAILY_GOAL} />
          )
        }
      />

      <div className="panel v5-quick">
        <div className="v5-mode-row">
          <div className="v5-segment" role="group" aria-label="등록 방식">
            <button type="button" className={mode === 'single' ? 'active' : ''} aria-pressed={mode === 'single'} disabled={bulkBusy} onClick={() => setMode('single')}>
              한 개씩 등록
            </button>
            <button type="button" className={mode === 'bulk' ? 'active' : ''} aria-pressed={mode === 'bulk'} disabled={bulkBusy || saving}
              onClick={() => {
                setBulkSeed(null)
                dispatchUndo({ type: 'dismiss' }) // 여러 개 등록으로 넘어가면 "방금 등록 되돌리기"는 접는다
                setMode('bulk')
              }}
            >
              여러 개 붙여넣기
            </button>
          </div>
        </div>

        {mode === 'bulk' ? (
          <>
            {bulkSeed && bulkSeed.dropped > 0 ? (
              <div className="v5-hint" role="status">
                주소가 없는 {bulkSeed.dropped}줄(제목 등)은 뺐어요. 제목은 등록할 때 자동으로 가져와요.
              </div>
            ) : null}
          <BulkRegister
            key={bulkSeed?.key ?? 0}
            initialText={bulkSeed?.text}
            recentStocks={recentStocks}
            registeredIds={registeredIds}
            onBusyChange={setBulkBusy}
            onStocksUsed={rememberStocks}
            onRegistered={onBulkRegistered}
          />
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter: 어느 칸에서든 등록(마우스로 버튼까지 가지 않아도 된다).
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
          >
            <div className="field">
              <label className="label" htmlFor="v5-reg-url">
                유튜브 주소
              </label>
              <div className="v5-url-row">
                <input
                  id="v5-reg-url"
                  ref={urlRef}
                  className="input"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={saving}
                  autoCapitalize="none"
                  enterKeyHint="next"
                  placeholder="여기에 유튜브 영상 주소를 붙여 넣으세요"
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value)
                    setPasteNote(null)
                    setClipHint('')
                  }}
                  onPaste={(e) => {
                    // 붙여넣기: 여러 개면 넣지 않고 "여러 개 붙여넣기"를 권한다.
                    // 하나면 앞뒤 공백을 지우고 종목 칸으로 넘어간다(자동 등록을 켰고 종목이 있으면 바로 등록).
                    if (applyClipboard(e.clipboardData.getData('text'), 'paste')) e.preventDefault()
                  }}
                  onBlur={() => {
                    if (youtubeUrl && youtubeUrl !== cleanUrl) setYoutubeUrl(cleanUrl)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && !e.nativeEvent.isComposing && (youtubeUrl || pasteNote || clipHint)) {
                      // Esc: 잘못 붙인 주소를 한 번에 비운다.
                      e.preventDefault()
                      setYoutubeUrl('')
                      setPasteNote(null)
                      setClipHint('')
                      setAutoTypeNote(false)
                      if (autoTypeNote) setContentType(manualTypeRef.current)
                      return
                    }
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      if (!stockName.trim() && cleanUrl && !urlProblem) stockRef.current?.focus()
                      else void submit()
                    }
                  }}
                  aria-invalid={Boolean(urlProblem)}
                  aria-describedby="v5-reg-url-hint"
                />
                {canReadClipboard ? (
                  <button className="button secondary" type="button" disabled={saving} onClick={() => void pasteFromClipboard()}>
                    붙여넣기
                  </button>
                ) : null}
              </div>
              <div id="v5-reg-url-hint" className={`v5-hint ${urlProblem || dupFound ? 'warn' : ''}`}>
                {urlProblem ? (
                  urlProblem
                ) : dupFound ? (
                  <>
                    {dupNotice(dupFound.info)}
                    {dupFound.info.mine ? (
                      <>
                        {dupHelp}
                        <button className="v5-linkbtn" type="button" disabled={saving} onClick={() => void submit({ refresh: true })}>
                          정보도 새로 가져오기
                        </button>
                      </>
                    ) : null}
                  </>
                ) : autoTypeNote ? (
                  '숏폼 주소라서 형식을 숏폼으로 맞췄어요.'
                ) : (
                  ''
                )}
              </div>
              <div className="v5-live" aria-live="polite" aria-atomic="true">
                {clipHint ? (
                  <div className="v5-paste-note">
                    <span className="v5-paste-note-text">{clipHint}</span>
                    <span className="v5-paste-note-actions">
                      <button className="button ghost sm" type="button" onClick={() => setClipHint('')}>
                        닫기
                      </button>
                    </span>
                  </div>
                ) : null}
                {pasteNote ? (
                  <div className="v5-paste-note">
                    <span className="v5-paste-note-text">
                      {pasteNote.kind === 'multi'
                        ? `영상 ${pasteNote.count}개를 한꺼번에 붙여 넣으셨네요. 여러 개 붙여넣기로 바꾸면 한 번에 등록할 수 있어요.`
                        : pasteNote.multiLine
                          ? '주소 말고 다른 줄도 함께 붙어 있어서 주소만 넣었어요. 제목은 자동으로 가져와요.'
                          : '주소 옆에 다른 글자가 붙어 있어서 주소만 넣었어요.'}
                    </span>
                    <span className="v5-paste-note-actions">
                      {pasteNote.kind === 'extra' && pasteNote.leftover && !stockName.trim() ? (
                        <button
                          className="button secondary sm"
                          type="button"
                          onClick={() => {
                            setStockName(pasteNote.leftover)
                            setPasteNote(null)
                            submitRef.current?.focus()
                          }}
                        >
                          종목을 “{pasteNote.leftover}”로 쓰기
                        </button>
                      ) : null}
                      {pasteNote.kind === 'multi' || pasteNote.multiLine ? (
                        <button className="button sm" type="button" onClick={() => switchToBulk(pasteNote.text)}>
                          여러 개 붙여넣기로 바꾸기
                        </button>
                      ) : null}
                      <button className="button ghost sm" type="button" onClick={() => setPasteNote(null)}>
                        닫기
                      </button>
                    </span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="v5-quick-row">
              <div className="field">
                <label className="label" htmlFor="v5-reg-stock">
                  종목
                </label>
                <input
                  id="v5-reg-stock"
                  ref={stockRef}
                  className="input"
                  list="v5-recent-stocks"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  readOnly={saving}
                  placeholder="예: 삼성전자"
                  value={stockName}
                  onChange={(e) => setStockName(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void submit()
                    }
                  }}
                  aria-invalid={Boolean(stockProblem)}
                  aria-describedby="v5-reg-stock-hint"
                />
                <datalist id="v5-recent-stocks">
                  {recentStocks.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <span className="label" aria-hidden="true">형식</span>
                <SegmentedChoice
                  label="영상 형식"
                  value={contentType}
                  disabled={saving}
                  onChange={chooseType}
                  options={[
                    { value: 'longform', label: CONTENT_TYPE_LABEL.longform },
                    { value: 'shortform', label: CONTENT_TYPE_LABEL.shortform }
                  ]}
                />
              </div>
              <button ref={submitRef} className="button v5-submit" type="submit" disabled={saving} aria-busy={saving}>
                {saving
                  ? '등록 중...'
                  : decision.action === 'update-stock'
                    ? '종목만 바꾸기'
                    : decision.action === 'already-same'
                      ? '이미 등록됨'
                      : decision.action === 'takeover'
                        ? '내 영상으로 등록'
                        : '등록'}
              </button>
            </div>
            <div id="v5-reg-stock-hint" className={`v5-hint ${stockProblem ? 'warn' : ''}`}>{stockProblem}</div>

            <FeedbackSlot
              feedback={feedback}
              undo={undo}
              onUndo={() => void runUndo()}
              onUndoExpire={() => dispatchUndo({ type: 'tick', now: Date.now() })}
              onQuickFix={quickFixStock}
              onRetry={() => void submit()}
            />

            <label className="v5-check v5-auto-row">
              <input type="checkbox" checked={autoSubmit} onChange={(e) => toggleAutoSubmit(e.target.checked)} />
              <span>주소만 붙이면 바로 등록 (종목이 채워져 있고 새 영상일 때만)</span>
            </label>

            {recentStocks.length > 0 ? (
              <div className="v5-chip-row" role="group" aria-label="최근 종목">
                <span className="v5-chip-label">최근 종목</span>
                {recentStocks.map((s) => (
                  <button key={s} type="button" className={`v5-chip ${stockName.trim() === s ? 'on' : ''}`} disabled={saving} aria-pressed={stockName.trim() === s} onClick={() => pickChip(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            <details className="v5-more">
              <summary>추가 정보 입력 (선택)</summary>
              <div className="v5-more-body">
                <div className="field">
                  <label className="label" htmlFor="v5-reg-category">
                    영상 분류
                  </label>
                  <input
                    id="v5-reg-category"
                    className="input"
                    autoComplete="off"
                    value={contentCategory}
                    readOnly={saving}
                    onChange={(e) => setContentCategory(e.target.value)}
                    placeholder="예: 실적분석, 급등주, 리포트"
                  />
                </div>
                {playbookOptions.length > 0 ? (
                  <div className="field">
                    <label className="label" htmlFor="v5-reg-playbook">
                      적용한 성공 공식
                    </label>
                    <select id="v5-reg-playbook" className="select" value={usedPlaybookId} disabled={saving} onChange={(e) => setUsedPlaybookId(e.target.value)}>
                      <option value="">선택 안 함</option>
                      {playbookOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} (사용 {p.usage_count}회)
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            </details>

            <KeyboardHint />
          </form>
        )}

        <TodayStocks stocks={stocksToday} />
      </div>

      <div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div className="panel-title" style={{ margin: 0 }}>
            {isAdmin ? '등록된 영상 (전체)' : '내가 등록한 영상'} <Badge tone="plain">{totalCount.toLocaleString('ko-KR')}</Badge>
          </div>
          {totalPages > 1 ? (
            <div className="row">
              <button className="button secondary sm" type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(p - 1, 1))}>
                이전
              </button>
              <span className="small muted">
                {page} / {totalPages}
              </span>
              <button className="button secondary sm" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(p + 1, totalPages))}>
                다음
              </button>
            </div>
          ) : null}
        </div>

        {!loadedOnce ? (
          <MyVideosSkeleton />
        ) : listError ? (
          <EmptyState
            tone="error"
            title={listError === 'auth' ? '로그인이 풀렸어요' : '목록을 불러오지 못했어요'}
            action={
              listError === 'auth' ? (
                <a className="button sm" href={loginHref(REGISTER_PATH)}>
                  다시 로그인
                </a>
              ) : (
                <button className="button secondary sm" type="button" onClick={() => void loadMine(page)}>
                  다시 불러오기
                </button>
              )
            }
          >
            {listError === 'auth' ? (
              <>다시 로그인하면 이 화면으로 돌아와요. 위에 적던 내용은 그대로 두었어요.</>
            ) : (
              <>
                인터넷 연결을 확인한 뒤 &lsquo;다시 불러오기&rsquo;를 눌러 주세요.
                <br />
                위 입력칸으로 등록은 계속할 수 있어요.
              </>
            )}
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 등록한 영상이 없어요"
            action={
              <button
                className="button sm"
                type="button"
                onClick={() => {
                  setMode('single')
                  window.setTimeout(() => urlRef.current?.focus(), 0)
                }}
              >
                첫 영상 등록하기
              </button>
            }
          >
            위 칸에 유튜브 주소를 붙여 넣고 종목을 적은 뒤 Enter를 눌러요.
            <br />
            등록한 영상은 여기에 쌓이고, 조회수 같은 숫자는 자동으로 채워져요.
          </EmptyState>
        ) : (
          <MyVideosTable
            items={items}
            isAdmin={isAdmin}
            highlightIds={highlightIds}
            onUpdated={onRowUpdated}
            onDeleted={onRowDeleted}
          />
        )}
      </div>
    </>
  )
}
