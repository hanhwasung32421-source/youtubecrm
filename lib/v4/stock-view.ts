// 종목 타일 크기 정하기 (순수 함수). 화면에 보이는 상위 N개 안에서의 순위로 정한다.

export type TileSize = 'xl' | 'lg' | 'md' | 'sm'

// totals: 총 조회수가 큰 순으로 정렬된 값들. 개수가 적을 때는 큰 타일 수를 줄여 화면이 어색하게 비지 않게 한다.
// 조회수가 0(또는 비정상)인 종목은 항상 작은 타일.
export function tileSizes(totals: number[]): TileSize[] {
  const n = totals.length
  const quota = n >= 6 ? { xl: 1, lg: 2, md: 3 } : n >= 3 ? { xl: 1, lg: 1, md: n - 2 } : n === 2 ? { xl: 1, lg: 1, md: 0 } : { xl: n, lg: 0, md: 0 }
  return totals.map((total, rank) => {
    if (!Number.isFinite(total) || total <= 0) return 'sm'
    if (rank < quota.xl) return 'xl'
    if (rank < quota.xl + quota.lg) return 'lg'
    if (rank < quota.xl + quota.lg + quota.md) return 'md'
    return 'sm'
  })
}
