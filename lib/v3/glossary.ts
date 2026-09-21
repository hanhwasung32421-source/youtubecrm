// V3 화면에서 쓰는 말의 뜻을 한 곳에서 관리한다. 같은 말은 어느 화면에서나 같은 이름·같은 설명을 쓴다. (외부 import 없음)
//   short: 한 줄(마우스를 올리거나 눌렀을 때)   long: "이게 뭐예요?" 펼침 목록에 쓰는 설명

export type GlossaryKey = 'engagement' | 'commentRate' | 'median' | 'viralThreshold' | 'dailyViews' | 'snapshot' | 'seriesEffect' | 'baseline'

export type GlossaryEntry = { term: string; short: string; long: string }

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  engagement: {
    term: '참여율',
    short: '영상을 본 사람 중 좋아요나 댓글을 남긴 사람의 비율이에요.',
    long: '(좋아요 + 댓글) ÷ 조회수예요. 100명이 봤을 때 몇 명이 반응했는지로 읽으면 쉬워요. 높을수록 시청자가 영상에 관심을 보인 거예요.'
  },
  commentRate: {
    term: '댓글 참여율',
    short: '영상을 본 사람 중 댓글을 남긴 사람의 비율이에요.',
    long: '댓글 ÷ 조회수예요. 댓글은 좋아요보다 남기기 어려워서, 이 값이 높으면 팬이 생기고 있다는 신호예요.'
  },
  median: {
    term: '중앙값',
    short: '숫자를 크기 순으로 줄 세웠을 때 한가운데 값이에요. ‘평소’를 나타내요.',
    long: '평균은 아주 잘 나온 영상 하나에 크게 흔들려요. 중앙값은 줄 세웠을 때 정확히 가운데 영상의 값이라 ‘보통 영상’을 더 잘 보여줘요.'
  },
  viralThreshold: {
    term: '급상승 기준',
    short: '하루 조회수가 팀 중앙값의 2배 이상이면 급상승 영상으로 봐요.',
    long: '최근 30일 동안 팀이 올린 영상의 하루 조회수 중앙값을 ‘평소’로 삼고, 그 2배 이상 빠르게 늘어나는 영상을 찾아요. 이 기준은 화면에서 바꿀 수 없어요.'
  },
  dailyViews: {
    term: '하루 조회수',
    short: '올린 뒤 하루에 평균 몇 번 재생됐는지예요.',
    long: '조회수 ÷ 올린 뒤 지난 날짜(최소 1일)예요. 오래된 영상과 새 영상을 같은 잣대로 비교하려고 써요.'
  },
  snapshot: {
    term: '조회수 기록',
    short: '‘새로고침’을 누른 시점의 조회수를 저장해 둔 거예요.',
    long: '유튜브에서 조회수를 가져와 그날그날 남겨 둔 값이에요. 기록이 2개 이상 쌓여야 조회수가 어떻게 늘었는지 그래프로 볼 수 있어요.'
  },
  seriesEffect: {
    term: '시리즈 효과',
    short: '같은 주제로 묶어 올린 영상이 일반 영상보다 반응이 좋은지예요.',
    long: '시리즈 영상들의 평균 참여율·하루 조회수를, 같은 종목이면서 시리즈에 속하지 않은 영상들과 비교해요. 두 값이 모두 5% 이상 높으면 ‘시리즈 효과 있음’으로 봐요.'
  },
  baseline: {
    term: '기준 영상',
    short: '비교할 때 기준으로 삼는, 시리즈에 속하지 않은 같은 종목 영상이에요.',
    long: '시리즈 효과를 계산할 때 시리즈에 묶이지 않은 같은 종목 영상들의 평균을 ‘기준’으로 써요. 종목을 비워 둔 시리즈는 시리즈 밖 모든 영상이 기준이에요.'
  }
}

export const GLOSSARY_STORAGE_PREFIX = 'v3:glossary-seen:v1:'
