// 화면에 나오는 낯선 말의 이름. "이게 뭐예요?" 를 누르면 풀어 쓴 글(glossary-text.ts)을 그때 불러온다.
// 화면마다 같은 이름을 쓰도록 여기 한 곳에서만 정한다.

export const GLOSSARY_KEYS = ['score', 'velocity', 'engagement', 'early', 'tier', 'playbook', 'experiment'] as const
export type GlossaryKey = (typeof GLOSSARY_KEYS)[number]

export const GLOSSARY_TERM: Record<GlossaryKey, string> = {
  score: '반응 점수',
  velocity: '조회 속도',
  engagement: '참여율',
  early: '초기 성장',
  tier: '구간',
  playbook: '성공 공식',
  experiment: '성장 실험'
}
