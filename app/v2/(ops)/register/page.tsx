'use client'

import Link from 'next/link'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PageHeader } from '@/components/v2/app-shell'
import { BulkRegister } from '@/components/v2/bulk-register'
import { SampleBanner } from '@/components/v2/sample-banner'
import { MyVideoRow, type RowMode } from '@/components/v2/my-video-row'
import { RegisterStatus, type RegisterErrorView } from '@/components/v2/register-status'
import { TodayProgress, TodayStocks } from '@/components/v2/register-progress'
import {
  DEFAULT_DAILY_GOAL,
  UNDO_INITIAL,
  clampGoal,
  groupTodayByStock,
  mergeVideoLists,
  parseDraft,
  registeredWhenLabel,
  serializeDraft,
  undoKindOf,
  undoReducer,
  unionVideos,
  upsertVideo,
  type EntryOrigin,
  type LastEntry
} from '@/components/v2/register-flow'
import {
  checkYoutubeInput,
  describeRegisterError,
  extractYoutubeUrls,
  friendlyEditError,
  hasYoutubeUrl,
  isImeKey,
  normalizeYoutubeUrl,
  urlProblemText,
  youtubeVideoId
} from '@/components/v2/register-utils'
import { Segmented } from '@/components/v2/segmented'
import { VideoListSkeleton } from '@/components/v2/skeletons'
import { useV2Me } from '@/components/v2/session-context'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson, authedPostJson, type AuthedJsonResult } from '@/lib/session/authed-fetch'
import { NETWORK_ERROR, authedDeleteJson, authedPatchJson, v2Get } from '@/lib/v2/client'
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
const AUTO_KEY = 'v2.register.autoSubmit'
const GOAL_KEY = 'v2.register.dailyGoal'
const DRAFT_KEY = 'v2.register.draft'
const REGISTER_PATH = '/v2/register'
const LOGIN_HREF = `/v2/login?next=${encodeURIComponent(REGISTER_PATH)}`
const STOCK_LIST_ID = 'v2-reg-stock-list'
const MAX_RECENT_STOCKS = 8
const EARLIER_PREVIEW = 5
const HIGHLIGHT_MS = 6000
const PAGE_SIZE = 20
// 중복 확인·"이전 등록" 목록을 위해 처음 화면을 띄운 뒤 뒤에서 더 받아 오는 쪽 수(20개씩)
const DEEP_PAGES = 5
const CHECKLIST_CHUNK = 40
const TYPE_OPTIONS = CONTENT_TYPES.map((type) => ({ value: type, label: CONTENT_TYPE_LABELS[type] }))

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

function readStoredAuto(): boolean {
  try {
    return window.localStorage.getItem(AUTO_KEY) === '1'
  } catch {
    return false
  }
}

function readStoredGoal(): number {
  try {
    const raw = window.localStorage.getItem(GOAL_KEY)
    return raw === null ? DEFAULT_DAILY_GOAL : clampGoal(raw)
  } catch {
    return DEFAULT_DAILY_GOAL
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 저장소를 못 써도 등록 자체에는 영향 없음
  }
}

// 로그인이 끊겨 로그인 화면으로 다녀올 때 쓰는 임시 보관(같은 탭에서만, 30분 안에만 유효)
function readDraft() {
  try {
    return parseDraft(window.sessionStorage.getItem(DRAFT_KEY), Date.now())
  } catch {
    return null
  }
}

function writeDraft(value: string) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, value)
  } catch {
    // 못 써도 로그인은 진행된다
  }
}

function removeDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // 무시
  }
}

function normStock(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function canReadClipboard() {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard) && typeof navigator.clipboard.readText === 'function'
}

type UrlMsg = { text: string; tone: 'error' | 'quiet' } | null
type SubmitOpts = { url?: string; type?: ContentType; force?: boolean }
type FetchPage = { ok: true; items: MineVideoItem[] } | { ok: false; error: string }
// 이미 등록돼 있는 것으로 확인된 영상(내 목록에서 찾았거나, 등록 직전 확인에서 내 것으로 나온 것)
type KnownVideo = { id: string; title: string | null; stock_name: string; content_type: ContentType; created_at: string }
type LookupPayload = { exists?: boolean; mine?: boolean; serverNow?: string; item?: { id: string; stock_name: string; content_type: ContentType; created_at: string } }

export default function RegisterPage() {
  const me = useV2Me()
  const { toast, showSuccess, showError } = useToast()

  const [draft] = useState(readDraft)
  const [url, setUrl] = useState(draft?.url ?? '')
  const [contentType, setContentType] = useState<ContentType>(() => draft?.type ?? readStoredType())
  const [stock, setStock] = useState(draft?.stock ?? '')
  const [note, setNote] = useState(draft?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [urlMsg, setUrlMsg] = useState<UrlMsg>(null)
  const [stockMsg, setStockMsg] = useState('')
  const [regError, setRegError] = useState<RegisterErrorView | null>(null)
  const [info, setInfo] = useState(draft ? '다시 로그인했어요. 적어 두었던 내용을 그대로 채워 두었어요.' : '')
  const [typeHint, setTypeHint] = useState('')
  const [recentStocks, setRecentStocks] = useState<string[]>(readStoredStocks)
  const [autoSubmit, setAutoSubmit] = useState(readStoredAuto)
  const [goal, setGoal] = useState(readStoredGoal)
  const [canPaste, setCanPaste] = useState(true)
  const [undo, dispatchUndo] = useReducer(undoReducer, UNDO_INITIAL)
  const [now, setNow] = useState(() => Date.now())

  const [videos, setVideos] = useState<MineVideoItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [checklists, setChecklists] = useState<Record<string, SeoChecklist>>({})
  const [checklistSample, setChecklistSample] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkSeed, setBulkSeed] = useState('')
  const [activeRow, setActiveRow] = useState<{ id: string; mode: Exclude<RowMode, null> } | null>(null)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())
  const highlightTimers = useRef<number[]>([])

  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const savingRef = useRef(false)
  const undoingRef = useRef(false)
  const deepDone = useRef(false)
  const loadSeq = useRef(0)
  const checklistLoaded = useRef<Set<string>>(new Set())

  const today = kstYmd()
  const isToday = (iso: string) => kstYmd(new Date(iso)) === today
  const todayVideos = useMemo(() => videos.filter((v) => kstYmd(new Date(v.created_at)) === today), [videos, today])
  const earlierVideos = useMemo(() => videos.filter((v) => kstYmd(new Date(v.created_at)) !== today), [videos, today])
  const todayCount = todayVideos.length
  // 관리자는 팀 전체 영상 중 최근 것만(최대 DEEP_PAGES × PAGE_SIZE 개) 받아 오므로, 전부 오늘 것이면 실제 개수는 이보다 많을 수 있다.
  const teamCapped = me.isAdmin && earlierVideos.length === 0 && videos.length >= PAGE_SIZE * DEEP_PAGES
  const todayGroups = useMemo(() => groupTodayByStock(videos, (iso) => kstYmd(new Date(iso)) === today), [videos, today])

  // 영상 ID → 이미 등록된 영상(중복 확인용)
  const registeredByVideoId = useMemo(() => {
    const map = new Map<string, MineVideoItem>()
    for (const v of videos) {
      const id = v.youtube_url ? youtubeVideoId(v.youtube_url) : null
      if (id && !map.has(id)) map.set(id, v)
    }
    return map
  }, [videos])
  const registeredIds = useMemo(() => new Set(registeredByVideoId.keys()), [registeredByVideoId])
  const suggestions = useMemo(() => titleKeywordSuggestions(stock), [stock])

  // 이미 등록된 영상인지 제출하기 전에 미리 알려 준다.
  const urlCheck = useMemo(() => checkYoutubeInput(url), [url])
  const existing = urlCheck.kind === 'ok' ? registeredByVideoId.get(urlCheck.videoId) || null : null
  const stockDiffers = Boolean(existing && normStock(stock) && normStock(stock) !== normStock(existing.stock_name))

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

  // ---- 목록 불러오기 ----
  const loadChecklists = async (videoIds: string[], force = false) => {
    const ids = force ? videoIds : videoIds.filter((id) => !checklistLoaded.current.has(id))
    for (let i = 0; i < ids.length; i += CHECKLIST_CHUNK) {
      const chunk = ids.slice(i, i + CHECKLIST_CHUNK)
      try {
        const { ok, data } = await authedFetchJson<{ items: SeoChecklist[]; sample?: boolean }>(`/api/v2/seo-checklists?videoIds=${chunk.join(',')}`)
        if (!ok) continue
        setChecklistSample(Boolean(data.sample))
        const map: Record<string, SeoChecklist> = {}
        for (const item of data.items) map[item.video_id] = item
        for (const id of chunk) checklistLoaded.current.add(id)
        setChecklists((prev) => ({ ...prev, ...map }))
      } catch {
        // 점검표를 못 읽어도 목록은 그대로 보여 준다
      }
    }
  }

  const fetchPage = async (page: number): Promise<FetchPage> => {
    try {
      const result: AuthedJsonResult<MineVideosPayload> = await authedFetchJson<MineVideosPayload>(`/api/videos/mine?page=${page}`)
      if (!result.ok) return { ok: false, error: result.data?.error || '등록한 영상 목록을 불러오지 못했어요.' }
      return { ok: true, items: result.data.items || [] }
    } catch {
      return { ok: false, error: '네트워크가 불안정해서 목록을 불러오지 못했어요.' }
    }
  }

  // 첫 쪽(가장 새로운 20개)을 먼저 그리고, deep 이면 뒤에서 더 오래된 쪽을 이어서 받아 중복 확인 범위를 넓힌다.
  const load = async (wantDeep = false) => {
    // 처음 화면의 깊은 불러오기가 다른 불러오기에 밀려 끊겼다면, 다음 불러오기에서 이어서 마저 받는다.
    const deep = wantDeep || !deepDone.current
    // 등록 직후·여러 개 등록이 끝난 직후처럼 요청이 겹치면 마지막 요청의 결과만 쓴다.
    const seq = ++loadSeq.current
    const first = await fetchPage(1)
    if (seq !== loadSeq.current) return
    setLoaded(true)
    if (!first.ok) {
      setLoadError(first.error)
      return
    }
    setLoadError('')
    setVideos((prev) => mergeVideoLists(first.items, prev, PAGE_SIZE))
    void loadChecklists(first.items.map((v) => v.id), true)
    if (!deep) return

    let last = first.items
    for (let page = 2; page <= DEEP_PAGES && last.length >= PAGE_SIZE; page += 1) {
      const next = await fetchPage(page)
      if (seq !== loadSeq.current || !next.ok) return
      last = next.items
      setVideos((prev) => unionVideos(prev, next.items))
      void loadChecklists(next.items.map((v) => v.id))
    }
    deepDone.current = true
  }

  useEffect(() => {
    urlRef.current?.focus()
    removeDraft()
    setCanPaste(canReadClipboard())
    void load(true)
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

  // 되돌리기 제한 시간(10초) 시계: 열려 있는 동안에만 돌린다
  useEffect(() => {
    if (undo.phase !== 'open') return
    setNow(Date.now())
    const timer = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      dispatchUndo({ type: 'tick', now: t })
    }, 500)
    return () => window.clearInterval(timer)
  }, [undo.phase, undo.entry?.videoId])

  // Esc: 열려 있는 수정/삭제 확인 창 닫기
  useEffect(() => {
    if (!activeRow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveRow(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeRow])

  // "/" : 글을 쓰는 중이 아니면 어디서든 주소 칸으로
  useEffect(() => {
    if (bulkMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      urlRef.current?.focus()
      urlRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bulkMode])

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

  const focusUrl = () => {
    urlRef.current?.focus()
  }

  const focusStock = () => {
    stockRef.current?.focus()
    stockRef.current?.select()
  }

  const clearMessages = () => {
    setUrlMsg(null)
    setRegError(null)
    setInfo('')
  }

  const onUrlChange = (value: string) => {
    setUrl(value)
    setUrlMsg(null)
    setRegError(null)
    setInfo('')
    if (/\/shorts\//i.test(value) && contentType !== 'shortform') {
      setContentType('shortform')
      setTypeHint('쇼츠 주소라서 형식을 숏폼으로 바꿨어요.')
    } else if (!value) {
      setTypeHint('')
    }
  }

  // 주소가 정해졌을 때(붙여넣기 · 붙여넣기 버튼): 문제가 있으면 이유를 알려 주고, 괜찮으면 종목 칸으로 넘어가거나
  // ("주소만 붙이면 바로 등록"을 켰고 종목이 채워져 있으면) 바로 등록한다.
  const acceptUrl = (raw: string) => {
    const check = checkYoutubeInput(raw)
    const nextUrl = check.kind === 'ok' ? check.url : normalizeYoutubeUrl(raw)
    setUrl(nextUrl)
    setRegError(null)
    setInfo('')
    if (check.kind !== 'ok') {
      setUrlMsg({ text: urlProblemText(check), tone: 'error' })
      focusUrl()
      return
    }
    setUrlMsg(check.inPlaylist ? { text: '재생목록 안의 영상이라 이 영상 한 개만 등록돼요.', tone: 'quiet' } : null)
    let type = contentType
    if (check.shorts && contentType !== 'shortform') {
      type = 'shortform'
      setContentType('shortform')
      setTypeHint('쇼츠 주소라서 형식을 숏폼으로 바꿨어요.')
    }
    const dup = registeredByVideoId.get(check.videoId)
    if (autoSubmit && normStock(stock) && !dup && !savingRef.current) {
      void submit(null, { url: nextUrl, type })
      return
    }
    focusStock()
  }

  // 주소 칸에 붙여넣기: "제목 + 주소"·여러 줄 글에서 주소만 뽑고, 주소가 2개 이상이면 여러 개 등록 화면으로 넘긴다.
  const onUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.trim()) return
    const urls = extractYoutubeUrls(text)
    if (urls.length >= 2) {
      e.preventDefault()
      setBulkSeed(text)
      setBulkMode(true)
      return
    }
    if (urls.length === 1) {
      e.preventDefault()
      acceptUrl(urls[0])
    }
    // 주소가 없는 글은 그대로 붙여 넣어 사용자가 직접 고칠 수 있게 둔다.
  }

  // "붙여넣기" 버튼: 복사해 둔 글을 읽어 온다(브라우저가 허락을 물을 수 있다).
  const pasteFromClipboard = async () => {
    if (!canReadClipboard()) {
      setCanPaste(false)
      setUrlMsg({ text: '이 브라우저는 버튼으로 붙여넣을 수 없어요. 주소 칸을 누르고 Ctrl+V(맥은 ⌘+V)로 붙여넣어 주세요.', tone: 'quiet' })
      focusUrl()
      return
    }
    let text = ''
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setUrlMsg({ text: '브라우저가 복사한 내용 읽기를 막았어요. 주소 칸을 누르고 Ctrl+V(맥은 ⌘+V)로 붙여넣어 주세요.', tone: 'quiet' })
      focusUrl()
      return
    }
    const urls = extractYoutubeUrls(text)
    if (urls.length === 0) {
      setUrlMsg({ text: '복사해 둔 내용에 유튜브 주소가 없어요. 유튜브에서 영상 주소를 복사한 뒤 다시 눌러 주세요.', tone: 'error' })
      focusUrl()
      return
    }
    if (urls.length >= 2) {
      setBulkSeed(text)
      setBulkMode(true)
      return
    }
    acceptUrl(urls[0])
  }

  const onUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e)) return
    if (e.key === 'Escape' && url) {
      // 내용이 있을 때만 지운다(열려 있는 수정 창을 닫는 Esc와 겹치지 않게 여기서 멈춘다).
      e.preventDefault()
      e.nativeEvent.stopPropagation()
      setUrl('')
      setTypeHint('')
      setUrlMsg(null)
      setRegError(null)
      return
    }
    // 주소 칸이 비어 있을 때 Ctrl/⌘+Z: 방금 등록한 영상 되돌리기(글자 되돌리기와 겹치지 않는다)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !url && undo.phase === 'open') {
      e.preventDefault()
      void doUndo()
      return
    }
    // 주소는 맞는데 종목명이 비어 있으면 Enter는 오류를 띄우지 않고 종목 칸으로 넘어간다.
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !normStock(stock) && urlCheck.kind === 'ok') {
      e.preventDefault()
      focusStock()
    }
  }

  const onStockKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e)) return
    if (e.key === 'Escape') {
      // 종목을 한 번에 비우고 주소 칸으로(수정 창을 닫는 Esc와 겹치지 않게 여기서 멈춘다)
      e.preventDefault()
      e.nativeEvent.stopPropagation()
      if (stock) setStock('')
      setStockMsg('')
      if (!stock) focusUrl()
    }
  }

  const pickStock = (name: string) => {
    setStock(name)
    setStockMsg('')
    if (url.trim()) submitRef.current?.focus()
    else urlRef.current?.focus()
  }

  // ---- 등록 ----
  const failWith = (message: string | undefined, status: number) => {
    const err = describeRegisterError(message, status)
    setRegError({ text: err.text, retry: err.retry, relogin: err.kind === 'session' })
  }

  // 이미 등록된 영상의 종목 변경이 실패했을 때(서버가 한국어 문장을 내려주므로 그대로 쓴다)
  const failEdit = (message: string | undefined, status: number, videoId: string) => {
    if (status === 401) {
      failWith(undefined, 401)
      return
    }
    if (status === 404) {
      // 다른 곳에서 이미 지워진 영상: 목록에서 빼면 「다시 시도」가 새로 등록한다
      setVideos((prev) => prev.filter((v) => v.id !== videoId))
      setRegError({ text: '이 영상은 이미 삭제돼 있어요. 「다시 시도」를 누르면 새로 등록해요.', retry: true, relogin: false })
      return
    }
    setRegError({ text: friendlyEditError(message, status, '종목을 바꾸지 못했어요. 잠시 뒤 「다시 시도」를 눌러 주세요.'), retry: true, relogin: false })
  }

  // 로그인 화면으로 다녀오기 전에 지금 적은 내용을 이 탭에 잠시 보관한다(돌아오면 그대로 채워 준다).
  const saveDraftForLogin = () => {
    writeDraft(serializeDraft({ url, stock, note, type: contentType }, Date.now()))
  }

  // "이미 같은 종목으로 등록돼 있어요": 아무것도 보내지 않고 다음 영상으로
  const finishSame = () => {
    setUrl('')
    setUrlMsg(null)
    setTypeHint('')
    setInfo('이미 같은 종목으로 등록돼 있어요. 다음 영상 주소를 붙여 넣어 주세요.')
    focusUrl()
  }

  const submit = async (e?: React.FormEvent | null, opts: SubmitOpts = {}) => {
    e?.preventDefault()
    // Enter와 버튼 클릭이 거의 동시에 들어와도 한 번만 보낸다(state는 다음 그리기 때 바뀌므로 ref로 막는다).
    if (savingRef.current) return

    const check = checkYoutubeInput(opts.url ?? url)
    const type = opts.type ?? contentType
    const cleanStock = normStock(stock)

    if (check.kind !== 'ok') {
      setUrlMsg({ text: urlProblemText(check), tone: 'error' })
      focusUrl()
      return
    }
    if (!cleanStock) {
      setStockMsg('어떤 종목 영상인지 종목명을 적어 주세요.')
      focusStock()
      return
    }

    const videoId = check.videoId
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
    const localDup = registeredByVideoId.get(videoId)

    // 이미 등록한 영상이고 종목도 같다: 보낼 것이 없다.
    if (localDup && !opts.force && normStock(localDup.stock_name) === cleanStock) {
      finishSame()
      return
    }

    await run(async () => {
      let dup: KnownVideo | undefined = localDup
      // 이번 등록이 무엇을 만드는지 "확실히" 알 때만 되돌리기(삭제)를 열어 준다.
      let origin: EntryOrigin = 'existing'
      let guard: string | null = null

      if (!dup) {
        // 내 목록(최근 것만 받아 옴)에 없다고 해서 새 영상이라는 뜻은 아니다. 다른 담당자가 올린 영상이나 오래된 내 영상일 수 있어서 서버에 직접 물어본다.
        const look = await v2Get<LookupPayload>(`/api/v2/my-videos/lookup?videoId=${encodeURIComponent(videoId)}`, '')
        if (look.status === 401) {
          failWith(undefined, 401)
          return
        }
        if (look.status === 0) {
          failWith(undefined, 0)
          return
        }
        const found = look.data
        if (look.ok && found.exists === false && typeof found.serverNow === 'string') {
          origin = 'created'
          guard = found.serverNow
        } else if (look.ok && found.exists === true && found.item) {
          if (found.mine) {
            dup = { id: found.item.id, title: null, stock_name: found.item.stock_name, content_type: found.item.content_type, created_at: found.item.created_at }
          } else {
            const go = window.confirm('이 영상은 다른 담당자가 이미 등록했어요.\n\n등록하면 내 영상으로 바뀌고, 그 담당자 목록에서는 빠져요. 그래도 등록할까요?')
            if (!go) {
              setInfo('등록하지 않았어요. 적어 둔 내용은 그대로 두었어요.')
              return
            }
          }
        } else {
          origin = 'unknown'
        }
      }

      // 이미 등록한 내 영상: 다시 등록하지 않고 종목만 바꾼다(같은 종목이면 아무것도 하지 않는다).
      if (dup && !opts.force) {
        if (normStock(dup.stock_name) === cleanStock) {
          finishSame()
          return
        }
        const known = dup
        const { ok, status, data } = await authedPatchJson<{ ok?: boolean; error?: string }>(`/api/v2/my-videos/${known.id}`, { stock_name: cleanStock })
        if (!ok) {
          failEdit(data?.error, status, known.id)
          return
        }
        setVideos((prev) => prev.map((v) => (v.id === known.id ? { ...v, stock_name: cleanStock } : v)))
        onRegistered({
          videoId: known.id,
          url: watchUrl,
          stock: cleanStock,
          type: known.content_type,
          nth: todayCount,
          origin: 'existing',
          updatedFrom: { stock: known.stock_name, type: known.content_type },
          guard: null
        })
        return
      }

      const { ok, status, data } = await authedPostJson<{ ok?: boolean; video?: { id: string; title?: string | null; published_at?: string | null; view_count?: number | null; like_count?: number | null; comment_count?: number | null }; error?: string }>(
        '/api/videos/create',
        { youtubeUrl: watchUrl, contentType: type, stockName: cleanStock, contentCategory: note.trim() || null }
      )
      if (!ok || !data.video) {
        failWith(data?.error, status)
        return
      }
      const video = data.video

      // 검색 점검표 행을 기본값으로 만들어 둔다. 테이블이 없으면 조용히 넘어간다.
      void authedPatchJson('/api/v2/seo-checklists', { videoId: video.id, patch: {} }).catch(() => undefined)

      // 다시 받아 오기 전에 목록·오늘 개수에 먼저 반영한다(같은 영상을 덮어쓴 경우는 원래 등록 시각을 유지).
      // 새 영상인지 모를 때는 등록 시각을 지어내지 않고 곧 이어지는 목록 새로고침에 맡긴다.
      if (dup || origin === 'created') {
        setVideos((prev) =>
          upsertVideo(prev, {
            id: video.id,
            title: video.title ?? dup?.title ?? null,
            stock_name: cleanStock,
            content_type: type,
            published_at: video.published_at ?? null,
            view_count: video.view_count ?? null,
            like_count: video.like_count ?? null,
            comment_count: video.comment_count ?? null,
            youtube_url: watchUrl,
            created_at: dup?.created_at ?? new Date().toISOString()
          })
        )
      }
      const alreadyToday = dup ? isToday(dup.created_at) : false
      onRegistered({
        videoId: video.id,
        url: watchUrl,
        stock: cleanStock,
        type,
        nth: todayCount + (alreadyToday || origin !== 'created' ? 0 : 1),
        origin: dup ? 'existing' : origin,
        // 이미 있던 내 영상을 덮어쓴 경우: 되돌리면 삭제하지 않고 이전 종목·형식으로 복원한다
        updatedFrom: dup ? { stock: dup.stock_name, type: dup.content_type } : null,
        guard: dup ? null : guard
      })
    })
  }

  // 요청 한 번을 감싼다: 진행 표시, 네트워크 오류(입력값 유지), 끝나면 주소 칸으로 커서.
  const run = async (task: () => Promise<void>) => {
    clearMessages()
    setStockMsg('')
    savingRef.current = true
    setSaving(true)
    try {
      await task()
    } catch {
      failWith(undefined, 0)
    } finally {
      savingRef.current = false
      setSaving(false)
      if (document.activeElement === document.body || document.activeElement === submitRef.current) urlRef.current?.focus()
    }
  }

  // 등록(또는 종목 변경)이 성공했을 때: 다음 영상을 바로 붙여 넣을 수 있게 주소만 비우고, 종목·형식은 그대로 둔다.
  const onRegistered = (entry: LastEntry) => {
    dispatchUndo({ type: 'registered', entry, now: Date.now() })
    setNow(Date.now())
    writeStored(TYPE_KEY, entry.updatedFrom ? contentType : entry.type)
    rememberStock(entry.stock)
    flash([entry.videoId])
    setUrl('')
    setNote('')
    setStock(entry.stock)
    setTypeHint('')
    urlRef.current?.focus()
    void load()
  }

  // ---- 되돌리기 · 종목 고치기 ----
  const doUndo = async () => {
    const entry = undo.entry
    if (!entry || undo.phase !== 'open') return
    const kind = undoKindOf(entry)
    // 새로 만든 것으로 확인된 영상이거나 내 영상의 이전 값 복원일 때만 한다. 그 밖에는 아무것도 지우거나 바꾸지 않는다.
    if (kind === 'none') return
    // 버튼을 빠르게 두 번 눌러도 한 번만 보낸다(state 는 다음 그리기 때 바뀐다).
    if (undoingRef.current) return
    const start = Date.now()
    if (start >= undo.expiresAt) return
    undoingRef.current = true
    dispatchUndo({ type: 'undo_start', now: start })
    const restore = () => {
      // 다음 영상을 이미 적기 시작했다면 그대로 두고, 주소 칸이 비어 있을 때만 방금 내용을 다시 채워 준다.
      const canRestore = !urlRef.current?.value.trim()
      if (canRestore) {
        setUrl(entry.url)
        setStock((cur) => (cur.trim() ? cur : entry.stock))
        setInfo('방금 등록을 취소했어요. 주소와 종목을 다시 채워 두었어요.')
      } else {
        setInfo('방금 등록을 취소했어요.')
      }
      window.setTimeout(() => {
        if (canRestore) {
          stockRef.current?.focus()
          stockRef.current?.select()
        }
      }, 0)
    }
    try {
      const path = `/api/v2/my-videos/${entry.videoId}`
      const from = entry.updatedFrom
      // 삭제는 서버에게 "이 시각 이후에 만든 영상일 때만"이라는 조건을 함께 보낸다(그 전부터 있던 영상은 서버가 거절한다).
      const res = from
        ? await authedPatchJson<{ error?: string }>(path, { stock_name: from.stock, content_type: from.type })
        : await authedDeleteJson<{ error?: string }>(`${path}?createdAfter=${encodeURIComponent(entry.guard || '')}`)
      const alreadyGone = !from && res.status === 404
      if (!res.ok && !alreadyGone) {
        const text = friendlyEditError(res.data?.error, res.status, '되돌리지 못했어요. 아래 목록에서 「삭제」를 눌러 주세요.')
        dispatchUndo({ type: 'undo_fail', videoId: entry.videoId, error: text, now: Date.now() })
        if (res.status === 401) failWith(undefined, 401)
        return
      }
      dispatchUndo({ type: 'undo_ok', videoId: entry.videoId })
      if (from) {
        setVideos((prev) => prev.map((v) => (v.id === entry.videoId ? { ...v, stock_name: from.stock, content_type: from.type } : v)))
      } else {
        setVideos((prev) => prev.filter((v) => v.id !== entry.videoId))
      }
      restore()
      void load()
    } catch {
      dispatchUndo({ type: 'undo_fail', videoId: entry.videoId, error: `${NETWORK_ERROR} 시간 안이면 「되돌리기」를 다시 눌러 보세요.`, now: Date.now() })
    } finally {
      undoingRef.current = false
    }
  }

  // 방금 등록한 영상의 종목만 그 자리에서 고친다. 문제가 있으면 문장을 돌려주고, 성공하면 빈 문자열.
  const fixLastStock = async (next: string): Promise<string> => {
    const entry = undo.entry
    if (!entry) return '고칠 영상을 찾지 못했어요.'
    const clean = normStock(next)
    if (!clean) return '종목명을 적어 주세요.'
    if (clean === entry.stock) return ''
    try {
      const { ok, status, data } = await authedPatchJson<{ error?: string }>(`/api/v2/my-videos/${entry.videoId}`, { stock_name: clean })
      if (!ok) {
        if (status === 401) failWith(undefined, 401)
        return friendlyEditError(data?.error, status, '종목을 고치지 못했어요. 잠시 뒤 다시 시도해 주세요.')
      }
    } catch {
      return NETWORK_ERROR
    }
    dispatchUndo({ type: 'stock_fixed', videoId: entry.videoId, stock: clean })
    setVideos((prev) => prev.map((v) => (v.id === entry.videoId ? { ...v, stock_name: clean } : v)))
    // 다음 영상도 같은 종목으로 이어 가던 중이었다면 고친 종목으로 이어 간다.
    setStock((cur) => (normStock(cur) === entry.stock ? clean : cur))
    rememberStock(clean)
    flash([entry.videoId])
    return ''
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
    if (undo.entry?.videoId === id) dispatchUndo({ type: 'stock_fixed', videoId: id, stock: patch.stock_name })
  }

  const onDeleted = (id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id))
    setActiveRow(null)
    setOpenId((cur) => (cur === id ? null : cur))
    if (undo.entry?.videoId === id) dispatchUndo({ type: 'clear' })
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

  const registerLabel = saving ? null : existing && stockDiffers ? '종목 바꾸기' : '등록'
  const dupText = existing ? (me.isAdmin ? '이미 등록된 영상이에요' : '이미 등록한 영상이에요') : ''

  return (
    <>
      <PageHeader title="영상 등록" subtitle="유튜브 주소와 종목만 넣으면 조회수·좋아요는 자동으로 가져와요." />
      <Toast toast={toast} />

      {/* 종목 자동완성 목록: 한 개씩 등록 칸·수정 칸·방금 등록한 영상의 종목 고치기 칸이 함께 쓴다 */}
      <datalist id={STOCK_LIST_ID}>
        {stockChips.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {bulkMode ? (
        <BulkRegister
          initialText={bulkSeed}
          notice={bulkSeed ? '붙여 넣은 글에 영상 주소가 여러 개 있어서 한 번에 등록하는 화면으로 바꿨어요.' : undefined}
          defaultType={contentType}
          stockChips={stockChips}
          registeredIds={registeredIds}
          onRegistered={({ videoId, stock: name, type }) => {
            rememberStock(name)
            flash([videoId])
            // 목록을 다시 받아 오기 전에도 오늘 개수가 바로 올라가도록 임시 줄을 넣어 둔다
            setVideos((prev) =>
              upsertVideo(prev, {
                id: videoId,
                title: null,
                stock_name: name,
                content_type: type,
                published_at: null,
                view_count: null,
                like_count: null,
                comment_count: null,
                youtube_url: null,
                created_at: new Date().toISOString()
              })
            )
          }}
          onFinished={() => void load(true)}
          onClose={() => {
            setBulkMode(false)
            setBulkSeed('')
            window.setTimeout(() => urlRef.current?.focus(), 0)
          }}
        />
      ) : (
        <div className="panel v2-register">
          <TodayProgress count={todayCount} goal={goal} teamView={me.isAdmin} loaded={loaded} capped={teamCapped} onGoalChange={(g) => {
            setGoal(g)
            writeStored(GOAL_KEY, String(g))
          }} />

          <form
            onSubmit={(e) => void submit(e)}
            onKeyDown={(e) => {
              // Ctrl/⌘+Enter: 어느 칸에 있든 바로 등록
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isImeKey(e)) {
                e.preventDefault()
                void submit()
              }
            }}
            noValidate
            className="v2-register-form"
            aria-busy={saving}
          >
            <div className="field">
              <label className="label" htmlFor="v2-reg-url">
                유튜브 주소
              </label>
              <div className="v2-url-row">
                <input
                  id="v2-reg-url"
                  ref={urlRef}
                  className="input v2-url-input"
                  placeholder="주소를 붙여 넣으세요 (https://www.youtube.com/watch?v=…)"
                  type="text"
                  inputMode="url"
                  enterKeyHint="next"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={url}
                  onChange={(e) => onUrlChange(e.target.value)}
                  onPaste={onUrlPaste}
                  onKeyDown={onUrlKeyDown}
                  onBlur={() => {
                    if (!url.trim()) return
                    if (hasYoutubeUrl(url)) setUrl(normalizeYoutubeUrl(url))
                    const check = checkYoutubeInput(url)
                    if (check.kind !== 'ok') setUrlMsg({ text: urlProblemText(check), tone: 'error' })
                  }}
                  aria-invalid={urlMsg?.tone === 'error' || undefined}
                  aria-describedby="v2-reg-url-note"
                />
                {canPaste ? (
                  <button
                    type="button"
                    className="button secondary v2-paste-btn"
                    // 키보드 사용자는 Ctrl+V가 더 빨라서 Tab 순서(주소→종목→형식→등록)에서는 뺀다
                    tabIndex={-1}
                    disabled={saving}
                    onClick={() => void pasteFromClipboard()}
                    aria-label="복사해 둔 유튜브 주소 붙여넣기"
                  >
                    붙여넣기
                  </button>
                ) : null}
              </div>
              <div className="v2-url-note" id="v2-reg-url-note">
                {urlMsg ? (
                  <div className={urlMsg.tone === 'error' ? 'v2-hint' : 'v2-hint quiet'} role={urlMsg.tone === 'error' ? 'alert' : 'status'}>
                    {urlMsg.text}
                  </div>
                ) : existing ? (
                  <div className="v2-hint v2-dup" role="status">
                    {dupText} ({registeredWhenLabel(existing.created_at, today)} · {existing.stock_name}).
                    {stockDiffers ? (
                      <button type="button" className="v2-text-btn" disabled={saving} onClick={() => void submit()}>
                        종목만 「{normStock(stock)}」(으)로 바꾸기
                      </button>
                    ) : null}
                    <button type="button" className="v2-text-btn" disabled={saving} onClick={() => void submit(null, { force: true })}>
                      그래도 다시 등록
                    </button>
                    <button
                      type="button"
                      className="v2-text-btn"
                      onClick={() => {
                        setUrl('')
                        setTypeHint('')
                        focusUrl()
                      }}
                    >
                      주소 지우기
                    </button>
                  </div>
                ) : typeHint ? (
                  <div className="v2-hint quiet">{typeHint}</div>
                ) : null}
              </div>
            </div>

            <div className="v2-reg-row">
              <div className="field v2-reg-stock">
                <label className="label" htmlFor="v2-reg-stock">
                  종목명
                </label>
                <div className="v2-stock-wrap">
                  <input
                    id="v2-reg-stock"
                    ref={stockRef}
                    className="input"
                    placeholder="예: 삼성전자"
                    type="text"
                    enterKeyHint="done"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    list={STOCK_LIST_ID}
                    value={stock}
                    onChange={(e) => {
                      setStock(e.target.value)
                      setStockMsg('')
                    }}
                    onKeyDown={onStockKeyDown}
                    aria-invalid={stockMsg ? true : undefined}
                    aria-describedby={stockMsg ? 'v2-reg-stock-msg' : undefined}
                  />
                  {stock ? (
                    <button
                      type="button"
                      className="v2-clear-x"
                      tabIndex={-1}
                      aria-label="종목명 지우기"
                      title="종목명 지우기 (Esc)"
                      disabled={saving}
                      onClick={() => {
                        setStock('')
                        setStockMsg('')
                        stockRef.current?.focus()
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="field">
                <span className="label" id="v2-reg-type-label">
                  형식
                </span>
                <Segmented
                  value={contentType}
                  onChange={(type) => {
                    setContentType(type)
                    setTypeHint('')
                  }}
                  options={TYPE_OPTIONS}
                  labelledBy="v2-reg-type-label"
                  disabled={saving}
                />
              </div>

              <button ref={submitRef} type="submit" className="button v2-reg-submit" disabled={saving}>
                {saving ? (
                  <>
                    <span className="v2-spin" aria-hidden="true" /> 등록 중…
                  </>
                ) : (
                  registerLabel
                )}
              </button>
            </div>

            {stockMsg ? (
              <div className="v2-hint" id="v2-reg-stock-msg" role="alert">
                {stockMsg}
              </div>
            ) : null}

            <RegisterStatus
              error={regError}
              info={info}
              undo={undo}
              now={now}
              saving={saving}
              loginHref={LOGIN_HREF}
              stockListId={STOCK_LIST_ID}
              onRetry={() => void submit()}
              onUndo={() => void doUndo()}
              onFixStock={fixLastStock}
              onBeforeRelogin={saveDraftForLogin}
              onFocusUrl={focusUrl}
            />

            <p className="v2-kbd-hint">
              <kbd>Enter</kbd> 등록 · <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> 어느 칸에서든 등록 · <kbd>/</kbd> 주소 칸으로 · 종목 칸에서 <kbd>Esc</kbd> 종목 지우기 · 주소 칸이 빈 채로 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> 방금 등록 되돌리기
            </p>

            <label className="v2-check-line v2-auto-line">
              <input
                type="checkbox"
                checked={autoSubmit}
                onChange={(e) => {
                  setAutoSubmit(e.target.checked)
                  writeStored(AUTO_KEY, e.target.checked ? '1' : '0')
                }}
              />
              <span>주소만 붙이면 바로 등록 (종목이 채워져 있을 때만)</span>
            </label>

            {stockChips.length > 0 ? (
              <div className="v2-recent">
                <span className="small muted">최근 종목</span>
                <div className="v2-chips">
                  {stockChips.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`v2-chip v2-chip-btn ${stock.trim() === name ? 'on' : ''}`}
                      aria-pressed={stock.trim() === name}
                      disabled={saving}
                      onClick={() => pickStock(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <TodayStocks groups={todayGroups} />

            <details className="v2-more">
              <summary>메모 남기기 (선택)</summary>
              <label className="v2-sr-only" htmlFor="v2-reg-note">
                메모
              </label>
              <input
                id="v2-reg-note"
                className="input compact"
                placeholder="나중에 알아보기 위한 내부 메모"
                autoComplete="off"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </details>

            {suggestions.length > 0 ? (
              <details className="v2-more">
                <summary>제목에 넣으면 좋은 표현 보기</summary>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  누르면 복사돼요. 제목에 종목명과 이런 검색어를 함께 쓰면 검색에 더 잘 걸려요.
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
          </form>
          <div className="v2-mode-switch">
            <button
              type="button"
              className="v2-text-btn"
              disabled={saving}
              onClick={() => {
                setBulkSeed('')
                setBulkMode(true)
              }}
            >
              영상이 많나요? 여러 개 한 번에 붙여넣기 →
            </button>
            <Link className="link small v2-help-link" href="/v2/help">
              처음이라면 사용 방법 보기
            </Link>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title v2-panel-h">{me.isAdmin ? '최근 등록된 영상' : '내가 등록한 영상'}</h2>
            <p className="panel-subtitle">
              {loaded && videos.length > 0
                ? `오늘 ${todayCount}개 등록 · 종목·형식이 틀렸으면 「수정」, 잘못 올린 영상은 「삭제」를 누르세요.`
                : '등록하면 여기에 쌓여요.'}
            </p>
          </div>
        </div>
        <SampleBanner show={checklistSample} />

        {!loaded ? (
          <VideoListSkeleton />
        ) : loadError && videos.length === 0 ? (
          <div className="empty-state" role="alert">
            <div style={{ color: 'var(--text)', fontWeight: 700, marginBottom: 6 }}>목록을 불러오지 못했어요</div>
            <p className="small" style={{ margin: '0 0 14px' }}>
              {loadError} 등록은 그대로 할 수 있어요.
            </p>
            <button type="button" className="button secondary" onClick={() => void load(true)}>
              다시 불러오기
            </button>
          </div>
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
                setBulkSeed('')
                window.setTimeout(() => urlRef.current?.focus(), 0)
              }}
            >
              주소 입력하러 가기
            </button>
          </div>
        ) : (
          <div className="list v2-vlist">
            {loadError ? (
              <div className="v2-hint" role="alert">
                {loadError}{' '}
                <button type="button" className="v2-text-btn" onClick={() => void load(true)}>
                  다시 불러오기
                </button>
              </div>
            ) : null}
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
