// 붙여넣은 글이 "주소 하나"인지, "여러 개/제목이 섞인 글"인지 가려내는 순수 도우미.
// 다른 파일을 가져오지 않는다(단독으로 시험할 수 있게).

// 주의: 뒤돌아보기(lookbehind)는 오래된 아이폰 사파리에서 파일 전체를 못 읽게 하므로 쓰지 않는다.
const URL_SOURCE = String.raw`(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s]+`
const VIDEO_ID_RES = [/[?&]v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/]

function videoIdOf(url: string): string | null {
  for (const re of VIDEO_ID_RES) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}

function urlMatches(text: string): string[] {
  return text.match(new RegExp(URL_SOURCE, 'gi')) || []
}

export type PasteInfo = {
  // none: 주소 없음 / url: 주소만 / text-with-url: 주소 하나 + 다른 글자 / multi: 서로 다른 영상 2개 이상
  kind: 'none' | 'url' | 'text-with-url' | 'multi'
  videoCount: number // 서로 다른 영상 수
  lineCount: number // 내용 있는 줄 수
  // 주소 하나 + 같은 줄에 붙은 짧은 글자(종목일 가능성). 여러 줄이면 빈 문자열.
  leftover: string
}

export function analyzePaste(raw: string): PasteInfo {
  const text = raw.trim()
  if (!text) return { kind: 'none', videoCount: 0, lineCount: 0, leftover: '' }

  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const ids = new Set<string>()
  for (const url of urlMatches(text)) {
    const id = videoIdOf(url)
    if (id) ids.add(id)
  }

  if (ids.size === 0) return { kind: 'none', videoCount: 0, lineCount: lines.length, leftover: '' }
  if (ids.size >= 2) return { kind: 'multi', videoCount: ids.size, lineCount: lines.length, leftover: '' }

  // 서로 다른 영상은 하나. 같은 영상을 여러 번 붙인 것도 여기에 든다.
  const onlyUrls = lines.every((l) => l.replace(new RegExp(URL_SOURCE, 'gi'), '').trim() === '')
  if (onlyUrls) return { kind: 'url', videoCount: 1, lineCount: lines.length, leftover: '' }

  let leftover = ''
  if (lines.length === 1) {
    leftover = lines[0]
      .replace(new RegExp(URL_SOURCE, 'gi'), ' ')
      .replace(/^[\s,;|/\\·•-]+|[\s,;|/\\·•-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (leftover.length > 30) leftover = ''
  }
  return { kind: 'text-with-url', videoCount: 1, lineCount: lines.length, leftover }
}

// 한 개씩 등록 화면에서 "여러 개 붙여넣기" 화면으로 넘길 글. 주소가 없는 줄(제목 등)은 뺀다.
// 제목은 등록할 때 자동으로 가져오므로 빠져도 괜찮다.
export function toBulkText(raw: string): { text: string; droppedLines: number; urlLines: number } {
  const kept: string[] = []
  let droppedLines = 0
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const ok = urlMatches(t).some((u) => videoIdOf(u))
    if (ok) kept.push(t)
    else droppedLines += 1
  }
  return { text: kept.join('\n'), droppedLines, urlLines: kept.length }
}
