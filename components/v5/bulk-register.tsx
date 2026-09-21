'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/v5/widget'
import { CONTENT_TYPE_LABEL, parseBulkText, registerVideo, type ContentType } from '@/components/v5/register-utils'

type RowStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed'

type Row = {
  key: string
  raw: string
  videoId: string | null
  stock: string // 줄에 적힌 종목. 비어 있으면 공통 종목을 쓴다.
  type: ContentType
  problem: string
  status: RowStatus
  error: string
}

const CONCURRENCY = 2 // 유튜브 API 한도를 아끼려고 동시에 2개까지만 보낸다.

export function BulkRegister({
  recentStocks,
  registeredIds,
  onRegistered,
  onStocksUsed,
  onBusyChange
}: {
  recentStocks: string[]
  registeredIds: Set<string>
  onRegistered: (videoId: string) => void
  onStocksUsed: (stocks: string[]) => void
  onBusyChange: (busy: boolean) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const runRef = useRef<HTMLButtonElement | null>(null)

  const [text, setText] = useState('')
  const [commonStock, setCommonStock] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [dupes, setDupes] = useState(0)
  const [running, setRunning] = useState(false)
  const [emptyNote, setEmptyNote] = useState('')

  useEffect(() => {
    textRef.current?.focus()
  }, [])

  useEffect(() => {
    onBusyChange(running)
  }, [running, onBusyChange])

  const common = commonStock.trim()
  const effectiveStock = (r: Row) => r.stock.trim() || common

  const build = (source: string) => {
    const { lines, duplicates } = parseBulkText(source)
    if (lines.length === 0) {
      setRows(null)
      setEmptyNote('붙여 넣은 내용이 없습니다. 한 줄에 영상 하나씩 적어 주세요.')
      return
    }
    setEmptyNote('')
    setDupes(duplicates)
    setRows(
      lines.map((l, i) => ({
        key: `${i}-${l.videoId || 'x'}`,
        raw: l.raw,
        videoId: l.videoId,
        stock: l.stock,
        type: l.type,
        problem: l.problem,
        status: 'idle' as RowStatus,
        error: ''
      }))
    )
    // 종목이 비어 있는 첫 줄로 바로 이동한다.
    window.setTimeout(() => {
      const missing = rootRef.current?.querySelector<HTMLInputElement>('input[data-stock][data-missing="1"]')
      if (missing) missing.focus()
      else runRef.current?.focus()
    }, 0)
  }

  const patchRow = (key: string, patch: Partial<Row>) => setRows((prev) => (prev ? prev.map((r) => (r.key === key ? { ...r, ...patch } : r)) : prev))

  const removeRow = (key: string) =>
    setRows((prev) => {
      if (!prev) return prev
      const next = prev.filter((r) => r.key !== key)
      return next.length ? next : null
    })

  const stats = useMemo(() => {
    const list = (rows || []).filter((r) => !r.problem)
    const done = list.filter((r) => r.status === 'done').length
    const failed = list.filter((r) => r.status === 'failed').length
    const active = list.filter((r) => r.status === 'queued' || r.status === 'running').length
    const waitingReady = list.filter((r) => r.status === 'idle' && (r.stock.trim() || common)).length
    const waitingMissing = list.filter((r) => r.status === 'idle' && !(r.stock.trim() || common)).length
    const problems = (rows || []).filter((r) => r.problem).length
    return { total: list.length, done, failed, active, waitingReady, waitingMissing, problems }
  }, [rows, common])

  const run = async (only: 'idle' | 'failed') => {
    if (!rows || running) return
    const jobs = rows
      .filter((r) => !r.problem && r.videoId && r.status === only && (r.stock.trim() || common))
      .map((r) => ({ key: r.key, videoId: r.videoId as string, type: r.type, stock: r.stock.trim() || common }))
    if (jobs.length === 0) return

    setRunning(true)
    const keys = new Set(jobs.map((j) => j.key))
    setRows((prev) => (prev ? prev.map((r) => (keys.has(r.key) ? { ...r, status: 'queued', error: '' } : r)) : prev))

    let cursor = 0
    const usedStocks: string[] = []
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor]
        cursor += 1
        patchRow(job.key, { status: 'running' })
        const res = await registerVideo({ videoId: job.videoId, contentType: job.type, stockName: job.stock })
        if (res.ok) {
          patchRow(job.key, { status: 'done', error: '' })
          usedStocks.push(job.stock)
          onRegistered(res.id)
        } else {
          // 한 개가 실패해도 나머지는 계속 등록한다.
          patchRow(job.key, { status: 'failed', error: res.message })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()))

    if (usedStocks.length) onStocksUsed(usedStocks)
    setRunning(false)
  }

  const reset = () => {
    setRows(null)
    setText('')
    setDupes(0)
    setEmptyNote('')
    window.setTimeout(() => textRef.current?.focus(), 0)
  }

  const focusNextStock = (from: HTMLInputElement) => {
    const inputs = Array.from(rootRef.current?.querySelectorAll<HTMLInputElement>('input[data-stock]') || [])
    const next = inputs[inputs.indexOf(from) + 1]
    if (next) next.focus()
    else runRef.current?.focus()
  }

  const allFinished = rows !== null && stats.total > 0 && stats.done === stats.total
  const started = stats.done + stats.failed + stats.active > 0

  return (
    <div ref={rootRef} className="v5-bulk">
      <div className="field">
        <label className="label" htmlFor="v5-bulk-common">
          공통 종목 (선택)
        </label>
        <input
          id="v5-bulk-common"
          className="input"
          list="v5-bulk-stocks"
          autoComplete="off"
          placeholder="종목이 없는 줄에 이 종목을 씁니다"
          value={commonStock}
          disabled={running}
          onChange={(e) => setCommonStock(e.target.value)}
        />
        <datalist id="v5-bulk-stocks">
          {recentStocks.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      {rows === null ? (
        <div className="field" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="v5-bulk-text">
            영상 목록 붙여넣기
          </label>
          <textarea
            id="v5-bulk-text"
            ref={textRef}
            className="textarea v5-bulk-text"
            spellCheck={false}
            rows={6}
            placeholder={'한 줄에 영상 하나씩, 주소 뒤에 종목을 적으세요.\nhttps://youtu.be/abcdefghijk 삼성전자\nhttps://www.youtube.com/shorts/lmnopqrstuv SK하이닉스'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={() => {
              // 붙여넣기가 끝난 뒤 곧바로 정리해서 미리보기로 넘어간다.
              window.setTimeout(() => {
                if (textRef.current) build(textRef.current.value)
              }, 0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                build(text)
              }
            }}
          />
          <div className={`v5-hint ${emptyNote ? 'warn' : ''}`}>
            {emptyNote || '주소만 붙여 넣어도 됩니다. 종목이 없는 줄은 미리보기에서 채우거나 위의 공통 종목을 씁니다.'}
          </div>
          <div>
            <button className="button" type="button" disabled={!text.trim()} onClick={() => build(text)}>
              목록 만들기
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {dupes > 0 ? <div className="v5-hint warn">붙여 넣은 목록에서 같은 영상 {dupes}개는 한 번만 등록되도록 뺐습니다.</div> : null}
          {stats.problems > 0 ? (
            <div className="v5-hint warn">주소를 알아볼 수 없는 {stats.problems}줄은 등록되지 않습니다. 제외하거나 다시 붙여 넣어 주세요.</div>
          ) : null}

          <div className="v5-table-wrap v5-bulk-wrap">
            <table className="v5-table compact">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th>영상</th>
                  <th style={{ width: '32%' }}>종목</th>
                  <th style={{ width: 96 }}>형식</th>
                  <th style={{ width: 150 }}>상태</th>
                  <th style={{ width: 56 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const stock = effectiveStock(r)
                  const locked = running || r.status === 'done' || r.status === 'queued' || r.status === 'running'
                  const already = r.videoId ? registeredIds.has(r.videoId) : false
                  return (
                    <tr key={r.key} className={r.status === 'done' ? 'v5-row-done' : ''}>
                      <td className="small muted">{i + 1}</td>
                      <td className="v5-title-cell" title={r.raw}>
                        {r.problem ? (
                          <span className="v5-bulk-bad">
                            {r.raw.length > 40 ? `${r.raw.slice(0, 40)}...` : r.raw}
                          </span>
                        ) : (
                          <span className="v5-bulk-url">youtube.com/watch?v={r.videoId}</span>
                        )}
                        {already && r.status === 'idle' ? <div className="v5-bulk-note">이미 등록된 영상 · 다시 등록하면 정보가 갱신됩니다</div> : null}
                      </td>
                      <td>
                        {r.problem ? (
                          <span className="small muted">-</span>
                        ) : (
                          <input
                            className="input v5-cell-input"
                            data-stock=""
                            data-missing={stock ? '0' : '1'}
                            autoComplete="off"
                            placeholder={common || '종목 입력'}
                            value={r.stock}
                            disabled={locked}
                            aria-label={`${i + 1}번 영상 종목`}
                            aria-invalid={!stock}
                            onChange={(e) => patchRow(r.key, { stock: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                e.preventDefault()
                                focusNextStock(e.currentTarget)
                              }
                            }}
                          />
                        )}
                      </td>
                      <td>
                        {r.problem ? null : (
                          <select
                            className="select v5-cell-input"
                            value={r.type}
                            disabled={locked}
                            aria-label={`${i + 1}번 영상 형식`}
                            onChange={(e) => patchRow(r.key, { type: e.target.value as ContentType })}
                          >
                            <option value="longform">{CONTENT_TYPE_LABEL.longform}</option>
                            <option value="shortform">{CONTENT_TYPE_LABEL.shortform}</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {r.problem ? (
                          <span className="v5-bulk-err">{r.problem}</span>
                        ) : r.status === 'done' ? (
                          <Badge tone="green">완료</Badge>
                        ) : r.status === 'running' ? (
                          <Badge tone="indigo">등록 중</Badge>
                        ) : r.status === 'failed' ? (
                          <>
                            <Badge tone="red">실패</Badge>
                            <div className="v5-bulk-err">{r.error}</div>
                          </>
                        ) : !stock ? (
                          <span className="v5-bulk-need">종목 입력 필요</span>
                        ) : (
                          <Badge tone="plain">대기</Badge>
                        )}
                      </td>
                      <td>
                        {r.status === 'done' || r.status === 'running' || r.status === 'queued' ? null : (
                          <button className="button ghost xs" type="button" disabled={running} onClick={() => removeRow(r.key)} aria-label={`${i + 1}번 줄 빼기`}>
                            빼기
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {started ? (
            <div className={`v5-bulk-summary ${stats.failed > 0 && !running ? 'has-fail' : ''}`} role="status" aria-live="polite">
              {running || stats.active > 0
                ? `${stats.total}개 중 ${stats.done}개 완료 · 등록 중입니다. 이 화면을 닫지 마세요.`
                : allFinished
                  ? `${stats.total}개 모두 등록됨`
                  : `${stats.total}개 중 ${stats.done}개 등록됨${stats.failed ? ` · ${stats.failed}개 실패` : ''}${stats.waitingMissing ? ` · ${stats.waitingMissing}개는 종목 입력 필요` : ''}`}
            </div>
          ) : null}

          <div className="row wrap" style={{ marginTop: 12 }}>
            {stats.failed > 0 && !running ? (
              <button className="button" type="button" onClick={() => void run('failed')}>
                실패한 {stats.failed}개 다시 시도
              </button>
            ) : null}
            {stats.waitingReady > 0 || !started ? (
              <button ref={runRef} className={`button ${stats.failed > 0 ? 'secondary' : ''}`} type="button" disabled={running || stats.waitingReady === 0} onClick={() => void run('idle')}>
                {running ? '등록 중...' : `${stats.waitingReady}개 등록`}
              </button>
            ) : null}
            {started ? (
              <button className="button secondary" type="button" disabled={running} onClick={reset}>
                새 목록 붙여넣기
              </button>
            ) : (
              <button className="button secondary" type="button" disabled={running} onClick={() => setRows(null)}>
                붙여넣기 다시
              </button>
            )}
          </div>
          {stats.waitingMissing > 0 && !running ? <div className="v5-hint warn">종목이 비어 있는 {stats.waitingMissing}줄은 종목을 채워야 등록됩니다.</div> : null}
        </div>
      )}
    </div>
  )
}
