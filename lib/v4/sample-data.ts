// V4 신규 테이블(content_experiments, growth_goals)이 아직 없을 때 GET 응답에 쓰는 샘플.
// 응답에 sample: true 가 붙고, 페이지는 배너로 "샘플 데이터 표시 중"을 알린다.

import { addDaysToYmd, getKstYmd } from '@/lib/attendance/time'

export type ExperimentItem = {
  id: string
  videoId: string | null
  videoTitle: string
  // 연결한 영상의 유튜브 주소 (없으면 null/없음). 나중에 추가된 값이라 옛 응답·샘플에는 없을 수 있다.
  videoUrl?: string | null
  stockName: string
  hypothesis: string
  variantA: string
  variantB: string
  metric: string
  startedOn: string
  endedOn: string | null
  winner: 'a' | 'b' | 'tie' | null
  learning: string | null
  createdBy: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
}

export type GoalItem = {
  id: string
  month: string
  userId: string | null
  targetVideos: number
  targetViews: number
}

export function getSampleExperiments(): ExperimentItem[] {
  const today = getKstYmd()
  const nowIso = new Date().toISOString()
  return [
    {
      id: 'sample-exp-1',
      videoId: null,
      videoTitle: '삼성전자 실적 발표 직후 매매 전략',
      stockName: '삼성전자',
      hypothesis: '종목명을 썸네일 왼쪽 위에 크게 넣으면 클릭률이 오른다',
      variantA: '기존 썸네일 (얼굴 + 차트)',
      variantB: '종목명을 큰 글씨로 + 빨간 화살표',
      metric: '클릭률 (유튜브 스튜디오의 노출 클릭률)',
      startedOn: addDaysToYmd(today, -10),
      endedOn: addDaysToYmd(today, -3),
      winner: 'b',
      learning: '종목명 글씨가 크면 클릭률이 5.1% → 7.4%로 올랐어요. 다만 얼굴이 없으면 평균 시청 시간은 조금 줄었어요.',
      createdBy: null,
      createdByName: '샘플',
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'sample-exp-2',
      videoId: null,
      videoTitle: '2차전지 급등, 지금 들어가도 될까?',
      stockName: '에코프로',
      hypothesis: '제목을 질문형으로 바꾸면 조회수가 더 나온다',
      variantA: '에코프로 급등 분석',
      variantB: '에코프로 지금 들어가도 될까? (질문형)',
      metric: '48시간 조회수',
      startedOn: addDaysToYmd(today, -5),
      endedOn: null,
      winner: null,
      learning: null,
      createdBy: null,
      createdByName: '샘플',
      createdAt: nowIso,
      updatedAt: nowIso
    },
    {
      id: 'sample-exp-3',
      videoId: null,
      videoTitle: '숏폼: 오늘의 급등주 3종목',
      stockName: '급등주',
      hypothesis: '숏폼 첫 1초에 종목명을 음성으로 말하면 이탈이 줄어든다',
      variantA: '인트로 후 종목 소개',
      variantB: '첫 1초에 종목명 즉시 언급',
      metric: '평균 시청 비율',
      startedOn: addDaysToYmd(today, -20),
      endedOn: addDaysToYmd(today, -14),
      winner: 'tie',
      learning: '시청 비율 차이가 1%p도 안 됐어요. 숏폼은 인트로보다 자막 크기의 영향이 더 큰 것 같아요.',
      createdBy: null,
      createdByName: '샘플',
      createdAt: nowIso,
      updatedAt: nowIso
    }
  ]
}

export function getSampleGoal(month: string, staffCount: number): GoalItem {
  const perStaff = 12 * 22
  return {
    id: 'sample-goal',
    month,
    userId: null,
    targetVideos: Math.max(1, staffCount) * perStaff,
    targetViews: Math.max(1, staffCount) * 300000
  }
}
