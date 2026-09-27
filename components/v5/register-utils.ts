// 영상 등록 화면(한 개씩 / 여러 개 / 수정)이 함께 쓰는 순수 도우미 모음.

import { authedFetchJson, type AuthedJsonResult } from '@/lib/session/authed-fetch'
import { classifyError, refineServerFailure, type RegisterErrorInfo } from './register-errors'

export type ContentType = 'longform' | 'shortform'

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = { longform: '롱폼', shortform: '숏폼' }

// 하루 등록 목표(안내용 숫자일 뿐, 넘겨도 막지 않는다).
export const DAILY_GOAL = 12

// ---- 주소 정리 ------------------------------------------------------------
// 순수 함수는 youtube-url.ts 로 옮겼다(단독으로 시험 가능). 예전 import 경로가 그대로 동작하도록 다시 내보낸다.
import { canonicalWatchUrl, describeUrlProblem, extractVideoId, findYoutubeUrl, normalizeUrl } from './youtube-url'
export { canonicalWatchUrl, describeUrlProblem, extractVideoId, isShortsUrl, isYoutubeUrl, normalizeUrl } from './youtube-url'

// ---- 여러 줄 붙여넣기 해석 ----------------------------------------------------

export type ParsedLine = {
  raw: string
  videoId: string | null
  canonicalUrl: string
  stock: string
  problem: string
}

// 한 줄 = `주소 [종목명]` (종목이 주소 앞에 와도 된다).
// 형식(롱폼/숏폼)은 더 이상 여기서 정하지 않는다. 등록할 때 서버가 실제 영상 길이로 정확히 정한다.
export function parseBulkText(text: string): { lines: ParsedLine[]; duplicates: number } {
  const seen = new Map<string, number>()
  const lines: ParsedLine[] = []
  let duplicates = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue

    const found = findYoutubeUrl(raw)
    if (!found) {
      lines.push({ raw, videoId: null, canonicalUrl: '', stock: '', problem: '유튜브 주소를 찾지 못했어요.' })
      continue
    }

    const url = normalizeUrl(found)
    const videoId = extractVideoId(url)
    const stock = raw
      .replace(found, ' ')
      .replace(/^[\s,;|/\\\t·•-]+|[\s,;|/\\\t·•-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!videoId) {
      lines.push({ raw, videoId: null, canonicalUrl: '', stock, problem: describeUrlProblem(url) || '올바른 영상 주소가 아니에요.' })
      continue
    }

    const at = seen.get(videoId)
    if (at !== undefined) {
      duplicates += 1
      // 먼저 나온 줄에 종목이 없고 이 줄에 있으면 채워 준다.
      if (!lines[at].stock && stock) lines[at].stock = stock
      continue
    }

    seen.set(videoId, lines.length)
    lines.push({
      raw,
      videoId,
      canonicalUrl: canonicalWatchUrl(videoId),
      stock,
      problem: ''
    })
  }

  return { lines, duplicates }
}

// ---- 한국 시간 -----------------------------------------------------------------

const kstFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
const kstTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })

export function kstYmd(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '' : kstFormatter.format(d)
}

export function formatKstWhen(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  const hm = kstTimeFormatter.format(d)
  const ymd = kstYmd(d)
  return ymd === kstYmd(new Date()) ? hm : `${ymd.slice(5)} ${hm}`
}

// ---- 오류 문구 -----------------------------------------------------------------
// 문구를 정하는 규칙은 register-errors.ts(순수 함수)에 있다.
export { classifyError, friendlyError, refineServerFailure } from './register-errors'
export type { RegisterErrorInfo, RegisterErrorKind } from './register-errors'

// ---- 서버 호출(시간 제한) --------------------------------------------------------
// 인터넷이 애매하게 걸려 있으면 요청이 끝없이 기다릴 수 있다. 그러면 "등록 중..."이 영영 풀리지 않으므로
// 정해진 시간이 지나면 끊고, 화면에는 "인터넷 연결" 안내(다시 시도 버튼 포함)를 보여 준다.
export const TIMEOUT_MS = { lookup: 8_000, save: 20_000, list: 20_000, undo: 15_000 } as const

export async function authedFetchJsonTimeout<T = any>(path: string, init: RequestInit = {}, timeoutMs: number = TIMEOUT_MS.save): Promise<AuthedJsonResult<T>> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await authedFetchJson<T>(path, { ...init, signal: controller.signal })
  } catch (e) {
    // 시간 초과로 끊은 것은 인터넷 문제와 같은 안내를 쓴다(classifyError 가 TypeError 를 인터넷 오류로 본다).
    if (controller.signal.aborted) throw new TypeError('timeout')
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}

// ---- 등록 호출 -----------------------------------------------------------------

// 종목명은 직접 적지 않는다. 서버가 (1) 이미 고쳐 둔 값을 지키거나 (2) 제목에서 읽거나 (3) 자리표시자로 정한다.
export type RegisterInput = { videoId: string; stockName?: string; contentCategory?: string }

// input: 화면에서 직접 보냄(지금은 v5 화면 어디서도 보내지 않는다) / kept: 이미 고쳐 둔 값을 지킴 /
// title: 제목에서 자동으로 읽음 / placeholder: 못 읽어서 '종목 미지정'으로 등록함.
export type StockNameSource = 'input' | 'kept' | 'title' | 'placeholder'

// 서버가 종목명을 못 읽었을 때 쓰는 자리표시자(app/api/videos/create/route.ts 와 같은 문구).
export const STOCK_NAME_PLACEHOLDER = '종목 미지정'

export type RegisterResult =
  // contentType: 서버가 실제 영상 길이로 정한 형식. stockName/stockNameSource: 서버가 정한 종목명과 그 출처.
  | { ok: true; id: string; title: string | null; contentType: ContentType; stockName: string; stockNameSource: StockNameSource }
  | { ok: false; message: string; error: RegisterErrorInfo }

// 로그인이 유지되는지 가볍게 확인한다(등록 API 는 로그인이 풀려도 401 대신 500 을 주기 때문).
async function probeAuth(): Promise<{ status: number | null }> {
  try {
    const res = await authedFetchJsonTimeout('/api/v5/my-today', {}, TIMEOUT_MS.lookup)
    return { status: res.status }
  } catch {
    return { status: 0 }
  }
}

// 유튜브에 그 영상이 공개로 있는지 물어 본다(오래 걸리거나 브라우저가 막으면 null = 모름).
async function probeOembed(videoId: string): Promise<{ status: number | null }> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalWatchUrl(videoId))}&format=json`, {
      signal: controller.signal,
      cache: 'no-store',
      referrerPolicy: 'no-referrer'
    })
    return { status: res.status }
  } catch {
    return { status: null }
  } finally {
    window.clearTimeout(timer)
  }
}

// 한 개 등록. 예외를 던지지 않고 결과로 돌려주므로 여러 개 등록 중에도 흐름이 끊기지 않는다.
// diagnose=true 면 서버가 원인을 알려 주지 않는 실패에 한해 원인을 한 번 더 확인해 문구를 정확하게 만든다.
export async function registerVideo(input: RegisterInput, options: { diagnose?: boolean } = {}): Promise<RegisterResult> {
  let error: RegisterErrorInfo
  try {
    const res = await authedFetchJsonTimeout<{
      ok?: boolean
      video?: { id: string; title: string | null; content_type?: string | null; stock_name?: string | null }
      stockNameSource?: string
      error?: string
    }>(
      '/api/videos/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: canonicalWatchUrl(input.videoId),
          // 형식(롱폼/숏폼)은 보내지 않는다. 서버가 실제 영상 길이로 정확히 정해 준다.
          // 종목명도 보내지 않는다(비워 두면 서버가 알아서 정한다). 값이 있을 때만 보낸다.
          stockName: input.stockName?.trim() || undefined,
          contentCategory: input.contentCategory || undefined
        })
      },
      TIMEOUT_MS.save
    )
    if (res.ok && res.data.video) {
      const contentType: ContentType = res.data.video.content_type === 'shortform' ? 'shortform' : 'longform'
      const src = res.data.stockNameSource
      const stockNameSource: StockNameSource = src === 'input' || src === 'kept' || src === 'title' ? src : 'placeholder'
      return {
        ok: true,
        id: res.data.video.id,
        title: res.data.video.title || null,
        contentType,
        stockName: res.data.video.stock_name || STOCK_NAME_PLACEHOLDER,
        stockNameSource
      }
    }
    error = classifyError(res.data?.error || '', res.status)
  } catch (e) {
    error = classifyError(e)
  }
  if (options.diagnose && error.kind === 'server') {
    const [probe, oembed] = await Promise.all([probeAuth(), probeOembed(input.videoId)])
    error = refineServerFailure(error, probe, oembed)
  }
  return { ok: false, message: error.message, error }
}
