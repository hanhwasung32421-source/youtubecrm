import { V5SessionProvider } from '@/components/v5/auth-guard'
import { AppShellFrame } from '@/components/v5/app-shell'

// 로그인/회원가입을 제외한 모든 V5 화면의 공통 틀.
// 세션 확인은 V5SessionProvider 가 처음 한 번만 하고, 메뉴를 옮길 때는 접근 권한만 다시 따진다.
export default function V5AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <V5SessionProvider>
      <AppShellFrame>{children}</AppShellFrame>
    </V5SessionProvider>
  )
}
