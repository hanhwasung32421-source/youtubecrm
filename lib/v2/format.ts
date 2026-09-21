// 숫자를 비전공자가 바로 읽을 수 있게 줄여 쓰는 도우미 (조/억/만).
// 정확한 값이 필요한 표에서는 toLocaleString('ko-KR')을, 요약·카드에서는 formatCount를 쓴다.

export function formatNumber(value: number | null | undefined): string {
  return Math.round(value || 0).toLocaleString('ko-KR')
}

function trim(n: number): string {
  // 12.0 -> 12, 1.24 -> 1.2
  const fixed = n >= 100 ? Math.round(n).toString() : n.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

export function formatCount(value: number | null | undefined): string {
  const n = Math.round(value || 0)
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000_000) return `${trim(n / 1_000_000_000_000)}조`
  if (abs >= 100_000_000) return `${trim(n / 100_000_000)}억`
  if (abs >= 10_000) return `${trim(n / 10_000)}만`
  return n.toLocaleString('ko-KR')
}

// 긴 제목을 한 줄 요약에 넣을 때
export function shortText(text: string | null | undefined, max = 28): string {
  const value = (text || '').trim()
  if (!value) return '(제목 수집 대기)'
  return value.length > max ? `${value.slice(0, max)}…` : value
}
