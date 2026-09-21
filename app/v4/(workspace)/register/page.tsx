'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v4/app-shell'
import { useV4Me } from '@/components/v4/me-context'
import { EmptyState, FormatPill } from '@/components/v4/ui'
import {
  extractVideoId,
  isShortsUrl,
  isTodayKst,
  isYoutubeUrl,
  normalizeStockName,
  normalizeYoutubeUrl,
  readJson,
  readStorage,
  todayKst,
  writeStorage
} from '@/components/v4/register-utils'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { fmtNumber, fmtRelative } from '@/lib/v4/format'

type ContentType = 'longform' | 'shortform'

type MyVideo = {
  id: string
  title: string | null
  stock_name: string
  content_type: ContentType
  published_at: string | null
  created_at: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  youtube_url: string | null
}

type Status = { tone: 'ok' | 'error'; text: string; detail?: string } | null

const FORMAT_KEY = 'v4.register.format'
const STOCKS_KEY = 'v4.register.recentStocks'
const COUNT_KEY = 'v4.register.todayCount'
const MAX_CHIPS = 8

export default function VideoRegisterPage() {
  const { isAdmin } = useV4Me()
  const urlRef = useRef<HTMLInputElement>(null)
  const stockRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)

  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [stockName, setStockName] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showHints, setShowHints] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [autoShortNote, setAutoShortNote] = useState(false)

  const [items, setItems] = useState<MyVideo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [justAddedId, setJustAddedId] = useState<string | null>(null)

  const [recentStocks, setRecentStocks] = useState<string[]>([])
  const [localCount, setLocalCount] = useState(0)

  const loadMine = async () => {
    const { ok, data } = await authedFetchJson<{ items?: MyVideo[]; error?: string }>('/api/videos/mine?page=1')
    setLoaded(true)
    if (!ok) {
      setLoadError(data?.error || '등록한 영상 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
      return
    }
    setLoadError('')
    setItems(data.items || [])
  }

  // 처음 열 때: 마지막에 쓴 형식·최근 종목 복원, 주소 칸에 커서, 목록 불러오기
  useEffect(() => {
    const savedFormat = readStorage(FORMAT_KEY)
    if (savedFormat === 'longform' || savedFormat === 'shortform') setContentType(savedFormat)
    const savedStocks = readJson<unknown>(STOCKS_KEY, [])
    if (Array.isArray(savedStocks)) setRecentStocks(savedStocks.filter((s): s is string => typeof s === 'string').slice(0, MAX_CHIPS))
    const savedCount = readJson<{ date?: string; count?: number }>(COUNT_KEY, {})
    if (savedCount.date === todayKst() && typeof savedCount.count === 'number') setLocalCount(savedCount.count)
    urlRef.current?.focus()
    void loadMine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const listTodayCount = useMemo(() => items.filter((item) => isTodayKst(item.created_at)).length, [items])
  // 직원: 서버 목록 기준(다른 기기에서 등록한 것도 포함). 관리자 목록은 팀 전체라서 이 화면에서 등록한 수만 센다.
  const todayCount = isAdmin ? localCount : Math.max(localCount, listTodayCount)

  const stockChoices = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const source = isAdmin ? recentStocks : [...recentStocks, ...items.map((i) => i.stock_name)]
    for (const raw of source) {
      const name = normalizeStockName(raw || '')
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out.slice(0, 20)
  }, [recentStocks, items, isAdmin])

  const normalizedUrl = normalizeYoutubeUrl(youtubeUrl)
  const urlInvalid = youtubeUrl.trim() !== '' && !isYoutubeUrl(normalizedUrl)
  const duplicate = useMemo(() => {
    if (!normalizedUrl || !isYoutubeUrl(normalizedUrl)) return null
    const id = extractVideoId(normalizedUrl)
    if (!id) return null
    return items.find((item) => item.youtube_url && extractVideoId(item.youtube_url) === id) || null
  }, [normalizedUrl, items])

  const changeFormat = (next: ContentType) => {
    setContentType(next)
    setAutoShortNote(false)
    writeStorage(FORMAT_KEY, next)
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
    e.preventDefault()
    const cleaned = applyUrl(text)
    // 주소가 제대로 들어왔으면 바로 종목 칸으로 → 붙여넣기 · 종목 입력 · Enter 만으로 끝
    if (cleaned && isYoutubeUrl(cleaned)) {
      setShowHints(false)
      window.setTimeout(() => stockRef.current?.focus(), 0)
    }
  }

  const rememberStock = (stock: string) => {
    const next = [stock, ...recentStocks.filter((s) => s !== stock)].slice(0, MAX_CHIPS)
    setRecentStocks(next)
    writeStorage(STOCKS_KEY, JSON.stringify(next))
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
    try {
      const { ok, data } = await authedPostJson<{ error?: string; video?: { id?: string; title?: string | null } }>('/api/videos/create', {
        youtubeUrl: url,
        contentType,
        stockName: stock,
        contentCategory: memo.trim() || null
      })
      if (!ok) {
        setStatus({ tone: 'error', text: data?.error || '등록하지 못했어요. 주소를 확인하고 다시 눌러 주세요.', detail: '입력한 내용은 그대로 남아 있어요' })
        return
      }

      const ordinal = todayCount + 1
      setLocalCount(ordinal)
      writeStorage(COUNT_KEY, JSON.stringify({ date: todayKst(), count: ordinal }))
      rememberStock(stock)
      setStatus({ tone: 'ok', text: `등록됨 · 오늘 ${ordinal}번째`, detail: `${stock}${data?.video?.title ? ` · ${data.video.title}` : ''}` })
      setJustAddedId(data?.video?.id || null)
      setYoutubeUrl('')
      setStockName('')
      setMemo('')
      setShowHints(false)
      setAutoShortNote(false)
      urlRef.current?.focus()
      void loadMine()
    } catch (e: any) {
      setStatus({ tone: 'error', text: e?.message || '네트워크 문제로 등록하지 못했어요. 다시 시도해 주세요.', detail: '입력한 내용은 그대로 남아 있어요' })
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

  const firstRun = loaded && !loadError && items.length === 0

  return (
    <>
      <PageHeader
        title="영상 등록"
        subtitle="유튜브 주소를 붙여넣고 종목명만 적으면 끝입니다. 제목·조회수·좋아요·댓글은 유튜브에서 자동으로 채워져요."
        actions={
          <div className="v4-today-chip" title="오늘 등록한 영상 수">
            오늘 <strong>{todayCount}</strong>개 등록
          </div>
        }
      />

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
            autoComplete="off"
            spellCheck={false}
            placeholder="여기에 영상 주소를 붙여넣으세요"
            value={youtubeUrl}
            aria-invalid={showHints && urlInvalid ? true : undefined}
            onChange={(e) => {
              setYoutubeUrl(e.target.value)
              setStatus(null)
              setAutoShortNote(false)
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
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !stockName.trim()) {
                // 종목을 아직 안 적었다면 등록 대신 종목 칸으로 이동
                e.preventDefault()
                stockRef.current?.focus()
              }
            }}
          />
          <div className="v4-hint-slot">
            {showHints && !youtubeUrl.trim() ? (
              <span className="v4-hint warn">유튜브 주소를 붙여넣어 주세요.</span>
            ) : showHints && urlInvalid ? (
              <span className="v4-hint warn">유튜브 영상 주소가 아닌 것 같아요. youtube.com 또는 youtu.be 로 시작하는 주소를 넣어 주세요.</span>
            ) : duplicate ? (
              <span className="v4-hint warn">이미 등록된 영상이에요. 다시 등록하면 종목·형식이 지금 입력한 값으로 바뀝니다.</span>
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
              placeholder="예: 삼성전자"
              value={stockName}
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
            <div className="v4-segment" role="radiogroup" aria-labelledby="v4-reg-format-label">
              {(
                [
                  ['longform', '롱폼'],
                  ['shortform', '숏폼']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={contentType === value}
                  className={`v4-segment-item ${contentType === value ? 'active' : ''}`}
                  onClick={() => changeFormat(value)}
                >
                  {label}
                </button>
              ))}
            </div>
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
              <button key={name} type="button" className={`v4-chip ${normalizeStockName(stockName) === name ? 'active' : ''}`} onClick={() => pickStock(name)}>
                {name}
              </button>
            ))}
          </div>
        ) : null}

        <details className="v4-more">
          <summary>메모 추가 (선택)</summary>
          <input className="input" value={memo} placeholder="예: 실적 발표 · 급등 이슈" onChange={(e) => setMemo(e.target.value)} />
        </details>

        <div className={`v4-reg-status ${status ? status.tone : ''}`} role="status" aria-live="polite">
          {status ? (
            <>
              <strong>
                {status.tone === 'ok' ? '✓ ' : ''}
                {status.text}
              </strong>
              {status.detail ? <span className="v4-reg-status-detail"> — {status.detail}</span> : null}
            </>
          ) : (
            <span className="muted">주소 붙여넣기 → 종목 입력 → Enter. 형식은 마지막에 고른 것으로 기억돼요.</span>
          )}
        </div>
      </form>

      {firstRun ? (
        <details className="panel soft v4-firstrun" open>
          <summary>처음이신가요? 이렇게 하세요</summary>
          <ol>
            <li>유튜브에서 영상을 올린 뒤, 영상 주소를 복사합니다.</li>
            <li>위 칸에 붙여넣고, 다룬 종목명을 적습니다. 롱폼/숏폼도 확인하세요.</li>
            <li>Enter 를 누르면 등록 끝. 바로 다음 영상 주소를 붙여넣을 수 있어요.</li>
          </ol>
        </details>
      ) : null}

      <div className="panel v4-reg-list">
        <div className="panel-header">
          <div>
            <div className="panel-title">{isAdmin ? '최근 등록된 영상 (팀 전체)' : '내가 등록한 영상'}</div>
            <p className="panel-subtitle">최근 20개 · 제목을 누르면 유튜브가 열립니다.</p>
          </div>
        </div>

        {!loaded ? (
          <div className="small muted">불러오는 중…</div>
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
          <ul className="v4-reg-items">
            {items.map((item) => {
              const isNew = item.id === justAddedId
              const label = item.title || (item.youtube_url ? '제목 불러오는 중 (주소 열기)' : '제목 없음')
              return (
                <li className={`v4-reg-item ${isNew ? 'new' : ''}`} key={item.id}>
                  <div className="v4-reg-item-main">
                    {item.youtube_url ? (
                      <a className="link v4-reg-item-title" href={item.youtube_url} target="_blank" rel="noreferrer" title={label}>
                        {label}
                      </a>
                    ) : (
                      <span className="v4-reg-item-title">{label}</span>
                    )}
                    <div className="v4-reg-item-sub">
                      {isNew ? <span className="v4-new-badge">방금 등록</span> : null}
                      <span>{item.stock_name}</span>
                      <FormatPill contentType={item.content_type} />
                      <span>{fmtRelative(item.created_at)}</span>
                    </div>
                  </div>
                  <div className="v4-reg-item-num" title={`좋아요 ${fmtNumber(item.like_count)} · 댓글 ${fmtNumber(item.comment_count)}`}>
                    <strong>{fmtNumber(item.view_count)}</strong>
                    <span>조회</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
