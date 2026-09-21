// CSV 만들기(순수 함수, 브라우저/서버 어디서나 동작). 엑셀에서 한글이 깨지지 않게 파일 앞에 BOM 을 붙여서 저장한다.
//
// 안전 장치:
//  - 쉼표·큰따옴표·줄바꿈이 든 칸은 큰따옴표로 감싸고, 안의 큰따옴표는 두 번 쓴다.
//  - 글자가 = + - @ (또는 탭/줄바꿈) 로 시작하면 앞에 ' 를 붙인다(엑셀이 수식으로 실행하지 못하게 — "CSV 수식 주입" 방지).
//    숫자(number)는 글자가 아니라 값이므로 그대로 둔다(예: -8).

import { formatDate, isoWeekRangeText } from '@/lib/v5/format'
import { scoreParts, strongestWeakest, totalOf } from '@/lib/v5/score-view'
import { SCORE_TIER_LABEL, type ScoreboardRow, type WeeklyRetro } from '@/lib/v5/types'

export type CsvValue = string | number | boolean | null | undefined

// 수식으로 읽힐 수 있는 첫 글자: = + - @ , 탭, 줄바꿈(CR)
const FORMULA_START = /^[=+\-@\t\r]/
// 큰따옴표로 감싸야 하는 글자
const NEEDS_QUOTE = /[",\r\n]/

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  let text: string
  if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : ''
  else if (typeof value === 'boolean') text = value ? '예' : '아니요'
  else {
    text = String(value)
    if (FORMULA_START.test(text)) text = `'${text}`
  }
  if (NEEDS_QUOTE.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

// 머리글 + 줄들 → CSV 글자(줄 끝은 CRLF, BOM 은 붙이지 않는다: 저장할 때(share.ts) 앞에 BOM 을 붙인다).
export function buildCsv(headers: readonly CsvValue[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','))
  return `${lines.join('\r\n')}\r\n`
}

// "영상점수판-2026-09-21.csv"
export function csvFileName(prefix: string, ymd: string): string {
  const safe = prefix.replace(/[\\/:*?"<>|\s]+/g, '-')
  return `${safe}-${ymd}.csv`
}

// ---------------------------------------------------------------------------
// 영상 점수판
// ---------------------------------------------------------------------------
export const SCOREBOARD_CSV_HEADERS = ['순위', '영상 제목', '종목', '담당자', '조회수', '올린 날', '반응 점수(0~100)', '구간', '조회 속도(45점 만점)', '참여율(35점 만점)', '초기 성장(20점 만점)', '가장 약한 요소', '유튜브 주소'] as const

// rankOf: 점수 순위(1등부터). 정렬을 바꿔도 순위는 점수 기준이라 따로 받는다.
export function scoreboardCsv<T extends ScoreboardRow>(rows: readonly T[], rankOf: (row: T) => number): string {
  const body = rows.map((row) => {
    const parts = scoreParts(row)
    const value = (key: string) => parts.find((p) => p.key === key)?.value ?? ''
    const weakest = strongestWeakest(row).worst
    return [
      rankOf(row),
      row.video.title || '',
      row.video.stock_name,
      row.video.owner_name || '',
      row.video.view_count ?? '',
      row.video.published_at ? formatDate(row.video.published_at) : '',
      totalOf(row),
      SCORE_TIER_LABEL[row.tier] || '',
      value('velocity'),
      value('engagement'),
      value('early'),
      weakest ? weakest.label : '',
      row.video.youtube_url
    ]
  })
  return buildCsv(SCOREBOARD_CSV_HEADERS, body)
}

// ---------------------------------------------------------------------------
// 주간 회고
// ---------------------------------------------------------------------------
export const RETRO_CSV_HEADERS = ['주차', '기간', '잘된 점', '고칠 점', '다음 주 할 일', '할 일 완료', '할 일 전체', '그 주 등록 영상 수', '그 주 조회수 합계', '작성자', '작성일'] as const

export function retrosCsv(retros: readonly WeeklyRetro[]): string {
  const body = retros.map((r) => {
    const items = r.action_items || []
    const k = r.kpi_snapshot
    return [
      r.week_label,
      isoWeekRangeText(r.week_label),
      r.went_well || '',
      r.to_improve || '',
      items.map((a) => `${a.done ? '[완료] ' : '[ ] '}${a.text}`).join('\n'),
      items.filter((a) => a.done).length,
      items.length,
      k && typeof k.totalVideos === 'number' ? k.totalVideos : '',
      k && typeof k.totalViews === 'number' ? k.totalViews : '',
      r.author_name || '',
      r.created_at ? formatDate(r.created_at) : ''
    ]
  })
  return buildCsv(RETRO_CSV_HEADERS, body)
}
