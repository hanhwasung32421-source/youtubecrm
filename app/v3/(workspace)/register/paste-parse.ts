// 주소 칸에 붙여넣은 글을 읽는다. 유튜브 공유 글은 "제목 + 주소"(모바일)처럼 주소 말고도 글자가 섞여 있고,
// 여러 줄로 여러 개의 주소를 한꺼번에 붙여넣는 경우도 있다.
//   - 주소가 없으면          → none     (그대로 붙여넣는다)
//   - 서로 다른 영상이 2개 이상 → multiple (여러 개 붙여넣기 모드로 안내한다)
//   - 영상 1개                → single   (주소만 골라 넣는다)

import { normalizeYoutubeUrl, ZERO_WIDTH, type NormalizedYoutubeUrl } from './youtube-url'

export type PasteResult =
  | { kind: 'none' }
  | { kind: 'multiple'; count: number }
  | { kind: 'single'; url: string; videoId: string; isShort: boolean; extracted: boolean }

function tokenize(raw: string): string[] {
  const cleaned = (raw || '').replace(ZERO_WIDTH, '').trim()
  return cleaned ? cleaned.split(/\s+/) : []
}

// 글 전체에서 처음으로 유튜브 주소로 읽히는 덩어리를 찾는다("제목 https://youtu.be/…"도 찾는다).
export function findYoutube(raw: string): NormalizedYoutubeUrl {
  const tokens = tokenize(raw)
  if (tokens.length === 0) return { ok: false, empty: true }
  for (const token of tokens) {
    const parsed = normalizeYoutubeUrl(token)
    if (parsed.ok) return parsed
  }
  return { ok: false, empty: false }
}

export function analyzePaste(raw: string): PasteResult {
  const tokens = tokenize(raw)
  const found: { index: number; videoId: string; url: string; isShort: boolean }[] = []
  tokens.forEach((token, index) => {
    const parsed = normalizeYoutubeUrl(token)
    if (parsed.ok) found.push({ index, videoId: parsed.videoId, url: parsed.url, isShort: parsed.isShort })
  })
  if (found.length === 0) return { kind: 'none' }

  const ids = new Set(found.map((item) => item.videoId))
  if (ids.size >= 2) return { kind: 'multiple', count: ids.size }

  const first = found[0]
  const extracted = tokens.length > found.length
  return { kind: 'single', url: first.url, videoId: first.videoId, isShort: first.isShort, extracted }
}
