// "왜 떴을까?" 한 줄 설명과 "다음에 뭘 하면 좋을까?" 제안을 만드는 순수 함수.
// 팀 중앙값(최근 30일 영상의 가운데 값)과 비교해서 몇 배인지를 쉬운 말로 알려 준다. (외부 import 없음)

export type WhyInput = {
  ratio: number
  velocity: number
  viewCount: number | null
  ageDays: number | null
  likeRatePct: number | null
  commentRatePct: number | null
}

export type WhyTeam = {
  medianVelocity: number
  medianLikeRatePct: number | null
  medianCommentRatePct: number | null
}

export type Why = {
  // 맨 앞 한 문장(항상 있음)
  headline: string
  // 덧붙이는 이유(0~2개)
  points: string[]
  // 화면에 그대로 보여 줄 전체 문장
  text: string
  // 좋아요·댓글이 평소보다 확실히 높은지(팬 반응이 함께 왔는지)
  fanReaction: 'high' | 'normal' | 'low' | 'unknown'
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

// value 가 base 의 몇 배인지. base 가 0 이하거나 값이 이상하면 null
export function multipleOf(value: number | null | undefined, base: number | null | undefined): number | null {
  if (!finite(value) || !finite(base) || base <= 0) return null
  const m = value / base
  return Number.isFinite(m) ? m : null
}

// 3.24 -> "3.2배", 10.04 -> "10배"
export function formatMultiple(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return '—'
  if (m >= 10) return `${Math.round(m)}배`
  return `${m.toFixed(1).replace(/\.0$/, '')}배`
}

const HIGH = 1.5
const LOW = 0.7

export function buildWhy(item: WhyInput, team: WhyTeam): Why {
  const speed = finite(item.ratio) && item.ratio > 0 ? item.ratio : multipleOf(item.velocity, team.medianVelocity)
  const headline = speed === null ? '하루 조회수가 평소보다 많이 늘고 있어요.' : `하루 조회수가 팀 중앙값의 ${formatMultiple(speed)}예요.`

  const likeM = multipleOf(item.likeRatePct, team.medianLikeRatePct)
  const commentM = multipleOf(item.commentRatePct, team.medianCommentRatePct)
  const points: string[] = []

  const likeHigh = likeM !== null && likeM >= HIGH
  const commentHigh = commentM !== null && commentM >= HIGH
  const likeLow = likeM !== null && likeM <= LOW
  const commentLow = commentM !== null && commentM <= LOW

  if (likeHigh && commentHigh) {
    points.push(`좋아요 비율은 ${formatMultiple(likeM)}, 댓글 비율은 ${formatMultiple(commentM)}로 시청자 반응도 함께 뜨거워요.`)
  } else if (likeHigh) {
    points.push(`좋아요 비율도 팀 중앙값의 ${formatMultiple(likeM)}로 높아요.`)
  } else if (commentHigh) {
    points.push(`댓글 비율이 팀 중앙값의 ${formatMultiple(commentM)}로 높아요. 궁금한 게 많은 영상이에요.`)
  } else if (likeLow && commentLow) {
    points.push('조회수만 크게 늘고 좋아요·댓글은 평소보다 적어요. 많이 노출된 영상일 수 있어요.')
  }

  if (finite(item.ageDays)) {
    if (item.ageDays <= 3) points.push('올린 지 며칠 안 됐는데 이미 빠르게 늘고 있어요.')
    else if (item.ageDays >= 14) points.push('올린 지 오래됐는데도 꾸준히 보고 있어요.')
  }

  const shown = points.slice(0, 2)
  let fanReaction: Why['fanReaction'] = 'unknown'
  if (likeM !== null || commentM !== null) {
    if (likeHigh || commentHigh) fanReaction = 'high'
    else if ((likeM === null || likeLow) && (commentM === null || commentLow)) fanReaction = 'low'
    else fanReaction = 'normal'
  }
  return { headline, points: shown, text: [headline, ...shown].join(' '), fanReaction }
}

export type FollowUp = { label: string; hint: string; stock: string | null; format: 'longform' | 'shortform' }

// 다음에 올리면 좋은 영상 제안. 같은 종목·같은 형식이 먼저, 그 다음이 다른 형식.
export function suggestFollowUps(item: { stockName: string | null; contentType: string }): FollowUp[] {
  const stock = (item.stockName || '').trim() || null
  const same: 'longform' | 'shortform' = item.contentType === 'shortform' ? 'shortform' : 'longform'
  const other: 'longform' | 'shortform' = same === 'longform' ? 'shortform' : 'longform'
  const label = (f: 'longform' | 'shortform') => (f === 'longform' ? '롱폼' : '숏폼')
  const list: FollowUp[] = [
    {
      label: stock ? `같은 종목(${stock})으로 후속 영상 올리기` : '비슷한 주제로 후속 영상 올리기',
      hint: `${label(same)}로 등록 화면이 열리고 종목이 미리 채워져요.`,
      stock,
      format: same
    }
  ]
  if (stock) {
    list.push({
      label: `${label(other)}로도 올려 보기`,
      hint: same === 'longform' ? '핵심만 짧게 풀어 더 많은 사람에게 닿게 해요.' : '자세한 설명을 담아 팬을 더 붙잡아요.',
      stock,
      format: other
    })
  }
  return list
}
