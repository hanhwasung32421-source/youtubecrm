'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Tag } from '@/components/v3/ui'
import { MAX_BULK_ROWS, parseBulk, shortUrl } from './bulk-parse'
import { lookupVideo, registerVideo, type ContentType, type StockNameSource } from './register-api'
import { STOCK_PLACEHOLDER } from './register-logic'

type RowState = 'queued' | 'running' | 'done' | 'failed'
// contentType·stockName = 등록 뒤 서버가 정한 값(등록 전에는 알 수 없다 — 형식은 영상 길이로, 종목명은 제목에서)
type Result = { state: RowState; error?: string; contentType?: ContentType; stockName?: string; stockNameSource?: StockNameSource }

type Row =
  | { kind: 'invalid'; key: string; lineNo: number; raw: string }
  | { kind: 'valid'; key: string; lineNo: number; videoId: string; url: string; result?: Result }

// 표 모양(넓은 화면)과 카드 모양(좁은 화면)은 CSS(.v3-brow)가 바꾼다. 마크업은 하나.

function typeLabel(type: ContentType) {
  return type === 'shortform' ? '숏폼' : '롱폼'
}

const CONCURRENCY = 2

export const BulkRegister = memo(function BulkRegister({
  active,
  seed,
  touchOnly,
  todayIds,
  onBatchDone,
  disabled
}: {
  active: boolean // 여러 개 모드가 화면에 보이는 중인지(숨겨져도 붙여넣은 내용은 그대로 둔다)
  seed: { text: string; n: number } | null // 하나씩 등록 칸에서 옮겨 온 붙여넣기 내용
  touchOnly: { current: boolean }
  todayIds: Set<string>
  onBatchDone: (registeredIds: string[]) => void | Promise<void>
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [results, setResults] = useState<Record<string, Result>>({})
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  const runningRef = useRef(false) // 클릭이 겹쳐도 묶음 등록이 두 번 시작되지 않게
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  // 화면에 나타날 때마다 붙여넣기 칸에 커서(휴대폰은 키보드가 가리므로 옮기지 않는다)
  useEffect(() => {
    if (active && !touchOnly.current) textRef.current?.focus()
  }, [active, touchOnly])

  // 하나씩 등록 칸에서 여러 주소를 붙여넣어 옮겨 온 경우 그 내용을 채운다(이전 표시는 비운다).
  useEffect(() => {
    if (!seed) return
    setText(seed.text)
    setRemoved(new Set())
    setResults({})
  }, [seed])

  const parsed = useMemo(() => parseBulk(text), [text])

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
      out.push({ kind: 'valid', key: line.videoId, lineNo: line.lineNo, videoId: line.videoId, url: line.url, result })
    }
    return { rows: out, skippedToday: skipped }
  }, [parsed, removed, results, todayIds])

  const valid = rows.filter((row): row is Extract<Row, { kind: 'valid' }> => row.kind === 'valid')
  const invalidCount = rows.length - valid.length
  const readyNew = valid.filter((row) => !row.result)
  const doneCount = valid.filter((row) => row.result?.state === 'done').length
  const failedRows = valid.filter((row) => row.result?.state === 'failed')
  const inFlight = valid.filter((row) => row.result?.state === 'queued' || row.result?.state === 'running').length
  const hasResults = valid.some((row) => row.result)

  const setResult = (id: string, result: Result) => setResults((prev) => ({ ...prev, [id]: result }))

  // 한 줄이 실패해도 멈추지 않고, 동시에 2개까지만 보내 유튜브 사용량을 아낀다.
  const runBatch = async (targets: typeof valid) => {
    if (targets.length === 0 || runningRef.current) return
    runningRef.current = true
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
        // 다른 직원이 이미 올린 영상은 덮어쓰지 않고 건너뛴다. 내가 전에 등록한 영상은 메모를 그대로 두고 다시 등록한다.
        const lookup = await lookupVideo(row.videoId)
        if (lookup && lookup.found && !lookup.mine) {
          setResult(row.videoId, { state: 'failed', error: '다른 직원이 이미 올린 영상이에요. 하나씩 등록에서 확인해 주세요.' })
          continue
        }
        const memo = lookup && lookup.found ? lookup.video.content_category || undefined : undefined
        const result = await registerVideo({ url: row.url, contentCategory: memo })
        if (result.ok) {
          setResult(row.videoId, { state: 'done', contentType: result.contentType, stockName: result.stockName, stockNameSource: result.stockNameSource })
          if (result.id) okIds.push(result.id)
        } else {
          setResult(row.videoId, { state: 'failed', error: result.short })
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
    } finally {
      runningRef.current = false
      setRunning(false)
      await onBatchDone(okIds)
    }
  }

  const reset = () => {
    setText('')
    setRemoved(new Set())
    setResults({})
    window.setTimeout(() => {
      if (!touchOnly.current) textRef.current?.focus()
    }, 0)
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
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          aria-describedby="v3-bulk-text-hint"
          value={text}
          readOnly={locked}
          placeholder={'한 줄에 영상 하나씩 주소를 붙여넣으세요.\nhttps://youtu.be/AbCdEfGhIjK\nhttps://www.youtube.com/shorts/LmNoPqRsTuV'}
          onChange={(e) => setText(e.target.value)}
        />
        <div id="v3-bulk-text-hint" className="v3-reg-hint">
          종목명은 등록되면서 제목에서 자동으로 채워져요. 한 번에 {MAX_BULK_ROWS}개까지 가능해요.
        </div>
      </div>

      {parsed.duplicates > 0 || skippedToday > 0 || parsed.overflow > 0 ? (
        <div className="v3-reg-hint warn v3-bulk-notes" role="status">
          {parsed.duplicates > 0 ? <span>같은 영상 {parsed.duplicates}개는 한 번만 넣었어요.</span> : null}
          {skippedToday > 0 ? <span>오늘 이미 등록한 영상 {skippedToday}개는 뺐어요.</span> : null}
          {parsed.overflow > 0 ? <span>{MAX_BULK_ROWS}개를 넘는 {parsed.overflow}줄은 다음에 붙여넣어 주세요.</span> : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="data-table v3-btable">
            <div className="data-table-header v3-brow v3-bhead" aria-hidden>
              <div className="v3-bc-no">#</div>
              <div className="v3-bc-url">정리된 주소</div>
              <div className="v3-bc-stock">종목</div>
              <div className="v3-bc-type">형식</div>
              <div className="v3-bc-state">상태</div>
              <div className="v3-bc-remove" />
            </div>
            {rows.map((row, index) => {
              if (row.kind === 'invalid') {
                return (
                  <div className="data-table-row v3-brow v3-brow-invalid" key={row.key}>
                    <div className="v3-bc-no small muted">{index + 1}</div>
                    <div className="v3-bc-raw v3-cell-sub" title={row.raw}>{row.raw}</div>
                    <div className="v3-bc-state v3-bulk-state bad">유효하지 않은 주소</div>
                  </div>
                )
              }
              const state = row.result?.state
              const stockName = row.result?.stockName
              return (
                <div className={`data-table-row v3-brow ${state === 'done' ? 'v3-bulk-done' : ''}`} key={row.key}>
                  <div className="v3-bc-no small muted">{index + 1}</div>
                  <div className="v3-bc-url v3-cell-sub" title={row.url}>{shortUrl(row.videoId)}</div>
                  <div className="v3-bc-stock">
                    {/* 종목은 고르지 않는다 — 등록되면 서버가 제목에서 읽어낸(또는 못 찾아 자리표시자로 둔) 값을 여기에 보여 준다. */}
                    {stockName ? (
                      <span
                        className={stockName === STOCK_PLACEHOLDER ? 'muted' : ''}
                        title={stockName === STOCK_PLACEHOLDER ? '아직 종목을 정하지 않았어요. 목록에서 나중에 고칠 수 있어요.' : undefined}
                      >
                        {stockName}
                      </span>
                    ) : (
                      <span className="muted small" aria-hidden>—</span>
                    )}
                  </div>
                  <div className="v3-bc-type">
                    {/* 형식은 고르지 않는다 — 등록되면 서버가 실제 영상 길이로 정한 값을 여기에 보여 준다. */}
                    {row.result?.contentType ? (
                      <Tag tone={row.result.contentType === 'shortform' ? 'violet' : 'blue'}>{typeLabel(row.result.contentType)}</Tag>
                    ) : (
                      <span className="muted small" aria-hidden>—</span>
                    )}
                  </div>
                  <div className={`v3-bc-state v3-bulk-state ${state === 'done' ? 'ok' : state === 'failed' ? 'bad' : ''}`} title={row.result?.error}>
                    {state === 'done'
                      ? '완료'
                      : state === 'running'
                        ? '등록 중…'
                        : state === 'queued'
                          ? '대기'
                          : state === 'failed'
                            ? `실패 · ${row.result?.error || '다시 시도해 주세요.'}`
                            : '대기'}
                  </div>
                  <div className="v3-bc-remove">
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
                </div>
              )
            })}
          </div>

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
                <button type="button" className="button secondary" onClick={() => void runBatch(failedRows)}>
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
})
