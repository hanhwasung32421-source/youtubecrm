// 영상 등록 칸에 붙여넣은 글이 어떤 모양인지 알아보는 순수 함수 (React 의존 없음).
//  - single         : 주소 하나만 (앞뒤 공백·문장부호는 정리)
//  - single-with-text: 주소 하나 + 제목 등 다른 글 (유튜브 "공유" 글: 제목 줄바꿈 주소)
//  - multi          : 주소가 둘 이상 → "여러 개 붙여넣기"를 권한다
//  - none           : 주소가 없음

const URL_GLOBAL = /(https?:\/\/[^\s]+)|((?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s]+)/gi
const TRAILING_PUNCT = /[)\]}>.,;'"”’]+$/

export type PasteKind = 'single' | 'single-with-text' | 'multi' | 'none'

export type PasteInfo = {
  kind: PasteKind
  urls: string[] // 문장부호를 뗀 주소들 (https:// 보정 전)
  leftover: string // 주소를 뺀 나머지 글 (한 칸으로 합침)
  lineCount: number // 내용이 있는 줄 수
}

function collapse(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

export function findUrls(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(URL_GLOBAL)) out.push(m[0].replace(TRAILING_PUNCT, ''))
  return out
}

export function analyzePaste(raw: string): PasteInfo {
  const text = (raw || '').trim()
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!text) return { kind: 'none', urls: [], leftover: '', lineCount: 0 }
  const urls = findUrls(text)
  if (urls.length === 0) return { kind: 'none', urls, leftover: collapse(text), lineCount: lines.length }
  if (urls.length > 1) return { kind: 'multi', urls, leftover: '', lineCount: lines.length }
  const leftover = collapse(text.replace(URL_GLOBAL, ' '))
  return { kind: leftover ? 'single-with-text' : 'single', urls, leftover, lineCount: lines.length }
}

// "여러 개 붙여넣기" 칸에 옮길 글을 만든다.
//  - 주소가 있는 줄은 그대로 둔다 (한 줄에 "주소 종목명" 형태를 살린다)
//  - 한 줄에 주소가 둘 이상이면 주소마다 한 줄로 나눈다
//  - 주소가 없는 줄(제목 줄 등)은 뺀다. 제목이 종목명으로 잘못 쓰이는 것을 막기 위해서다.
export function toBulkText(raw: string): string {
  const out: string[] = []
  for (const line of (raw || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const urls = findUrls(line)
    if (urls.length === 0) continue
    if (urls.length === 1) out.push(line.trim())
    else for (const u of urls) out.push(u)
  }
  return out.join('\n')
}

// 종목명 칸에 넣어 볼 만한 짧은 글인지 (제목처럼 긴 글은 제외)
export function looksLikeStockName(text: string) {
  const t = collapse(text)
  return t.length >= 1 && t.length <= 12 && !/[!?:|]/.test(t)
}
