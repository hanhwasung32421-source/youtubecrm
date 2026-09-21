// 화면의 표를 CSV 글자로 바꾸는 순수 함수. 화면에 보이는 표와 같은 순서·같은 값(정렬·필터 적용 후)을 그대로 담는다.

import { buildCsv, csvDateTime } from '@/lib/v3/csv'
import { buildWhy, type WhyTeam } from '@/lib/v3/viral-why'
import { seriesEffectScore } from '@/lib/v3/sorting'

const formatName = (t: string | null | undefined) => (t === 'shortform' ? '숏폼' : t === 'longform' ? '롱폼' : '')
const round = (n: number | null | undefined, digits: number): number | null => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(digits)) : null)

// ── 급상승 영상 ──
export type ViralCsvItem = {
  id: string
  title: string
  stockName: string | null
  contentType: string
  youtubeUrl: string | null
  viewCount: number | null
  publishedAt?: string | null
  velocity: number
  ratio: number
  likeRatePct?: number | null
  commentRatePct?: number | null
  engagementPct?: number | null
  ageDays?: number | null
  ownerName?: string | null
  acknowledged: boolean
  actionNote: string | null
  ackedByName?: string | null
}

export function viralCsv(items: ViralCsvItem[], team: WhyTeam, opts: { showOwner: boolean }): string {
  const headers = ['제목', '종목', '형식', ...(opts.showOwner ? ['올린 사람'] : []), '올린 날짜', '조회수', '하루 조회수', '팀 중앙값 대비(배)', '참여율(%)', '왜 떴을까', '확인 여부', '확인한 사람', '조치 메모', '영상 주소']
  const rows = items.map((i) => {
    const why = buildWhy(
      { ratio: i.ratio, velocity: i.velocity, viewCount: i.viewCount, ageDays: i.ageDays ?? null, likeRatePct: i.likeRatePct ?? null, commentRatePct: i.commentRatePct ?? null },
      team
    )
    return [
      i.title,
      i.stockName,
      formatName(i.contentType),
      ...(opts.showOwner ? [i.ownerName || ''] : []),
      csvDateTime(i.publishedAt),
      i.viewCount,
      i.velocity,
      round(i.ratio, 1),
      round(i.engagementPct, 2),
      why.text,
      i.acknowledged ? '확인함' : '아직',
      i.ackedByName || '',
      i.actionNote || '',
      i.youtubeUrl
    ]
  })
  return buildCsv(headers, rows)
}

// ── 참여 현황: 영상별 순위 ──
export type EngagementCsvRow = {
  title: string
  stockName: string | null
  contentType: string
  viewCount: number
  likeRatePct: number
  commentRatePct: number
  engagementPct: number
  publishedAt: string | null
  youtubeUrl: string | null
}

export function engagementCsv(rows: EngagementCsvRow[]): string {
  return buildCsv(
    ['순위', '제목', '종목', '형식', '올린 날짜', '조회수', '참여율(%)', '좋아요 비율(%)', '댓글 참여율(%)', '영상 주소'],
    rows.map((r, i) => [i + 1, r.title, r.stockName, formatName(r.contentType), csvDateTime(r.publishedAt), r.viewCount, round(r.engagementPct, 2), round(r.likeRatePct, 2), round(r.commentRatePct, 3), r.youtubeUrl])
  )
}

// ── 조회수 성장: 한 영상의 기록 표 ──
export type SnapshotCsvRow = { snapshotAt: string; day: number; viewCount: number; likeCount: number; commentCount: number; gain?: number | null }

export function lifecycleCsv(snapshots: SnapshotCsvRow[]): string {
  // 화면과 같이 가장 최근 기록이 맨 위
  const rows = [...snapshots].reverse().map((s) => [csvDateTime(s.snapshotAt), round(s.day, 1), s.viewCount, s.gain ?? null, s.likeCount, s.commentCount])
  return buildCsv(['기록한 시각', '올린 뒤(일)', '조회수', '이전 기록보다 늘어난 조회수', '좋아요', '댓글'], rows)
}

// ── 시리즈 ──
export type SeriesCsvRow = {
  name: string
  stockName: string | null
  videoCount: number
  avgEngagementPct: number
  avgVelocity: number
  baselineEngagementPct: number
  baselineVelocity: number
  createdByName: string | null
  members: { title: string }[]
}

export function seriesCsv(rows: SeriesCsvRow[]): string {
  return buildCsv(
    ['시리즈', '종목', '영상 수', '참여율(%)', '기준 영상 참여율(%)', '하루 평균 조회수', '기준 영상 하루 평균 조회수', '시리즈 밖 영상보다(%)', '만든 사람', '묶인 영상'],
    rows.map((s) => {
      const score = seriesEffectScore(s)
      return [
        s.name,
        s.stockName,
        s.videoCount,
        s.videoCount ? round(s.avgEngagementPct, 2) : null,
        round(s.baselineEngagementPct, 2),
        s.videoCount ? Math.round(s.avgVelocity) : null,
        Math.round(s.baselineVelocity),
        score === null ? null : round(score, 1),
        s.createdByName,
        s.members.map((m) => m.title).join(' / ')
      ]
    })
  )
}
