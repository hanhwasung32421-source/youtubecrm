import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getBearerToken, getProfileByAccessToken } from '@/lib/auth/session'
import { deriveContentType, extractStockNameFromTitle, extractYoutubeVideoId, fetchYoutubeVideoMeta } from '@/lib/youtube/api'
import { ensureDefaultYoutubeAccount } from '@/lib/youtube/default-account'
import { TABLES } from '@/lib/supabase/tables'
import { errorResponse } from '@/lib/api/error-response'

// 제목에서 종목명을 못 읽었을 때 쓰는 자리표시자. 목록 화면에서 언제든 고칠 수 있다.
const STOCK_NAME_PLACEHOLDER = '종목 미지정'

const bodySchema = z.object({
  youtubeUrl: z.string().url(),
  // 형식은 영상 길이로 자동으로 정해진다(10분 미만=숏폼, 10분 이상=롱폼).
  // 길이를 알 수 없을 때(API 비활성 등)만 이 값을 예비로 쓴다.
  contentType: z.enum(['longform', 'shortform']).optional(),
  // 종목명도 이제 필수가 아니다. 비어 있으면 제목에서 자동으로 읽어내고, 그마저 안 되면
  // 자리표시자로 등록한 뒤 나중에 목록에서 고칠 수 있게 한다.
  stockName: z.string().trim().min(1).optional(),
  contentCategory: z.string().optional().nullable()
})

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json())
    const { profile, supabaseAdmin } = await getProfileByAccessToken(getBearerToken(request))
    const youtubeAccount = await ensureDefaultYoutubeAccount(supabaseAdmin)

    const apiActive = Boolean((youtubeAccount as any).api_active)
    const apiKey = String((youtubeAccount as any).api_key || '').trim()

    let meta:
      | Awaited<ReturnType<typeof fetchYoutubeVideoMeta>>
      | {
          youtubeVideoId: string
          youtubeChannelId: string
          channelName: string
          title: string
          description: string
          publishedAt: string | null
          durationSeconds: number | null
          privacyStatus: string | null
          thumbnailUrl: string | null
          viewCount: number | null
          likeCount: number | null
          commentCount: number | null
        }

    if (apiActive && apiKey) {
      meta = await fetchYoutubeVideoMeta(body.youtubeUrl, apiKey)
    } else {
      const youtubeVideoId = extractYoutubeVideoId(body.youtubeUrl)
      if (!youtubeVideoId) {
        return NextResponse.json({ error: '유효한 유튜브 영상 주소가 아닙니다.' }, { status: 400 })
      }

      const channelIdText = String((youtubeAccount as any).channel_id || '').trim()
      const channelNameText = String((youtubeAccount as any).channel_name || '').trim()
      if (!channelIdText) {
        return NextResponse.json(
          {
            error:
              '현재는 API가 비활성 상태입니다. 유튜브 계정에 채널 ID를 입력하거나, 관리자에서 API 활성화를 먼저 해 주세요.'
          },
          { status: 400 }
        )
      }

      meta = {
        youtubeVideoId,
        youtubeChannelId: channelIdText,
        channelName: channelNameText || `채널-${channelIdText.slice(0, 8)}`,
        title: '',
        description: '',
        publishedAt: null,
        durationSeconds: null,
        privacyStatus: null,
        thumbnailUrl: null,
        viewCount: null,
        likeCount: null,
        commentCount: null
      }
    }

    // 길이를 알면 그 값으로 형식을 정하고(사용자가 고른 값이 있어도 덮어쓴다),
    // 길이를 모를 때만 화면에서 보낸 값을 쓴다(그마저 없으면 롱폼).
    const contentType = deriveContentType(meta.durationSeconds, body.contentType ?? 'longform')

    // 이미 등록된 영상이면(같은 주소를 다시 등록) 그동안 목록에서 고쳐 둔 종목명을 지키기 위해 먼저 읽어 둔다.
    const { data: existingVideoRow } = await supabaseAdmin
      .from(TABLES.videos)
      .select('stock_name')
      .eq('youtube_video_id', meta.youtubeVideoId)
      .maybeSingle()
    const existingStockName = String(existingVideoRow?.stock_name || '').trim()
    const keepExisting = existingStockName && existingStockName !== STOCK_NAME_PLACEHOLDER ? existingStockName : null

    // 종목명: 직접 적어 보냈으면 그 값을 쓰고, 아니면 이미 있던(고쳐 둔) 값을 지키고,
    // 그마저 없으면 제목에서 읽어내고, 그래도 안 되면 자리표시자.
    const titleStockName = extractStockNameFromTitle(meta.title)
    const stockName = body.stockName || keepExisting || titleStockName || STOCK_NAME_PLACEHOLDER
    const stockNameSource: 'input' | 'kept' | 'title' | 'placeholder' = body.stockName
      ? 'input'
      : keepExisting
        ? 'kept'
        : titleStockName
          ? 'title'
          : 'placeholder'

    let channelId: string | null = null
    const { data: existingChannel } = await supabaseAdmin
      .from(TABLES.channels)
      .select('id')
      .eq('youtube_channel_id', meta.youtubeChannelId)
      .maybeSingle()

    if (existingChannel?.id) {
      channelId = existingChannel.id
    } else {
      const { data: newChannel, error: channelInsertError } = await supabaseAdmin
        .from(TABLES.channels)
        .insert({
          youtube_channel_id: meta.youtubeChannelId,
          name: meta.channelName || `채널-${meta.youtubeChannelId.slice(0, 8)}`,
          status: 'active',
          is_active: true
        })
        .select('id')
        .single()

      if (channelInsertError || !newChannel) {
        return errorResponse(channelInsertError, '채널 생성 실패')
      }
      channelId = newChannel.id
    }

    const { data: insertedVideo, error: upsertError } = await supabaseAdmin
      .from(TABLES.videos)
      .upsert(
        {
          youtube_video_id: meta.youtubeVideoId,
          youtube_account_id: youtubeAccount.id,
          channel_id: channelId,
          primary_owner_user_id: profile.id,
          youtube_url: body.youtubeUrl,
          content_type: contentType,
          stock_name: stockName,
          content_category: body.contentCategory || null,
          publish_state: apiActive ? 'published' : null,
          title: meta.title || null,
          description: meta.description || null,
          privacy_status: meta.privacyStatus,
          published_at: meta.publishedAt,
          duration_seconds: meta.durationSeconds,
          thumbnail_url: meta.thumbnailUrl,
          view_count: meta.viewCount,
          like_count: meta.likeCount,
          comment_count: meta.commentCount,
          last_synced_at: apiActive ? new Date().toISOString() : null
        },
        { onConflict: 'youtube_video_id' }
      )
      .select('id, youtube_video_id, title, published_at, view_count, like_count, comment_count, content_type, duration_seconds, stock_name')
      .single()

    if (upsertError || !insertedVideo) {
      return errorResponse(upsertError, '영상 저장 실패')
    }

    if (apiActive) {
      await supabaseAdmin.from(TABLES.videoSnapshots).insert({
        video_id: insertedVideo.id,
        snapshot_at: new Date().toISOString(),
        view_count: meta.viewCount,
        like_count: meta.likeCount,
        comment_count: meta.commentCount,
        privacy_status: meta.privacyStatus,
        raw_json: meta
      })
    }

    await supabaseAdmin.from(TABLES.workActivityEvents).insert({
      user_id: profile.id,
      activity_type: 'video_registered',
      related_channel_id: channelId,
      related_video_id: insertedVideo.id,
      payload_summary: {
        youtube_account_id: youtubeAccount.id,
        youtube_account_name: youtubeAccount.account_name,
        youtube_video_id: meta.youtubeVideoId,
        stock_name: stockName,
        content_type: contentType,
        api_active: apiActive
      }
    })

    // stockNameSource: 화면에서 "제목에서 종목명을 가져왔어요" 같은 안내를 보여줄 때 쓴다.
    return NextResponse.json({ ok: true, video: insertedVideo, stockNameSource })
  } catch (e: any) {
    const firstIssue = e?.issues?.[0]
    if (firstIssue?.message) {
      return NextResponse.json({ error: firstIssue.message }, { status: 500 })
    }
    return errorResponse(e, '영상 저장 실패')
  }
}
