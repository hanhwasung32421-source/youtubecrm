'use client'

// 브라우저에서 파일로 저장하는 도우미. (서버에서는 부르지 않는다. 저장 버튼을 눌렀을 때만 불러온다)

import { CSV_BOM } from '@/lib/v4/csv'

// CSV 글자를 파일로 저장한다. text 는 buildCsv 의 결과(이미 BOM 포함)를 그대로 넘긴다.
export function downloadCsvFile(filename: string, text: string) {
  const body = text.startsWith(CSV_BOM) ? text : `${CSV_BOM}${text}`
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 바로 지우면 일부 브라우저가 저장을 시작하기 전에 끊기므로 잠깐 뒤에 지운다.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
