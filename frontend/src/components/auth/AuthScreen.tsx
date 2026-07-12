import { AuthForm } from './AuthForm'
import { AuthHero } from './AuthHero'

export function AuthScreen() {
  return (
    <div className="app-shell min-h-dvh">
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:min-h-dvh lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,440px)] lg:items-stretch lg:gap-8 lg:px-8 lg:py-8 xl:max-w-[90rem] xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,460px)]">
        <AuthHero />
        <AuthForm />
      </div>
    </div>
  )
}
