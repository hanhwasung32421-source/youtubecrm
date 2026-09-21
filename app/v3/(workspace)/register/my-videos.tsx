'use client'

import { useEffect, useRef, useState } from 'react'
import { SegmentedType } from '@/components/v3/segmented'
import { Tag } from '@/components/v3/ui'
import { isTodayKst } from '@/lib/v3/engagement'
import { formatDateTime, formatNumber } from '@/lib/v3/format'
import { callMyVideo, type ContentType } from './register-api'

export type MineVideo = {
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

type VideoPatch = { stock_name: string | null; content_type: ContentType }

// 표 모양(넓은 화면)과 카드 모양(좁은 화면)은 CSS(.v3-vrow)가 바꾼다. 마크업은 하나.

function typeLabel(type: ContentType) {
  return type === 'shortform' ? '숏폼' : '롱폼'
}

function whenLabel(iso: string, today: boolean) {
  if (today) return formatDateTime(iso).slice(-5)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(d)
}

type Handlers = {
  stockListId: string
  onPatched: (id: string, patch: VideoPatch) => void
  onDeleted: (id: string) => void
  onNotice: (text: string, tone: 'success' | 'error') => void
}

function VideoRow({ video, today, highlight, stockListId, ...handlers }: { video: MineVideo; today: boolean; highlight: boolean } & Handlers) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [stock, setStock] = useState('')
  const [type, setType] = useState<ContentType>('longform')
  const [memo, setMemo] = useState('')
  const [memoState, setMemoState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const stockRef = useRef<HTMLInputElement | null>(null)
  const editBtnRef = useRef<HTMLButtonElement | null>(null)
  const deleteBtnRef = useRef<HTMLButtonElement | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const title = video.title || video.stock_name || '(제목 없음)'

  const close = (restore?: 'edit' | 'delete') => {
    setMode('view')
    setError('')
    if (restore) window.setTimeout(() => (restore === 'edit' ? editBtnRef : deleteBtnRef).current?.focus(), 0)
  }

  const openEdit = () => {
    setStock(video.stock_name || '')
    setType(video.content_type)
    setMemo('')
    setMemoState('loading')
    setError('')
    setMode('edit')
    // 목록에는 메모가 없어서, 수정 창을 열 때 현재 메모만 따로 불러온다.
    void callMyVideo<{ video?: { content_category?: string | null } }>(video.id, 'GET').then((res) => {
      if (!alive.current) return
      if (res.ok) {
        setMemo(res.data?.video?.content_category || '')
        setMemoState('ready')
      } else {
        setMemoState('failed')
      }
    })
  }

  const openDelete = () => {
    setError('')
    setMode('delete')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation()
      close(mode === 'edit' ? 'edit' : 'delete')
    }
  }

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    const nextStock = stock.replace(/\s+/g, ' ').trim()
    if (!nextStock) {
      setError('종목명을 입력해 주세요.')
      stockRef.current?.focus()
      return
    }
    const body: Record<string, string | null> = { stock_name: nextStock, content_type: type }
    if (memoState === 'ready') body.content_category = memo.trim() || null

    setBusy(true)
    setError('')
    const res = await callMyVideo<{ video?: { stock_name: string | null; content_type: ContentType } }>(video.id, 'PATCH', body)
    if (!alive.current) return
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    handlers.onPatched(video.id, {
      stock_name: res.data?.video?.stock_name ?? nextStock,
      content_type: res.data?.video?.content_type ?? type
    })
    handlers.onNotice('수정했어요.', 'success')
    close('edit')
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const res = await callMyVideo(video.id, 'DELETE')
    if (!alive.current) {
      if (res.ok) handlers.onDeleted(video.id)
      return
    }
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    handlers.onNotice('삭제했어요.', 'success')
    handlers.onDeleted(video.id)
  }

  if (mode === 'edit') {
    return (
      <div className="data-table-row v3-vrow-open v3-row-editing" onKeyDown={onKeyDown}>
        <form className="v3-edit-form" onSubmit={save} noValidate>
          <div className="v3-edit-title" title={title}>{title}</div>
          <div className="v3-edit-grid">
            <div className="field">
              <label className="label" htmlFor={`v3-edit-stock-${video.id}`}>종목</label>
              <input
                id={`v3-edit-stock-${video.id}`}
                ref={stockRef}
                className="input"
                autoFocus
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                list={stockListId}
                value={stock}
                readOnly={busy}
                onChange={(e) => {
                  setStock(e.target.value)
                  if (error) setError('')
                }}
              />
            </div>
            <div className="field">
              <span className="label" id={`v3-edit-type-${video.id}`}>형식</span>
              <SegmentedType value={type} onChange={setType} disabled={busy} labelledBy={`v3-edit-type-${video.id}`} />
            </div>
            <div className="field">
              <label className="label" htmlFor={`v3-edit-memo-${video.id}`}>메모</label>
              <input
                id={`v3-edit-memo-${video.id}`}
                className="input"
                autoComplete="off"
                spellCheck={false}
                value={memo}
                readOnly={busy || memoState !== 'ready'}
                placeholder={memoState === 'loading' ? '불러오는 중…' : memoState === 'failed' ? '메모를 불러오지 못했어요 (그대로 유지돼요)' : '예: 실적 브리핑'}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>
          <div className="v3-edit-actions">
            <button className="button xs" type="submit" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button className="button secondary xs" type="button" disabled={busy} onClick={() => close('edit')}>
              취소
            </button>
            <span className="v3-edit-error" role="alert">{error}</span>
          </div>
        </form>
      </div>
    )
  }

  if (mode === 'delete') {
    return (
      <div className="data-table-row v3-vrow-open v3-row-deleting" onKeyDown={onKeyDown}>
        <div className="v3-delete-confirm" role="group" aria-label={`${title} 삭제 확인`}>
          <span className="v3-delete-text">
            <strong title={title}>{video.stock_name || title}</strong> 등록을 지울까요? 지우면 되돌릴 수 없어요.
          </span>
          <span className="v3-edit-actions">
            <button className="button danger xs" type="button" disabled={busy} onClick={() => void remove()}>
              {busy ? '삭제 중…' : '삭제'}
            </button>
            <button className="button secondary xs" type="button" autoFocus disabled={busy} onClick={() => close('delete')}>
              취소
            </button>
            <span className="v3-edit-error" role="alert">{error}</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`data-table-row v3-vrow ${highlight ? 'v3-row-new' : ''}`}>
      <div className="v3-vc-time small muted">{whenLabel(video.created_at, today)}</div>
      <div className="v3-vc-title" style={{ minWidth: 0 }}>
        {video.youtube_url ? (
          <a className="v3-link v3-cell-clip" href={video.youtube_url} target="_blank" rel="noreferrer">
            {title}
          </a>
        ) : (
          <div className="v3-cell-clip">{title}</div>
        )}
        {video.stock_name || highlight ? (
          <div className="v3-cell-sub">
            {video.stock_name}
            {highlight ? <span className="v3-tag green v3-just-added">방금 등록</span> : null}
          </div>
        ) : null}
      </div>
      <div className="v3-vc-type">
        <Tag tone={video.content_type === 'shortform' ? 'violet' : 'blue'}>{typeLabel(video.content_type)}</Tag>
      </div>
      <div className="v3-vc-views data-right">{formatNumber(video.view_count)}</div>
      <div className="v3-cell-actions v3-vc-actions">
        <button ref={editBtnRef} type="button" className="v3-row-action" onClick={openEdit} aria-label={`${title} 수정`}>
          수정
        </button>
        <button ref={deleteBtnRef} type="button" className="v3-row-action danger" onClick={openDelete} aria-label={`${title} 삭제`}>
          삭제
        </button>
      </div>
    </div>
  )
}

export function MyVideosList({
  videos,
  highlightIds,
  onPatched,
  onDeleted,
  onNotice,
  stockListId
}: { videos: MineVideo[]; highlightIds: Set<string> } & Handlers) {
  const today = videos.filter((v) => isTodayKst(v.created_at))
  const earlier = videos.filter((v) => !isTodayKst(v.created_at))
  const [showEarlier, setShowEarlier] = useState(false)
  // 오늘 등록한 게 없으면 최근 등록 내역을 바로 보여 준다.
  const earlierOpen = showEarlier || today.length === 0

  const handlers = { onPatched, onDeleted, onNotice, stockListId }

  return (
    <>
      <div className="data-table v3-vtable">
        <div className="data-table-header v3-vrow v3-vhead" aria-hidden>
          <div className="v3-vc-time">시각</div>
          <div className="v3-vc-title">영상</div>
          <div className="v3-vc-type">형식</div>
          <div className="v3-vc-views data-right">조회수</div>
          <div className="v3-vc-actions" />
        </div>
        {today.length === 0 && earlier.length === 0 ? (
          <div className="data-table-row v3-vrow-open">
            <div className="muted small">등록된 영상이 없습니다.</div>
          </div>
        ) : null}
        {today.map((video) => (
          <VideoRow key={video.id} video={video} today highlight={highlightIds.has(video.id)} {...handlers} />
        ))}
        {earlierOpen
          ? earlier.slice(0, 8).map((video) => (
              <VideoRow key={video.id} video={video} today={false} highlight={highlightIds.has(video.id)} {...handlers} />
            ))
          : null}
      </div>
      {today.length > 0 && earlier.length > 0 ? (
        <button type="button" className="v3-more-toggle" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier}>
          {showEarlier ? '이전 등록 접기' : `이전에 등록한 영상 ${Math.min(earlier.length, 8)}개 보기`}
        </button>
      ) : null}
    </>
  )
}
