// "여러 개 붙여넣기" 입력을 줄 단위로 읽어 정리한다.
// 한 줄 형식: 주소 [종목명]  (종목명이 주소 앞에 있어도, 탭·공백으로 구분돼 있어도 된다)

import { normalizeYoutubeUrl } from './youtube-url'

export const MAX_BULK_ROWS = 40

export type ParsedLine =
  | { kind: 'valid'; lineNo: number; videoId: string; url: string; isShort: boolean; stock: string }
  | { kind: 'invalid'; lineNo: number; raw: string }

export type ParsedBulk = {
  lines: ParsedLine[] // 화면에 보여 줄 순서 그대로(중복 제거 후)
  duplicates: number // 같은 영상이 붙여넣기 안에 여러 번 있어 뺀 개수
  overflow: number // 한 번에 등록할 수 있는 개수를 넘어 뺀 개수
}

export function parseBulk(text: string): ParsedBulk {
  const lines: ParsedLine[] = []
  const seen = new Map<string, number>() // videoId → lines 인덱스
  let duplicates = 0
  let overflow = 0

  const rawLines = (text || '').split(/\r?\n/)
  rawLines.forEach((rawLine, index) => {
    const line = rawLine.replace(/[​-‍﻿]/g, '').trim()
    if (!line) return

    const tokens = line.split(/\s+/)
    const urlIndex = tokens.findIndex((token) => normalizeYoutubeUrl(token).ok)
    if (urlIndex === -1) {
      if (lines.length >= MAX_BULK_ROWS) overflow++
      else lines.push({ kind: 'invalid', lineNo: index + 1, raw: line })
      return
    }

    const parsed = normalizeYoutubeUrl(tokens[urlIndex])
    if (!parsed.ok) return
    const stock = tokens
      .filter((_, i) => i !== urlIndex)
      .join(' ')
      .replace(/^[,;·|-]+|[,;·|-]+$/g, '')
      .trim()

    const existing = seen.get(parsed.videoId)
    if (existing !== undefined) {
      duplicates++
      // 앞 줄에 종목이 없고 뒷줄에 있으면 뒷줄 종목을 살려 준다.
      const prev = lines[existing]
      if (prev.kind === 'valid' && !prev.stock && stock) prev.stock = stock
      return
    }

    if (lines.length >= MAX_BULK_ROWS) {
      overflow++
      return
    }
    seen.set(parsed.videoId, lines.length)
    lines.push({ kind: 'valid', lineNo: index + 1, videoId: parsed.videoId, url: parsed.url, isShort: parsed.isShort, stock })
  })

  return { lines, duplicates, overflow }
}

// 표에 보여 줄 짧은 주소
export function shortUrl(videoId: string): string {
  return `youtube.com/watch?v=${videoId}`
}
