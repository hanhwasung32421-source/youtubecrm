'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_BULK_ROWS, parseBulkText, removeLine, type ParsedLine } from '@/components/v4/register-bulk'
import { registerVideo, type ContentType, type StockNameSource } from '@/components/v4/register-api'
import { findUrls, toBulkText } from '@/components/v4/paste-detect'
import { FormatPill, StockLabel } from '@/components/v4/ui'
import { AUTH_COPY } from '@/components/v4/register-logic'
import { loginHrefWithNext } from '@/components/v4/safe-next'
import { LOGIN_HREF } from '@/lib/v4/menu'

type RowStatus = 'pending' | 'running' | 'done' | 'failed'

type Row = ParsedLine & {
  status: RowStatus
  error: string
  resultType: ContentType | null // 등록이 끝난 뒤 서버가 정한 실제 형식 (등록 전에는 알 수 없다)
  resultStock: string | null // 등록이 끝난 뒤 서버가 정한 실제 종목명 (등록 전에는 알 수 없다)
  resultStockSource: StockNameSource | null
}

const CONCURRENCY = 2 // 유튜브 호출 한도를 아끼려고 동시에 2개까지만

const PLACEHOLDER = ['https://youtu.be/AbC123xyz', 'https://www.youtube.com/shorts/DeF456uvw', 'https://youtu.be/GhI789rst'].join('\n')

function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.|m\.)?/i, '')
}

export const BulkRegister = memo(function BulkRegister({
  seed,
  existingIds,
  onFinished
}: {
  seed?: { id: number; text: string } | null
  existingIds: Set<string>
  onFinished: (result: { ids: string[] }) => void
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const rowsRef = useRef<Row[]>([])
  const runningRef = useRef(false)

  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [dupes, setDupes] = useState(0)
  const [overflow, setOverflow] = useState(0)
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
    setRows(limited.map<Row>((p) => ({ ...p, status: 'pending', error: '', resultType: null, resultStock: null, resultStockSource: null })))
  }

  // 하나씩 등록 화면에서 "여러 개 붙여넣기로 바꾸기"를 눌렀을 때 넘어온 글을 채운다.
  useEffect(() => {
    if (!seed) return
    setStarted(false)
    setText(seed.text)
    reparse(seed.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.id])

  // 여러 줄을 붙여넣을 때 제목 줄(주소가 없는 줄)은 빼고, 한 줄에 주소가 여러 개면 나눠서 넣는다.
  const onPasteText = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (!pasted || (!/\r?\n/.test(pasted.trim()) && findUrls(pasted).length <= 1)) return
    const cleaned = toBulkText(pasted)
    if (!cleaned || cleaned === pasted.trim()) return
    e.preventDefault()
    const el = e.currentTarget
    const before = text.slice(0, el.selectionStart)
    const after = text.slice(el.selectionEnd)
    const glueBefore = before && !before.endsWith('\n') ? '\n' : ''
    const glueAfter = after && !after.startsWith('\n') ? '\n' : ''
    const next = `${before}${glueBefore}${cleaned}${glueAfter}${after}`
    setText(next)
    reparse(next)
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

  const isReady = (row: Row) => row.valid && (row.status === 'pending' || row.status === 'failed')

  const validRows = rows.filter((r) => r.valid)
  const readyRows = rows.filter((r) => r.valid && r.status === 'pending')
  const failedRows = rows.filter((r) => r.status === 'failed')
  const doneRows = rows.filter((r) => r.status === 'done')
  const invalidRows = rows.filter((r) => !r.valid)

  const run = async (target: 'ready' | 'failed') => {
    if (runningRef.current) return
    const pool = rowsRef.current.filter((r) => isReady(r) && (target === 'failed' ? r.status === 'failed' : r.status === 'pending'))
    if (pool.length === 0) return

    const jobs = pool.map((r) => ({ key: r.key, url: r.url }))
    runningRef.current = true
    setRunning(true)
    setStarted(true)
    setRows((prev) => prev.map((r) => (jobs.some((j) => j.key === r.key) ? { ...r, status: 'pending', error: '' } : r)))

    const registeredIds: string[] = []
    const queue = [...jobs]
    const worker = async () => {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) break
        patchRow(job.key, { status: 'running', error: '' })
        const result = await registerVideo({ youtubeUrl: job.url })
        if (result.ok) {
          if (result.video?.id) registeredIds.push(result.video.id)
          patchRow(job.key, {
            status: 'done',
            error: '',
            resultType: result.video?.content_type ?? null,
            resultStock: result.video?.stock_name ?? null,
            resultStockSource: result.stockNameSource
          })
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
      onFinished({ ids: registeredIds })
    }
  }

  const finished = started && !running && validRows.length > 0
  const needsLogin = failedRows.some((r) => r.error === AUTH_COPY)
  const allDone = finished && failedRows.length === 0
  const summaryParts = useMemo(() => {
    const parts: string[] = [`${validRows.length}개 중 ${doneRows.length}개 등록됨`]
    if (failedRows.length > 0) parts.push(`${failedRows.length}개 실패`)
    return parts
  }, [validRows.length, doneRows.length, failedRows.length])

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
            autoCorrect="off"
            autoCapitalize="none"
            aria-describedby="v4-bulk-help"
            placeholder={PLACEHOLDER}
            value={text}
            disabled={running}
            onPaste={onPasteText}
            onChange={(e) => {
              setText(e.target.value)
              reparse(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                void run('ready')
              }
            }}
          />
          <div className="v4-hint-slot" id="v4-bulk-help">
            <span className="v4-hint">
              한 줄에 유튜브 주소를 하나씩 붙여넣어 주세요. 종목명은 제목에서 자동으로 채워지고, 형식(롱폼/숏폼)은 영상 길이로 자동 정해져요.
            </span>
          </div>
        </div>
      ) : null}

      {dupes > 0 || overflow > 0 || invalidRows.length > 0 ? (
        <div className="v4-bulk-notes">
          {dupes > 0 ? <span className="v4-hint">같은 영상이 여러 번 있어서 {dupes}개는 뺐어요.</span> : null}
          {invalidRows.length > 0 ? <span className="v4-hint warn">주소를 알아볼 수 없는 줄이 {invalidRows.length}개 있어요. 아래에서 확인해 주세요.</span> : null}
          {overflow > 0 ? <span className="v4-hint warn">한 번에 {MAX_BULK_ROWS}개까지만 등록할 수 있어요. 나머지 {overflow}개는 다음에 붙여넣어 주세요.</span> : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="v4-bulk-table-wrap">
          <table className="v4-bulk-table">
            <caption className="v4-sr">붙여넣은 영상 미리보기</caption>
            <thead>
              <tr>
                <th scope="col" className="num">
                  #
                </th>
                <th scope="col">정리된 주소</th>
                <th scope="col">종목</th>
                <th scope="col">형식</th>
                <th scope="col">상태</th>
                <th scope="col">
                  <span className="v4-sr">줄 빼기</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const alreadyRegistered = row.valid && row.status === 'pending' && existingIds.has(row.videoId)
                return (
                  <tr key={row.key} className={`v4-bulk-row ${row.status} ${!row.valid ? 'invalid' : ''}`}>
                    <td className="num">{index + 1}</td>
                    <td className="url" title={row.url}>
                      {shortUrl(row.url)}
                    </td>
                    <td className="stock">
                      {!row.valid ? (
                        <span className="muted small">-</span>
                      ) : row.status === 'done' ? (
                        <StockLabel name={row.resultStock} />
                      ) : (
                        <span className="muted small">자동</span>
                      )}
                    </td>
                    <td className="fmt">
                      {!row.valid ? (
                        <span className="muted small">-</span>
                      ) : row.resultType ? (
                        <FormatPill contentType={row.resultType} />
                      ) : (
                        <span className="muted small">자동</span>
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
                      ) : alreadyRegistered ? (
                        <span className="v4-bulk-badge wait" title="이미 등록된 영상이에요. 다시 등록하면 조회수만 새로 가져오고 종목은 그대로 둬요.">
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
        <div className={`v4-reg-status ${allDone ? 'ok' : 'error'}`} role={allDone ? 'status' : 'alert'} aria-live={allDone ? 'polite' : 'assertive'}>
          <strong>
            {allDone ? '✓ ' : ''}
            {summaryParts.join(' · ')}
          </strong>
          {failedRows.length > 0 ? <span className="v4-reg-status-detail"> → 아래 버튼으로 다시 시도할 수 있어요</span> : null}
          {needsLogin ? (
            <a className="link v4-relogin" href={loginHrefWithNext(LOGIN_HREF, '/v4/register')} target="_blank" rel="noopener noreferrer">
              다시 로그인 (새 창)
            </a>
          ) : null}
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
})
