'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader, useV5Me } from '@/components/v5/app-shell'
import { Badge, EmptyState } from '@/components/v5/widget'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { toYmd } from '@/lib/v5/format'

type ContentType = 'longform' | 'shortform'

type MineVideo = {
  id: string
  title: string | null
  stock_name: string
  content_type: ContentType
  published_at: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  youtube_url: string
  created_at: string
}

type PlaybookOption = { id: string; title: string; usage_count: number }

type Confirmation =
  | { kind: 'ok'; stock: string; type: ContentType; title: string | null }
  | { kind: 'error'; message: string }

const CONTENT_TYPE_LABEL: Record<ContentType, string> = { longform: '롱폼', shortform: '숏폼' }
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

// 붙여넣은 글에서 유튜브 주소만 뽑아 정리한다. 앞뒤 공백/줄바꿈 제거, https:// 없으면 붙여 준다.
function normalizeUrl(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  const match = text.match(/(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+/i)
  const picked = match ? match[0] : text.split(/\s+/)[0]
  return /^https?:\/\//i.test(picked) ? picked : `https://${picked}`
}

function extractVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/)
  return m ? m[1] : null
}

function isYoutubeUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|music)\./, '')
    return host === 'youtube.com' || host === 'youtu.be'
  } catch {
    return false
  }
}

function formatWhen(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return toYmd(d) === toYmd(new Date()) ? `오늘 ${hm}` : `${toYmd(d).slice(5)} ${hm}`
}

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString('ko-KR')

// ---- 화면 ----------------------------------------------------------------

export default function RegisterPage() {
  const me = useV5Me()
  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
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
  const [justJoinedId, setJustJoinedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)

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

  // 목록 + "오늘 등록한 수". 오늘 등록분이 한 페이지를 넘으면 다음 페이지까지 세어 본다.
  const loadMine = useCallback(async (targetPage: number) => {
    type Res = { items: MineVideo[]; pagination: { page: number; pageSize: number; totalCount: number } }
    const res = await authedFetchJson<Res>(`/api/videos/mine?page=${targetPage}`)
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
  }, [])

  const countToday = useCallback(async () => {
    const today = toYmd(new Date())
    let count = 0
    for (let p = 1; p <= 5; p += 1) {
      const res = await authedFetchJson<{ items: MineVideo[] }>(`/api/videos/mine?page=${p}`)
      if (!res.ok) break
      const rows = res.data.items || []
      const todays = rows.filter((v) => toYmd(new Date(v.created_at)) === today).length
      count += todays
      if (todays < rows.length || rows.length === 0) break
    }
    setTodayCount(count)
  }, [])

  useEffect(() => {
    void loadMine(page)
  }, [page, loadMine])

  useEffect(() => {
    void countToday()
  }, [countToday])

  useEffect(() => {
    const run = async () => {
      const res = await authedFetchJson<{ items: PlaybookOption[] }>('/api/v5/playbook')
      if (res.ok) setPlaybookOptions((res.data.items || []).slice(0, 20))
    }
    void run()
  }, [])

  // ---- 입력 검사(붉은 벽 대신 입력칸 아래 한 줄 힌트) ----
  const cleanUrl = normalizeUrl(youtubeUrl)
  const urlProblem =
    !cleanUrl ? (touched ? '유튜브 주소를 붙여 넣어 주세요.' : '') : !isYoutubeUrl(cleanUrl) || !extractVideoId(cleanUrl) ? '유튜브 영상 주소가 맞는지 확인해 주세요.' : ''
  const videoId = cleanUrl ? extractVideoId(cleanUrl) : null
  const alreadyRegistered = Boolean(videoId && items.some((v) => v.youtube_url.includes(videoId)))
  const stockProblem = touched && !stockName.trim() ? '종목명을 적어 주세요.' : ''

  const chooseType = (t: ContentType) => {
    setContentType(t)
    writeStorage(LS_TYPE, t)
  }

  const rememberStock = (stock: string) => {
    const next = [stock, ...recentStocks.filter((s) => s !== stock)].slice(0, MAX_RECENT_STOCKS)
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
    if (!cleanUrl || urlProblem) {
      urlRef.current?.focus()
      return
    }
    if (!stockName.trim()) {
      stockRef.current?.focus()
      return
    }

    const stock = stockName.trim()
    const type = contentType
    setSaving(true)
    try {
      const res = await authedPostJson<{ ok: boolean; video: { id: string; title: string | null }; error?: string }>('/api/videos/create', {
        youtubeUrl: cleanUrl,
        contentType: type,
        stockName: stock,
        contentCategory: contentCategory.trim() || undefined
      })
      if (!res.ok) {
        setConfirmation({ kind: 'error', message: (res.data as any)?.error || '영상 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.' })
        return
      }

      if (usedPlaybookId) {
        // 성공 공식 사용 횟수 기록은 실패해도 등록 결과에 영향을 주지 않는다.
        void authedPostJson(`/api/v5/playbook/${usedPlaybookId}/use`, {})
      }

      const newId = res.data.video.id
      rememberStock(stock)
      setTodayCount((n) => n + 1)
      setConfirmation({ kind: 'ok', stock, type, title: res.data.video.title || null })

      // 다음 영상을 바로 붙여 넣을 수 있게 입력을 비우고 URL 칸으로 돌아간다.
      setYoutubeUrl('')
      setStockName('')
      setContentCategory('')
      setUsedPlaybookId('')
      setTouched(false)
      urlRef.current?.focus()

      // 목록은 뒤에서 갱신하고, 새 줄만 잠깐 강조한다.
      void (async () => {
        if (page !== 1) setPage(1)
        else await loadMine(1)
        void countToday()
        setJustJoinedId(newId)
        window.setTimeout(() => setJustJoinedId(null), 2800)
      })()
    } catch (e: any) {
      setConfirmation({ kind: 'error', message: e?.message || '영상 등록 중 오류가 발생했습니다.' })
    } finally {
      setSaving(false)
    }
  }

  const totalPages = Math.max(Math.ceil(totalCount / 20), 1)

  return (
    <>
      <PageHeader
        title="영상 등록"
        subtitle="유튜브 주소를 붙여 넣고 종목을 적은 뒤 Enter. 제목·조회수·좋아요·댓글은 자동으로 가져옵니다."
        actions={
          <Badge tone="indigo">
            {isAdmin ? '오늘 전체 등록' : '오늘 등록'} {todayCount.toLocaleString('ko-KR')}개
          </Badge>
        }
      />

      <form
        className="panel v5-quick"
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
            {urlProblem || (alreadyRegistered ? '이미 등록된 영상입니다. 다시 등록하면 정보가 새로 갱신됩니다.' : '')}
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
                <button key={t} type="button" className={contentType === t ? 'active' : ''} aria-pressed={contentType === t} onClick={() => chooseType(t)}>
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
              <button key={s} type="button" className={`v5-chip ${stockName.trim() === s ? 'on' : ''}`} onClick={() => pickChip(s)}>
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
                onChange={(e) => setContentCategory(e.target.value)}
                placeholder="예: 실적분석, 급등주, 리포트"
              />
            </div>
            {playbookOptions.length > 0 ? (
              <div className="field">
                <label className="label" htmlFor="v5-reg-playbook">
                  적용한 성공 공식
                </label>
                <select id="v5-reg-playbook" className="select" value={usedPlaybookId} onChange={(e) => setUsedPlaybookId(e.target.value)}>
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
              <span>✓ 등록됨 · 오늘 {todayCount.toLocaleString('ko-KR')}번째</span>
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
            네트워크 상태를 확인한 뒤 다시 시도해 주세요. 위 입력칸으로 등록은 계속할 수 있습니다.
          </EmptyState>
        ) : items.length === 0 ? (
          <EmptyState
            title="아직 등록한 영상이 없습니다"
            action={
              <button className="button sm" type="button" onClick={() => urlRef.current?.focus()}>
                첫 영상 등록하기
              </button>
            }
          >
            위 칸에 유튜브 주소를 붙여 넣고 종목을 적은 뒤 Enter를 누르세요.
            <br />
            등록한 영상은 여기에 쌓이고, 조회수 같은 숫자는 자동으로 채워집니다.
          </EmptyState>
        ) : (
          <div className="panel v5-table-wrap" style={{ padding: 0 }}>
            <table className="v5-table">
              <thead>
                <tr>
                  <th>등록 시각</th>
                  <th>종목</th>
                  <th>제목</th>
                  <th>형식</th>
                  <th className="num">조회수</th>
                  <th className="num">좋아요</th>
                  <th className="num">댓글</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id} className={v.id === justJoinedId ? 'is-new' : ''}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatWhen(v.created_at)}
                    </td>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{v.stock_name}</td>
                    <td className="v5-title-cell" title={v.title || undefined}>
                      {v.title || <span className="muted">제목 수집 전</span>}
                    </td>
                    <td>
                      <Badge tone="plain">{CONTENT_TYPE_LABEL[v.content_type] || v.content_type}</Badge>
                    </td>
                    <td className="num">{num(v.view_count)}</td>
                    <td className="num">{num(v.like_count)}</td>
                    <td className="num">{num(v.comment_count)}</td>
                    <td>
                      <a className="v5-link-cell" href={v.youtube_url} target="_blank" rel="noreferrer">
                        열기
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
