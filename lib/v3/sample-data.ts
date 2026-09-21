// V3 테이블(supabase/sql/v3/100_v3_engagement.sql)이 아직 생성되지 않았을 때
// GET API가 돌려주는 샘플 데이터. 시드 기반 난수를 써서 새로고침해도 같은 숫자가 나오게 한다.

const SAMPLE_STOCK_NAMES = ['삼성전자', 'SK하이닉스', '에코프로', '현대차', 'LS머트리얼즈', '한미반도체', '알테오젠']

function seeded(seed: number) {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

export type SampleSeriesRow = {
  id: string
  name: string
  stock_name: string | null
  video_count: number
  avg_engagement_pct: number
  avg_velocity: number
  baseline_engagement_pct: number
  baseline_velocity: number
  created_at: string
}

// video_series 테이블이 없을 때 "형식·시리즈 효과" 페이지에 보여줄 예시 시리즈
export function sampleSeriesRows(): SampleSeriesRow[] {
  const rand = seeded(20260918)
  const names = ['삼성전자 실적 브리핑 시리즈', '반도체 위클리 브리핑', '2차전지 집중분석']
  return names.map((name, i) => {
    const stock = SAMPLE_STOCK_NAMES[i % SAMPLE_STOCK_NAMES.length]
    const baseEng = 2 + rand() * 3
    const baseVel = 600 + rand() * 800
    return {
      id: `sample-series-${i + 1}`,
      name,
      stock_name: stock,
      video_count: 4 + Math.floor(rand() * 6),
      avg_engagement_pct: baseEng * (1.2 + rand() * 0.4),
      avg_velocity: baseVel * (1.2 + rand() * 0.5),
      baseline_engagement_pct: baseEng,
      baseline_velocity: baseVel,
      created_at: '2026-09-01T09:00:00.000Z'
    }
  })
}

// viral_signal_acks 테이블이 없을 때: 항상 "미확인" 취급하므로 샘플 데이터가 필요 없다.
