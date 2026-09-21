'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { BulkRegister } from '@/components/v4/bulk-register'
import { useV4Me } from '@/components/v4/me-context'
import { MyVideoList, type MyVideo } from '@/components/v4/my-video-list'
import { DAILY_TARGET, deleteMyVideo, fetchDailyTarget, fetchTodayCount, patchMyVideo, registerVideo, type ContentType } from '@/components/v4/register-api'
import { RegisterFeedback, type FeedbackStatus } from '@/components/v4/register-feedback'
import { TodayChip, TodayPanel } from '@/components/v4/today-progress'
import { EmptyState, FormatToggle } from '@/components/v4/ui'
import { ListSkeleton } from '@/components/v4/skeleton'
import { analyzePaste, looksLikeStockName, toBulkText } from '@/components/v4/paste-detect'
import { buildVideoIndex, diagnoseYoutubeUrl, duplicateChoice, duplicateMessage, findDuplicate, groupTodayByStock } from '@/components/v4/register-logic'
import { UNDO_IDLE, deleteSafety, undoReducer } from '@/components/v4/undo-state'
import { isShortsUrl, normalizeStockName, normalizeYoutubeUrl, readJson, readStorage, todayKst, writeStorage } from '@/components/v4/register-utils'
import { authedFetchJson } from '@/lib/session/authed-fetch'

type Mode = 'single' | 'bulk'
type SubmitOverride = { url?: string; type?: ContentType }

const FORMAT_KEY = 'v4.register.format'
const STOCKS_KEY = 'v4.register.recentStocks'
const AUTO_SUBMIT_KEY = 'v4.register.autoSubmit'
const MAX_CHIPS = 8
const NEW_HIGHLIGHT_MS = 5000
const PAGE_SIZE = 20
const OLDER_PAGES = 4 // 중복 확인·오늘 종목 묶음을 위해 최근 100개까지 미리 읽어 둔다 (2~5쪽)

export default function VideoRegisterPage() {
  const { me, isAdmin } = useV4Me()
  const urlRef = useRef<HTMLInputElement>(null)
  const stockRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)
  const aliveRef = useRef(true)
  const olderStartedRef = useRef(false)
  const highlightTimer = useRef<number | null>(null)

  const [mode, setMode] = useState<Mode>('single')
  const [bulkOpened, setBulkOpened] = useState(false)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [stockName, setStockName] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showHints, setShowHints] = useState(false)
  const [status, setStatus] = useState<FeedbackStatus>(null)
  const [autoShortNote, setAutoShortNote] = useState(false)
  // 붙여넣기 안내: 제목이 같이 붙었을 때 / 주소가 여러 개일 때 / 클립보드를 못 읽었을 때
  const [pasteNote, setPasteNote] = useState('')
  const [stockSuggest, setStockSuggest] = useState('')
  const [bulkSuggest, setBulkSuggest] = useState<{ text: string; count: number } | null>(null)
  const [bulkSeed, setBulkSeed] = useState<{ id: number; text: string } | null>(null)
  const [canPaste, setCanPaste] = useState(false)
  const [autoSubmit, setAutoSubmit] = useState(false)

  const [items, setItems] = useState<MyVideo[]>([])
  const [older, setOlder] = useState<MyVideo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [listNotice, setListNotice] = useState('')

  const [recentStocks, setRecentStocks] = useState<string[]>([])
  const [todayCount, setTodayCount] = useState<number | null>(null)
  const [daily, setDaily] = useState<{ target: number; source: 'personal' | 'default' }>({ target: DAILY_TARGET, source: 'default' })

  const [undo, dispatchUndo] = useReducer(undoReducer, UNDO_IDLE)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // 최신 입력값을 비동기 작업(등록 응답 뒤)에서 읽기 위한 사본
  const urlNowRef = useRef('')
  const stockNowRef = useRef('')
  urlNowRef.current = youtubeUrl
  stockNowRef.current = stockName

  const loadMine = async (): Promise<MyVideo[] | null> => {
    try {
      const { ok, data } = await authedFetchJson<{ items?: MyVideo[]; error?: string }>('/api/videos/mine?page=1')
      if (!aliveRef.current) return null
      setLoaded(true)
      if (!ok) {
        setLoadError('등록한 영상 목록을 불러오지 못했어요. "다시 불러오기"를 눌러 주세요.')
        return null
      }
      setLoadError('')
      const list = data.items || []
      setItems(list)
      return list
    } catch {
      if (!aliveRef.current) return null
      setLoaded(true)
      setLoadError('인터넷 연결을 확인하고 "다시 불러오기"를 눌러 주세요.')
      return null
    }
  }

  // 2~5쪽(최근 100개)을 뒤에서 조용히 읽어 온다: "이미 등록한 영상" 확인과 오늘 종목 묶음이 더 정확해진다.
  const loadOlder = async () => {
    const collected: MyVideo[] = []
    for (let page = 2; page <= OLDER_PAGES + 1; page += 1) {
      try {
        const { ok, data } = await authedFetchJson<{ items?: MyVideo[] }>(`/api/videos/mine?page=${page}`)
        if (!ok || !aliveRef.current) return
        const list = data.items || []
        collected.push(...list)
        setOlder([...collected])
        if (list.length < PAGE_SIZE) return
      } catch {
        return
      }
    }
  }

  const refreshToday = async () => {
    const count = await fetchTodayCount()
    if (count !== null && aliveRef.current) setTodayCount(count)
    return count
  }

  const highlight = (ids: string[]) => {
    if (ids.length === 0) return
    setNewIds(new Set(ids))
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setNewIds(new Set()), NEW_HIGHLIGHT_MS)
  }

  const focusStock = () => {
    const el = stockRef.current
    if (!el) return
    el.focus()
    el.select() // 미리 채워진 종목은 그대로 Enter, 바꾸려면 바로 타이핑
  }

  // 처음 열 때: 마지막에 쓴 형식·최근 종목·자동 등록 설정 복원, 주소 칸에 커서, 목록·오늘 등록 수 불러오기
  useEffect(() => {
    aliveRef.current = true
    const savedFormat = readStorage(FORMAT_KEY)
    if (savedFormat === 'longform' || savedFormat === 'shortform') setContentType(savedFormat)
    const savedStocks = readJson<unknown>(STOCKS_KEY, [])
    if (Array.isArray(savedStocks)) setRecentStocks(savedStocks.filter((s): s is string => typeof s === 'string').slice(0, MAX_CHIPS))
    setAutoSubmit(readStorage(AUTO_SUBMIT_KEY) === 'on')
    // "붙여넣기" 버튼은 브라우저가 클립보드 읽기를 지원할 때만 보인다.
    setCanPaste(typeof window !== 'undefined' && window.isSecureContext && typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function')
    urlRef.current?.focus()
    void loadMine().then((list) => {
      if (list && list.length >= PAGE_SIZE && !olderStartedRef.current) {
        olderStartedRef.current = true
        void loadOlder()
      }
    })
    void refreshToday()
    return () => {
      aliveRef.current = false
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 하루 목표: 내 이번 달 개인 목표가 있으면 그 값, 없으면 기본 12개
  const myId = me?.crmUserId || ''
  useEffect(() => {
    if (!myId) return
    let cancelled = false
    void fetchDailyTarget(myId).then((result) => {
      if (!cancelled) setDaily(result)
    })
    return () => {
      cancelled = true
    }
  }, [myId])

  // 되돌리기 시간(10초) 카운트다운
  useEffect(() => {
    if (undo.phase !== 'open') return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setNowMs(now)
      dispatchUndo({ type: 'tick', now })
    }, 500)
    return () => window.clearInterval(timer)
  }, [undo.phase])

  // "/" 키: 글을 쓰는 중이 아닐 때 주소 칸으로 바로 이동
  useEffect(() => {
    if (mode !== 'single') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      e.preventDefault()
      urlRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode])

  const allItems = useMemo(() => {
    const seen = new Set<string>()
    const out: MyVideo[] = []
    for (const item of [...items, ...older]) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
    return out
  }, [items, older])

  const stockChoices = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    // 관리자 목록은 팀 전체라서 남의 종목이 섞이지 않게 이 브라우저에서 쓴 종목만 쓴다.
    const source = isAdmin ? recentStocks : [...recentStocks, ...items.map((i) => i.stock_name)]
    for (const raw of source) {
      const name = normalizeStockName(raw || '')
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out.slice(0, 20)
  }, [recentStocks, items, isAdmin])

  const videoIndex = useMemo(() => buildVideoIndex(allItems), [allItems])
  const existingIds = useMemo(() => new Set(videoIndex.keys()), [videoIndex])

  const normalizedUrl = normalizeYoutubeUrl(youtubeUrl)
  const diagnosis = diagnoseYoutubeUrl(normalizedUrl)
  const urlInvalid = youtubeUrl.trim() !== '' && !diagnosis.ok
  const dupKnown = useMemo(() => findDuplicate(videoIndex, normalizedUrl), [videoIndex, normalizedUrl])
  const dupChoice = dupKnown ? duplicateChoice(dupKnown, stockName) : null

  const todayGroups = useMemo(() => (isAdmin ? [] : groupTodayByStock(allItems, todayKst())), [allItems, isAdmin])

  const changeFormat = (next: ContentType) => {
    setContentType(next)
    setAutoShortNote(false)
    writeStorage(FORMAT_KEY, next)
  }

  const toggleAutoSubmit = (on: boolean) => {
    setAutoSubmit(on)
    writeStorage(AUTO_SUBMIT_KEY, on ? 'on' : 'off')
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    if (next === 'bulk') {
      setBulkOpened(true)
      window.setTimeout(() => document.getElementById('v4-bulk-text')?.focus(), 0)
    } else {
      window.setTimeout(() => urlRef.current?.focus(), 0)
    }
  }

  // "여러 개 붙여넣기"로 바꾸면서 방금 붙여넣은 글을 그대로 옮겨 준다.
  const carryToBulk = () => {
    if (!bulkSuggest) return
    setBulkSeed((prev) => ({ id: (prev?.id || 0) + 1, text: bulkSuggest.text }))
    setBulkSuggest(null)
    setYoutubeUrl('')
    setStatus(null)
    switchMode('bulk')
  }

  const clearUrlField = () => {
    setYoutubeUrl('')
    setStatus(null)
    setShowHints(false)
    setAutoShortNote(false)
    setPasteNote('')
    setStockSuggest('')
    setBulkSuggest(null)
    urlRef.current?.focus()
  }

  const applyUrl = (raw: string) => {
    const cleaned = normalizeYoutubeUrl(raw)
    setYoutubeUrl(cleaned || raw.trim())
    setStatus(null)
    let type = contentType
    // 쇼츠 주소면 형식을 알아서 숏폼으로
    if (cleaned && isShortsUrl(cleaned)) {
      type = 'shortform'
      if (contentType !== 'shortform') {
        setContentType('shortform')
        writeStorage(FORMAT_KEY, 'shortform')
        setAutoShortNote(true)
      } else {
        setAutoShortNote(false)
      }
    } else {
      setAutoShortNote(false)
    }
    return { cleaned, type }
  }

  // 붙여넣은 글(Ctrl+V 든 "붙여넣기" 버튼이든)을 처리한다. 처리했으면 true.
  const ingestPaste = (text: string, source: 'field' | 'button'): boolean => {
    const info = analyzePaste(text)
    setPasteNote('')
    setStockSuggest('')

    // 주소가 둘 이상 = 여러 개를 한꺼번에 붙여넣은 것 → "여러 개 붙여넣기"를 권하고, 클릭 한 번에 글을 옮겨 준다.
    if (info.kind === 'multi') {
      setStatus(null)
      setShowHints(false)
      setBulkSuggest({ text: toBulkText(text), count: info.urls.length })
      return true
    }
    setBulkSuggest(null)
    // 주소가 없는 글은 그대로 두고(직접 고쳐 쓰는 중일 수 있어요), 버튼으로 읽었을 땐 안내만 한다.
    if (info.kind === 'none') {
      if (source === 'button') {
        setShowHints(false)
        setPasteNote('복사한 글에서 유튜브 주소를 찾지 못했어요. 유튜브에서 영상 주소를 다시 복사해 주세요.')
        urlRef.current?.focus()
      }
      return false
    }

    const { cleaned, type } = applyUrl(text)
    if (info.kind === 'single-with-text') {
      setPasteNote('제목은 빼고 주소만 넣었어요. 제목은 유튜브에서 자동으로 채워져요.')
      if (!stockName.trim() && looksLikeStockName(info.leftover)) setStockSuggest(info.leftover)
    }
    if (!diagnoseYoutubeUrl(cleaned).ok) {
      // 재생목록·채널 주소 등: 안내 문장이 주소 칸 아래에 바로 보인다.
      setShowHints(true)
      return true
    }
    setShowHints(false)
    // 이미 등록한 영상이면 자동으로 등록하지 않는다 (아래 안내에서 고른다).
    if (findDuplicate(videoIndex, cleaned)) {
      window.setTimeout(focusStock, 0)
      return true
    }
    // "주소만 붙이면 바로 등록"을 켜 두었고 종목이 채워져 있으면 붙여넣기만으로 끝난다.
    if (autoSubmit && normalizeStockName(stockName)) {
      void submit({ url: cleaned, type })
      return true
    }
    window.setTimeout(focusStock, 0)
    return true
  }

  const onPasteUrl = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text) return
    if (ingestPaste(text, 'field')) e.preventDefault()
  }

  const pasteFromClipboard = async () => {
    if (submitting) return
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setShowHints(false)
        setPasteNote('복사된 내용이 없어요. 유튜브에서 영상 주소를 먼저 복사해 주세요.')
        urlRef.current?.focus()
        return
      }
      ingestPaste(text, 'button')
    } catch {
      // 사용자가 거절했거나 브라우저가 막은 경우
      setShowHints(false)
      setPasteNote('붙여넣기 버튼을 쓸 수 없었어요. 주소 칸을 누르고 Ctrl+V 로 붙여넣어 주세요. (주소창 옆 자물쇠에서 "클립보드"를 허용하면 버튼이 동작해요)')
      urlRef.current?.focus()
    }
  }

  const rememberStocks = (stocks: string[]) => {
    const next = [...stocks.map((s) => normalizeStockName(s)).filter(Boolean), ...recentStocks]
    const unique = Array.from(new Set(next)).slice(0, MAX_CHIPS)
    setRecentStocks(unique)
    writeStorage(STOCKS_KEY, JSON.stringify(unique))
  }

  const patchLocalItem = (id: string, patch: { stock_name: string; content_type: ContentType }) => {
    const apply = (list: MyVideo[]) => list.map((item) => (item.id === id ? { ...item, ...patch } : item))
    setItems(apply)
    setOlder(apply)
  }

  const removeLocalItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
    setOlder((prev) => prev.filter((item) => item.id !== id))
  }

  // 이미 등록한 영상: 새로 등록하지 않고 종목만 바꾼다 (영상 정보·조회수는 그대로).
  const changeDuplicateStock = async (known: MyVideo, stock: string, url: string) => {
    savingRef.current = true
    setSubmitting(true)
    setStatus(null)
    try {
      const res = await patchMyVideo(known.id, { stock_name: stock })
      if (!res.ok) {
        setStatus({ tone: 'error', text: res.message, kind: res.auth ? 'auth' : 'other', retry: true })
        return
      }
      patchLocalItem(known.id, { stock_name: res.item.stock_name, content_type: res.item.content_type })
      rememberStocks([res.item.stock_name])
      const now = Date.now()
      setNowMs(now)
      dispatchUndo({
        type: 'registered',
        now,
        recent: { id: known.id, mode: 'restore', stock: res.item.stock_name, title: known.title || '', url, ordinal: null, prevStock: known.stock_name }
      })
      highlight([known.id])
      finishInput(url)
    } finally {
      savingRef.current = false
      setSubmitting(false)
    }
  }

  // 등록이 끝난 뒤 입력칸 정리: 주소·메모만 비우고 종목·형식은 그대로 둔다. 커서는 주소 칸.
  // 그 사이 다음 주소를 이미 붙여넣었다면 지우거나 커서를 빼앗지 않는다.
  const finishInput = (doneUrl: string) => {
    setMemo('')
    setAutoShortNote(false)
    setPasteNote('')
    setStockSuggest('')
    setBulkSuggest(null)
    setShowHints(false)
    const current = urlNowRef.current.trim()
    const pending = current !== '' && normalizeYoutubeUrl(current) !== doneUrl
    if (!pending) {
      setYoutubeUrl('')
      urlRef.current?.focus()
    }
  }

  const submit = async (override: SubmitOverride = {}) => {
    if (savingRef.current) return
    const url = normalizeYoutubeUrl(override.url ?? youtubeUrl)
    const type = override.type ?? contentType
    const stock = normalizeStockName(stockName)

    if (!diagnoseYoutubeUrl(url).ok) {
      setShowHints(true)
      urlRef.current?.focus()
      return
    }
    if (!stock) {
      setShowHints(true)
      focusStock()
      return
    }

    const known = findDuplicate(videoIndex, url)
    if (known) {
      const choice = duplicateChoice(known, stock)
      if (choice.kind === 'same') {
        clearUrlField()
        setStatus({ tone: 'ok', text: '이미 같은 종목으로 등록돼 있어서 그대로 두었어요.' })
        return
      }
      await changeDuplicateStock(known, choice.stock, url)
      return
    }

    savingRef.current = true
    setSubmitting(true)
    setStatus(null)
    setListNotice('')
    try {
      const result = await registerVideo({ youtubeUrl: url, contentType: type, stockName: stock, contentCategory: memo.trim() || null })
      if (!result.ok) {
        // 입력한 내용은 그대로 두고, 무엇을 하면 되는지 알려 준다.
        setStatus({ tone: 'error', text: result.message, kind: result.kind, retry: result.retry })
        return
      }

      // "오늘 N번째"는 서버가 센 값을 쓴다 (다른 기기·화면에서 등록한 것도 포함)
      const fresh = await refreshToday()
      const ordinal = fresh ?? (todayCount ?? 0) + 1
      if (fresh === null) setTodayCount(ordinal)
      rememberStocks([stock])
      const now = Date.now()
      setNowMs(now)
      dispatchUndo({
        type: 'registered',
        now,
        recent: { id: result.video?.id || null, mode: 'delete', stock, title: result.video?.title || '', url, ordinal, prevStock: null }
      })
      highlight(result.video?.id ? [result.video.id] : [])
      finishInput(url)
      void loadMine().then((list) => {
        if (list && list.length >= PAGE_SIZE && !olderStartedRef.current) {
          olderStartedRef.current = true
          void loadOlder()
        }
      })
    } finally {
      savingRef.current = false
      setSubmitting(false)
    }
  }

  // ---- 되돌리기 / 바로 고치기 ----------------------------------------------------
  const failUndo = (id: string, message: string) => dispatchUndo({ type: 'failed', id, message, now: Date.now() })

  const onUndo = async () => {
    const recent = undo.recent
    if (!recent || !recent.id || undo.phase !== 'open') return
    const id = recent.id
    dispatchUndo({ type: 'begin', id, now: Date.now() })

    if (recent.mode === 'restore') {
      const res = await patchMyVideo(id, { stock_name: recent.prevStock || recent.stock })
      if (!res.ok) {
        failUndo(id, res.message)
        return
      }
      patchLocalItem(id, { stock_name: res.item.stock_name, content_type: res.item.content_type })
      dispatchUndo({ type: 'succeeded', id })
      setStatus({ tone: 'ok', text: `종목을 '${res.item.stock_name}'(으)로 되돌렸어요.` })
      return
    }

    // 지우기: 방금 새로 등록한 영상만 지운다. 예전에 등록해 둔 영상을 실수로 지우지 않도록 목록을 다시 확인한다.
    const list = await loadMine()
    if (list === null) {
      failUndo(id, '목록을 확인하지 못해서 지우지 않았어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')
      return
    }
    const safety = deleteSafety(list.find((item) => item.id === id), Date.now())
    if (!safety.safe) {
      failUndo(id, '예전에 등록해 둔 영상이라 자동으로 지우지 않았어요. 잘못 올렸다면 아래 목록에서 직접 삭제해 주세요.')
      return
    }
    const res = await deleteMyVideo(id)
    if (!res.ok) {
      failUndo(id, res.message)
      return
    }
    removeLocalItem(id)
    void refreshToday()
    dispatchUndo({ type: 'succeeded', id })
    setStatus({ tone: 'ok', text: '되돌렸어요. 목록에서 지웠고, 주소를 다시 넣어 두었어요. 종목을 고쳐서 등록해 주세요.' })
    if (!urlNowRef.current.trim()) {
      setYoutubeUrl(recent.url)
      window.setTimeout(focusStock, 0)
    }
  }

  const onQuickFix = async (raw: string): Promise<{ ok: boolean; message: string }> => {
    const recent = undo.recent
    if (!recent || !recent.id) return { ok: false, message: '' }
    const next = normalizeStockName(raw)
    if (!next) return { ok: false, message: '종목명을 적어 주세요.' }
    if (next === recent.stock) return { ok: true, message: '' }
    const res = await patchMyVideo(recent.id, { stock_name: next })
    if (!res.ok) return { ok: false, message: res.message }
    patchLocalItem(recent.id, { stock_name: res.item.stock_name, content_type: res.item.content_type })
    dispatchUndo({ type: 'edited', id: recent.id, stock: res.item.stock_name })
    rememberStocks([res.item.stock_name])
    // 방금 틀린 종목이 다음 영상 칸에도 남아 있었다면 함께 고쳐 준다.
    if (normalizeStockName(stockNowRef.current) === recent.stock) setStockName(res.item.stock_name)
    return { ok: true, message: '고쳤어요.' }
  }

  const pickStock = (name: string) => {
    setStockName(name)
    setStatus(null)
    if (!youtubeUrl.trim()) urlRef.current?.focus()
    else submitRef.current?.focus()
  }

  const onBulkFinished = ({ ids, stocks }: { ids: string[]; stocks: string[] }) => {
    if (stocks.length > 0) rememberStocks(stocks)
    highlight(ids)
    void loadMine()
    void refreshToday()
  }

  const onUpdated = (id: string, patch: { stock_name: string; content_type: ContentType }) => {
    patchLocalItem(id, patch)
    if (undo.recent?.id === id) dispatchUndo({ type: 'edited', id, stock: patch.stock_name })
  }

  const onDeleted = (id: string) => {
    removeLocalItem(id)
    if (undo.recent?.id === id) dispatchUndo({ type: 'dismiss' })
    setListNotice('영상을 지웠어요. 오늘 등록 수도 다시 셌어요.')
    void refreshToday()
    void loadMine()
  }

  const firstRun = loaded && !loadError && items.length === 0
  const urlOk = diagnosis.ok
  const submitLabel = submitting
    ? '등록 중…'
    : dupKnown && dupChoice?.kind === 'change'
      ? '종목만 바꾸기'
      : dupKnown && dupChoice?.kind === 'same'
        ? '이미 등록됨'
        : '등록'

  return (
    <>
      <PageHeader
        title="영상 등록"
        subtitle="유튜브 주소를 붙여넣고 종목명만 적으면 끝입니다. 제목·조회수·좋아요·댓글은 유튜브에서 자동으로 채워져요."
        actions={<TodayChip count={todayCount} target={daily.target} source={daily.source} />}
      />

      <div className="v4-mode-tabs" role="group" aria-label="등록 방법">
        <button type="button" aria-pressed={mode === 'single'} className={`v4-mode-tab ${mode === 'single' ? 'active' : ''}`} onClick={() => switchMode('single')}>
          하나씩 등록
        </button>
        <button type="button" aria-pressed={mode === 'bulk'} className={`v4-mode-tab ${mode === 'bulk' ? 'active' : ''}`} onClick={() => switchMode('bulk')}>
          여러 개 붙여넣기
        </button>
      </div>

      <div hidden={mode !== 'single'}>
      <div
        className="panel v4-reg-form"
        onKeyDown={(e) => {
          // Ctrl/Cmd + Enter: 어느 칸에 있든 바로 등록
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            if ((e.target as HTMLElement).closest('[data-v4-quickfix]')) return
            e.preventDefault()
            void submit()
          }
        }}
      >
        <form
          className="v4-reg-fields"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="field">
            <label className="label" htmlFor="v4-reg-url">
              1. 유튜브 주소
            </label>
            <div className="v4-reg-urlrow">
              <input
                id="v4-reg-url"
                ref={urlRef}
                className="input v4-reg-url"
                inputMode="url"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="next"
                aria-describedby="v4-reg-url-hint"
                placeholder="여기에 영상 주소를 붙여넣으세요"
                value={youtubeUrl}
                aria-invalid={showHints && urlInvalid ? true : undefined}
                onChange={(e) => {
                  setYoutubeUrl(e.target.value)
                  setStatus(null)
                  setAutoShortNote(false)
                  setPasteNote('')
                  setStockSuggest('')
                  setBulkSuggest(null)
                }}
                onPaste={onPasteUrl}
                onBlur={() => {
                  if (youtubeUrl.trim()) {
                    const cleaned = normalizeYoutubeUrl(youtubeUrl)
                    if (cleaned && cleaned !== youtubeUrl) setYoutubeUrl(cleaned)
                    // 주소가 이상할 때만 안내한다 (올바른 주소를 붙인 직후에는 종목 칸으로 넘어가도 재촉하지 않는다)
                    if (!diagnoseYoutubeUrl(cleaned).ok) setShowHints(true)
                  }
                }}
                onKeyDown={(e) => {
                  // Esc: 주소 칸을 비우고 안내도 지운다 (잘못 붙여넣었을 때 빨리 다시 시작)
                  if (e.key === 'Escape' && (youtubeUrl || bulkSuggest || pasteNote || status)) {
                    e.preventDefault()
                    clearUrlField()
                    return
                  }
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.nativeEvent.isComposing && !stockName.trim()) {
                    // 종목을 아직 안 적었다면 등록 대신 종목 칸으로 이동
                    e.preventDefault()
                    focusStock()
                  }
                }}
              />
              {canPaste ? (
                <button type="button" className="button secondary v4-paste-btn v4-touch" onClick={() => void pasteFromClipboard()} disabled={submitting} title="복사해 둔 유튜브 주소를 바로 붙여넣어요">
                  붙여넣기
                </button>
              ) : null}
            </div>
            {bulkSuggest ? (
              <div className="v4-suggest" role="status">
                <span>
                  주소가 <strong>{bulkSuggest.count}개</strong> 들어 있어요. 한 번에 등록할까요?
                </span>
                <span className="v4-suggest-actions">
                  <button type="button" className="button v4-mini v4-touch" onClick={carryToBulk}>
                    여러 개 붙여넣기로 바꾸기
                  </button>
                  <button type="button" className="button secondary v4-mini v4-touch" onClick={() => setBulkSuggest(null)}>
                    하나만 쓸게요
                  </button>
                </span>
              </div>
            ) : null}
            {dupKnown && dupChoice && !bulkSuggest ? (
              <div className="v4-suggest v4-dup" role="status">
                <span>
                  <strong>{duplicateMessage(dupKnown, isAdmin)}</strong>
                  <span className="v4-dup-detail">
                    {' '}
                    · 지금 종목: {dupKnown.stock_name || '없음'}.{' '}
                    {dupChoice.kind === 'change'
                      ? '영상 정보는 그대로 두고 종목만 바꿀 수 있어요.'
                      : dupChoice.kind === 'same'
                        ? '종목도 같아서 바꿀 것이 없어요.'
                        : '종목만 바꾸려면 아래 종목명을 적어 주세요.'}
                  </span>
                </span>
                <span className="v4-suggest-actions">
                  {dupChoice.kind === 'change' ? (
                    <button type="button" className="button v4-mini v4-touch" disabled={submitting} onClick={() => void submit()}>
                      종목만 &lsquo;{dupChoice.stock}&rsquo;로 바꾸기
                    </button>
                  ) : null}
                  <button type="button" className="button secondary v4-mini v4-touch" onClick={clearUrlField}>
                    주소 지우기
                  </button>
                </span>
              </div>
            ) : null}
            <div className="v4-hint-slot" id="v4-reg-url-hint" aria-live="polite">
              {showHints && !youtubeUrl.trim() ? (
                <span className="v4-hint warn">유튜브 주소를 붙여넣어 주세요.</span>
              ) : showHints && urlInvalid && !diagnosis.ok ? (
                <span className="v4-hint warn">{diagnosis.message}</span>
              ) : pasteNote ? (
                <span className="v4-hint">
                  {pasteNote}
                  {stockSuggest ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="v4-text-btn v4-touch"
                        onClick={() => {
                          setStockName(stockSuggest)
                          setStockSuggest('')
                          submitRef.current?.focus()
                        }}
                      >
                        &lsquo;{stockSuggest}&rsquo;를 종목명으로 쓰기
                      </button>
                    </>
                  ) : null}
                </span>
              ) : autoShortNote ? (
                <span className="v4-hint">쇼츠 주소라서 형식을 숏폼으로 바꿨어요.</span>
              ) : null}
            </div>
          </div>

          <div className="v4-reg-row">
            <div className="field v4-reg-stock">
              <label className="label" htmlFor="v4-reg-stock">
                2. 종목명
              </label>
              <input
                id="v4-reg-stock"
                ref={stockRef}
                className="input"
                list="v4-reg-stock-list"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                placeholder="예: 삼성전자"
                value={stockName}
                aria-invalid={showHints && urlOk && !stockName.trim() ? true : undefined}
                onChange={(e) => {
                  setStockName(e.target.value)
                  setStatus(null)
                }}
                onKeyDown={(e) => {
                  // Esc: 종목명을 한 번에 지운다 (미리 채워진 종목을 바꿀 때)
                  if (e.key === 'Escape' && stockName) {
                    e.preventDefault()
                    setStockName('')
                  }
                }}
              />
              <datalist id="v4-reg-stock-list">
                {stockChoices.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div className="field">
              <span className="label" id="v4-reg-format-label">
                형식
              </span>
              <FormatToggle value={contentType} onChange={changeFormat} disabled={submitting} labelledBy="v4-reg-format-label" />
            </div>

            <button ref={submitRef} className="button v4-reg-submit" type="submit" disabled={submitting}>
              {submitLabel}
            </button>
          </div>

          {showHints && urlOk && !stockName.trim() ? (
            <div className="v4-hint-slot">
              <span className="v4-hint warn">종목명을 적어 주세요.</span>
            </div>
          ) : null}

          {stockChoices.length > 0 ? (
            <div className="v4-chips" aria-label="최근 종목">
              <span className="v4-chips-label">최근 종목</span>
              {stockChoices.slice(0, MAX_CHIPS).map((name) => (
                <button key={name} type="button" disabled={submitting} className={`v4-chip ${normalizeStockName(stockName) === name ? 'active' : ''}`} onClick={() => pickStock(name)}>
                  {name}
                </button>
              ))}
            </div>
          ) : null}

          <details className="v4-more">
            <summary>메모 추가 (선택)</summary>
            <label className="v4-sr" htmlFor="v4-reg-memo">
              메모
            </label>
            <input id="v4-reg-memo" className="input" autoComplete="off" value={memo} placeholder="예: 실적 발표 · 급등 이슈" onChange={(e) => setMemo(e.target.value)} />
          </details>
        </form>

        <RegisterFeedback
          status={status}
          undo={undo}
          nowMs={nowMs}
          busy={submitting}
          onUndo={() => void onUndo()}
          onRetry={() => void submit()}
          onQuickFix={onQuickFix}
          idleHint={
            <>
              <span>주소를 붙여넣고 Enter. 형식과 종목은 마지막에 쓴 그대로 남아 있어요.</span>
              <span className="v4-kbd-hint"> / 주소 칸으로 이동 · Esc 지우기 · Ctrl+Enter 어느 칸에서든 등록</span>
            </>
          }
        />

        <label className="v4-check v4-auto-submit" htmlFor="v4-reg-auto">
          <input id="v4-reg-auto" type="checkbox" checked={autoSubmit} onChange={(e) => toggleAutoSubmit(e.target.checked)} />
          <span>주소만 붙이면 바로 등록 (종목이 채워져 있을 때만 · 이미 등록한 영상은 제외)</span>
        </label>
      </div>
      </div>

      {bulkOpened ? (
        <div hidden={mode !== 'bulk'}>
          <BulkRegister seed={bulkSeed} defaultFormat={contentType} stockChoices={stockChoices} existingIds={existingIds} onFinished={onBulkFinished} />
        </div>
      ) : null}

      {!isAdmin && mode === 'single' ? <TodayPanel count={todayCount} target={daily.target} groups={todayGroups} showGroups /> : null}

      {firstRun ? (
        <details className="panel soft v4-firstrun" open>
          <summary>처음이신가요? 이렇게 하세요</summary>
          <ol>
            <li>유튜브에서 영상을 올린 뒤, 영상 주소를 복사합니다.</li>
            <li>위 칸에 붙여넣고(또는 &quot;붙여넣기&quot; 버튼), 다룬 종목명을 적습니다. 롱폼/숏폼도 확인하세요.</li>
            <li>Enter 를 누르면 등록 끝. 종목은 그대로 남아 있으니 바로 다음 영상 주소를 붙여넣을 수 있어요.</li>
            <li>잘못 등록했다면 등록 직후 10초 안에 &quot;되돌리기&quot;, 그 뒤에는 아래 목록에서 수정·삭제하세요.</li>
          </ol>
        </details>
      ) : null}

      <div className="panel v4-reg-list">
        <div className="panel-header">
          <div>
            <div className="panel-title">{isAdmin ? '최근 등록된 영상 (팀 전체)' : '내가 등록한 영상'}</div>
            <p className="panel-subtitle">
              최근 20개 · 제목을 누르면 유튜브가 열립니다. 종목이나 형식이 틀렸다면 <strong>수정</strong>, 잘못 올렸다면 <strong>삭제</strong>를 누르세요.
              {isAdmin ? ' (관리자는 모든 영상을 고칠 수 있어요)' : ''}
            </p>
          </div>
        </div>

        {listNotice ? (
          <div className="v4-reg-status ok v4-list-notice" role="status" aria-live="polite">
            <strong>✓ {listNotice}</strong>
          </div>
        ) : null}

        {!loaded ? (
          <ListSkeleton rows={5} />
        ) : loadError ? (
          <EmptyState
            title="목록을 불러오지 못했어요"
            action={
              <button className="button secondary" type="button" onClick={() => void loadMine()}>
                다시 불러오기
              </button>
            }
          >
            {loadError}
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 등록한 영상이 없어요"
            action={
              <button className="button" type="button" onClick={() => urlRef.current?.focus()}>
                첫 영상 등록하기
              </button>
            }
          >
            위 칸에 유튜브 주소와 종목명을 넣으면 여기에 쌓입니다.
          </EmptyState>
        ) : (
          <MyVideoList items={items} newIds={newIds} stockChoices={stockChoices} onUpdated={onUpdated} onDeleted={onDeleted} />
        )}
      </div>
    </>
  )
}
