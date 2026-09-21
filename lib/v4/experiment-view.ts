// 실험 화면의 순수 계산: 진행 단계(스텝), 폼 검사 문구, 낙관적 갱신, 삭제/되돌리기 안내문. (React/DB 의존 없음)

export type ExpStepKey = 'running' | 'result' | 'learned'
export type ExpStepState = 'done' | 'current' | 'todo'

export const EXP_STEPS: Array<{ key: ExpStepKey; label: string; hint: string }> = [
  { key: 'running', label: '진행 중', hint: '두 방식을 적용해 올리고 조회수를 지켜봐요' },
  { key: 'result', label: '결과 기록', hint: 'A와 B 중 어느 쪽이 나았는지 남겨요' },
  { key: 'learned', label: '배운 점', hint: '다음 영상에 쓸 점을 적어요' }
]

export type ExpLite = { winner: 'a' | 'b' | 'tie' | null; learning: string | null }

// 세 칸의 상태. 결과가 없으면 ① 진행 중이 현재, 결과만 있으면 ③ 배운 점이 현재, 둘 다 있으면 모두 끝.
export function stepStates(item: ExpLite): [ExpStepState, ExpStepState, ExpStepState] {
  if (!item.winner) return ['current', 'todo', 'todo']
  if (!(item.learning && item.learning.trim())) return ['done', 'done', 'current']
  return ['done', 'done', 'done']
}

// 지금 할 수 있는 다음 행동 (버튼 이름 + 안내)
export function nextStep(item: ExpLite): { action: 'record' | 'learn' | 'none'; label: string; hint: string } {
  if (!item.winner) return { action: 'record', label: '결과 기록하기', hint: '며칠 지났다면 어느 쪽이 나았는지 남겨 주세요.' }
  if (!(item.learning && item.learning.trim())) return { action: 'learn', label: '배운 점 적기', hint: '결과는 남겼어요. 배운 점을 적으면 마무리돼요.' }
  return { action: 'none', label: '', hint: '결과와 배운 점까지 모두 남겼어요.' }
}

// ---------------------------------------------------------------- 폼 검사

export type ExpFormValues = { hypothesis: string; variantA: string; variantB: string; startedOn: string }
export type ExpFieldKey = keyof ExpFormValues

const YMD = /^\d{4}-\d{2}-\d{2}$/

// 실제로 있는 날짜인지 (2026-02-31 같은 값은 거절)
export function isRealYmd(value: string): boolean {
  if (!YMD.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

export function validateExperiment(form: ExpFormValues, editingEndedOn?: string | null): Partial<Record<ExpFieldKey, string>> {
  const errors: Partial<Record<ExpFieldKey, string>> = {}
  if (!form.hypothesis.trim()) errors.hypothesis = '무엇을 확인하고 싶은지 한 문장으로 적어 주세요. 예: 썸네일에 종목명을 크게 넣으면 조회수가 늘까?'
  if (!form.variantA.trim()) errors.variantA = '지금 하던 방식(A)을 적어 주세요. 예: 종목명을 작은 글씨로'
  if (!form.variantB.trim()) errors.variantB = '새로 해볼 방식(B)을 적어 주세요. 예: 종목명을 크게, 노란 배경으로'
  else if (form.variantA.trim() && norm(form.variantA) === norm(form.variantB)) {
    errors.variantB = 'A와 B가 똑같아요. 서로 다른 방식을 적어야 비교할 수 있어요.'
  }
  if (!isRealYmd(form.startedOn)) errors.startedOn = '시작일을 달력에서 골라 주세요.'
  else if (editingEndedOn && form.startedOn > editingEndedOn) errors.startedOn = '시작일이 끝난 날보다 늦을 수 없어요. 끝난 날을 먼저 확인해 주세요.'
  return errors
}

export function validateResult(winner: string, endedOn: string, startedOn: string): { winner?: string; endedOn?: string } {
  const errors: { winner?: string; endedOn?: string } = {}
  if (!winner) errors.winner = '어느 쪽이 더 좋았는지 골라 주세요. 잘 모르겠으면 “차이가 없었어요”를 고르면 돼요.'
  if (endedOn && !isRealYmd(endedOn)) errors.endedOn = '끝난 날을 달력에서 골라 주세요.'
  else if (endedOn && endedOn < startedOn) errors.endedOn = '끝난 날은 시작일보다 빠를 수 없어요.'
  return errors
}

// ---------------------------------------------------------------- 낙관적 갱신

export type ResultPatch = { winner?: 'a' | 'b' | 'tie' | null; learning?: string | null; endedOn?: string | null }

// 서버 응답을 기다리지 않고 화면에 먼저 반영할 새 실험 값. 원본은 바꾸지 않는다.
export function applyResultPatch<T extends { winner: ExpLite['winner']; learning: string | null; endedOn: string | null }>(item: T, patch: ResultPatch): T {
  return {
    ...item,
    winner: patch.winner !== undefined ? patch.winner : item.winner,
    learning: patch.learning !== undefined ? patch.learning : item.learning,
    endedOn: patch.endedOn !== undefined ? patch.endedOn : item.endedOn
  }
}

// ---------------------------------------------------------------- 되돌릴 수 없는 일의 안내문

export function deleteConsequence(item: ExpLite): string {
  const parts = ['실험 내용']
  if (item.winner) parts.push('기록한 결과')
  if (item.learning && item.learning.trim()) parts.push(`배운 점(${item.learning.trim().length}자)`)
  return `삭제하면 ${parts.join(', ')}이(가) 모두 사라지고 되돌릴 수 없어요.`
}

export const REOPEN_CONSEQUENCE = '되돌리면 결과(A/B 중 어느 쪽)와 끝난 날이 지워지고 “진행 중”으로 돌아가요. 적어 둔 배운 점은 그대로 남아요.'
