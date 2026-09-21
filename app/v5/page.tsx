'use client'

import { useHomeRedirect } from '@/components/v5/use-home-redirect'
import { Skeleton, SkeletonRegion } from '@/components/v5/widget'

// 로그인된 사람은 역할별 첫 화면(직원 = 영상 등록, 관리자 = 성장 실험)으로,
// 아니면 로그인 화면으로 보낸다.
export default function HomePage() {
  useHomeRedirect('/v5/login')
  return (
    <SkeletonRegion label="이동 중" className="v5-home-skel">
      <Skeleton height={26} width={220} radius={8} />
      <Skeleton height={14} width={320} />
    </SkeletonRegion>
  )
}
