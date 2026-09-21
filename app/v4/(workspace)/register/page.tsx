'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { BulkRegister } from '@/components/v4/bulk-register'
import { useV4Me } from '@/components/v4/me-context'
import { MyVideoList, type MyVideo } from '@/components/v4/my-video-list'
import { DAILY_TARGET, fetchTodayCount, registerVideo, type ContentType } from '@/components/v4/register-api'
import { EmptyState, FormatToggle } from '@/components/v4/ui'
import { ListSkeleton } from '@/components/v4/skeleton'
import { analyzePaste, looksLikeStockName, toBulkText } from '@/components/v4/paste-detect'
import {
  extractVideoId,
  isShortsUrl,
  isYoutubeUrl,
  normalizeStockName,
  normalizeYoutubeUrl,
  readJson,
  readStorage,
  writeStorage
} from '@/components/v4/register-utils'
import { authedFetchJson } from '@/lib/session/authed-fetch'

type Status = { tone: 'ok' | 'error'; text: string; detail?: string } | null
type Mode = 'single' | 'bulk'

const FORMAT_KEY = 'v4.register.format'
const STOCKS_KEY = 'v4.register.recentStocks'
const MAX_CHIPS = 8
const NEW_HIGHLIGHT_MS = 5000

export default function VideoRegisterPage() {
  const { isAdmin } = useV4Me()
  const urlRef = useRef<HTMLInputElement>(null)
  const stockRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)
  const highlightTimer = useRef<number | null>(null)

  const [mode, setMode] = useState<Mode>('single')
  const [bulkOpened, setBulkOpened] = useState(false)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [stockName, setStockName] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showHints, setShowHints] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [autoShortNote, setAutoShortNote] = useState(false)
  // 붙여넣기 안내: 제목이 같이 붙었을 때 / 주소가 여러 개일 때
  const [pasteNote, setPasteNote] = useState('')
  const [stockSuggest, setStockSuggest] = useState('')
  const [bulkSuggest, setBulkSuggest] = useState<{ text: string; count: number } | null>(null)
  const [bulkSeed, setBulkSeed] = useState<{ id: number; text: string } | null>(null)

  const [items, setItems] = useState<MyVideo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [listNotice, setListNotice] = useState('')

  const [recentStocks, setRecentStocks] = useState<string[]>([])
  const [todayCount, setTodayCount] = useState<number | null>(null)

  const loadMine = async () => {
    try {
      const { ok, data } = await authedFetchJson<{ items?: MyVideo[]; error?: string }>('/api/videos/mine?page=1')
      setLoaded(true)
      if (!ok) {
        setLoadError('등록한 영상 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }
      setLoadError('')
      setItems(data.items || [])
    } catch {
      setLoaded(true)
      setLoadError('인터넷 연결을 확인해 주세요.')
    }
  }

  const refreshToday = async () => {
    const count = await fetchTodayCount()
    if (count !== null) setTodayCount(count)
    return count
  }

  const highlight = (ids: string[]) => {
    if (ids.length === 0) return
    setNewIds(new Set(ids))
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setNewIds(new Set()), NEW_HIGHLIGHT_MS)
  }

  // 처음 열 때: 마지막에 쓴 형식·최근 종목 복원, 주소 칸에 커서, 목록·오늘 등록 수 불러오기
  useEffect(() => {
    const savedFormat = readStorage(FORMAT_KEY)
    if (savedFormat === 'longform' || savedFormat === 'shortform') setContentType(savedFormat)
    const savedStocks = readJson<unknown>(STOCKS_KEY, [])
    if (Array.isArray(savedStocks)) setRecentStocks(savedStocks.filter((s): s is string => typeof s === 'string').slice(0, MAX_CHIPS))
    urlRef.current?.focus()
    void loadMine()
    void refreshToday()
    return () => {
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const existingIds = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      const id = item.youtube_url ? extractVideoId(item.youtube_url) : ''
      if (id) set.add(id)
    }
    return set
  }, [items])

  const normalizedUrl = normalizeYoutubeUrl(youtubeUrl)
  const urlInvalid = youtubeUrl.trim() !== '' && !isYoutubeUrl(normalizedUrl)
  const duplicate = useMemo(() => {
    if (!normalizedUrl || !isYoutubeUrl(normalizedUrl)) return null
    const id = extractVideoId(normalizedUrl)
    return id && existingIds.has(id) ? id : null
  }, [normalizedUrl, existingIds])

  const changeFormat = (next: ContentType) => {
    setContentType(next)
    setAutoShortNote(false)
    writeStorage(FORMAT_KEY, next)
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

  const applyUrl = (raw: string) => {
    const cleaned = normalizeYoutubeUrl(raw)
    setYoutubeUrl(cleaned || raw.trim())
    setStatus(null)
    // 쇼츠 주소면 형식을 알아서 숏폼으로
    if (cleaned && isShortsUrl(cleaned) && contentType !== 'shortform') {
      setContentType('shortform')
      writeStorage(FORMAT_KEY, 'shortform')
      setAutoShortNote(true)
    } else {
      setAutoShortNote(false)
    }
    return cleaned
  }

  const onPasteUrl = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text) return
    const info = analyzePaste(text)
    setPasteNote('')
    setStockSuggest('')

    // 주소가 둘 이상 = 여러 개를 한꺼번에 붙여넣은 것 → "여러 개 붙여넣기"를 권하고, 클릭 한 번에 글을 옮겨 준다.
    if (info.kind === 'multi') {
      e.preventDefault()
      setStatus(null)
      setBulkSuggest({ text: toBulkText(text), count: info.urls.length })
      return
    }
    setBulkSuggest(null)
    // 주소가 없는 글은 그대로 두고(직접 고쳐 쓰는 중일 수 있어요), 나머지는 주소만 뽑아 넣는다.
    if (info.kind === 'none') return

    e.preventDefault()
    const cleaned = applyUrl(text)
    if (info.kind === 'single-with-text') {
      setPasteNote('제목은 빼고 주소만 넣었어요. 제목은 유튜브에서 자동으로 채워져요.')
      if (!stockName.trim() && looksLikeStockName(info.leftover)) setStockSuggest(info.leftover)
    }
    // 주소가 제대로 들어왔으면 바로 종목 칸으로 → 붙여넣기 · 종목 입력 · Enter 만으로 끝
    if (cleaned && isYoutubeUrl(cleaned)) {
      setShowHints(false)
      window.setTimeout(() => stockRef.current?.focus(), 0)
    }
  }

  const rememberStocks = (stocks: string[]) => {
    const next = [...stocks.map((s) => normalizeStockName(s)).filter(Boolean), ...recentStocks]
    const unique = Array.from(new Set(next)).slice(0, MAX_CHIPS)
    setRecentStocks(unique)
    writeStorage(STOCKS_KEY, JSON.stringify(unique))
  }

  const submit = async () => {
    if (savingRef.current) return
    const url = normalizeYoutubeUrl(youtubeUrl)
    const stock = normalizeStockName(stockName)

    if (!url || !isYoutubeUrl(url)) {
      setShowHints(true)
      urlRef.current?.focus()
      return
    }
    if (!stock) {
      setShowHints(true)
      stockRef.current?.focus()
      return
    }

    savingRef.current = true
    setSubmitting(true)
    setStatus(null)
    setListNotice('')
    try {
      const result = await registerVideo({ youtubeUrl: url, contentType, stockName: stock, contentCategory: memo.trim() || null })
      if (!result.ok) {
        setStatus({ tone: 'error', text: result.message, detail: '입력한 내용은 그대로 남아 있어요' })
        return
      }

      // "오늘 N번째"는 서버가 센 값을 쓴다 (다른 기기·화면에서 등록한 것도 포함)
      const fresh = await refreshToday()
      const ordinal = fresh ?? (todayCount ?? 0) + 1
      if (fresh === null) setTodayCount(ordinal)
      rememberStocks([stock])
      setStatus({ tone: 'ok', text: `등록됨 · 오늘 ${ordinal}번째`, detail: `${stock}${result.video?.title ? ` · ${result.video.title}` : ''}` })
      highlight(result.video?.id ? [result.video.id] : [])
      setYoutubeUrl('')
      setStockName('')
      setMemo('')
      setShowHints(false)
      setAutoShortNote(false)
      setPasteNote('')
      setStockSuggest('')
      setBulkSuggest(null)
      urlRef.current?.focus()
      void loadMine()
    } finally {
      savingRef.current = false
      setSubmitting(false)
    }
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
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const onDeleted = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
    setListNotice('영상을 지웠어요. 오늘 등록 수도 다시 셌어요.')
    void refreshToday()
    void loadMine()
  }

  const firstRun = loaded && !loadError && items.length === 0
  const progress = todayCount === null ? 0 : Math.min(1, todayCount / DAILY_TARGET)
  const reached = todayCount !== null && todayCount >= DAILY_TARGET

  return (
    <>
      <PageHeader
        title="영상 등록"
        subtitle="유튜브 주소를 붙여넣고 종목명만 적으면 끝입니다. 제목·조회수·좋아요·댓글은 유튜브에서 자동으로 채워져요."
        actions={
          <div className="v4-today-chip" title={`오늘(한국 시간) 내가 등록한 영상 수 · 하루 목표 ${DAILY_TARGET}개는 참고용이에요`}>
            <div>
              오늘 <strong>{todayCount === null ? '–' : todayCount}</strong>개 등록 <span className="v4-today-goal">· 오늘 목표 {DAILY_TARGET}개</span>
            </div>
            <div className="v4-today-bar" role="progressbar" aria-valuemin={0} aria-valuemax={DAILY_TARGET} aria-valuenow={todayCount ?? 0} aria-label="오늘 등록 진행">
              <span className={reached ? 'done' : ''} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        }
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
        <form
          className="panel v4-reg-form"
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
              readOnly={submitting}
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
                  setShowHints(true)
                }
              }}
              onKeyDown={(e) => {
                // Esc: 주소 칸을 비우고 안내도 지운다 (잘못 붙여넣었을 때 빨리 다시 시작)
                if (e.key === 'Escape' && (youtubeUrl || bulkSuggest || pasteNote)) {
                  e.preventDefault()
                  setYoutubeUrl('')
                  setStatus(null)
                  setShowHints(false)
                  setAutoShortNote(false)
                  setPasteNote('')
                  setStockSuggest('')
                  setBulkSuggest(null)
                  return
                }
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !stockName.trim()) {
                  // 종목을 아직 안 적었다면 등록 대신 종목 칸으로 이동
                  e.preventDefault()
                  stockRef.current?.focus()
                }
              }}
            />
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
            <div className="v4-hint-slot" id="v4-reg-url-hint">
              {showHints && !youtubeUrl.trim() ? (
                <span className="v4-hint warn">유튜브 주소를 붙여넣어 주세요.</span>
              ) : showHints && urlInvalid ? (
                <span className="v4-hint warn">유효하지 않은 주소예요. youtube.com 또는 youtu.be 로 시작하는 영상 주소를 넣어 주세요.</span>
              ) : duplicate ? (
                <span className="v4-hint warn">이미 등록된 영상이에요. 다시 등록하면 종목·형식이 지금 입력한 값으로 바뀝니다.</span>
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
                readOnly={submitting}
                aria-invalid={showHints && !stockName.trim() ? true : undefined}
                onChange={(e) => {
                  setStockName(e.target.value)
                  setStatus(null)
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
              {submitting ? '등록 중…' : '등록'}
            </button>
          </div>

          {showHints && !stockName.trim() ? (
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
            <input id="v4-reg-memo" className="input" autoComplete="off" value={memo} readOnly={submitting} placeholder="예: 실적 발표 · 급등 이슈" onChange={(e) => setMemo(e.target.value)} />
          </details>

          <div className={`v4-reg-status ${status ? status.tone : ''}`} aria-live="polite" aria-atomic="true">
            {status ? (
              <span role={status.tone === 'error' ? 'alert' : undefined}>
                <strong>
                  {status.tone === 'ok' ? '✓ ' : ''}
                  {status.text}
                </strong>
                {status.detail ? <span className="v4-reg-status-detail"> — {status.detail}</span> : null}
              </span>
            ) : (
              <span className="muted">주소 붙여넣기 → 종목 입력 → Enter. 형식은 마지막에 고른 것으로 기억돼요. (Esc: 주소 지우기)</span>
            )}
          </div>
        </form>
      </div>

      {bulkOpened ? (
        <div hidden={mode !== 'bulk'}>
          <BulkRegister seed={bulkSeed} defaultFormat={contentType} stockChoices={stockChoices} existingIds={existingIds} onFinished={onBulkFinished} />
        </div>
      ) : null}

      {firstRun ? (
        <details className="panel soft v4-firstrun" open>
          <summary>처음이신가요? 이렇게 하세요</summary>
          <ol>
            <li>유튜브에서 영상을 올린 뒤, 영상 주소를 복사합니다.</li>
            <li>위 칸에 붙여넣고, 다룬 종목명을 적습니다. 롱폼/숏폼도 확인하세요.</li>
            <li>Enter 를 누르면 등록 끝. 바로 다음 영상 주소를 붙여넣을 수 있어요.</li>
            <li>여러 개를 한꺼번에 올릴 땐 "여러 개 붙여넣기"를, 잘못 등록했다면 아래 목록에서 수정·삭제하세요.</li>
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
