// 여러 화면에서 같은 말은 같은 뜻으로 쓰기 위한 용어 사전. 뜻풀이는 여기 한 곳에서만 고친다.
// label 이 화면에 쓰는 이름이고, aliases 는 같은 뜻으로 들을 수 있는 다른 말이다.
import { SCORE_GOOD_MIN, SCORE_LOW_MAX } from './score'
import { LIKE_RATE_TARGET, VIEW_VELOCITY_TARGET_PER_DAY } from './types'

export type GlossaryKey = 'score' | 'views' | 'likes' | 'check' | 'fixspot' | 'thumb' | 'plan' | 'best' | 'recent'

export type GlossaryEntry = { label: string; aliases?: string[]; meaning: string }

export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  score: {
    label: '반응 점수',
    meaning: `영상이 얼마나 잘 되고 있는지 100점 만점으로 나타낸 점수예요. 하루 조회 40% + 좋아요 비율 30% + 검색 점검 30%를 합쳐요. ${SCORE_GOOD_MIN}점 이상이면 좋음, ${SCORE_LOW_MAX}점 미만이면 낮음이에요.`
  },
  views: {
    label: '하루 조회',
    aliases: ['조회 속도'],
    meaning: `올린 뒤 하루에 평균 몇 번 조회됐는지예요. 오래된 영상과 새 영상을 공평하게 견줄 수 있어요. 하루 ${VIEW_VELOCITY_TARGET_PER_DAY.toLocaleString('ko-KR')}회면 이 항목은 만점이에요.`
  },
  likes: {
    label: '좋아요 비율',
    aliases: ['참여율'],
    meaning: `영상을 본 사람 100명 중 좋아요를 누른 사람 수예요. ${(LIKE_RATE_TARGET * 100).toFixed(0)}%면 이 항목은 만점이에요.`
  },
  check: {
    label: '검색 점검',
    aliases: ['SEO 체크리스트'],
    meaning: '검색에서 잘 보이게 하는 네 가지(제목에 종목명, 썸네일 글자, 설명란 목차, 태그 5개 이상) 중 끝낸 칸 수예요. 4칸 중 몇 칸을 했는지 보여줘요.'
  },
  fixspot: {
    label: '고칠 곳',
    meaning: '제목·설명·썸네일에서 검색에 불리한 점의 개수예요. 종목명이 없거나, 제목이 60자를 넘거나, 설명이 비었거나, 썸네일 평가가 없거나 낮으면 하나씩 늘어요.'
  },
  thumb: {
    label: '썸네일 평가',
    meaning: '썸네일(영상 대표 이미지)만 보고 클릭하고 싶은지를 별 1~5개로 직접 남기는 평가예요. 3점 미만이면 다시 만드는 것이 좋아요.'
  },
  plan: {
    label: '계획 채움',
    meaning: '정해 둔 업로드 계획 중 실제로 영상이 등록된 비율이에요. 지나간 날의 계획만 세요.'
  },
  best: {
    label: '추천 시간',
    meaning: '지난 30일에 올린 영상을 요일·시간별로 묶어, 하루 평균 조회가 가장 높았던 시간이에요. 영상이 너무 적은 시간대는 우연일 수 있어 뺐어요.'
  },
  recent: {
    label: '최근 7일 다룬 종목',
    meaning: '지난 7일 동안 영상으로 만든 종목이에요. 같은 종목이 겹치지 않게 키워드를 고를 때 참고해요.'
  }
}

export function glossaryTitle(key: GlossaryKey): string {
  const entry = GLOSSARY[key]
  const alias = entry.aliases?.length ? ` (${entry.aliases.join(', ')}이라고도 해요)` : ''
  return `${entry.label}${alias}: ${entry.meaning}`
}
