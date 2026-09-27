// "여러 개 붙여넣기" 전용 해석 도우미 (React 의존 없음).
// 한 줄에 유튜브 주소 하나. 종목명은 더 이상 줄에 적지 않는다 — 등록할 때 서버가 제목에서 자동으로 읽어낸다.

import { extractVideoId, isYoutubeUrl, normalizeYoutubeUrl } from '@/components/v4/register-utils'
import { diagnoseYoutubeUrl } from '@/components/v4/register-logic'

export type ParsedLine = {
  key: string // 영상 ID (주소가 이상한 줄은 line-번호)
  lineNo: number // textarea 안의 줄 위치 (0부터)
  url: string // 정리된 주소
  videoId: string
  valid: boolean
  problem: string // valid 가 아닐 때 이유 한 줄
}

export type ParsedBulk = { rows: ParsedLine[]; duplicates: number; lineCount: number }

const URL_IN_LINE = /(https?:\/\/[^\s]+)|((?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s]+)/i

export const MAX_BULK_ROWS = 60

function parseLine(line: string, lineNo: number): ParsedLine {
  const match = line.match(URL_IN_LINE)
  if (!match) {
    return { key: `line-${lineNo}`, lineNo, url: line.trim(), videoId: '', valid: false, problem: '주소를 찾지 못했어요' }
  }
  const url = normalizeYoutubeUrl(match[0])
  if (!isYoutubeUrl(url)) {
    return { key: `line-${lineNo}`, lineNo, url, videoId: '', valid: false, problem: '유튜브 주소가 아니에요' }
  }
  const videoId = extractVideoId(url)
  if (!videoId) {
    const kind = diagnoseYoutubeUrl(url)
    const problem = !kind.ok && kind.kind === 'playlist' ? '재생목록 주소예요 (영상 주소를 넣어 주세요)' : !kind.ok && kind.kind === 'channel' ? '채널 주소예요 (영상 주소를 넣어 주세요)' : '영상 주소가 아니에요'
    return { key: `line-${lineNo}`, lineNo, url, videoId: '', valid: false, problem }
  }
  return { key: videoId, lineNo, url, videoId, valid: true, problem: '' }
}

export function parseBulkText(text: string): ParsedBulk {
  const lines = text.split(/\r?\n/)
  const rows: ParsedLine[] = []
  const seen = new Set<string>()
  let duplicates = 0
  lines.forEach((line, index) => {
    if (!line.trim()) return
    const parsed = parseLine(line, index)
    if (parsed.valid) {
      if (seen.has(parsed.videoId)) {
        duplicates += 1
        return
      }
      seen.add(parsed.videoId)
    }
    rows.push(parsed)
  })
  return { rows, duplicates, lineCount: rows.length }
}

// textarea 에서 index 번째 줄을 지운 새 텍스트
export function removeLine(text: string, lineNo: number) {
  return text
    .split(/\r?\n/)
    .filter((_, index) => index !== lineNo)
    .join('\n')
}
