'use client'

// 브라우저에서 파일 저장 / 글자 복사 도우미. (서버에서는 부르지 않는다)

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

// 링크 등을 클립보드에 복사. 성공하면 true. (권한이 막힌 환경에서는 예전 방식으로 한 번 더 시도한다)
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 아래 예전 방식으로 계속
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
