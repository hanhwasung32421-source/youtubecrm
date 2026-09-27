'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { useV3Me } from '@/components/v3/auth-guard'
import { loginHref } from '@/components/v3/safe-next'
import { EmptyState, Section } from '@/components/v3/ui'
import { Skel, VideoListSkeleton } from '@/components/v3/skeleton'
import { Toast, useToast } from '@/components/toast'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import { isTodayKst } from '@/lib/v3/engagement'
import { DailyProgress } from './daily-progress'
import { readDraft, writeDraft } from './draft'
import { MyVideosList, type MineVideo } from './my-videos'
import { analyzePaste, findYoutube } from './paste-parse'
import { callMyVideo, lookupVideo, registerVideo, type ContentType, type VideoLookup } from './register-api'
import {
  DEFAULT_GOAL,
  STOCK_PLACEHOLDER,
  UNDO_IDLE,
  classifyRegisterFailure,
  explainInvalidUrl,
  findDuplicate,
  groupByStock,
  isImeKey,
  noUndoNote,
  parseGoal,
  planUndo,
  registeredAtLabel,
  stockNameSourceNote,
  undoReduce,
  undoSecondsLeft,
  type Failure,
  type PriorState
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

type SubmitOptions = { auto?: boolean; url?: string }

const GOAL_KEY = 'v3.register.goal'
const AUTO_KEY = 'v3.register.autoSubmit'
// 목록 수정 화면(my-videos.tsx)의 종목 칸 자동완성이 쓰는 datalist. 그 화면은 이 작업 범위 밖이라 그대로 둔다.
const STOCK_LIST_ID = 'v3-stock-suggestions'
const MAX_STOCK_SUGGESTIONS = 50
const PREVIEW_DELAY_MS = 600
const HIGHLIGHT_MS = 4500
const LIST_PAGE_SIZE = 20 // /api/videos/mine 의 한 페이지 크기
const LIST_MAX_PAGES = 4
const LOOKUP_WAIT_MS = 2500
// 여러 개 등록은 두 번째 방식이라 필요할 때(처음 열 때)만 내려받는다.
const loadBulk = () => import('./bulk-register').then((m) => m.BulkRegister)
const BulkRegister = dynamic(loadBulk, {
  ssr: false,
  loading: () => (
    <div className="v3-bulk" aria-busy="true">
      <Skel h={140} r={10} />
    </div>
  )
})

const PASTE_FALLBACK = '주소 칸을 누르고 Ctrl+V(맥은 ⌘+V)로 붙여넣어 주세요.'

function typeLabel(type: ContentType) {
  return type === 'shortform' ? '숏폼' : '롱폼'
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
  const [contentCategory, setContentCategory] = useState('')
  const [memoOpen, setMemoOpen] = useState(false)
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [autoSubmit, setAutoSubmit] = useState(false) // "주소만 붙이면 바로 등록" (기본 꺼짐)
  const [canPaste, setCanPaste] = useState(false)

  const [urlHint, setUrlHint] = useState('')
  const [urlNote, setUrlNote] = useState('') // 경고가 아닌 안내(붙여넣은 글에서 주소만 골랐어요 등)
  const [pasteHint, setPasteHint] = useState('')
  const [bulkOffer, setBulkOffer] = useState<{ text: string; count: number } | null>(null)
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
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const statusId = useRef(0)
  const touchOnly = useRef(false) // 휴대폰: 저절로 커서를 옮기면 키보드가 화면을 가리므로 옮기지 않는다.
  const modeRef = useRef(mode)
  const draftReady = useRef(false)
  const flashTimers = useRef(new Set<number>())
  const mineSeq = useRef(0) // 목록 요청이 겹쳤을 때 늦게 도착한 옛 결과가 새 결과를 덮지 않게
  const toastRef = useRef({ showSuccess, showError })

  const normalized = useMemo(() => findYoutube(youtubeUrl), [youtubeUrl])
  const validId = normalized.ok ? normalized.videoId : ''

  const todayVideos = useMemo(() => (videos || []).filter((v) => isTodayKst(v.created_at)), [videos])
  const todayCount = todayVideos.length
  const todayGroups = useMemo(() => groupByStock(todayVideos), [todayVideos])

  // 목록 수정 화면(수정 창의 종목 칸)에서 자동완성으로 보여 줄 이름들 — 실제로 등록된 종목명만 쓴다.
  const knownStocks = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const v of videos || []) {
      const name = (v.stock_name || '').trim()
      if (!name || name === STOCK_PLACEHOLDER || seen.has(name)) continue
      seen.add(name)
      out.push(name)
      if (out.length >= MAX_STOCK_SUGGESTIONS) break
    }
    return out
  }, [videos])

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

  const focusUrl = () => {
    if (!touchOnly.current) urlRef.current?.focus()
  }

  // ── 처음 열 때: 저장해 둔 목표·설정, 쓰던 내용 불러오기, (마우스·키보드 환경에서는) 주소 칸에 커서 ──
  useEffect(() => {
    touchOnly.current = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
    setGoal(parseGoal(readStored(GOAL_KEY)))
    setAutoSubmit(readStored(AUTO_KEY) === '1')
    setCanPaste(typeof navigator !== 'undefined' && !!navigator.clipboard && typeof navigator.clipboard.readText === 'function')

    // 로그인이 끊겨 다녀왔거나 새로고침했을 때, 쓰던 내용을 이어서 쓸 수 있게 한다.
    const draft = readDraft()
    if (draft) {
      setYoutubeUrl(draft.url)
      setContentCategory(draft.memo)
      if (draft.memo) setMemoOpen(true)
      if (draft.url) setUrlNote('쓰던 내용을 불러왔어요. 이어서 등록하세요.')
    }
    // 급상승 영상 등의 "후속 영상 올리기" 링크(?stock=…)로 들어오면 안내만 보여 준다.
    // (종목 칸이 없어졌으니 채울 곳은 없고, 그냥 이어서 올린다는 것만 알려 준다.
    //  예전에는 ?format=도 함께 왔지만, 형식은 이제 영상 길이로 자동 정해져서 쓰지 않는다.)
    try {
      const query = new URLSearchParams(window.location.search)
      const linkedStock = (query.get('stock') || '').trim().slice(0, 100)
      if (linkedStock) setUrlNote(`'${linkedStock}' 후속 영상이에요. 주소만 붙여넣으면 돼요.`)
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
    writeDraft({ url: youtubeUrl, memo: contentCategory })
  }, [youtubeUrl, contentCategory])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    toastRef.current = { showSuccess, showError }
  })

  // 화면을 떠날 때 남아 있는 "방금 등록" 강조 타이머를 치운다.
  useEffect(() => {
    const timers = flashTimers.current
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

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
    const seq = ++mineSeq.current
    try {
      const all: MineVideo[] = []
      for (let page = 1; page <= LIST_MAX_PAGES; page++) {
        const { ok, data } = await authedFetchJson<{ items: MineVideo[] }>(`/api/videos/mine?page=${page}`)
        if (!ok) {
          if (page === 1) {
            if (seq === mineSeq.current) setListError(true)
            return null
          }
          break
        }
        const items = data.items || []
        all.push(...items)
        // 한 페이지가 전부 오늘 등록한 것이면 다음 페이지도 오늘 것일 수 있으니 이어서 받는다.
        if (items.length < LIST_PAGE_SIZE || !isTodayKst(items[items.length - 1].created_at)) break
      }
      // 더 나중에 시작한 요청이 있으면 이 (옛) 결과로 화면을 덮지 않는다. 숫자만 돌려준다.
      if (seq === mineSeq.current) {
        setListError(false)
        setVideos(all)
      }
      return all.filter((v) => isTodayKst(v.created_at)).length
    } catch {
      if (seq === mineSeq.current) setListError(true)
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
        // 미리보기는 없어도 등록에는 영향이 없다. 실패도 기억해 두어서 "확인하는 중" 표시가 계속 남지 않게 한다.
        if (token !== previewToken.current) return
        const result: PreviewResponse = { error: 'no-preview' }
        previewCache.current.set(target.videoId, result)
        setPreview({ id: target.videoId, data: result })
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

  // 아래 함수들은 자식 화면(목록·진행 막대·여러 개 등록)에 넘겨서, 글자를 칠 때마다 그 화면들이 다시 그려지지 않게 고정해 둔다.
  const changeGoal = useCallback((next: number) => {
    setGoal(next)
    writeStored(GOAL_KEY, String(next))
  }, [])

  const changeAutoSubmit = (on: boolean) => {
    setAutoSubmit(on)
    writeStored(AUTO_KEY, on ? '1' : '0')
  }

  // 방금 등록한 줄을 잠깐 강조한다.
  const flash = useCallback((id: string | null) => {
    if (!id) return
    setHighlightIds((prev) => new Set(prev).add(id))
    const timer = window.setTimeout(() => {
      flashTimers.current.delete(timer)
      setHighlightIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, HIGHLIGHT_MS)
    flashTimers.current.add(timer)
  }, [])

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
    setUrlNote(result.extracted ? '붙여넣은 글에서 유튜브 주소만 골랐어요.' : '')

    if (autoSubmit) {
      // "주소만 붙이면 바로 등록"
      void submit({ auto: true, url: result.url })
    } else {
      // 더 적을 것이 없으니 곧바로 등록 버튼으로 넘어간다(Enter 한 번이면 등록).
      window.setTimeout(() => submitRef.current?.focus(), 0)
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
    if (isImeKey(e)) return
    if (e.key === 'Escape' && youtubeUrl && !saving) {
      // Esc: 주소 칸을 비우고 처음부터 다시
      e.preventDefault()
      setYoutubeUrl('')
      clearUrlMessages()
    }
    // 주소가 맞으면 Enter는 (칸 안의 폼 제출로) 그대로 등록으로 이어진다 — 더 적을 칸이 없다.
  }

  const onUrlBlur = () => {
    if (normalized.ok) {
      if (youtubeUrl !== normalized.url) setYoutubeUrl(normalized.url)
      setUrlHint('')
    } else if (!normalized.empty) {
      setUrlHint(explainInvalidUrl(youtubeUrl))
    }
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

  // 등록 직후 "확인 → 다음 영상" 준비: 주소·메모를 비우고 커서를 주소 칸으로.
  const readyForNext = () => {
    setYoutubeUrl('')
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
    savingRef.current = true
    noPreviewFor.current = target.videoId
    setSaving(true)
    setStatus(null)
    clearUrlMessages()
    try {
      // 이미 등록한 영상인지 확인(주소를 붙일 때 이미 요청해 둬서 보통 바로 끝난다). 확인이 안 되면 그냥 등록한다.
      const lookup = await resolveExisting(target.videoId)
      const listed = findDuplicate(videos, target.videoId)

      // 등록하기 전에 이 영상이 어땠는지. 조회로 "없다"고 확실히 확인된 경우에만 새로 만든 것으로 본다(그때만 되돌리기로 지운다).
      let prior: PriorState
      let existing: { id: string; stock_name: string | null; content_category: string | null | undefined } | null = null
      if (lookup) {
        if (!lookup.found) {
          prior = 'new'
        } else if (lookup.mine) {
          prior = 'mine'
          existing = lookup.video
        } else {
          prior = 'other'
        }
      } else if (listed) {
        prior = 'mine'
        existing = { id: listed.id, stock_name: listed.stock_name, content_category: undefined }
      } else {
        prior = 'unknown'
      }

      if (opts.auto && prior !== 'new') {
        // 바로 등록을 켜 둬도, 이미 있는(또는 있는지 모르는) 영상을 덮어쓰지는 않는다. 안내 카드가 보이므로 여기서 멈춘다.
        if (prior === 'unknown') setUrlNote('이미 등록한 영상인지 확인하지 못해서 자동 등록은 멈췄어요. 확인하고 등록을 눌러 주세요.')
        focusUrl()
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

      const result = await registerVideo({ url: target.url, contentCategory: memo })
      if (!result.ok) {
        sayFailure(result.failure)
        if (result.failure.focus === 'url') urlRef.current?.focus()
        return
      }

      invalidateLookups()

      const plan = planUndo({ hasId: !!result.id, prior, before: existing ? { stock: existing.stock_name } : null })
      if (result.id) setLastRegId(result.id)
      dispatchUndo({ type: 'registered', entry: { id: result.id || '', stock: result.stockName, plan }, now: Date.now() })

      // 종목명은 서버가 정한 값(직접 입력 없음: 제목에서 읽었거나, 전에 고쳐 둔 값을 지켰거나, 자리표시자)을 그대로 보여 준다.
      // 형식도 서버가 실제 영상 길이로 정한 값을 그대로 보여 준다(화면에서 고른 값이 아니다).
      const sourceNote = stockNameSourceNote(result.stockNameSource, result.stockName)
      const detail = sourceNote ? `${typeLabel(result.contentType)} · ${sourceNote}` : `${result.stockName} · ${typeLabel(result.contentType)}`
      const title = prior === 'mine' ? '다시 등록했어요' : prior === 'other' ? '내 영상으로 등록했어요' : '등록됐어요'
      const id = sayOk(
        title,
        detail,
        prior === 'new' ? todayCount + 1 : undefined,
        plan.kind === 'none' ? noUndoNote(result.id ? prior : 'unknown') : undefined
      )
      flash(result.id)
      readyForNext()

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

  // 방금 등록한 영상 되돌리기(새로 등록한 것은 지우고, 덮어쓴 것은 이전 종목·형식으로 돌린다)
  const onUndo = async () => {
    if (undo.phase !== 'open' && undo.phase !== 'failed') return
    const entry = undo.entry
    const now = Date.now()
    if (undoReduce(undo, { type: 'start', now }).phase !== 'working') {
      dispatchUndo({ type: 'tick', now }) // 시간이 막 지났다면 조용히 닫는다.
      return
    }
    const plan = entry.plan
    if (plan.kind === 'none') {
      dispatchUndo({ type: 'dismiss' }) // 되돌릴 것이 없는 등록에는 원래 이 버튼이 나오지 않는다
      return
    }
    dispatchUndo({ type: 'start', now })
    const statusAtStart = statusId.current

    let res
    if (plan.kind === 'delete') {
      // undo: 서버가 "방금 새로 만든 영상"일 때만 지운다(전에 있던 영상은 지우지 않는다).
      res = await callMyVideo(entry.id, 'DELETE', undefined, { undo: true })
    } else {
      // 형식은 영상 길이로 자동 정해지므로 되돌릴 때 손대지 않는다. 종목만 이전 값으로 되돌린다.
      const body: Record<string, string> = {}
      if (plan.stock) body.stock_name = plan.stock
      res = await callMyVideo(entry.id, 'PATCH', body)
    }

    if (!res.ok) {
      dispatchUndo({ type: 'failed', id: entry.id, message: res.message })
      return
    }
    dispatchUndo({ type: 'succeeded', id: entry.id, now: Date.now() })
    invalidateLookups()
    if (plan.kind === 'delete') setVideos((prev) => (prev ? prev.filter((v) => v.id !== entry.id) : prev))
    void loadMine()
    // 되돌리는 동안 다른 영상을 이미 등록했다면 그 등록 결과를 덮어쓰지 않는다.
    if (statusId.current !== statusAtStart) return
    setLastRegId(null)
    sayOk(plan.kind === 'restore' ? '이전 종목·형식으로 되돌렸어요' : '등록을 취소했어요', entry.stock, undefined, '다음 영상 주소를 붙여넣으세요.')
    focusUrl()
  }

  // 수정·삭제 결과는 다시 받아 오지 않고 화면의 목록에 바로 반영한다.
  const onPatched = useCallback((id: string, patch: { stock_name: string | null; content_type: ContentType }) => {
    setVideos((prev) => (prev ? prev.map((v) => (v.id === id ? { ...v, ...patch } : v)) : prev))
    invalidateLookups()
    dispatchUndo({ type: 'dismiss' }) // 직접 고쳤다면 이전 되돌리기는 더 이상 맞지 않는다.
  }, [invalidateLookups])
  const onDeleted = useCallback(
    (id: string) => {
      setVideos((prev) => (prev ? prev.filter((v) => v.id !== id) : prev))
      invalidateLookups()
      dispatchUndo({ type: 'dismiss' })
    },
    [invalidateLookups]
  )
  const onNotice = useCallback(
    (text: string, tone: 'success' | 'error') => (tone === 'success' ? toastRef.current.showSuccess(text) : toastRef.current.showError(text)),
    []
  )
  const onBulkDone = useCallback(
    async (ids: string[]) => {
      invalidateLookups()
      await loadMine()
      // 목록에 나타난 뒤에 강조해야 눈에 띈다.
      ids.forEach((id) => flash(id))
    },
    [invalidateLookups, loadMine, flash]
  )

  const showFallback = videos !== null && todayVideos.length === 0 && videos.length > 0
  const firstRun = videos !== null && videos.length === 0
  // 가장 최근에 등록한 줄(종목을 그 자리에서 고칠 수 있다)
  const quickFixId = todayVideos.some((v) => v.id === lastRegId) ? lastRegId : (videos && videos[0]?.id) || null

  // 화면에 보일 미리보기: 방금 받은 것, 아니면 이전에 받아 둔 같은 영상의 결과
  const shownPreview: PreviewResponse | null =
    mode === 'single' && validId ? (preview && preview.id === validId ? preview.data : previewCache.current.get(validId)) || null : null
  const previewPending = mode === 'single' && !!validId && !saving && noPreviewFor.current !== validId && shownPreview === null
  const urlMessage = urlHint || pasteHint || urlNote
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
      <PageHeader title="영상 등록" subtitle="유튜브 주소만 붙여넣으면 등록돼요. 종목명·제목·조회수는 자동으로 가져와요." />

      <datalist id={STOCK_LIST_ID}>
        {knownStocks.map((name) => (
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
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isImeKey(e)) {
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
                enterKeyHint="done"
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
                      <strong>이미 등록한 영상이에요</strong> ({registeredAtLabel(dup.at)}) · 종목{' '}
                      <span className={dup.stock === STOCK_PLACEHOLDER ? 'muted' : ''} title={dup.stock === STOCK_PLACEHOLDER ? '아직 종목을 정하지 않았어요' : undefined}>
                        {dup.stock || '없음'}
                      </span>{' '}
                      · {typeLabel(dup.type)}
                    </span>
                    <span className="v3-reg-dup-note">
                      ‘다시 등록’을 누르면 제목에서 종목을 다시 확인해요. 종목을 직접 고치려면 아래 목록에서 ‘수정’을 쓰세요.
                    </span>
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

          <p className="v3-reg-keys">Enter 등록 · Ctrl(⌘)+Enter 어느 칸에서든 등록 · / 주소 칸으로 이동 · Esc 주소 지우기</p>

          <label className="v3-reg-toggle">
            <input type="checkbox" checked={autoSubmit} onChange={(e) => changeAutoSubmit(e.target.checked)} />
            <span>
              주소만 붙이면 바로 등록
              <span className="v3-reg-toggle-help"> — 이미 등록한 영상이면 등록하지 않고 알려 드려요.</span>
            </span>
          </label>
        </form>

        <div className="v3-reg-modelink">
          <button
            type="button"
            className="v3-text-button"
            onClick={() => switchMode('bulk')}
            onPointerEnter={() => void loadBulk()}
            onFocus={() => void loadBulk()}
          >
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
            touchOnly={touchOnly}
            todayIds={todayIds}
            onBatchDone={onBulkDone}
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
              <span>2. Enter 키(또는 ‘등록’ 버튼)로 등록 — 그게 다예요</span>
              <span>3. 종목명은 제목에서 자동으로 채워져요. 못 찾으면 아래 목록에서 나중에 고칠 수 있어요</span>
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
