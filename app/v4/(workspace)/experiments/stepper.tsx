'use client'

import { EXP_STEPS, nextStep, stepStates, type ExpLite } from '@/lib/v4/experiment-view'

// 실험이 지금 어디까지 왔는지: ① 진행 중 → ② 결과 기록 → ③ 배운 점. 끝난 칸은 ✓, 지금 할 칸은 강조한다.
export function ExperimentStepper({ item, pending }: { item: ExpLite; pending?: boolean }) {
  const states = stepStates(item)
  const next = nextStep(item)
  return (
    <div className="v4p-stepper-wrap">
      <ol className="v4p-stepper" aria-label="실험 진행 단계">
        {EXP_STEPS.map((step, i) => (
          <li className={`v4p-step ${states[i]}`} key={step.key} aria-current={states[i] === 'current' ? 'step' : undefined} title={step.hint}>
            <span className="v4p-step-dot" aria-hidden="true">
              {states[i] === 'done' ? '✓' : i + 1}
            </span>
            <span className="v4p-step-label">
              {step.label}
              <span className="v4p-sr">{states[i] === 'done' ? ' (끝남)' : states[i] === 'current' ? ' (지금 할 차례)' : ' (아직)'}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="v4p-step-hint">{pending ? '저장하는 중이에요…' : next.hint}</p>
    </div>
  )
}
