import { NextResponse } from 'next/server'
import { RANKING_COLUMNS, getPeriodRange, parsePeriod, rankVideos } from '@/lib/v4/analytics'
import { loadUsers, loadVideos, requireV4User, v4ErrorResponse } from '@/lib/v4/server'

export async function GET(request: Request) {
  try {
    const { profile, supabaseAdmin, isAdmin } = await requireV4User(request)
    const url = new URL(request.url)
    const range = getPeriodRange(parsePeriod(url.searchParams.get('period')))
    const ownerId = isAdmin ? null : profile.id

    const [videos, { map: userMap, staff }] = await Promise.all([
      loadVideos(supabaseAdmin, { startIso: range.startIso, endIso: range.endIso, ownerId, columns: RANKING_COLUMNS }),
      loadUsers(supabaseAdmin)
    ])

    // 90일이면 6,000개 이상이라 화면에 안 쓰는 썸네일 주소는 빼고 내려준다 (응답 크기 절감).
    const items = rankVideos(videos, userMap).map(({ thumbnailUrl: _thumbnail, ...rest }) => rest)
    // 필터용 담당자 목록: 관리자는 활동 직원 전체 + 기간 내 영상 소유자, 직원은 본인만
    const ownerIds = new Set(items.map((v) => v.ownerId).filter((id): id is string => Boolean(id)))
    const staffOptions = isAdmin
      ? Array.from(new Set([...staff.map((s) => s.id), ...ownerIds]))
          .map((id) => ({ id, name: userMap.get(id)?.name || '미지정' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      : [{ id: profile.id, name: profile.name }]

    return NextResponse.json({
      scope: isAdmin ? 'admin' : 'staff',
      period: range.days,
      range: { start: range.startYmd, end: range.endYmd },
      items,
      staffOptions
    })
  } catch (e) {
    return v4ErrorResponse(e, '콘텐츠 성과 랭킹 조회 실패')
  }
}
