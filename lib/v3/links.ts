// V3 화면끼리 이어 주는 주소를 한 곳에서 만든다. (순수 함수)
//   등록 화면의 ?stock= / ?format= 미리 채우기, 조회수 성장의 ?video= 선택, 급상승의 ?format= 필터.

export type FormatValue = 'longform' | 'shortform'

export function isFormat(value: unknown): value is FormatValue {
  return value === 'longform' || value === 'shortform'
}

export function formatLabel(value: string | null | undefined): string {
  return value === 'shortform' ? '숏폼' : value === 'longform' ? '롱폼' : ''
}

// 영상 등록 화면: 종목과 형식을 미리 채워서 연다.
export function registerHref(opts: { stock?: string | null; format?: string | null } = {}): string {
  const q = new URLSearchParams()
  const stock = (opts.stock || '').trim()
  if (stock) q.set('stock', stock)
  if (isFormat(opts.format)) q.set('format', opts.format)
  const s = q.toString()
  return s ? `/v3/register?${s}` : '/v3/register'
}

// 조회수 성장 화면에서 그 영상의 곡선을 바로 연다.
export function lifecycleHref(videoId: string): string {
  return `/v3/lifecycle?video=${encodeURIComponent(videoId)}`
}

// 급상승 영상 화면을 형식으로 걸러서 연다. 다른 필터는 기본값으로 시작한다.
export function viralHref(format?: string | null): string {
  return isFormat(format) ? `/v3/viral?format=${format}` : '/v3/viral'
}
