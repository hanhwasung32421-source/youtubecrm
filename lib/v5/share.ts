'use client'

// 브라우저 전용 도우미: 링크 복사, CSV 파일 저장. (순수 계산은 csv.ts / filters.ts)

import { CSV_BOM, CSV_MIME } from '@/lib/v5/csv'

// 클립보드에 글자를 넣는다. 성공하면 true. (권한이 없는 브라우저는 예전 방식으로 한 번 더 시도)
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 아래 예전 방식으로
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

// CSV 글자를 파일로 저장한다(엑셀 한글 깨짐 방지 BOM 포함). 성공하면 true.
export function downloadCsv(fileName: string, csvText: string): boolean {
  try {
    const blob = new Blob([CSV_BOM, csvText], { type: CSV_MIME })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 저장 창이 뜬 뒤에 주소를 풀어 준다
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch {
    return false
  }
}

// 지금 화면의 "필터가 담긴" 공유용 주소(한 번만 쓰는 new/video 같은 값은 빼고).
export function buildShareUrl(pathname: string, queryString: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${pathname}${queryString ? `?${queryString}` : ''}`
}
