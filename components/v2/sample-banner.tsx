'use client'

import { V2_SQL_FILE } from '@/lib/v2/tables'
import { useV2Me } from './session-context'

// 아직 준비되지 않은 기능이라 예시 데이터가 보일 때(API가 sample:true를 돌려줄 때) 화면 위쪽에 보이는 차분한 한 줄 안내
export function SampleBanner({ show }: { show?: boolean }) {
  const me = useV2Me()
  if (!show) return null
  return (
    <div className="v2-sample-banner" role="status">
      <span className="v2-sample-tag">예시</span>
      {me.isAdmin ? (
        <span>
          지금은 예시 데이터가 보여요. 실제 데이터를 쓰려면 개발 담당자에게 <code>{V2_SQL_FILE}</code> 실행을 요청해 주세요.
        </span>
      ) : (
        <span>지금은 예시 데이터가 보여요. 관리자에게 알려 주세요.</span>
      )}
    </div>
  )
}
