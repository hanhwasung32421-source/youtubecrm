'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DocRow, DocTable, type DocColumn } from '@/components/v3/ui'
import { MAX_BULK_ROWS, parseBulk, shortUrl } from './bulk-parse'
import { registerVideo, type ContentType } from './register-api'

type RowState = 'queued' | 'running' | 'done' | 'failed'
type Result = { state: RowState; error?: string }
type Override = { stock?: string; type?: ContentType }

type Row =
  | { kind: 'invalid'; key: string; lineNo: number; raw: string }
  | {
      kind: 'valid'
      key: string
      lineNo: number
      videoId: string
      url: string
      stockInput: string // 표에 보이는 값(직접 적었거나 고친 종목)
      stock: string // 실제로 등록할 종목(비어 있으면 공통 종목)
      type: ContentType
      result?: Result
    }

const COLUMNS: DocColumn[] = [
  { key: 'no', label: '#', width: '32px' },
  { key: 'url', label: '정리된 주소', width: 'minmax(0, 1.3fr)' },
  { key: 'stock', label: '종목', width: 'minmax(0, 1fr)' },
  { key: 'type', label: '형식', width: '92px' },
  { key: 'status', label: '상태', width: 'minmax(0, 1.1fr)' },
  { key: 'remove', label: '', width: '28px' }
]

const CONCURRENCY = 2

function typeLabel(type: ContentType) {
  return type === 'shortform' ? '숏폼' : '롱폼'
}

export function BulkRegister({
  contentType,
  onChooseType,
  recentStocks,
  todayIds,
  onRegistered,
  onBatchDone,
  disabled
}: {
  contentType: ContentType
  onChooseType: (type: ContentType) => void
  recentStocks: string[]
  todayIds: Set<string>
  onRegistered: (info: { id: string | null; stock: string }) => void
  onBatchDone: (registeredIds: string[]) => void | Promise<void>
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [commonStock, setCommonStock] = useState('')
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [results, setResults] = useState<Record<string, Result>>({})
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textRef.current?.focus()
  }, [])

  const parsed = useMemo(() => parseBulk(text), [text])
  const common = commonStock.replace(/\s+/g, ' ').trim()

  const { rows, skippedToday } = useMemo(() => {
    const out: Row[] = []
    let skipped = 0
    for (const line of parsed.lines) {
      if (line.kind === 'invalid') {
        out.push({ kind: 'invalid', key: `bad-${line.lineNo}`, lineNo: line.lineNo, raw: line.raw })
        continue
      }
      if (removed.has(line.videoId)) continue
      const result = results[line.videoId]
      // 오늘 이미 등록한 영상은 덮어쓰지 않도록 뺀다(이번 묶음에서 방금 등록한 것은 그대로 보여 준다).
      if (!result && todayIds.has(line.videoId)) {
        skipped++
        continue
      }
      const override = overrides[line.videoId]
      const stockInput = override?.stock ?? line.stock
      out.push({
        kind: 'valid',
        key: line.videoId,
        lineNo: line.lineNo,
        videoId: line.videoId,
        url: line.url,
        stockInput,
        stock: (stockInput.replace(/\s+/g, ' ').trim() || common),
        type: override?.type ?? (line.isShort ? 'shortform' : contentType),
        result
      })
    }
    return { rows: out, skippedToday: skipped }
  }, [parsed, removed, results, todayIds, overrides, common, contentType])

  const valid = rows.filter((row): row is Extract<Row, { kind: 'valid' }> => row.kind === 'valid')
  const invalidCount = rows.length - valid.length
  const readyNew = valid.filter((row) => !row.result && row.stock)
  const needInput = valid.filter((row) => !row.result && !row.stock).length
  const doneCount = valid.filter((row) => row.result?.state === 'done').length
  const failedRows = valid.filter((row) => row.result?.state === 'failed')
  const inFlight = valid.filter((row) => row.result?.state === 'queued' || row.result?.state === 'running').length
  const hasResults = valid.some((row) => row.result)

  const setResult = (id: string, result: Result) => setResults((prev) => ({ ...prev, [id]: result }))
  const patchOverride = (id: string, patch: Override) => setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  // 한 줄이 실패해도 멈추지 않고, 동시에 2개까지만 보내 유튜브 사용량을 아낀다.
  const runBatch = async (targets: typeof valid) => {
    if (targets.length === 0 || running) return
    stopRef.current = false
    setRunning(true)
    for (const row of targets) setResult(row.videoId, { state: 'queued' })

    let next = 0
    const okIds: string[] = []
    const worker = async () => {
      while (next < targets.length) {
        const row = targets[next++]
        if (stopRef.current) {
          setResults((prev) => {
            const copy = { ...prev }
            delete copy[row.videoId]
            return copy
          })
          continue
        }
        setResult(row.videoId, { state: 'running' })
        const result = await registerVideo({ url: row.url, contentType: row.type, stockName: row.stock })
        if (result.ok) {
          setResult(row.videoId, { state: 'done' })
          if (result.id) okIds.push(result.id)
          onRegistered({ id: result.id, stock: row.stock })
        } else {
          setResult(row.videoId, { state: 'failed', error: result.message })
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
    } finally {
      setRunning(false)
      await onBatchDone(okIds)
    }
  }

  const reset = () => {
    setText('')
    setOverrides({})
    setRemoved(new Set())
    setResults({})
    window.setTimeout(() => textRef.current?.focus(), 0)
  }

  const focusNextStock = (index: number) => {
    const el = document.querySelector<HTMLInputElement>(`[data-bulk-stock="${index + 1}"]`)
    el?.focus()
  }

  const locked = running || !!disabled
  const summaryTotal = valid.length

  return (
    <div className="v3-bulk">
      <div className="field">
        <label className="label" htmlFor="v3-bulk-text">주소 붙여넣기</label>
        <textarea
          id="v3-bulk-text"
          ref={textRef}
          className="textarea v3-bulk-text"
          rows={5}
          spellCheck={false}
          value={text}
          readOnly={locked}
          placeholder={'한 줄에 영상 하나씩, 주소 뒤에 종목을 적어요.\nhttps://youtu.be/AbCdEfGhIjK 삼성전자\nhttps://www.youtube.com/shorts/LmNoPqRsTuV SK하이닉스'}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="v3-reg-hint">종목은 빼도 돼요. 빠진 줄에는 아래 공통 종목이 들어갑니다. 한 번에 {MAX_BULK_ROWS}개까지 가능해요.</div>
      </div>

      <div className="v3-reg-row v3-bulk-common">
        <div className="field">
          <label className="label" htmlFor="v3-bulk-common">공통 종목 (선택)</label>
          <input
            id="v3-bulk-common"
            className="input"
            autoComplete="off"
            placeholder="종목이 없는 줄에 넣을 종목"
            value={commonStock}
            readOnly={locked}
            onChange={(e) => setCommonStock(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="label" id="v3-bulk-type-label">기본 형식</span>
          <div className="v3-seg" role="group" aria-labelledby="v3-bulk-type-label">
            {(['longform', 'shortform'] as const).map((type) => (
              <button key={type} type="button" aria-pressed={contentType === type} disabled={locked} onClick={() => onChooseType(type)}>
                {typeLabel(type)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {recentStocks.length > 0 ? (
        <div className="v3-reg-chips" aria-label="최근 쓴 종목">
          <span className="v3-reg-chips-label">최근 종목</span>
          {recentStocks.map((name) => (
            <button
              type="button"
              key={name}
              className={`v3-tag blue v3-tag-button ${commonStock.trim() === name ? 'active' : ''}`}
              disabled={locked}
              onClick={() => setCommonStock(commonStock.trim() === name ? '' : name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {parsed.duplicates > 0 || skippedToday > 0 || parsed.overflow > 0 ? (
        <div className="v3-reg-hint warn v3-bulk-notes">
          {parsed.duplicates > 0 ? <span>같은 영상 {parsed.duplicates}개는 한 번만 넣었어요.</span> : null}
          {skippedToday > 0 ? <span>오늘 이미 등록한 영상 {skippedToday}개는 뺐어요.</span> : null}
          {parsed.overflow > 0 ? <span>{MAX_BULK_ROWS}개를 넘는 {parsed.overflow}줄은 다음에 붙여넣어 주세요.</span> : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          <DocTable columns={COLUMNS}>
            {rows.map((row, index) => {
              if (row.kind === 'invalid') {
                return (
                  <DocRow columns={COLUMNS} key={row.key}>
                    <div className="small muted">{index + 1}</div>
                    <div className="v3-cell-sub" title={row.raw} style={{ gridColumn: 'span 3' }}>{row.raw}</div>
                    <div className="v3-bulk-state bad">유효하지 않은 주소</div>
                    <div />
                  </DocRow>
                )
              }
              const state = row.result?.state
              const editable = !locked && state !== 'done' && state !== 'queued' && state !== 'running'
              return (
                <DocRow columns={COLUMNS} key={row.key} className={state === 'done' ? 'v3-bulk-done' : undefined}>
                  <div className="small muted">{index + 1}</div>
                  <div className="v3-cell-sub" title={row.url}>{shortUrl(row.videoId)}</div>
                  <div>
                    <input
                      className="input"
                      data-bulk-stock={index}
                      aria-label={`${index + 1}번 종목`}
                      autoComplete="off"
                      placeholder={common || '종목 입력'}
                      value={row.stockInput}
                      readOnly={!editable}
                      onChange={(e) => patchOverride(row.videoId, { stock: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          focusNextStock(index)
                        }
                      }}
                    />
                  </div>
                  <div>
                    <select
                      className="select"
                      aria-label={`${index + 1}번 형식`}
                      value={row.type}
                      disabled={!editable}
                      onChange={(e) => patchOverride(row.videoId, { type: e.target.value as ContentType })}
                    >
                      <option value="longform">롱폼</option>
                      <option value="shortform">숏폼</option>
                    </select>
                  </div>
                  <div className={`v3-bulk-state ${state === 'done' ? 'ok' : state === 'failed' ? 'bad' : !state && !row.stock ? 'warn' : ''}`} title={row.result?.error}>
                    {state === 'done'
                      ? '완료'
                      : state === 'running'
                        ? '등록 중…'
                        : state === 'queued'
                          ? '대기'
                          : state === 'failed'
                            ? `실패 · ${row.result?.error || '다시 시도해 주세요.'}`
                            : row.stock
                              ? '대기'
                              : '종목 입력 필요'}
                  </div>
                  <div>
                    {state === 'done' || state === 'queued' || state === 'running' || locked ? null : (
                      <button
                        type="button"
                        className="v3-icon-button"
                        aria-label={`${index + 1}번 줄 빼기`}
                        title="이 줄 빼기"
                        onClick={() => setRemoved((prev) => new Set(prev).add(row.videoId))}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </DocRow>
              )
            })}
          </DocTable>

          <div className="v3-bulk-actions">
            <div className="v3-bulk-summary" role="status" aria-live="polite">
              {running ? (
                <span>
                  등록 중 · {doneCount + failedRows.length}/{doneCount + failedRows.length + inFlight}
                </span>
              ) : hasResults ? (
                failedRows.length > 0 ? (
                  <span className="bad">
                    {summaryTotal}개 중 {doneCount}개 등록됨 · {failedRows.length}개 실패
                  </span>
                ) : (
                  <span className="ok">
                    {doneCount}개 등록됨{summaryTotal > doneCount ? ` · ${summaryTotal - doneCount}개 남음` : ''}
                  </span>
                )
              ) : needInput > 0 ? (
                <span className="warn">종목이 필요한 줄 {needInput}개 — 종목을 적거나 공통 종목을 넣어 주세요.</span>
              ) : invalidCount > 0 ? (
                <span className="warn">유효하지 않은 주소 {invalidCount}줄은 등록되지 않아요.</span>
              ) : null}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {running ? (
                <button type="button" className="button secondary" onClick={() => (stopRef.current = true)}>
                  남은 것 멈추기
                </button>
              ) : null}
              {!running && failedRows.length > 0 ? (
                <button type="button" className="button secondary" onClick={() => void runBatch(failedRows.filter((row) => row.stock))}>
                  실패한 {failedRows.length}개 다시 시도
                </button>
              ) : null}
              {!running && hasResults && readyNew.length === 0 && failedRows.length === 0 ? (
                <button type="button" className="button secondary" onClick={reset}>
                  새로 붙여넣기
                </button>
              ) : null}
              <button
                type="button"
                className="button"
                disabled={locked || readyNew.length === 0}
                onClick={() => void runBatch(readyNew)}
              >
                {running ? '등록 중…' : `${readyNew.length}개 등록`}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
