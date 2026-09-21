'use client'

// "표를 CSV로 저장" 과 "이 화면 링크 복사" 버튼 줄.
//  - CSV 는 브라우저 안에서 만들어 바로 내려받는다 (서버에 보내지 않는다). 엑셀에서 한글이 깨지지 않도록 BOM 이 들어간다.
//  - 링크 복사는 클립보드 권한이 없으면 임시 입력칸 복사로, 그것도 안 되면 주소를 보여 주고 직접 복사하게 한다.
import { useEffect, useRef, useState } from 'react'
import { buildCsv, csvFileName, type CsvValue } from './csv'
import { kstYmd } from './dates'

export type CsvTable = { name: string; headers: string[]; rows: CsvValue[][] }

// 파일로 내려받기. 실패하면 false.
export function downloadCsv(filename: string, csv: string): boolean {
  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch {
    return false
  }
}

// 글자를 클립보드에 복사. 성공하면 true.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 권한이 없으면 아래 방법으로 넘어간다.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export function ShareBar({
  getCsv,
  csvDisabledReason,
  getLink
}: {
  /** 눌렀을 때 표를 만들어 돌려준다 (긴 표를 미리 만들어 두지 않도록). 없으면 CSV 버튼을 숨긴다. */
  getCsv?: () => CsvTable
  /** 저장할 표가 없을 때 그 이유 (버튼이 꺼지고 마우스를 올리면 이유가 보인다) */
  csvDisabledReason?: string
  getLink: () => string
}) {
  const [message, setMessage] = useState('')
  const [manualLink, setManualLink] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  const say = (text: string) => {
    setMessage(text)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setMessage(''), 5000)
  }

  useEffect(() => {
    if (manualLink) inputRef.current?.select()
  }, [manualLink])

  const onCsv = () => {
    if (!getCsv) return
    const table = getCsv()
    const csv = buildCsv(table.headers, table.rows)
    if (downloadCsv(csvFileName(table.name, kstYmd()), csv)) say(`표 ${table.rows.length.toLocaleString('ko-KR')}줄을 파일로 저장했어요. 엑셀에서 열 수 있어요.`)
    else say('파일을 저장하지 못했어요. 브라우저의 다운로드 차단을 확인해 주세요.')
  }

  const onCopy = async () => {
    const link = getLink()
    if (await copyText(link)) {
      setManualLink('')
      say('이 화면 링크를 복사했어요. 원하는 곳에 붙여넣으세요.')
    } else {
      setManualLink(link)
      say('자동 복사가 막혀 있어요. 아래 주소를 직접 복사해 주세요.')
    }
  }

  return (
    <div className="v2a-share">
      <div className="v2a-share-buttons">
        {getCsv ? (
          <button type="button" className="button secondary xs" onClick={onCsv} disabled={Boolean(csvDisabledReason)} title={csvDisabledReason || '지금 보이는 조건의 표 전체를 엑셀에서 열 수 있는 파일(CSV)로 저장해요.'}>
            표를 CSV로 저장
          </button>
        ) : null}
        <button type="button" className="button secondary xs" onClick={() => void onCopy()} title="지금 고른 필터가 그대로 담긴 주소를 복사해요.">
          이 화면 링크 복사
        </button>
      </div>
      <span className="v2a-share-msg" role="status" aria-live="polite">
        {message}
      </span>
      {manualLink ? <input ref={inputRef} className="input compact v2a-share-link" readOnly value={manualLink} aria-label="복사할 주소" onFocus={(e) => e.currentTarget.select()} /> : null}
    </div>
  )
}
