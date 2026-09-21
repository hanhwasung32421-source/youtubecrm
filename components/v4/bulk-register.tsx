'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MAX_BULK_ROWS, parseBulkText, removeLine, type ParsedLine } from '@/components/v4/register-bulk'
import { registerVideo, type ContentType } from '@/components/v4/register-api'
import { normalizeStockName } from '@/components/v4/register-utils'

type RowStatus = 'pending' | 'running' | 'done' | 'failed'

type Row = ParsedLine & {
  stockEdited: boolean
  formatOverride: ContentType | null
  status: RowStatus
  error: string
}

const CONCURRENCY = 2 // 유튜브 호출 한도를 아끼려고 동시에 2개까지만

const PLACEHOLDER = ['https://youtu.be/AbC123xyz 삼성전자', 'https://www.youtube.com/shorts/DeF456uvw 에코프로', 'https://youtu.be/GhI789rst   (종목을 안 적으면 위의 공통 종목이 쓰여요)'].join('\n')

function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.|m\.)?/i, '')
}

function effectiveStock(row: Row, common: string) {
  return normalizeStockName(row.stock) || normalizeStockName(common)
}

function effectiveFormat(row: Row, fallback: ContentType): ContentType {
  if (row.formatOverride) return row.formatOverride
  return row.shorts ? 'shortform' : fallback
}

export function BulkRegister({
  defaultFormat,
  stockChoices,
  existingIds,
  onFinished
}: {
  defaultFormat: ContentType
  stockChoices: string[]
  existingIds: Set<string>
  onFinished: (result: { ids: string[]; stocks: string[] }) => void
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<Row[]>([])
  const runningRef = useRef(false)

  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [dupes, setDupes] = useState(0)
  const [overflow, setOverflow] = useState(0)
  const [commonStock, setCommonStock] = useState('')
  const [format, setFormat] = useState<ContentType>(defaultFormat)
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)

  rowsRef.current = rows

  useEffect(() => {
    textRef.current?.focus()
  }, [])

  // 등록하는 동안 창을 닫으면 나머지가 등록되지 않는다는 걸 알려 준다.
  useEffect(() => {
    if (!running) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [running])

  const reparse = (nextText: string) => {
    const parsed = parseBulkText(nextText)
    setDupes(parsed.duplicates)
    setOverflow(Math.max(0, parsed.rows.length - MAX_BULK_ROWS))
    const limited = parsed.rows.slice(0, MAX_BULK_ROWS)
    setRows((prev) => {
      const old = new Map(prev.map((r) => [r.key, r]))
      return limited.map<Row>((p) => {
        const before = p.valid ? old.get(p.key) : undefined
        return {
          ...p,
          stock: before?.stockEdited ? before.stock : p.stock,
          stockEdited: before?.stockEdited || false,
          formatOverride: before?.formatOverride || null,
          status: 'pending',
          error: ''
        }
      })
    })
  }

  const patchRow = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const removeRow = (row: Row) => {
    if (running) return
    if (!started) {
      const next = removeLine(text, row.lineNo)
      setText(next)
      reparse(next)
    } else {
      setRows((prev) => prev.filter((r) => r.key !== row.key))
    }
  }

  const reset = () => {
    if (running) return
    setText('')
    setRows([])
    setDupes(0)
    setOverflow(0)
    setStarted(false)
    window.setTimeout(() => textRef.current?.focus(), 0)
  }

  const isReady = (row: Row) => row.valid && (row.status === 'pending' || row.status === 'failed') && Boolean(effectiveStock(row, commonStock))

  const validRows = rows.filter((r) => r.valid)
  const readyRows = rows.filter((r) => r.valid && r.status === 'pending' && effectiveStock(r, commonStock))
  const failedRows = rows.filter((r) => r.status === 'failed')
  const doneRows = rows.filter((r) => r.status === 'done')
  const needStockRows = rows.filter((r) => r.valid && r.status === 'pending' && !effectiveStock(r, commonStock))
  const invalidRows = rows.filter((r) => !r.valid)

  const run = async (target: 'ready' | 'failed') => {
    if (runningRef.current) return
    const pool = rowsRef.current.filter((r) => isReady(r) && (target === 'failed' ? r.status === 'failed' : r.status === 'pending'))
    if (pool.length === 0) return

    const jobs = pool.map((r) => ({ key: r.key, url: r.url, contentType: effectiveFormat(r, format), stockName: effectiveStock(r, commonStock) }))
    runningRef.current = true
    setRunning(true)
    setStarted(true)
    setRows((prev) => prev.map((r) => (jobs.some((j) => j.key === r.key) ? { ...r, status: 'pending', error: '' } : r)))

    const registered: { id: string | null; stock: string }[] = []
    const queue = [...jobs]
    const worker = async () => {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) break
        patchRow(job.key, { status: 'running', error: '' })
        const result = await registerVideo({ youtubeUrl: job.url, contentType: job.contentType, stockName: job.stockName })
        if (result.ok) {
          registered.push({ id: result.video?.id || null, stock: job.stockName })
          patchRow(job.key, { status: 'done', error: '' })
        } else {
          patchRow(job.key, { status: 'failed', error: result.message })
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()))
    } finally {
      runningRef.current = false
      setRunning(false)
      onFinished({ ids: registered.map((r) => r.id).filter((id): id is string => Boolean(id)), stocks: registered.map((r) => r.stock) })
    }
  }

  const focusNextStock = (from: HTMLInputElement) => {
    const inputs = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>('input.v4-bulk-stock:not(:disabled)') || [])
    const next = inputs[inputs.indexOf(from) + 1]
    if (next) next.focus()
    else if (readyRows.length > 0) (tableRef.current?.closest('.v4-bulk')?.querySelector('button.v4-reg-submit') as HTMLButtonElement | null)?.focus()
  }

  const finished = started && !running && validRows.length > 0
  const allDone = finished && failedRows.length === 0 && needStockRows.length === 0
  const summaryParts = useMemo(() => {
    const parts: string[] = [`${validRows.length}개 중 ${doneRows.length}개 등록됨`]
    if (failedRows.length > 0) parts.push(`${failedRows.length}개 실패`)
    if (needStockRows.length > 0) parts.push(`${needStockRows.length}개는 종목명이 없어 아직 등록 전`)
    return parts
  }, [validRows.length, doneRows.length, failedRows.length, needStockRows.length])

  return (
    <div className="panel v4-reg-form v4-bulk">
      {!started ? (
        <div className="field">
          <label className="label" htmlFor="v4-bulk-text">
            영상 주소 붙여넣기 (한 줄에 하나)
          </label>
          <textarea
            id="v4-bulk-text"
            ref={textRef}
            className="textarea v4-bulk-text"
            rows={6}
            spellCheck={false}
            autoComplete="off"
            placeholder={PLACEHOLDER}
            value={text}
            disabled={running}
            onChange={(e) => {
              setText(e.target.value)
              reparse(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void run('ready')
              }
            }}
          />
          <div className="v4-hint-slot">
            <span className="v4-hint">
              한 줄에 <strong>주소 종목명</strong> 형태로 적어 주세요. 종목명을 빼면 아래 공통 종목이 쓰입니다. 쇼츠 주소는 숏폼으로 자동 표시돼요.
            </span>
          </div>
        </div>
      ) : null}

      {!started ? (
        <div className="v4-bulk-common">
          <div className="field v4-reg-stock">
            <label className="label" htmlFor="v4-bulk-common">
              공통 종목 (선택)
            </label>
            <input
              id="v4-bulk-common"
              className="input"
              list="v4-bulk-stock-list"
              autoComplete="off"
              placeholder="종목명을 안 적은 줄에 쓰여요"
              value={commonStock}
              disabled={running}
              onChange={(e) => setCommonStock(e.target.value)}
            />
          </div>
          <div className="field">
            <span className="label" id="v4-bulk-format-label">
              기본 형식
            </span>
            <div className="v4-segment" role="radiogroup" aria-labelledby="v4-bulk-format-label">
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
                  aria-checked={format === value}
                  className={`v4-segment-item ${format === value ? 'active' : ''}`}
                  disabled={running}
                  onClick={() => setFormat(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <datalist id="v4-bulk-stock-list">
        {stockChoices.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {dupes > 0 || overflow > 0 || invalidRows.length > 0 ? (
        <div className="v4-bulk-notes">
          {dupes > 0 ? <span className="v4-hint">같은 영상이 여러 번 있어서 {dupes}개는 뺐어요.</span> : null}
          {invalidRows.length > 0 ? <span className="v4-hint warn">주소를 알아볼 수 없는 줄이 {invalidRows.length}개 있어요. 아래에서 확인해 주세요.</span> : null}
          {overflow > 0 ? <span className="v4-hint warn">한 번에 {MAX_BULK_ROWS}개까지만 등록할 수 있어요. 나머지 {overflow}개는 다음에 붙여넣어 주세요.</span> : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="v4-bulk-table-wrap" ref={tableRef}>
          <table className="v4-bulk-table">
            <thead>
              <tr>
                <th scope="col" className="num">
                  #
                </th>
                <th scope="col">정리된 주소</th>
                <th scope="col">종목명</th>
                <th scope="col">형식</th>
                <th scope="col">상태</th>
                <th scope="col">
                  <span className="v4-sr">줄 빼기</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const stock = effectiveStock(row, commonStock)
                const editable = row.valid && !running && (row.status === 'pending' || row.status === 'failed')
                const missingStock = row.valid && row.status === 'pending' && !stock
                const alreadyRegistered = row.valid && row.status === 'pending' && existingIds.has(row.videoId)
                const rowFormat = effectiveFormat(row, format)
                return (
                  <tr key={row.key} className={`v4-bulk-row ${row.status} ${!row.valid ? 'invalid' : ''}`}>
                    <td className="num">{index + 1}</td>
                    <td className="url" title={row.url}>
                      {shortUrl(row.url)}
                    </td>
                    <td>
                      {row.valid ? (
                        <input
                          className="input v4-bulk-stock"
                          list="v4-bulk-stock-list"
                          autoComplete="off"
                          aria-label={`${index + 1}번 종목명`}
                          aria-invalid={missingStock ? true : undefined}
                          placeholder={normalizeStockName(commonStock) || '종목명 입력'}
                          value={row.stock}
                          disabled={!editable}
                          onChange={(e) => patchRow(row.key, { stock: e.target.value, stockEdited: true })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault()
                              focusNextStock(e.currentTarget)
                            }
                          }}
                        />
                      ) : (
                        <span className="muted small">-</span>
                      )}
                    </td>
                    <td>
                      {row.valid ? (
                        <select
                          className="input v4-bulk-select"
                          aria-label={`${index + 1}번 형식`}
                          value={rowFormat}
                          disabled={!editable}
                          onChange={(e) => patchRow(row.key, { formatOverride: e.target.value as ContentType })}
                        >
                          <option value="longform">롱폼</option>
                          <option value="shortform">숏폼</option>
                        </select>
                      ) : (
                        <span className="muted small">-</span>
                      )}
                    </td>
                    <td className="status">
                      {!row.valid ? (
                        <span className="v4-bulk-badge bad">{row.problem}</span>
                      ) : row.status === 'running' ? (
                        <span className="v4-bulk-badge run">등록 중…</span>
                      ) : row.status === 'done' ? (
                        <span className="v4-bulk-badge ok">완료</span>
                      ) : row.status === 'failed' ? (
                        <span className="v4-bulk-badge bad" title={row.error}>
                          실패 · {row.error}
                        </span>
                      ) : missingStock ? (
                        <span className="v4-bulk-badge warn">종목명 필요</span>
                      ) : alreadyRegistered ? (
                        <span className="v4-bulk-badge wait" title="이미 등록된 영상이에요. 등록하면 종목·형식이 지금 값으로 바뀝니다.">
                          대기 · 이미 등록됨
                        </span>
                      ) : (
                        <span className="v4-bulk-badge wait">대기</span>
                      )}
                    </td>
                    <td className="act">
                      {!running && row.status !== 'done' ? (
                        <button type="button" className="v4-icon-btn" aria-label={`${index + 1}번 줄 빼기`} title="이 줄 빼기" onClick={() => removeRow(row)}>
                          ×
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {finished ? (
        <div className={`v4-reg-status ${allDone ? 'ok' : 'error'}`} role="status" aria-live="polite">
          <strong>
            {allDone ? '✓ ' : ''}
            {summaryParts.join(' · ')}
          </strong>
          {failedRows.length > 0 ? <span className="v4-reg-status-detail"> → 아래 버튼으로 다시 시도할 수 있어요</span> : null}
        </div>
      ) : running ? (
        <div className="v4-reg-status" role="status" aria-live="polite">
          <strong>
            등록 중… {doneRows.length + failedRows.length} / {validRows.length}
          </strong>
          <span className="v4-reg-status-detail"> — 창을 닫지 말고 잠시만 기다려 주세요</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="v4-reg-status" role="status" aria-live="polite">
          <span className="muted">주소를 붙여넣으면 여기서 미리 확인한 뒤 한 번에 등록할 수 있어요. (Ctrl+Enter 로 바로 등록)</span>
        </div>
      ) : needStockRows.length > 0 ? (
        <div className="v4-reg-status" role="status" aria-live="polite">
          <span className="muted">종목명이 비어 있는 {needStockRows.length}개는 종목명을 채우면 함께 등록돼요.</span>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="v4-bulk-actions">
          <button className="button v4-reg-submit" type="button" disabled={running || readyRows.length === 0} onClick={() => void run('ready')}>
            {running ? '등록 중…' : `${readyRows.length}개 등록`}
          </button>
          {failedRows.length > 0 ? (
            <button className="button secondary" type="button" disabled={running} onClick={() => void run('failed')}>
              실패 {failedRows.length}개 다시 시도
            </button>
          ) : null}
          <button className="button secondary" type="button" disabled={running} onClick={reset}>
            {started ? '새로 붙여넣기' : '모두 지우기'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
