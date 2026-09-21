'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/v5/widget'
import { CONTENT_TYPE_LABEL, formatKstWhen, friendlyError, kstYmd, type ContentType } from '@/components/v5/register-utils'
import { authedFetchJson } from '@/lib/session/authed-fetch'

export type MineVideo = {
  id: string
  title: string | null
  stock_name: string
  content_type: ContentType
  content_category?: string | null
  published_at: string | null
  view_count: number | null
  like_count: number | null
  comment_count: number | null
  youtube_url: string
  created_at: string
  owner_name?: string | null
}

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString('ko-KR')

type Draft = { stock: string; type: ContentType; memo: string }

export function MyVideosTable({
  items,
  isAdmin,
  highlightIds,
  onUpdated,
  onDeleted
}: {
  items: MineVideo[]
  isAdmin: boolean
  highlightIds: Set<string>
  onUpdated: (id: string, patch: Partial<MineVideo>) => void
  onDeleted: (id: string) => void
}) {
  const stockInputRef = useRef<HTMLInputElement | null>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ stock: '', type: 'longform', memo: '' })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)

  const busy = saving || deleting

  // 삭제 확인은 실수로 남아 있지 않도록 몇 초 뒤 자동으로 닫는다.
  useEffect(() => {
    if (!confirmId || deleting) return
    const timer = window.setTimeout(() => setConfirmId(null), 6000)
    return () => window.clearTimeout(timer)
  }, [confirmId, deleting])

  useEffect(() => {
    if (editingId) stockInputRef.current?.focus()
  }, [editingId])

  useEffect(() => {
    if (confirmId) cancelDeleteRef.current?.focus()
  }, [confirmId])

  const startEdit = (v: MineVideo) => {
    if (busy) return
    setConfirmId(null)
    setDeleteError(null)
    setEditError('')
    setDraft({ stock: v.stock_name, type: v.content_type, memo: v.content_category || '' })
    setEditingId(v.id)
  }

  const cancelEdit = () => {
    if (saving) return
    setEditingId(null)
    setEditError('')
  }

  const saveEdit = async (v: MineVideo) => {
    if (saving) return
    const stock = draft.stock.trim()
    if (!stock) {
      setEditError('종목명을 적어 주세요.')
      stockInputRef.current?.focus()
      return
    }
    const memo = draft.memo.trim()
    if (stock === v.stock_name && draft.type === v.content_type && memo === (v.content_category || '')) {
      setEditingId(null)
      return
    }
    setSaving(true)
    setEditError('')
    try {
      const res = await authedFetchJson<{ ok?: boolean; item?: Partial<MineVideo>; error?: string }>(`/api/v5/my-videos/${v.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_name: stock, content_type: draft.type, content_category: memo })
      })
      if (!res.ok) {
        setEditError(friendlyError(res.data?.error || '', res.status))
        return
      }
      onUpdated(v.id, { stock_name: stock, content_type: draft.type, content_category: memo || null })
      setEditingId(null)
    } catch (e) {
      setEditError(friendlyError(e))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (v: MineVideo) => {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await authedFetchJson<{ ok?: boolean; error?: string }>(`/api/v5/my-videos/${v.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        setDeleteError({ id: v.id, message: friendlyError(res.data?.error || '', res.status) })
        setConfirmId(null)
        return
      }
      setConfirmId(null)
      onDeleted(v.id) // 이미 지워진 영상(404)도 목록에서는 치운다.
    } catch (e) {
      setDeleteError({ id: v.id, message: friendlyError(e) })
      setConfirmId(null)
    } finally {
      setDeleting(false)
    }
  }

  const today = kstYmd(new Date())
  const isToday = (v: MineVideo) => kstYmd(v.created_at) === today
  const todayCount = items.filter(isToday).length
  const showGroups = todayCount > 0
  const colCount = isAdmin ? 9 : 8

  return (
    <div className="panel v5-table-wrap" style={{ padding: 0 }}>
      <table className="v5-table compact">
        <thead>
          <tr>
            <th>등록 시각</th>
            <th>종목</th>
            <th>제목</th>
            <th>형식</th>
            {isAdmin ? <th>등록자</th> : null}
            <th className="num">조회수</th>
            <th className="num">좋아요</th>
            <th className="num">댓글</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((v, i) => {
            const today1 = isToday(v)
            const prevToday = i > 0 ? isToday(items[i - 1]) : null
            const header = showGroups && (i === 0 || prevToday !== today1) ? (today1 ? '오늘 등록' : '이전에 등록한 영상') : null
            const editing = editingId === v.id
            const arming = confirmId === v.id
            return (
              <Fragment key={v.id}>
                {header ? (
                  <tr className="v5-group-row">
                    <td colSpan={colCount}>{header}</td>
                  </tr>
                ) : null}
                <tr className={highlightIds.has(v.id) ? 'is-new' : ''}>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                    {formatKstWhen(v.created_at)}
                  </td>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{v.stock_name}</td>
                  <td className="v5-title-cell" title={v.title || undefined}>
                    {v.title || <span className="muted">제목 수집 전</span>}
                    {v.content_category ? <span className="v5-memo"> · {v.content_category}</span> : null}
                  </td>
                  <td>
                    <Badge tone="plain">{CONTENT_TYPE_LABEL[v.content_type] || v.content_type}</Badge>
                  </td>
                  {isAdmin ? <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{v.owner_name || '-'}</td> : null}
                  <td className="num">{num(v.view_count)}</td>
                  <td className="num">{num(v.like_count)}</td>
                  <td className="num">{num(v.comment_count)}</td>
                  <td className="v5-actions-cell">
                    {arming ? (
                      <span
                        className="v5-confirm-inline"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setConfirmId(null)
                        }}
                      >
                        <span className="small">정말 삭제할까요?</span>
                        <button className="button danger xs" type="button" disabled={deleting} onClick={() => void confirmDelete(v)}>
                          {deleting ? '삭제 중...' : '삭제'}
                        </button>
                        <button ref={cancelDeleteRef} className="button secondary xs" type="button" disabled={deleting} onClick={() => setConfirmId(null)}>
                          취소
                        </button>
                      </span>
                    ) : (
                      <span className="v5-actions">
                        <a className="v5-link-cell" href={v.youtube_url} target="_blank" rel="noreferrer">
                          열기
                        </a>
                        <button className="button ghost xs" type="button" disabled={busy} onClick={() => startEdit(v)}>
                          수정
                        </button>
                        <button
                          className="button ghost xs v5-danger-text"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(null)
                            setDeleteError(null)
                            setConfirmId(v.id)
                          }}
                        >
                          삭제
                        </button>
                      </span>
                    )}
                    {deleteError?.id === v.id ? <div className="v5-bulk-err">{deleteError.message}</div> : null}
                  </td>
                </tr>
                {editing ? (
                  <tr className="v5-edit-row">
                    <td colSpan={colCount}>
                      <div
                        className="v5-editor"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            cancelEdit()
                          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'INPUT') {
                            e.preventDefault()
                            void saveEdit(v)
                          }
                        }}
                      >
                        <div className="field">
                          <label className="label" htmlFor={`v5-edit-stock-${v.id}`}>
                            종목
                          </label>
                          <input
                            id={`v5-edit-stock-${v.id}`}
                            ref={stockInputRef}
                            className="input"
                            autoComplete="off"
                            value={draft.stock}
                            disabled={saving}
                            onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value }))}
                          />
                        </div>
                        <div className="field">
                          <span className="label">형식</span>
                          <div className="v5-type-toggle" role="group" aria-label="영상 형식">
                            {(['longform', 'shortform'] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                className={draft.type === t ? 'active' : ''}
                                aria-pressed={draft.type === t}
                                disabled={saving}
                                onClick={() => setDraft((d) => ({ ...d, type: t }))}
                              >
                                {CONTENT_TYPE_LABEL[t]}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="field">
                          <label className="label" htmlFor={`v5-edit-memo-${v.id}`}>
                            메모 (선택)
                          </label>
                          <input
                            id={`v5-edit-memo-${v.id}`}
                            className="input"
                            autoComplete="off"
                            placeholder="예: 실적분석"
                            value={draft.memo}
                            disabled={saving}
                            onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))}
                          />
                        </div>
                        <div className="v5-editor-actions">
                          <button className="button sm" type="button" disabled={saving} onClick={() => void saveEdit(v)}>
                            {saving ? '저장 중...' : '저장'}
                          </button>
                          <button className="button secondary sm" type="button" disabled={saving} onClick={cancelEdit}>
                            취소
                          </button>
                        </div>
                        {editError ? (
                          <div className="v5-bulk-err v5-editor-error" role="alert">
                            {editError}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
