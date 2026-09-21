// V3 차트 계산용 순수 함수. (React/Next 의존성 없음 — 서버와 브라우저 어디서나 쓸 수 있다)

const STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10]

function clean(n: number): number {
  // 0.1 * 3 = 0.30000000000000004 같은 부동소수점 찌꺼기를 없앤다.
  return Number(n.toPrecision(12))
}

// 눈금이 "0, 25, 50, 75, 100" 처럼 딱 떨어지도록 최댓값을 올려 잡는다.
export function niceScale(maxValue: number, targetTicks = 4): { max: number; step: number; ticks: number[] } {
  const safeMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1
  const count = Math.max(Math.floor(targetTicks), 1)
  const rawStep = safeMax / count
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const residual = rawStep / magnitude
  const multiplier = STEP_MULTIPLIERS.find((m) => residual <= m + 1e-9) ?? 10
  const step = clean(multiplier * magnitude)
  const steps = Math.max(Math.ceil(safeMax / step - 1e-9), 1)
  const ticks: number[] = []
  for (let i = 0; i <= steps; i += 1) ticks.push(clean(i * step))
  return { max: ticks[ticks.length - 1], step, ticks }
}

// 값을 화면 좌표로. 값이나 범위가 이상하면(NaN, 0 이하) 시작점에 둔다.
export function scaleLinear(value: number, domainMax: number, rangeStart: number, rangeEnd: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(domainMax) || domainMax <= 0) return rangeStart
  const ratio = Math.min(Math.max(value / domainMax, 0), 1)
  return rangeStart + (rangeEnd - rangeStart) * ratio
}

// 점이 너무 많으면 처음과 끝은 남기고 고르게 솎아 낸다. (그래프가 뭉개지지 않게)
export function downsample<T>(items: T[], max: number): T[] {
  const limit = Math.max(Math.floor(max), 2)
  if (items.length <= limit) return items
  const out: T[] = []
  const last = items.length - 1
  let prev = -1
  for (let i = 0; i < limit; i += 1) {
    const index = Math.round((i * last) / (limit - 1))
    if (index !== prev) out.push(items[index])
    prev = index
  }
  return out
}

// 마우스/손가락 위치와 가장 가까운 점의 번호(없으면 -1). points 는 화면 좌표.
export function nearestPoint(points: { x: number; y: number }[], px: number, py: number, maxDistance: number): number {
  let best = -1
  let bestDist = maxDistance * maxDistance
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i].x - px
    const dy = points[i].y - py
    const d = dx * dx + dy * dy
    if (Number.isFinite(d) && d <= bestDist) {
      best = i
      bestDist = d
    }
  }
  return best
}
