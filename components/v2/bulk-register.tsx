'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { authedPatchJson } from '@/lib/v2/client'
import { authedPostJson } from '@/lib/session/authed-fetch'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, type ContentType } from '@/lib/v2/types'
import { friendlyRegisterError, isImeKey, parseBulkText, youtubeVideoId } from './register-utils'
import { Segmented } from './segmented'

const CONCURRENCY = 2

type RowResult = { status: 'queued' | 'running' | 'done' | 'failed'; error?: string }
type RowEdit = { stock?: string; type?: ContentType }

type RowView = {
  key: string
  line: number
  url: string
  videoId: string | null
  stock: string
  type: ContentType
  autoShorts: boolean
  problem: 'url' | 'stock' | null
  alreadyRegistered: boolean
}

type Props = {
  initialText?: string
  notice?: string
  defaultType: ContentType
  stockChips: string[]
  registeredIds: Set<string>
  onRegistered: (info: { videoId: string; stock: string; type: ContentType }) => void
  onFinished: () => void
  onClose: () => void
}

const TYPE_OPTIONS = CONTENT_TYPES.map((type) => ({ value: type, label: CONTENT_TYPE_LABELS[type] }))

function toWatchUrl(url: string) {
  const id = youtubeVideoId(url)
  return id ? `https://www.youtube.com/watch?v=${id}` : url
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, '')
}

export function BulkRegister({ initialText = '', notice, defaultType, stockChips, registeredIds, onRegistered, onFinished, onClose }: Props) {
  const [text, setText] = useState(initialText)
  const [commonStock, setCommonStock] = useState('')
  const [baseType, setBaseType] = useState<ContentType>(defaultType)
  const [edits, setEdits] = useState<Record<string, RowEdit>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [running, setRunning] = useState(false)
  const [ranOnce, setRanOnce] = useState(false)

  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(true)
  const runningRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    textRef.current?.focus()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const parsed = useMemo(() => parseBulkText(text), [text])

  const rows: RowView[] = useMemo(() => {
    const common = commonStock.trim().replace(/\s+/g, ' ')
    return parsed.rows
      .filter((r) => !removed.has(r.key))
      .map((r) => {
        const edit = edits[r.key] || {}
        const own = (edit.stock ?? '').trim() || r.stock
        const stock = (own || common).trim().replace(/\s+/g, ' ')
        const type: ContentType = edit.type ?? (r.isShorts ? 'shortform' : baseType)
        return {
          key: r.key,
          line: r.line,
          url: r.url,
          videoId: r.videoId,
          stock,
          type,
          autoShorts: r.isShorts,
          problem: !r.videoId ? 'url' : !stock ? 'stock' : null,
          alreadyRegistered: Boolean(r.videoId && registeredIds.has(r.videoId))
        }
      })
  }, [parsed, removed, edits, commonStock, baseType, registeredIds])

  const eligible = rows.filter((r) => !r.problem && results[r.key]?.status !== 'done')
  const failed = rows.filter((r) => results[r.key]?.status === 'failed')
  const untried = eligible.filter((r) => !results[r.key])
  const doneCount = rows.filter((r) => results[r.key]?.status === 'done').length
  const attempted = rows.filter((r) => results[r.key]).length
  const processed = rows.filter((r) => results[r.key]?.status === 'done' || results[r.key]?.status === 'failed').length
  const needInput = rows.filter((r) => r.problem && results[r.key]?.status !== 'done')
  const needStockCount = rows.filter((r) => r.problem === 'stock').length
  const needUrlCount = rows.filter((r) => r.problem === 'url').length

  const setEdit = (key: string, patch: RowEdit) => setEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const register = async (targets: RowView[]) => {
    if (runningRef.current || targets.length === 0) return
    runningRef.current = true
    setRunning(true)
    setRanOnce(true)
    setResults((prev) => {
      const next = { ...prev }
      for (const r of targets) next[r.key] = { status: 'queued' }
      return next
    })

    let cursor = 0
    const worker = async () => {
      while (mountedRef.current) {
        const index = cursor
        cursor += 1
        if (index >= targets.length) return
        const row = targets[index]
        setResults((prev) => ({ ...prev, [row.key]: { status: 'running' } }))
        let result: RowResult
        try {
          const { ok, status, data } = await authedPostJson<{ ok?: boolean; video?: { id: string }; error?: string }>('/api/videos/create', {
            youtubeUrl: toWatchUrl(row.url),
            contentType: row.type,
            stockName: row.stock,
            contentCategory: null
          })
          if (ok && data.video) {
            result = { status: 'done' }
            // SEO 점검표 기본 행. 실패해도 등록에는 영향 없음.
            void authedPatchJson('/api/v2/seo-checklists', { videoId: data.video.id, patch: {} }).catch(() => undefined)
            if (mountedRef.current) onRegistered({ videoId: data.video.id, stock: row.stock, type: row.type })
          } else {
            result = { status: 'failed', error: friendlyRegisterError(data?.error, status) }
          }
        } catch {
          result = { status: 'failed', error: '네트워크가 불안정해요. 잠시 후 다시 시도해 주세요.' }
        }
        if (mountedRef.current) setResults((prev) => ({ ...prev, [row.key]: result }))
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    runningRef.current = false
    if (mountedRef.current) {
      setRunning(false)
      onFinished()
    }
  }

  const reset = () => {
    setText('')
    setEdits({})
    setRemoved(new Set())
    setResults({})
    setRanOnce(false)
    textRef.current?.focus()
  }

  // 종목 칸에서 Enter → 다음 줄의 종목 칸으로(한 손으로 빠르게 채우기)
  const focusNextStock = (current: HTMLInputElement) => {
    const inputs = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-bulk-stock]:not(:disabled)') || [])
    const idx = inputs.indexOf(current)
    const next = inputs[idx + 1]
    if (next) next.focus()
    else current.blur()
  }

  const primaryLabel = running
    ? '등록 중…'
    : failed.length > 0 && untried.length === 0
      ? `실패한 ${failed.length}개 다시 시도`
      : `${eligible.length}개 등록`

  const showSummary = ranOnce && attempted > 0

  return (
    <div className="panel v2-bulk">
      <div className="panel-header">
        <div>
          <div className="panel-title">여러 개 붙여넣기</div>
          <p className="panel-subtitle">한 줄에 영상 하나씩, 「주소 종목명」 순서로 붙여 넣으세요. 종목명은 비워 두고 아래 공통 종목으로 채워도 돼요.</p>
        </div>
        <button type="button" className="button secondary xs" onClick={onClose} disabled={running}>
          ← 한 개씩 등록
        </button>
      </div>

      <div className="v2-register-form">
        {notice ? (
          <div className="v2-hint quiet" role="status">
            {notice}
          </div>
        ) : null}
        <div className="field">
          <label className="label" htmlFor="v2-bulk-text">
            주소 목록
          </label>
          <textarea
            id="v2-bulk-text"
            ref={textRef}
            className="textarea v2-bulk-text"
            rows={6}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={'https://youtu.be/abc123 삼성전자\nhttps://www.youtube.com/shorts/xyz789 SK하이닉스'}
            value={text}
            disabled={running}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="v2-reg-row">
          <div className="field v2-reg-stock">
            <label className="label" htmlFor="v2-bulk-common">
              공통 종목 (선택)
            </label>
            <input
              id="v2-bulk-common"
              className="input"
              placeholder="종목명이 없는 줄에 이 종목이 들어가요"
              autoComplete="off"
              spellCheck={false}
              list="v2-bulk-stock-list"
              value={commonStock}
              disabled={running}
              onChange={(e) => setCommonStock(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="label" id="v2-bulk-type-label">
              기본 형식
            </span>
            <Segmented value={baseType} onChange={setBaseType} options={TYPE_OPTIONS} labelledBy="v2-bulk-type-label" disabled={running} />
          </div>
        </div>

        <datalist id="v2-bulk-stock-list">
          {stockChips.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {stockChips.length > 0 ? (
          <div className="v2-recent">
            <span className="small muted">최근 종목</span>
            <div className="v2-chips">
              {stockChips.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`v2-chip v2-chip-btn ${commonStock.trim() === name ? 'on' : ''}`}
                  disabled={running}
                  onClick={() => setCommonStock(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="small muted">주소를 붙여 넣으면 여기에 정리된 목록이 보여요. 쇼츠 주소는 형식이 자동으로 숏폼이 됩니다.</div>
        ) : (
          <>
            {parsed.duplicates > 0 ? <div className="v2-hint quiet">같은 영상이 여러 번 붙어 있어서 {parsed.duplicates}개는 뺐어요.</div> : null}

            <div className="v2-bulk-table-wrap" ref={tableRef}>
              <table className="v2-bulk-table" role="table" aria-label="등록할 영상 목록">
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">#</th>
                    <th scope="col" role="columnheader">정리된 주소</th>
                    <th scope="col" role="columnheader">종목</th>
                    <th scope="col" role="columnheader">형식</th>
                    <th scope="col" role="columnheader">상태</th>
                    <th scope="col" role="columnheader" aria-label="빼기" />
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {rows.map((row, i) => {
                    const result = results[row.key]
                    const locked = running || result?.status === 'done'
                    return (
                      <tr key={row.key} role="row" className={result?.status === 'done' ? 'is-done' : result?.status === 'failed' ? 'is-failed' : ''}>
                        <td role="cell" className="v2-mono v2-c-num">{i + 1}</td>
                        <td role="cell" className="v2-bulk-url v2-c-url" title={row.url}>
                          {shortUrl(row.url)}
                        </td>
                        <td role="cell" className="v2-c-stock">
                          <input
                            className={`input compact v2-bulk-stock ${!row.stock && !result ? 'need' : ''}`}
                            data-bulk-stock
                            aria-label={`${i + 1}번 종목명`}
                            placeholder={commonStock.trim() || '종목명'}
                            autoComplete="off"
                            spellCheck={false}
                            enterKeyHint="next"
                            list="v2-bulk-stock-list"
                            value={edits[row.key]?.stock ?? row.stock}
                            disabled={locked}
                            onChange={(e) => setEdit(row.key, { stock: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !isImeKey(e)) {
                                e.preventDefault()
                                focusNextStock(e.currentTarget)
                              }
                            }}
                          />
                        </td>
                        <td role="cell" className="v2-c-type">
                          <select
                            className="select compact v2-bulk-type"
                            aria-label={`${i + 1}번 형식`}
                            value={row.type}
                            disabled={locked}
                            onChange={(e) => setEdit(row.key, { type: e.target.value as ContentType })}
                          >
                            {CONTENT_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {CONTENT_TYPE_LABELS[type]}
                              </option>
                            ))}
                          </select>
                          {row.autoShorts && !edits[row.key]?.type ? <span className="v2-bulk-auto"> 자동</span> : null}
                        </td>
                        <td role="cell" className="v2-c-st">
                          <RowStatus row={row} result={result} />
                        </td>
                        <td role="cell" className="v2-c-rm">
                          <button
                            type="button"
                            className="v2-icon-btn"
                            aria-label={`${i + 1}번 줄 빼기`}
                            title="이 줄 빼기"
                            disabled={locked}
                            onClick={() => setRemoved((prev) => new Set(prev).add(row.key))}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {needInput.length > 0 && !running ? (
              <div className="v2-hint" role="status">
                {needUrlCount > 0 ? `주소를 알아볼 수 없는 ${needUrlCount}줄은 건너뛰어요. ` : ''}
                {needStockCount > 0 ? `종목명이 비어 있는 ${needStockCount}줄은 종목을 적으면 등록할 수 있어요.` : ''}
              </div>
            ) : null}

            <div className="v2-bulk-actions">
              <button type="button" className="button v2-reg-submit" disabled={running || eligible.length === 0} onClick={() => void register(eligible)}>
                {primaryLabel}
              </button>
              {failed.length > 0 && untried.length > 0 && !running ? (
                <button type="button" className="button secondary" onClick={() => void register(failed)}>
                  실패한 {failed.length}개만 다시 시도
                </button>
              ) : null}
              <button type="button" className="button secondary" disabled={running} onClick={reset}>
                지우고 새로 붙여넣기
              </button>
            </div>

            <div className="v2-status" aria-live="polite" aria-atomic="true">
              {showSummary ? (
                running ? (
                  <span className="v2-hint quiet">
                    {attempted}개 중 {processed}개 처리했어요… 창을 닫지 말고 잠시만 기다려 주세요.
                  </span>
                ) : (
                  <span className={failed.length > 0 ? 'v2-hint' : 'v2-confirm'}>
                    {failed.length === 0 ? <span aria-hidden="true">✓ </span> : null}
                    {attempted}개 중 {doneCount}개 등록됨{failed.length > 0 ? ` · ${failed.length}개 실패 → 다시 시도할 수 있어요` : ''}
                  </span>
                )
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function RowStatus({ row, result }: { row: RowView; result?: RowResult }) {
  if (result) {
    if (result.status === 'queued') return <span className="v2-bulk-st wait">대기</span>
    if (result.status === 'running') return <span className="v2-bulk-st run">등록 중…</span>
    if (result.status === 'done') return <span className="v2-bulk-st ok">✓ 완료</span>
    return (
      <span className="v2-bulk-st bad" title={result.error}>
        실패 · {result.error}
      </span>
    )
  }
  if (row.problem === 'url') return <span className="v2-bulk-st bad">주소를 확인해 주세요</span>
  if (row.problem === 'stock') return <span className="v2-bulk-st need">종목을 적어 주세요</span>
  if (row.alreadyRegistered) return <span className="v2-bulk-st note">이미 등록됨 · 덮어써요</span>
  return <span className="v2-bulk-st wait">준비됨</span>
}
