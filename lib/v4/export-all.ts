// "조건에 맞는 전부" 내려받기: 서버가 한 번에 주는 만큼(pageSize)씩 끝까지 이어서 받는 반복문 (순수 함수).
// - 취소(AbortSignal)하면 그 자리에서 멈추고 지금까지 받은 것을 돌려준다(cancelled: true).
// - 중간에 새 영상이 등록돼 순서가 밀려도 같은 영상이 두 번 들어가지 않게 id 로 걸러낸다.
// - 서버가 요청보다 적게 줘도(상한이 더 낮을 때) 받은 개수만큼만 건너뛰며 계속 이어받는다.

export type PageResult<T> = { items: T[]; total: number }

export type FetchAllOptions<T> = {
  pageSize: number
  // 실패하면 throw 한다 (그 오류가 그대로 호출한 쪽으로 전달된다).
  fetchPage: (offset: number, limit: number, signal?: AbortSignal) => Promise<PageResult<T>>
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  // 서버 이상으로 끝나지 않는 일을 막는 안전장치 (기본 300쪽)
  maxPages?: number
}

export type FetchAllResult<T> = { rows: T[]; total: number; cancelled: boolean; truncated: boolean }

export async function fetchAllPages<T extends { id: string }>(options: FetchAllOptions<T>): Promise<FetchAllResult<T>> {
  const { pageSize, fetchPage, onProgress, signal } = options
  const maxPages = options.maxPages ?? 300
  const rows: T[] = []
  const seen = new Set<string>()
  let offset = 0
  let total = 0
  let pages = 0
  while (pages < maxPages) {
    if (signal?.aborted) return { rows, total, cancelled: true, truncated: false }
    const page = await fetchPage(offset, pageSize, signal)
    // 기다리는 사이 취소됐으면 방금 받은 쪽은 버린다.
    if (signal?.aborted) return { rows, total, cancelled: true, truncated: false }
    pages += 1
    total = Number.isFinite(page.total) ? Math.max(0, page.total) : rows.length
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      rows.push(item)
    }
    offset += page.items.length
    onProgress?.(rows.length, Math.max(total, rows.length))
    if (page.items.length === 0 || offset >= total) return { rows, total, cancelled: false, truncated: false }
  }
  return { rows, total, cancelled: false, truncated: true }
}
