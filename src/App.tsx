import { lazy, Suspense, useEffect } from 'react'
import { createHashRouter, Outlet, RouterProvider, useNavigate } from 'react-router'

import { Importer } from '@/components/Importer'
import { Toaster } from '@/components/ui/sonner'
import { usePrefs } from '@/hooks/prefs'
import { useTabIdentity } from '@/hooks/useTabIdentity'
import { listBooks } from '@/lib/db'
import { useStreak } from '@/lib/streak'
import { setStreakBadge, startWidgets } from '@/lib/widgets'
import Library from '@/pages/Library'

const Reader = lazy(() => import('@/pages/Reader'))
const Sync = lazy(() => import('@/pages/Sync'))

function Layout() {
  useTabIdentity()
  const { streakBadge } = usePrefs()
  const { count } = useStreak()
  useEffect(startWidgets, [])
  useEffect(() => setStreakBadge(streakBadge, count), [streakBadge, count])
  return (
    <Importer>
      <Suspense>
        <Outlet />
      </Suspense>
      {/* sit above the floating + button */}
      <Toaster position="bottom-center" offset={88} mobileOffset={{ bottom: 88 }} />
    </Importer>
  )
}

/** Where the "Continue reading" shortcut and widgets land: the book read last, or the library when there is none. */
function Continue() {
  const navigate = useNavigate()
  useEffect(() => {
    void listBooks().then(books => {
      const last = books.find(b => b.openedAt)
      navigate(last ? `/read/${last.id}` : '/', { replace: true })
    })
  }, [navigate])
  return null
}

// Hash routes (#/read/:id) so the app works on any static host, GitHub Pages included, without rewrite rules.
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Library /> },
      { path: '/read/:id', element: <Reader /> },
      { path: '/sync/:code', element: <Sync /> },
      { path: '/continue', element: <Continue /> },
      // the "Scan a sync code" shortcut: the library with the scanner open (components/Fab)
      { path: '/scan', element: <Library /> },
      { path: '*', element: <Library /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
