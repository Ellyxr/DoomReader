import { lazy, Suspense } from 'react'
import { createHashRouter, Outlet, RouterProvider } from 'react-router'

import { Importer } from '@/components/Importer'
import { Toaster } from '@/components/ui/sonner'
import Library from '@/pages/Library'

const Reader = lazy(() => import('@/pages/Reader'))

function Layout() {
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

// Hash routes (#/read/:id) so the app works on any static host, GitHub Pages included, without rewrite rules.
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Library /> },
      { path: '/read/:id', element: <Reader /> },
      { path: '*', element: <Library /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
