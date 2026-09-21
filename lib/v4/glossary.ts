// 화면에 나오는 낯선 말을 쉬운 말로 풀어 둔 사전. 화면에서는 "이게 뭐예요?" 로 열어 본다. (순수 데이터)

export type GlossaryKey =
  | 'velocity'
  | 'reactionScore'
  | 'avgViews'
  | 'likeRate'
  | 'trend'
  | 'sample'
  | 'foldCandidate'
  | 'dailyTarget'
  | 'abTest'
  | 'heatmap'

export type GlossaryEntry = { term: string; short: string; long: string }

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  velocity: {
    term: '조회 속도',
    short: '하루에 평균 몇 번 봤는지',
    long: '조회수 ÷ 올린 뒤 지난 날짜(최소 1일)예요. 어제 올린 영상과 한 달 전에 올린 영상을 공평하게 비교할 수 있어요.'
  },
  reactionScore: {
    term: '반응 점수',
    short: '팀 평균의 몇 배인지',
    long: '그 종목 영상 1개당 평균 조회수 ÷ 팀 전체 영상 1개당 평균 조회수예요. 1.0배가 평균이고, 2.0배면 평균보다 2배 잘 나온다는 뜻이에요.'
  },
  avgViews: {
    term: '영상당 평균 조회수',
    short: '영상 1개가 보통 받는 조회수',
    long: '조회수 합계 ÷ 영상 수예요. 영상을 많이 올린 쪽과 적게 올린 쪽을 공평하게 비교할 때 써요.'
  },
  likeRate: {
    term: '좋아요 비율',
    short: '본 사람 중 좋아요를 누른 비율',
    long: '좋아요 수 ÷ 조회수예요. 높을수록 영상을 본 사람이 만족했다는 뜻에 가까워요.'
  },
  trend: {
    term: '지난 기간 대비',
    short: '직전 같은 길이 기간과 비교한 변화',
    long: '예를 들어 30일을 보고 있으면 그 앞 30일과 총 조회수를 비교해요. ±5% 이내는 “비슷해요”로 봐요.'
  },
  sample: {
    term: '표본이 적어요',
    short: '영상이 너무 적어서 우연일 수 있다는 뜻',
    long: '영상이 1~2개뿐인 칸이나 종목은 한 영상이 우연히 잘 나온 것일 수 있어요. 3개 이상 쌓이면 그때부터 믿고 참고하세요.'
  },
  foldCandidate: {
    term: '접어도 좋아요',
    short: '여러 번 다뤘는데 반응이 약한 종목',
    long: '영상을 3개 이상 올렸는데 영상당 평균 조회수가 팀 평균의 절반 이하인 종목이에요. 당분간 쉬고 반응이 좋은 종목을 먼저 다뤄도 좋다는 참고 신호예요. 꼭 그래야 한다는 뜻은 아니에요.'
  },
  dailyTarget: {
    term: '오늘 목표',
    short: '하루 12개 등록 (참고용)',
    long: '직원 1명이 하루에 등록하면 좋은 영상 수예요. 강제가 아니라 진행 상황을 함께 보기 위한 참고 숫자예요.'
  },
  abTest: {
    term: 'A/B 실험',
    short: '두 가지를 만들어 어느 쪽이 나은지 비교',
    long: '지금 쓰던 방식(A)과 새로 해볼 방식(B)을 비슷한 영상에 각각 적용하고, 며칠 뒤 조회수를 보고 어느 쪽이 나았는지 기록하는 거예요.'
  },
  heatmap: {
    term: '요일 × 시간대 표',
    short: '언제 올린 영상이 잘 나왔는지 색으로 보여주는 표',
    long: '칸이 진할수록 값이 커요. 점선 칸은 영상이 3개 미만이라 표본이 적으니 참고만 하세요. 시각은 한국 시간이에요.'
  }
}
