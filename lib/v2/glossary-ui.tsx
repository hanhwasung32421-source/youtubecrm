'use client'

// 용어 풀이 조각. <Term> 은 글자에 마우스를 올리면 뜻이 보이고, <GlossaryDetails> 는 화면 위쪽에서 "이게 뭐예요?"로 한 번에 펼친다.
// (터치 화면은 마우스를 올릴 수 없으므로 <GlossaryDetails> 가 같은 내용을 보여 준다.)
import type { ReactNode } from 'react'
import { GLOSSARY, glossaryTitle, type GlossaryKey } from './glossary'

export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  return (
    <abbr className="v2a-term" title={glossaryTitle(k)}>
      {children ?? GLOSSARY[k].label}
    </abbr>
  )
}

export function GlossaryDetails({ keys, title = '이게 뭐예요? 이 화면에 나오는 말 풀이' }: { keys: readonly GlossaryKey[]; title?: string }) {
  return (
    <details className="v2a-howto v2a-gloss">
      <summary>{title}</summary>
      <dl className="v2a-howto-body v2a-gloss-list">
        {keys.map((key) => {
          const entry = GLOSSARY[key]
          return (
            <div key={key} className="v2a-gloss-item">
              <dt>
                {entry.label}
                {entry.aliases?.length ? <span className="muted"> ({entry.aliases.join(', ')}이라고도 해요)</span> : null}
              </dt>
              <dd>{entry.meaning}</dd>
            </div>
          )
        })}
      </dl>
    </details>
  )
}
