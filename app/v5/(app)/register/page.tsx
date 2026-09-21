'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { BulkRegister } from '@/components/v5/bulk-register'
import { MyVideosTable, type MineVideo } from '@/components/v5/my-videos-table'
import {
  CONTENT_TYPE_LABEL,
  DAILY_GOAL,
  extractVideoId,
  friendlyError,
  isShortsUrl,
  isYoutubeUrl,
  normalizeUrl,
  registerVideo,
  type ContentType
} from '@/components/v5/register-utils'
import { Badge, EmptyState } from '@/components/v5/widget'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'

type PlaybookOption = { id: string; title: string; usage_count: number }

type Confirmation =
  | { kind: 'ok'; id: string; stock: string; type: ContentType; title: string | null; refreshed: boolean; nth: number | null }
  | { kind: 'error'; message: string }

const LS_TYPE = 'v5.register.contentType'
const LS_STOCKS = 'v5.register.recentStocks'
const MAX_RECENT_STOCKS = 8

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

// ---- 화면 ----------------------------------------------------------------

export default function RegisterPage() {
  const me = useV5Me()
  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)

  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [bulkBusy, setBulkBusy] = useState(false)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [autoTypeNote, setAutoTypeNote] = useState(false)
  const [stockName, setStockName] = useState('')
  const [recentStocks, setRecentStocks] = useState<string[]>([])
  const [contentCategory, setContentCategory] = useState('')
  const [playbookOptions, setPlaybookOptions] = useState<PlaybookOption[]>([])
  const [usedPlaybookId, setUsedPlaybookId] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const [items, setItems] = useState<MineVideo[]>([])
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [listError, setListError] = useState(false)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [teamToday, setTeamToday] = useState<number | null>(null)

  const pageRef = useRef(1)
  const refreshTimer = useRef<number | null>(null)

  const isAdmin = Boolean(me?.isAdmin)

  // 마지막으로 쓴 형식과 최근 종목을 기억한다(저장소를 못 쓰면 조용히 건너뜀).
  useEffect(() => {
    const savedType = readStorage(LS_TYPE)
    if (savedType === 'longform' || savedType === 'shortform') setContentType(savedType)
    try {
      const parsed = JSON.parse(readStorage(LS_STOCKS) || '[]')
      if (Array.isArray(parsed)) setRecentStocks(parsed.filter((s) => typeof s === 'string').slice(0, MAX_RECENT_STOCKS))
    } catch {}
    urlRef.current?.focus()
  }, [])

  useEffect(() => {
    pageRef.current = page
  }, [page])

  useEffect(
    () => () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    },
    []
  )

  const loadMine = useCallback(async (targetPage: number) => {
    type Res = { items: MineVideo[]; pagination: { page: number; pageSize: number; totalCount: number } }
    try {
      const res = await authedFetchJson<Res>(`/api/v5/my-videos?page=${targetPage}`)
      if (!res.ok) {
        setListError(true)
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
      setListError(true)
      setLoadedOnce(true)
      return null
    }
  }, [])

  // "오늘 N번째"의 기준 숫자: 서버가 한국 시간 기준으로 센 값.
  const refreshToday = useCallback(async (): Promise<number | null> => {
    try {
      const res = await authedFetchJson<{ count: number; teamCount?: number }>('/api/v5/my-today')
      if (!res.ok) return null
      setTodayCount(res.data.count || 0)
      setTeamToday(typeof res.data.teamCount === 'number' ? res.data.teamCount : null)
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
    const run = async () => {
      const res = await authedFetchJson<{ items: PlaybookOption[] }>('/api/v5/playbook')
      if (res.ok) setPlaybookOptions((res.data.items || []).slice(0, 20))
    }
    void run()
  }, [])

  const highlight = useCallback((id: string) => {
    setHighlightIds((prev) => new Set(prev).add(id))
    window.setTimeout(() => {
      setHighlightIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 3000)
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

  // ---- 입력 검사(붉은 벽 대신 입력칸 아래 한 줄 힌트) ----
  const cleanUrl = normalizeUrl(youtubeUrl)
  const urlProblem =
    !cleanUrl ? (touched ? '유튜브 주소를 붙여 넣어 주세요.' : '') : !isYoutubeUrl(cleanUrl) || !extractVideoId(cleanUrl) ? '유효하지 않은 주소입니다. 유튜브 영상 주소가 맞는지 확인해 주세요.' : ''
  const videoId = cleanUrl ? extractVideoId(cleanUrl) : null
  const alreadyRegistered = Boolean(videoId && registeredIds.has(videoId))
  const stockProblem = touched && !stockName.trim() ? '종목명을 적어 주세요.' : ''

  const chooseType = (t: ContentType) => {
    setContentType(t)
    setAutoTypeNote(false)
    writeStorage(LS_TYPE, t)
  }

  const rememberStocks = (stocks: string[]) => {
    const fresh = Array.from(new Set(stocks.map((s) => s.trim()).filter(Boolean))).reverse()
    if (fresh.length === 0) return
    const next = [...fresh, ...recentStocks.filter((s) => !fresh.includes(s))].slice(0, MAX_RECENT_STOCKS)
    setRecentStocks(next)
    writeStorage(LS_STOCKS, JSON.stringify(next))
  }

  const pickChip = (stock: string) => {
    setStockName(stock)
    if (cleanUrl && !urlProblem) submitRef.current?.focus()
    else urlRef.current?.focus()
  }

  const onSubmit = async () => {
    if (saving) return
    setTouched(true)
    setConfirmation(null)
    if (!cleanUrl || urlProblem || !videoId) {
      urlRef.current?.focus()
      return
    }
    if (!stockName.trim()) {
      stockRef.current?.focus()
      return
    }

    const stock = stockName.trim()
    const type = contentType
    const refreshed = alreadyRegistered
    setSaving(true)
    try {
      const res = await registerVideo({ videoId, contentType: type, stockName: stock, contentCategory: contentCategory.trim() })
      if (!res.ok) {
        setConfirmation({ kind: 'error', message: res.message })
        return
      }

      if (usedPlaybookId) {
        // 성공 공식 사용 횟수 기록은 실패해도 등록 결과에 영향을 주지 않는다.
        void authedPostJson(`/api/v5/playbook/${usedPlaybookId}/use`, {})
      }

      rememberStocks([stock])
      setConfirmation({ kind: 'ok', id: res.id, stock, type, title: res.title, refreshed, nth: null })

      // 다음 영상을 바로 붙여 넣을 수 있게 입력을 비우고 URL 칸으로 돌아간다.
      setYoutubeUrl('')
      setStockName('')
      setContentCategory('')
      setUsedPlaybookId('')
      setAutoTypeNote(false)
      setTouched(false)
      urlRef.current?.focus()

      // 목록과 오늘 숫자는 뒤에서 갱신하고, 새 줄만 잠깐 강조한다.
      void (async () => {
        const countPromise = refreshToday()
        if (pageRef.current !== 1) setPage(1)
        else await loadMine(1)
        const count = await countPromise
        setConfirmation((prev) => (prev && prev.kind === 'ok' && prev.id === res.id ? { ...prev, nth: count } : prev))
        highlight(res.id)
      })()
    } finally {
      setSaving(false)
    }
  }

  const totalPages = Math.max(Math.ceil(totalCount / 20), 1)

  const goalPct = Math.min(Math.round((todayCount / DAILY_GOAL) * 100), 100)

  return (
    <>
      <PageHeader
        title="영상 등록"
        subtitle="유튜브 주소를 붙여 넣고 종목을 적은 뒤 Enter. 제목·조회수·좋아요·댓글은 자동으로 가져옵니다."
        actions={
          isAdmin ? (
            <Badge tone="indigo">
              오늘 전체 등록 {(teamToday ?? todayCount).toLocaleString('ko-KR')}개
              {teamToday !== null && todayCount > 0 ? ` (내가 ${todayCount.toLocaleString('ko-KR')}개)` : ''}
            </Badge>
          ) : (
            <div className="v5-goal" role="group" aria-label="오늘 등록 진행">
              <div className="v5-goal-top">
                <strong>오늘 {todayCount.toLocaleString('ko-KR')}개 등록</strong>
                <span>{todayCount >= DAILY_GOAL ? `목표 ${DAILY_GOAL}개 달성` : `오늘 목표 ${DAILY_GOAL}개 · ${DAILY_GOAL - todayCount}개 남음`}</span>
              </div>
              <div className="v5-goal-track" aria-hidden="true">
                <div className={`v5-goal-bar ${todayCount >= DAILY_GOAL ? 'full' : ''}`} style={{ width: `${goalPct}%` }} />
              </div>
            </div>
          )
        }
      />

      <div className="panel v5-quick">
        <div className="v5-mode-row">
          <div className="v5-segment" role="group" aria-label="등록 방식">
            <button type="button" className={mode === 'single' ? 'active' : ''} aria-pressed={mode === 'single'} disabled={bulkBusy} onClick={() => setMode('single')}>
              한 개씩 등록
            </button>
            <button type="button" className={mode === 'bulk' ? 'active' : ''} aria-pressed={mode === 'bulk'} disabled={bulkBusy || saving} onClick={() => setMode('bulk')}>
              여러 개 붙여넣기
            </button>
          </div>
        </div>

        {mode === 'bulk' ? (
          <BulkRegister
            recentStocks={recentStocks}
            registeredIds={registeredIds}
            onBusyChange={setBulkBusy}
            onStocksUsed={rememberStocks}
            onRegistered={(id) => {
              highlight(id)
              scheduleRefresh()
            }}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void onSubmit()
            }}
          >
            <div className="field">
              <label className="label" htmlFor="v5-reg-url">
                유튜브 주소
              </label>
              <input
                id="v5-reg-url"
                ref={urlRef}
                className="input"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                placeholder="여기에 유튜브 영상 주소를 붙여 넣으세요"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                onPaste={(e) => {
                  // 붙여넣기: 앞뒤 공백을 지우고, 종목이 비어 있으면 곧바로 종목 칸으로 넘어간다.
                  const text = e.clipboardData.getData('text')
                  const cleaned = normalizeUrl(text)
                  if (!cleaned) return
                  e.preventDefault()
                  setYoutubeUrl(cleaned)
                  if (isShortsUrl(cleaned) && contentType !== 'shortform') {
                    setContentType('shortform')
                    setAutoTypeNote(true)
                  }
                  if (!stockName.trim() && isYoutubeUrl(cleaned)) window.setTimeout(() => stockRef.current?.focus(), 0)
                }}
                onBlur={() => {
                  if (youtubeUrl && youtubeUrl !== cleanUrl) setYoutubeUrl(cleanUrl)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    if (!stockName.trim() && cleanUrl && !urlProblem) stockRef.current?.focus()
                    else void onSubmit()
                  }
                }}
                aria-invalid={Boolean(urlProblem)}
              />
              <div className={`v5-hint ${urlProblem || alreadyRegistered ? 'warn' : ''}`}>
                {urlProblem ||
                  (alreadyRegistered
                    ? '이미 등록된 영상입니다. 다시 등록하면 정보가 새로 갱신됩니다.'
                    : autoTypeNote
                      ? '숏폼 주소라서 형식을 숏폼으로 맞췄습니다.'
                      : '')}
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
                  disabled={saving}
                  placeholder="예: 삼성전자"
                  value={stockName}
                  onChange={(e) => setStockName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void onSubmit()
                    }
                  }}
                  aria-invalid={Boolean(stockProblem)}
                />
                <datalist id="v5-recent-stocks">
                  {recentStocks.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <span className="label">형식</span>
                <div className="v5-type-toggle" role="group" aria-label="영상 형식">
                  {(['longform', 'shortform'] as const).map((t) => (
                    <button key={t} type="button" className={contentType === t ? 'active' : ''} aria-pressed={contentType === t} disabled={saving} onClick={() => chooseType(t)}>
                      {CONTENT_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              </div>
              <button ref={submitRef} className="button" type="submit" disabled={saving}>
                {saving ? '등록 중...' : '등록'}
              </button>
            </div>
            <div className={`v5-hint ${stockProblem ? 'warn' : ''}`}>{stockProblem}</div>

            {recentStocks.length > 0 ? (
              <div className="v5-chip-row" aria-label="최근 종목">
                <span className="v5-chip-label">최근 종목</span>
                {recentStocks.map((s) => (
                  <button key={s} type="button" className={`v5-chip ${stockName.trim() === s ? 'on' : ''}`} disabled={saving} onClick={() => pickChip(s)}>
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
                    value={contentCategory}
                    disabled={saving}
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

            {confirmation ? (
              confirmation.kind === 'ok' ? (
                <div className="v5-confirm" role="status">
                  <span>
                    {confirmation.refreshed
                      ? '✓ 다시 등록됨 · 정보를 새로 갱신했습니다'
                      : `✓ 등록됨 · 오늘 ${(confirmation.nth ?? todayCount + 1).toLocaleString('ko-KR')}번째`}
                  </span>
                  <span className="v5-confirm-detail">
                    {confirmation.stock} · {CONTENT_TYPE_LABEL[confirmation.type]}
                    {confirmation.title ? ` · ${confirmation.title}` : ''}
                  </span>
                </div>
              ) : (
                <div className="v5-confirm error" role="alert">
                  <span>등록하지 못했습니다</span>
                  <span className="v5-confirm-detail" style={{ whiteSpace: 'normal' }}>
                    {confirmation.message}
                  </span>
                </div>
              )
            ) : null}
          </form>
        )}
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
          <div className="small muted">목록을 불러오는 중...</div>
        ) : listError ? (
          <EmptyState
            title="목록을 불러오지 못했습니다"
            action={
              <button className="button secondary sm" type="button" onClick={() => void loadMine(page)}>
                다시 불러오기
              </button>
            }
          >
            인터넷 연결을 확인한 뒤 다시 시도해 주세요.
            <br />
            위 입력칸으로 등록은 계속할 수 있습니다.
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 등록한 영상이 없습니다"
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
            위 칸에 유튜브 주소를 붙여 넣고 종목을 적은 뒤 Enter를 누르세요.
            <br />
            등록한 영상은 여기에 쌓이고, 조회수 같은 숫자는 자동으로 채워집니다.
          </EmptyState>
        ) : (
          <MyVideosTable
            items={items}
            isAdmin={isAdmin}
            highlightIds={highlightIds}
            onUpdated={(id, patch) => {
              setItems((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)))
              highlight(id)
            }}
            onDeleted={(id) => {
              setItems((prev) => prev.filter((v) => v.id !== id))
              setTotalCount((n) => Math.max(n - 1, 0))
              void (async () => {
                const rows = await loadMine(pageRef.current)
                if (rows && rows.length === 0 && pageRef.current > 1) setPage(pageRef.current - 1)
                void refreshToday()
              })()
            }}
          />
        )}
      </div>
    </>
  )
}
