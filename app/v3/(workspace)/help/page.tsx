'use client'

import Link from 'next/link'
import { PageHeader } from '@/components/v3/app-shell'
import { useV3Me } from '@/components/v3/auth-guard'
import { Section } from '@/components/v3/ui'

const STEPS = [
  {
    title: '주소 붙여넣기',
    body: '유튜브에서 영상 주소를 복사해서 ‘영상 등록’ 화면의 주소 칸에 붙여넣어요. 칸 옆의 ‘붙여넣기’ 버튼을 눌러도 돼요.'
  },
  {
    title: '종목 적기',
    body: '영상에서 다루는 종목 이름을 적어요. 전에 쓴 종목은 칸 아래 ‘최근 종목’ 버튼을 누르면 바로 들어가요.'
  },
  {
    title: '등록 누르기',
    body: 'Enter 키(또는 ‘등록’ 버튼)를 누르면 끝이에요. 종목은 그대로 남아 있어서, 다음 영상은 주소만 붙여넣으면 돼요.'
  },
  {
    title: '잘못 올렸다면 되돌리기',
    body: '등록한 직후 10초 안에 나오는 ‘되돌리기’ 버튼을 누르면 돼요. 시간이 지났다면 아래 목록 첫 줄의 종목을 눌러 고치거나, 줄 오른쪽의 ‘수정’·‘삭제’를 쓰세요.'
  }
]

const KEYS: { keys: string; what: string }[] = [
  { keys: 'Enter', what: '등록해요.' },
  { keys: 'Ctrl + Enter (맥은 ⌘ + Enter)', what: '어느 칸에 있든 바로 등록해요.' },
  { keys: '/', what: '주소 칸으로 바로 가요. (글자를 치는 중이 아닐 때)' },
  { keys: 'Esc', what: '지금 칸을 비워요. 종목 칸에서 한 번 더 누르면 주소 칸으로 가요.' },
  { keys: 'Tab', what: '다음 칸으로 가요.' }
]

const ROUTINE = [
  { href: '/v3/lifecycle', label: '조회수 성장', what: '‘조회수 새로고침’을 눌러 최신 숫자로 맞춰요. 10개씩 갱신되니 영상이 많으면 몇 번 눌러요.' },
  { href: '/v3/viral', label: '급상승 영상', what: '새로 뜬 영상을 확인하고 ‘확인’을 눌러요. 후속 영상을 올릴 만한 종목도 여기서 볼 수 있어요.' },
  { href: '/v3/engagement', label: '참여 현황', what: '좋아요·댓글 반응이 지난 기간보다 늘었는지 줄었는지 봐요.' },
  { href: '/v3/series', label: '롱폼·숏폼·시리즈 비교', what: '매일은 아니어도 돼요. 일주일에 한 번 정도, 어떤 형식이 반응이 좋은지 봐요.' }
]

export default function HelpPage() {
  const me = useV3Me()
  const isAdmin = !!me?.isAdmin

  return (
    <>
      <PageHeader title="사용 방법" subtitle="처음 쓰는 분도 5분이면 익힐 수 있어요." />

      <div className="v3-help">
        <Section title="처음 시작하기" description="영상 하나를 올리는 데 10초면 돼요. 이 네 단계만 기억하세요.">
          <ol className="v3-help-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="v3-help-num" aria-hidden>
                  {index + 1}
                </span>
                <div>
                  <div className="v3-help-step-title">{step.title}</div>
                  <p className="v3-help-text">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="v3-help-cta">
            <Link className="button" href="/v3/register">
              영상 등록하러 가기
            </Link>
          </p>
        </Section>

        <Section title="키보드로 더 빠르게" description="마우스 없이도 영상을 이어서 올릴 수 있어요.">
          <dl className="v3-help-keys">
            {KEYS.map((item) => (
              <div key={item.keys}>
                <dt>
                  <kbd>{item.keys}</kbd>
                </dt>
                <dd>{item.what}</dd>
              </div>
            ))}
          </dl>
          <p className="v3-help-text">
            영상이 여러 개라면 등록 화면 아래의 ‘여러 개 붙여넣기’를 쓰세요. 한 줄에 영상 하나씩, 주소 뒤에 종목을 적으면 한꺼번에 올라가요.
          </p>
        </Section>

        <Section title="자주 묻는 질문">
          <div className="v3-help-faq">
            <details>
              <summary>같은 영상을 두 번 올리면 어떻게 되나요?</summary>
              <p>
                영상이 두 개로 늘어나지는 않고, 하나로 합쳐져요. 내가 이미 올린 영상이면 ‘이미 등록한 영상이에요’ 안내가 먼저 나오고, 종목만 바꿀 수도 있어요.
                다른 직원이 올린 영상을 등록하면 그 영상이 내 영상으로 바뀌니, 안내 문구를 꼭 확인하세요.
              </p>
            </details>
            <details>
              <summary>숏폼 주소는 어떻게 넣나요?</summary>
              <p>
                <code>youtube.com/shorts/…</code> 주소를 그대로 붙여넣으면 돼요. 형식이 자동으로 ‘숏폼’으로 바뀌어요.
              </p>
            </details>
            <details>
              <summary>조회수는 언제 보이나요?</summary>
              <p>
                등록할 때 유튜브에서 그 순간의 숫자를 가져와요. 그다음부터는 ‘조회수 성장’ 화면에서 ‘조회수 새로고침’을 눌러야 최신 숫자로 바뀌어요.
                올린 지 하루 정도 지나야 성장 그래프가 의미 있게 보여요.
              </p>
            </details>
            <details>
              <summary>‘되돌리기’ 버튼이 안 나와요.</summary>
              <p>
                새로 올린 영상에만 나와요. 이미 올려 둔 영상을 다시 등록했다면 이전 종목으로 돌려 놓는 버튼이 나오고, 다른 직원이 올렸던 영상이거나 이미 올렸는지 확인하지 못했다면
                안 나와요. (전에 있던 영상이 실수로 지워지지 않게 하려는 거예요.) 그럴 때는 목록 첫 줄에서 종목을 고치세요.
              </p>
            </details>
            <details>
              <summary>로그아웃됐어요. 쓰던 내용은 사라지나요?</summary>
              <p>
                로그인이 오래되면 저절로 끊길 수 있어요. ‘다시 로그인’을 누르면 하던 화면으로 돌아오고, 적어 둔 주소와 종목도 남아 있어요. 다만 창(탭)을 닫으면 사라져요.
              </p>
            </details>
            <details>
              <summary>‘영상을 찾지 못했어요’라고 나와요.</summary>
              <p>삭제됐거나 비공개인 영상일 수 있어요. 유튜브에서 그 주소가 열리는지 먼저 확인해 보세요. 열리는데도 계속 안 되면 관리자에게 알려 주세요.</p>
            </details>
          </div>
        </Section>

        {isAdmin ? (
          <Section title="매일 아침 5분 루틴 (관리자)" description="이 순서로 열어 보면 어제와 오늘의 흐름을 빠르게 볼 수 있어요.">
            <ol className="v3-help-steps">
              {ROUTINE.map((item, index) => (
                <li key={item.href}>
                  <span className="v3-help-num" aria-hidden>
                    {index + 1}
                  </span>
                  <div>
                    <div className="v3-help-step-title">
                      <Link className="v3-link" href={item.href}>
                        {item.label}
                      </Link>
                    </div>
                    <p className="v3-help-text">{item.what}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}
      </div>
    </>
  )
}
