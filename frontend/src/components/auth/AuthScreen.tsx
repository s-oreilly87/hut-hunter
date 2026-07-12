import { AuthForm } from './AuthForm'
import { AuthHero } from './AuthHero'

export function AuthScreen() {
  return (
    <div className="app-shell min-h-dvh">
      <div className="mx-auto grid min-h-dvh max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,460px)] lg:px-8">
        <AuthHero />
        <AuthForm />
      </div>
    </div>
  )
}
