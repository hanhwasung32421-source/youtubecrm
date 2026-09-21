'use client'

import { useEffect, useRef, useState } from 'react'
import { ContentTypeTag } from '@/components/v2/tags'
import { authedFetchJson } from '@/lib/session/authed-fetch'
import { authedDeleteJson, authedPatchJson } from '@/lib/v2/client'
import { formatKstDateTime } from '@/lib/v2/dates'
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  SEO_CHECKLIST_FIELDS,
  SEO_CHECKLIST_LABELS,
  checklistDoneCount,
  type ContentType,
  type MineVideoItem,
  type SeoChecklist,
  type SeoChecklistField
} from '@/lib/v2/types'
import { friendlyEditError } from './register-utils'

export type RowMode = 'edit' | 'delete' | null

type Props = {
  video: MineVideoItem
  checklist: SeoChecklist
  isNew: boolean
  mode: RowMode
  onMode: (mode: RowMode) => void
  checklistOpen: boolean
  onToggleChecklist: () => void
  checklistBusy: boolean
  onSaveChecklist: (patch: Partial<Record<SeoChecklistField, boolean>>) => void
  onPatched: (id: string, patch: { stock_name: string; content_type: ContentType }) => void
  onDeleted: (id: string) => void
  onNotify: (tone: 'success' | 'error', text: string) => void
}

export function MyVideoRow({ video, checklist, isNew, mode, onMode, checklistOpen, onToggleChecklist, checklistBusy, onSaveChecklist, onPatched, onDeleted, onNotify }: Props) {
  const done = checklistDoneCount(checklist)
  const [stock, setStock] = useState(video.stock_name)
  const [type, setType] = useState<ContentType>(video.content_type)
  const [memo, setMemo] = useState('')
  const [memoOriginal, setMemoOriginal] = useState<string | null>(null)
  const [memoTouched, setMemoTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const stockRef = useRef<HTMLInputElement | null>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // 수정 창이 열릴 때: 현재 값으로 채우고, 목록에 없는 메모는 서버에서 읽어 온다.
  useEffect(() => {
    if (mode !== 'edit') return
    setStock(video.stock_name)
    setType(video.content_type)
    setMemo('')
    setMemoOriginal(null)
    setMemoTouched(false)
    setError('')
    stockRef.current?.focus()
    stockRef.current?.select()
    let cancelled = false
    void (async () => {
      const { ok, data } = await authedFetchJson<{ item?: { content_category: string | null } }>(`/api/v2/my-videos/${video.id}`)
      if (cancelled || !ok || !data.item) return
      const current = data.item.content_category || ''
      setMemoOriginal(current)
      setMemo((prev) => (prev === '' ? current : prev))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, video.id])

  useEffect(() => {
    if (mode === 'delete') {
      setError('')
      cancelDeleteRef.current?.focus()
    }
  }, [mode])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const cleanStock = stock.trim().replace(/\s+/g, ' ')
    if (!cleanStock) {
      setError('종목명을 적어 주세요.')
      stockRef.current?.focus()
      return
    }
    const body: { stock_name?: string; content_type?: ContentType; content_category?: string | null } = {}
    if (cleanStock !== video.stock_name) body.stock_name = cleanStock
    if (type !== video.content_type) body.content_type = type
    if (memoTouched && memo.trim() !== (memoOriginal ?? '')) body.content_category = memo.trim() || null
    if (Object.keys(body).length === 0) {
      onMode(null)
      return
    }

    setBusy(true)
    setError('')
    try {
      const { ok, status, data } = await authedPatchJson<{ ok?: boolean; error?: string }>(`/api/v2/my-videos/${video.id}`, body)
      if (!alive.current) return
      if (!ok) {
        setError(friendlyEditError(data?.error, status, '수정하지 못했어요. 잠시 후 다시 시도해 주세요.'))
        return
      }
      onPatched(video.id, { stock_name: cleanStock, content_type: type })
      onNotify('success', '수정했어요.')
      onMode(null)
    } catch {
      if (alive.current) setError('수정하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { ok, status, data } = await authedDeleteJson<{ ok?: boolean; error?: string }>(`/api/v2/my-videos/${video.id}`)
      if (!alive.current) return
      if (!ok) {
        setError(friendlyEditError(data?.error, status, '삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'))
        return
      }
      onNotify('success', '삭제했어요.')
      onDeleted(video.id)
    } catch {
      if (alive.current) setError('삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className={`list-item v2-vrow ${isNew ? 'is-new' : ''}`}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="v2-card-title">
            <span>{video.title || '(제목을 불러오는 중이에요)'}</span>
            <ContentTypeTag contentType={video.content_type} />
          </div>
          <div className="v2-card-meta" style={{ marginTop: 4 }}>
            <span>{video.stock_name}</span>
            <span>{formatKstDateTime(video.created_at)}</span>
            <span>조회 {(video.view_count ?? 0).toLocaleString('ko-KR')}</span>
            <span>좋아요 {(video.like_count ?? 0).toLocaleString('ko-KR')}</span>
            {video.youtube_url ? (
              <a className="link" href={video.youtube_url} target="_blank" rel="noreferrer">
                영상 열기 ↗
              </a>
            ) : null}
          </div>
        </div>
        <div className="v2-vrow-actions">
          <button
            type="button"
            className={`pill v2-check-toggle ${done === 4 ? 'success' : done > 0 ? 'warning' : ''}`}
            aria-expanded={checklistOpen}
            onClick={onToggleChecklist}
          >
            SEO 점검 {done}/4 {checklistOpen ? '▴' : '▾'}
          </button>
          <button type="button" className="v2-text-btn" aria-expanded={mode === 'edit'} disabled={busy} onClick={() => onMode(mode === 'edit' ? null : 'edit')}>
            수정
          </button>
          <button type="button" className="v2-text-btn danger" aria-expanded={mode === 'delete'} disabled={busy} onClick={() => onMode(mode === 'delete' ? null : 'delete')}>
            삭제
          </button>
        </div>
      </div>

      {mode === 'edit' ? (
        <form className="v2-inline-edit" onSubmit={save} noValidate>
          <div className="field">
            <label className="label" htmlFor={`v2-edit-stock-${video.id}`}>
              종목명
            </label>
            <input
              id={`v2-edit-stock-${video.id}`}
              ref={stockRef}
              className="input compact"
              autoComplete="off"
              value={stock}
              disabled={busy}
              onChange={(e) => {
                setStock(e.target.value)
                setError('')
              }}
            />
          </div>
          <div className="field">
            <span className="label" id={`v2-edit-type-${video.id}`}>
              형식
            </span>
            <div className="v2-seg" role="group" aria-labelledby={`v2-edit-type-${video.id}`}>
              {CONTENT_TYPES.map((t) => (
                <button key={t} type="button" className={`v2-seg-btn ${type === t ? 'active' : ''}`} aria-pressed={type === t} disabled={busy} onClick={() => setType(t)}>
                  {CONTENT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="field v2-edit-memo">
            <label className="label" htmlFor={`v2-edit-memo-${video.id}`}>
              메모 (선택)
            </label>
            <input
              id={`v2-edit-memo-${video.id}`}
              className="input compact"
              autoComplete="off"
              placeholder="나중에 알아보기 위한 내부 메모"
              value={memo}
              disabled={busy}
              onChange={(e) => {
                setMemo(e.target.value)
                setMemoTouched(true)
              }}
            />
          </div>
          <div className="v2-inline-buttons">
            <button type="submit" className="button xs" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="button secondary xs" disabled={busy} onClick={() => onMode(null)}>
              취소
            </button>
          </div>
          {error ? <div className="v2-hint v2-inline-msg">{error}</div> : null}
        </form>
      ) : null}

      {mode === 'delete' ? (
        <div className="v2-inline-edit v2-confirm-delete" role="alertdialog" aria-label="영상 삭제 확인">
          <div className="v2-confirm-text">
            「{video.stock_name}」 영상 등록을 삭제할까요?
            <span className="muted"> 이 CRM의 기록(조회수 기록 포함)만 지워지고 유튜브 영상은 그대로예요.</span>
          </div>
          <div className="v2-inline-buttons">
            <button type="button" className="button danger xs" disabled={busy} onClick={() => void remove()}>
              {busy ? '삭제 중…' : '삭제하기'}
            </button>
            <button ref={cancelDeleteRef} type="button" className="button secondary xs" disabled={busy} onClick={() => onMode(null)}>
              취소
            </button>
          </div>
          {error ? <div className="v2-hint v2-inline-msg">{error}</div> : null}
        </div>
      ) : null}

      {checklistOpen ? (
        <div className="v2-checklist" style={{ marginTop: 8 }}>
          {SEO_CHECKLIST_FIELDS.map((field) => (
            <label className={`v2-check ${checklist[field] ? 'done' : ''}`} key={field}>
              <input type="checkbox" checked={checklist[field]} disabled={checklistBusy} onChange={() => onSaveChecklist({ [field]: !checklist[field] })} />
              <span>{SEO_CHECKLIST_LABELS[field]}</span>
            </label>
          ))}
          {done < 4 ? (
            <div>
              <button
                type="button"
                className="button secondary v2-check-all"
                disabled={checklistBusy}
                onClick={() => onSaveChecklist({ title_has_stock: true, thumbnail_text_checked: true, description_timestamps: true, tags_5plus: true })}
              >
                모두 확인함
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
