import { getPeriodRange, parsePeriod, rankVideos, type RankedVideo } from '@/lib/v4/analytics'
import { cachedJson } from '@/lib/v4/http'
import { loadPeriodRows, loadUsersShared } from '@/lib/v4/period-rows'
import { filterRanked, pageOf, parseRankQuery, sortRanked, summarizeRanked } from '@/lib/v4/ranking-query'
import { requireV4User, v4ErrorResponse } from '@/lib/v4/server'

// GET /api/v4/ranking?period=&sort=&dir=&limit=&offset=&staffId=&format=&q=&dow=&hour=
// - dow(0=일~6=토)·hour(0~23) 는 "그 요일·시각(한국 시간)에 올린 영상만" 이다. 타이밍 화면의 칸에서 넘어올 때 쓴다.
// - 새 파라미터를 하나도 안 주면 예전처럼 items 를 돌려주되 최대 500개까지만 (전체 개수는 total).
// - 새 파라미터를 주면 정렬·필터를 여기서 하고 요청한 쪽(offset~offset+limit)만 내려준다. limit=0 이면 요약만.
export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await requireV4User(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))
    const query = parseRankQuery(url.searchParams)
    const ownerId = isAdmin ? null : profile.id

    const [videos, { map: userMap, staff }] = await Promise.all([
      loadPeriodRows(supabaseAdmin, { startIso: range.startIso, endIso: range.endIso, ownerId }),
      loadUsersShared(supabaseAdmin)
    ])

    const all = rankVideos(videos, userMap)

    // 필터용 담당자 목록: 관리자는 활동 직원 전체 + 기간 내 영상 소유자, 직원은 본인만
    const ownerIds = new Set<string>()
    for (const v of all) if (v.ownerId) ownerIds.add(v.ownerId)
    const staffOptions = isAdmin
      ? Array.from(new Set([...staff.map((s) => s.id), ...ownerIds]))
          .map((id) => ({ id, name: userMap.get(id)?.name || '미지정' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      : [{ id: profile.id, name: profile.name }]

    // 목록에 없는 담당자 값(퇴사 후 저장된 선택 등)은 무시한다. 직원 계정은 이미 본인 영상만 읽었으므로 필터가 필요 없다.
    const staffId = isAdmin && staffOptions.some((s) => s.id === query.staffId) ? query.staffId : ''

    const summary = summarizeRanked(all)
    const filtered = filterRanked(all, { staffId, format: query.format, q: query.q, dow: query.dow, hour: query.hour })
    // 필터를 걸었을 때 화면 위쪽 숫자도 "걸러진 영상" 기준으로 보여줄 수 있게 따로 계산한다. (필터가 없으면 summary 와 같다)
    const filteredSummary = filtered === all ? summary : summarizeRanked(filtered)
    const sorted = sortRanked(filtered, query.sort, query.dir)
    // 90일이면 6,000개 이상이라 화면에 안 쓰는 썸네일 주소는 빼고 내려준다 (응답 크기 절감).
    const strip = ({ thumbnailUrl: _thumbnail, ...rest }: RankedVideo) => rest
    const items = pageOf(sorted, query.offset, query.limit).map(strip)

    return cachedJson({
      scope: isAdmin ? 'admin' : 'staff',
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      items,
      staffOptions,
      // ---- 여기부터 추가 필드 (예전 화면은 무시해도 된다)
      total: sorted.length,
      offset: query.offset,
      limit: query.limit,
      sort: query.sort,
      dir: query.dir,
      staffId,
      format: query.format,
      q: query.q,
      dow: query.dow,
      hour: query.hour,
      hasMore: query.offset + items.length < sorted.length,
      summary: {
        videoCount: summary.videoCount,
        totalViews: summary.totalViews,
        avgViews: summary.avgViews,
        top: summary.top ? strip(summary.top) : null,
        rising: summary.rising ? strip(summary.rising) : null
      },
      filteredSummary: {
        videoCount: filteredSummary.videoCount,
        totalViews: filteredSummary.totalViews,
        avgViews: filteredSummary.avgViews,
        top: filteredSummary.top ? strip(filteredSummary.top) : null,
        rising: filteredSummary.rising ? strip(filteredSummary.rising) : null
      }
    })
  } catch (e) {
    return v4ErrorResponse(e, '영상 순위를 불러오지 못했어요')
  }
}
