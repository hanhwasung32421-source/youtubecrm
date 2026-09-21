'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/v3/app-shell'
import { DocRow, DocTable, EmptyState, Section, Tag, type DocColumn } from '@/components/v3/ui'
import { authedFetchJson, authedPostJson } from '@/lib/session/authed-fetch'
import { isTodayKst } from '@/lib/v3/engagement'
import { formatDateTime, formatNumber } from '@/lib/v3/format'
import { normalizeYoutubeUrl, readStored, videoIdFromStoredUrl, writeStored } from './youtube-url'

type ContentType = 'longform' | 'shortform'

type PreviewResponse = {
  title?: string
  channelName?: string
  thumbnailUrl?: string | null
  error?: string
}

type MineVideo = {
  id: string
  title: string | null
  stock_name: string | null
  content_type: ContentType
  published_at: string | null
  view_count: number
  like_count: number
  comment_count: number
  youtube_url: string | null
  created_at: string
}

type Status = { id: number; kind: 'ok' | 'error'; text: string; count?: number }

const TODAY_COLUMNS: DocColumn[] = [
  { key: 'time', label: '시각', width: '64px' },
  { key: 'title', label: '영상', width: 'minmax(0, 1.8fr)' },
  { key: 'type', label: '형식', width: '70px' },
  { key: 'views', label: '조회수', width: '90px', align: 'right' }
]

const TYPE_KEY = 'v3.register.contentType'
const STOCKS_KEY = 'v3.register.recentStocks'
const MAX_CHIPS = 8
const PREVIEW_DELAY_MS = 900

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
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [contentType, setContentType] = useState<ContentType>('longform')
  const [stockName, setStockName] = useState('')
  const [contentCategory, setContentCategory] = useState('')
  const [recentStocks, setRecentStocks] = useState<string[]>([])

  const [urlHint, setUrlHint] = useState('')
  const [stockHint, setStockHint] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  const [saving, setSaving] = useState(false)

  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const previewCache = useRef(new Map<string, PreviewResponse>())
  const previewToken = useRef(0)

  const [videos, setVideos] = useState<MineVideo[] | null>(null)
  const [listError, setListError] = useState(false)
  const [todayCount, setTodayCount] = useState(0)

  const urlRef = useRef<HTMLInputElement | null>(null)
  const stockRef = useRef<HTMLInputElement | null>(null)
  const submitRef = useRef<HTMLButtonElement | null>(null)
  const statusId = useRef(0)

  const normalized = useMemo(() => normalizeYoutubeUrl(youtubeUrl), [youtubeUrl])
  const validId = normalized.ok ? normalized.videoId : ''

  // 오늘 이미 등록한 영상인지(같은 주소를 두 번 넣는 실수 방지용 안내)
  const todayIds = useMemo(() => {
    const set = new Set<string>()
    for (const v of videos || []) {
      if (isTodayKst(v.created_at)) {
        const id = videoIdFromStoredUrl(v.youtube_url)
        if (id) set.add(id)
      }
    }
    return set
  }, [videos])
  const isDuplicate = !!validId && todayIds.has(validId)

  // 저장해 둔 형식·종목 불러오기 + 첫 화면에서 바로 주소 칸에 커서
  useEffect(() => {
    const savedType = readStored(TYPE_KEY)
    if (savedType === 'longform' || savedType === 'shortform') setContentType(savedType)
    setRecentStocks(readRecentStocks())
    urlRef.current?.focus()
  }, [])

  const loadMine = useCallback(async (): Promise<number | null> => {
    const { ok, data } = await authedFetchJson<{ items: MineVideo[] }>('/api/videos/mine?page=1')
    if (!ok) {
      setListError(true)
      return null
    }
    setListError(false)
    const items = data.items || []
    setVideos(items)
    setRecentStocks((prev) => mergeStocks(prev, items.map((v) => v.stock_name || '')))
    const count = items.filter((v) => isTodayKst(v.created_at)).length
    setTodayCount(count)
    return count
  }, [])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  // 링크 미리보기: 붙여넣고 잠시 멈췄을 때만 1번 불러온다. 같은 영상은 다시 부르지 않고,
  // 등록을 눌러 저장이 시작되면(=빠르게 입력한 경우) 아예 부르지 않는다.
  useEffect(() => {
    if (!validId || saving) {
      setPreview(null)
      return
    }
    const cached = previewCache.current.get(validId)
    if (cached) {
      setPreview(cached)
      return
    }
    setPreview(null)
    const token = ++previewToken.current
    const timer = window.setTimeout(async () => {
      const target = normalizeYoutubeUrl(youtubeUrl)
      if (!target.ok) return
      const { ok, data } = await authedFetchJson<PreviewResponse>(`/api/v3/link-preview?url=${encodeURIComponent(target.url)}`)
      if (token !== previewToken.current) return
      const result: PreviewResponse = ok && !data?.error ? data : { error: data?.error || 'no-preview' }
      previewCache.current.set(target.videoId, result)
      setPreview(result)
    }, PREVIEW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      previewToken.current++
    }
    // youtubeUrl은 validId가 바뀔 때만 의미가 있으므로 의존성에서 제외한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validId, saving])

  const chooseType = (type: ContentType) => {
    setContentType(type)
    writeStored(TYPE_KEY, type)
  }

  const rememberStock = (name: string) => {
    const next = mergeStocks([name], recentStocks)
    setRecentStocks(next)
    writeStored(STOCKS_KEY, JSON.stringify(next))
  }

  const onUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const result = normalizeYoutubeUrl(e.clipboardData.getData('text'))
    if (!result.ok) return // 주소가 아니면 그대로 붙여넣고 아래 안내에 맡긴다.
    e.preventDefault()
    setYoutubeUrl(result.url)
    setUrlHint('')
    if (result.isShort) setContentType('shortform')
    // 붙여넣자마자 종목 칸으로 넘어가 바로 이어서 입력할 수 있게 한다.
    window.setTimeout(() => stockRef.current?.focus(), 0)
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
    if (saving) return

    if (!normalized.ok) {
      setUrlHint(normalized.empty ? '유튜브 영상 주소를 붙여넣어 주세요.' : '유튜브 영상 주소가 맞는지 확인해 주세요.')
      urlRef.current?.focus()
      return
    }
    const stock = stockName.replace(/\s+/g, ' ').trim()
    if (!stock) {
      setStockHint('종목을 입력하거나 아래에서 골라 주세요.')
      stockRef.current?.focus()
      return
    }

    setSaving(true)
    setStatus(null)
    setUrlHint('')
    setStockHint('')
    try {
      const { ok, data } = await authedPostJson<{ error?: string; video?: { title?: string | null } }>('/api/videos/create', {
        youtubeUrl: normalized.url,
        contentType,
        stockName: stock,
        contentCategory: contentCategory.trim() || undefined
      })
      if (!ok) {
        say('error', `등록하지 못했어요. ${data?.error || '잠시 후 다시 시도해 주세요.'} 입력한 내용은 그대로 남아 있어요.`)
        return
      }

      rememberStock(stock)
      writeStored(TYPE_KEY, contentType)
      const id = say('ok', `${stock} · ${typeLabel(contentType)}`, todayCount + 1)
      setYoutubeUrl('')
      setStockName('')
      setContentCategory('')
      setPreview(null)
      urlRef.current?.focus()

      // 목록을 새로 받아 오고, 서버 기준의 실제 "오늘 N번째"로 바로잡는다.
      void loadMine().then((count) => {
        if (count !== null) setStatus((s) => (s && s.id === id ? { ...s, count } : s))
      })
    } catch (err: any) {
      say('error', `등록하지 못했어요. ${err?.message || '네트워크를 확인하고 다시 시도해 주세요.'}`)
    } finally {
      setSaving(false)
      window.setTimeout(() => {
        // 저장이 끝나면 (성공이든 실패든) 곧바로 다음 입력을 이어갈 수 있게 커서를 돌려준다.
        if (document.activeElement === document.body) urlRef.current?.focus()
      }, 0)
    }
  }

  const todayVideos = useMemo(() => (videos || []).filter((v) => isTodayKst(v.created_at)), [videos])
  const showFallback = videos !== null && todayVideos.length === 0 && videos.length > 0
  const listVideos = showFallback ? (videos || []).slice(0, 8) : todayVideos
  const firstRun = videos !== null && videos.length === 0

  return (
    <>
      <PageHeader title="영상 등록" subtitle="유튜브 주소와 종목만 넣으면 등록됩니다. 제목·조회수는 자동으로 가져옵니다." />

      <form className="v3-reg" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="label" htmlFor="v3-reg-url">유튜브 주소</label>
          <input
            id="v3-reg-url"
            ref={urlRef}
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            placeholder="주소를 붙여넣으세요 (Ctrl+V)"
            value={youtubeUrl}
            readOnly={saving}
            onChange={(e) => {
              setYoutubeUrl(e.target.value)
              if (urlHint) setUrlHint('')
            }}
            onPaste={onUrlPaste}
            onBlur={onUrlBlur}
          />
          <div className={`v3-reg-hint ${urlHint || isDuplicate ? 'warn' : ''}`} aria-live="polite">
            {urlHint || (isDuplicate ? '오늘 이미 등록한 영상이에요. 다시 등록하면 종목·형식이 바뀝니다.' : '')}
          </div>
        </div>

        {preview && !preview.error ? (
          <div className="v3-reg-preview">
            {preview.thumbnailUrl ? <img src={preview.thumbnailUrl} alt="" /> : null}
            <span>
              {preview.title || '(제목 없음)'}
              {preview.channelName ? ` · ${preview.channelName}` : ''}
            </span>
          </div>
        ) : null}

        <div className="v3-reg-row">
          <div className="field">
            <label className="label" htmlFor="v3-reg-stock">종목</label>
            <input
              id="v3-reg-stock"
              ref={stockRef}
              className="input"
              type="text"
              autoComplete="off"
              placeholder="예: 삼성전자"
              value={stockName}
              readOnly={saving}
              onChange={(e) => {
                setStockName(e.target.value)
                if (stockHint) setStockHint('')
              }}
            />
          </div>
          <div className="field">
            <span className="label" id="v3-reg-type-label">형식</span>
            <div className="v3-seg" role="group" aria-labelledby="v3-reg-type-label">
              {(['longform', 'shortform'] as const).map((type) => (
                <button key={type} type="button" aria-pressed={contentType === type} disabled={saving} onClick={() => chooseType(type)}>
                  {typeLabel(type)}
                </button>
              ))}
            </div>
          </div>
          <button ref={submitRef} className="button" type="submit" disabled={saving} style={{ height: 44 }}>
            {saving ? '등록 중…' : '등록'}
          </button>
        </div>
        <div className={`v3-reg-hint ${stockHint ? 'warn' : ''}`} aria-live="polite" style={{ marginTop: -6 }}>
          {stockHint}
        </div>

        {recentStocks.length > 0 ? (
          <div className="v3-reg-chips" aria-label="최근 쓴 종목">
            <span className="v3-reg-chips-label">최근 종목</span>
            {recentStocks.map((name) => (
              <button
                type="button"
                key={name}
                className={`v3-tag blue v3-tag-button ${stockName === name ? 'active' : ''}`}
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
            onChange={(e) => setContentCategory(e.target.value)}
            placeholder="예: 실적 브리핑"
            aria-label="메모"
          />
        </details>

        <div role="status" aria-live="polite">
          {status ? (
            <div className={`v3-reg-status ${status.kind === 'error' ? 'error' : ''}`}>
              {status.kind === 'ok' ? (
                <span>
                  <strong>등록됨</strong>
                  {status.count ? ` · 오늘 ${status.count}번째` : ''} · {status.text}
                </span>
              ) : (
                <span>{status.text}</span>
              )}
            </div>
          ) : null}
        </div>
      </form>

      <Section
        title={showFallback ? '최근 등록한 영상' : '오늘 등록한 영상'}
        count={showFallback ? undefined : todayVideos.length}
        description={showFallback ? '오늘은 아직 등록한 영상이 없어서 최근 등록 내역을 보여드려요.' : undefined}
      >
        {listError && videos === null ? (
          <EmptyState title="목록을 불러오지 못했어요" action={<button className="button secondary" onClick={() => void loadMine()}>다시 불러오기</button>}>
            등록은 그대로 하실 수 있어요.
          </EmptyState>
        ) : videos === null ? (
          <div className="small muted">불러오는 중…</div>
        ) : firstRun ? (
          <EmptyState title="아직 등록한 영상이 없어요">
            <div className="v3-reg-guide">
              <span>1. 유튜브 주소를 위 칸에 붙여넣기</span>
              <span>2. 종목 입력 (다음부터는 아래 버튼으로 고르기)</span>
              <span>3. Enter 키로 등록 — 바로 다음 영상을 이어서 넣을 수 있어요</span>
            </div>
          </EmptyState>
        ) : (
          <DocTable columns={TODAY_COLUMNS} isEmpty={listVideos.length === 0} empty="등록된 영상이 없습니다.">
            {listVideos.map((video) => (
              <DocRow columns={TODAY_COLUMNS} key={video.id}>
                <div className="small muted">{formatDateTime(video.created_at).slice(-5)}</div>
                <div style={{ minWidth: 0 }}>
                  {video.youtube_url ? (
                    <a className="v3-link" href={video.youtube_url} target="_blank" rel="noreferrer">
                      {video.title || video.stock_name || '(제목 없음)'}
                    </a>
                  ) : (
                    video.title || video.stock_name || '(제목 없음)'
                  )}
                  {video.stock_name ? <div className="v3-cell-sub">{video.stock_name}</div> : null}
                </div>
                <div>
                  <Tag tone={video.content_type === 'shortform' ? 'violet' : 'blue'}>{typeLabel(video.content_type)}</Tag>
                </div>
                <div className="data-right">{formatNumber(video.view_count)}</div>
              </DocRow>
            ))}
          </DocTable>
        )}
      </Section>
    </>
  )
}
