'use client'

import { V2_SQL_FILE } from '@/lib/v2/tables'

// API가 sample:true를 돌려줄 때(테이블 미생성) 페이지 상단에 보이는 차분한 한 줄 안내
export function SampleBanner({ show }: { show?: boolean }) {
  if (!show) return null
  return (
    <div className="v2-sample-banner" role="status">
      <span className="v2-sample-tag">샘플</span>
      <span>
        지금은 예시 데이터예요. 실제 데이터로 바꾸려면 <code>{V2_SQL_FILE}</code> 파일을 실행해 주세요.
      </span>
    </div>
  )
}
