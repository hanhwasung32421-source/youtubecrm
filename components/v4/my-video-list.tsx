'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { FormatPill, FormatToggle } from '@/components/v4/ui'
import { deleteMyVideo, loadMyVideoMemo, patchMyVideo, type ContentType, type VideoPatch } from '@/components/v4/register-api'
import { normalizeStockName } from '@/components/v4/register-utils'
import { needsRelogin } from '@/components/v4/register-logic'
import { loginHrefWithNext } from '@/components/v4/safe-next'
import { LOGIN_HREF } from '@/lib/v4/menu'
import { fmtNumber, fmtRelative } from '@/lib/v4/format'

export type MyVideo = {
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

type ListProps = {
  items: MyVideo[]
  newIds: Set<string>
  stockChoices: string[]
  onUpdated: (id: string, patch: { stock_name: string; content_type: ContentType }) => void
  onDeleted: (id: string) => void
}

// 글자를 칠 때마다 다시 그려지지 않게 memo. 부모는 늘 같은 함수(onUpdated/onDeleted)를 넘긴다.
export const MyVideoList = memo(function MyVideoList({ items, newIds, stockChoices, onUpdated, onDeleted }: ListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ id: string; tone: 'ok' | 'error'; text: string } | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // 수정 창이나 삭제 확인이 닫히면 그 줄의 버튼으로 커서를 돌려 준다.
  const focusRowButton = (kind: 'edit' | 'del', id: string) => {
    window.setTimeout(() => listRef.current?.querySelector<HTMLElement>(`[data-${kind}-for="${id}"]`)?.focus(), 0)
  }

  // "고쳤어요" 안내는 잠깐 보여 주고 사라진다.
  useEffect(() => {
    if (message?.tone !== 'ok') return
    const timer = window.setTimeout(() => setMessage(null), 3000)
    return () => window.clearTimeout(timer)
  }, [message])

  const remove = async (item: MyVideo) => {
    if (busyId) return
    setBusyId(item.id)
    setMessage(null)
    const result = await deleteMyVideo(item.id)
    setBusyId(null)
    if (!result.ok) {
      setMessage({ id: item.id, tone: 'error', text: result.message })
      return
    }
    setConfirmId(null)
    onDeleted(item.id) // 지워진 줄에는 돌아갈 버튼이 없다
  }

  return (
    <ul className="v4-reg-items" ref={listRef}>
      {items.map((item) => {
        const isNew = newIds.has(item.id)
        const label = item.title || (item.youtube_url ? '제목 불러오는 중 (주소 열기)' : '제목 없음')
        const editing = editingId === item.id
        const confirming = confirmId === item.id
        const busy = busyId === item.id
        const msg = message && message.id === item.id ? message : null
        return (
          <li className={`v4-reg-item ${isNew ? 'new' : ''} ${editing || confirming ? 'active' : ''}`} key={item.id}>
            <div className="v4-reg-item-main">
              {item.youtube_url ? (
                <a className="link v4-reg-item-title" href={item.youtube_url} target="_blank" rel="noreferrer" title={label}>
                  {label}
                </a>
              ) : (
                <span className="v4-reg-item-title">{label}</span>
              )}

              {editing ? (
                <EditForm
                  item={item}
                  stockChoices={stockChoices}
                  onCancel={() => {
                    setEditingId(null)
                    focusRowButton('edit', item.id)
                  }}
                  onSaved={(patch) => {
                    setEditingId(null)
                    focusRowButton('edit', item.id)
                    setMessage({ id: item.id, tone: 'ok', text: '고쳤어요.' })
                    onUpdated(item.id, patch)
                  }}
                />
              ) : confirming ? (
                <div
                  className="v4-reg-confirm"
                  role="alertdialog"
                  aria-label="영상 지우기 확인"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setConfirmId(null)
                      focusRowButton('del', item.id)
                    }
                  }}
                >
                  <span>이 영상을 목록에서 지울까요? 되돌릴 수 없어요.</span>
                  <button type="button" className="button v4-mini v4-danger" disabled={busy} onClick={() => void remove(item)} autoFocus>
                    {busy ? '지우는 중…' : '지우기'}
                  </button>
                  <button
                    type="button"
                    className="button secondary v4-mini"
                    disabled={busy}
                    onClick={() => {
                      setConfirmId(null)
                      focusRowButton('del', item.id)
                    }}
                  >
                    아니요, 그대로 둘게요
                  </button>
                </div>
              ) : (
                <div className="v4-reg-item-sub">
                  {isNew ? <span className="v4-new-badge">방금 등록</span> : null}
                  <span>{item.stock_name}</span>
                  <FormatPill contentType={item.content_type} />
                  <span>{fmtRelative(item.created_at)}</span>
                  <span className="v4-reg-item-actions">
                    <button
                      type="button"
                      className="v4-text-btn v4-touch"
                      aria-label={`${item.stock_name} 영상 수정`}
                      data-edit-for={item.id}
                      disabled={Boolean(busyId)}
                      onClick={() => {
                        setMessage(null)
                        setConfirmId(null)
                        setEditingId(item.id)
                      }}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className="v4-text-btn danger v4-touch"
                      aria-label={`${item.stock_name} 영상 삭제`}
                      data-del-for={item.id}
                      disabled={Boolean(busyId)}
                      onClick={() => {
                        setMessage(null)
                        setEditingId(null)
                        setConfirmId(item.id)
                      }}
                    >
                      삭제
                    </button>
                  </span>
                </div>
              )}

              {msg ? (
                <div className={`v4-reg-item-msg ${msg.tone}`} role={msg.tone === 'error' ? 'alert' : 'status'}>
                  {msg.text}
                  {needsRelogin(msg.text) ? (
                    <>
                      {' '}
                      <a className="link" href={loginHrefWithNext(LOGIN_HREF, '/v4/register')} target="_blank" rel="noopener noreferrer">
                        다시 로그인 (새 창)
                      </a>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="v4-reg-item-num" title={`좋아요 ${fmtNumber(item.like_count)} · 댓글 ${fmtNumber(item.comment_count)}`}>
              <strong>{fmtNumber(item.view_count)}</strong>
              <span>조회</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
})

function EditForm({
  item,
  stockChoices,
  onCancel,
  onSaved
}: {
  item: MyVideo
  stockChoices: string[]
  onCancel: () => void
  onSaved: (patch: { stock_name: string; content_type: ContentType }) => void
}) {
  const stockRef = useRef<HTMLInputElement>(null)
  const [stock, setStock] = useState(item.stock_name)
  const [type, setType] = useState<ContentType>(item.content_type)
  const [memo, setMemo] = useState('')
  const [originalMemo, setOriginalMemo] = useState<string | null>(null) // null = 아직 불러오는 중
  const [memoFailed, setMemoFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const listId = `v4-edit-stocks-${item.id}`

  useEffect(() => {
    stockRef.current?.focus()
    stockRef.current?.select()
    let alive = true
    void loadMyVideoMemo(item.id).then((value) => {
      if (!alive) return
      if (value === null) {
        setMemoFailed(true)
        return
      }
      setOriginalMemo(value)
      setMemo(value)
    })
    return () => {
      alive = false
    }
  }, [item.id])

  const save = async () => {
    if (saving) return
    const nextStock = normalizeStockName(stock)
    if (!nextStock) {
      setError('종목명을 적어 주세요.')
      stockRef.current?.focus()
      return
    }
    const patch: VideoPatch = {}
    if (nextStock !== item.stock_name) patch.stock_name = nextStock
    if (type !== item.content_type) patch.content_type = type
    if (originalMemo !== null && memo.trim() !== originalMemo.trim()) patch.content_category = memo.trim() || null
    if (Object.keys(patch).length === 0) {
      onCancel()
      return
    }
    setSaving(true)
    setError('')
    const result = await patchMyVideo(item.id, patch)
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSaved({ stock_name: result.item.stock_name, content_type: result.item.content_type })
  }

  return (
    <form
      className="v4-reg-edit"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (!saving) onCancel()
        }
      }}
    >
      <div className="v4-reg-edit-grid">
        <label className="v4-reg-edit-field">
          <span>종목명</span>
          <input
            ref={stockRef}
            className="input"
            list={listId}
            autoComplete="off"
            spellCheck={false}
            value={stock}
            disabled={saving}
            aria-invalid={error && !normalizeStockName(stock) ? true : undefined}
            onChange={(e) => {
              setStock(e.target.value)
              setError('')
            }}
          />
          <datalist id={listId}>
            {stockChoices.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <div className="v4-reg-edit-field">
          <span id={`${listId}-fmt`}>형식</span>
          <FormatToggle value={type} onChange={setType} disabled={saving} labelledBy={`${listId}-fmt`} />
        </div>
        <label className="v4-reg-edit-field memo">
          <span>메모 (선택)</span>
          <input
            className="input"
            autoComplete="off"
            maxLength={200}
            value={memo}
            disabled={saving || originalMemo === null}
            placeholder={memoFailed ? '메모를 불러오지 못했어요' : originalMemo === null ? '불러오는 중…' : '예: 실적 발표 · 급등 이슈'}
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
      </div>
      <div className="v4-reg-edit-actions">
        <button className="button v4-mini" type="submit" disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
        <button className="button secondary v4-mini" type="button" disabled={saving} onClick={onCancel}>
          취소
        </button>
        {error ? (
          <span className="v4-hint warn" role="alert">
            {error}
            {needsRelogin(error) ? (
              <>
                {' '}
                <a className="link" href={loginHrefWithNext(LOGIN_HREF, '/v4/register')} target="_blank" rel="noopener noreferrer">
                  다시 로그인 (새 창)
                </a>
              </>
            ) : null}
          </span>
        ) : (
          <span className="v4-hint">Enter 저장 · Esc 닫기</span>
        )}
      </div>
    </form>
  )
}
