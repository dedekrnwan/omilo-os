import { RouterProvider } from '@tanstack/react-router'
import { router } from './app/router'

/**
 * App is the router entry point. The Shell (rendered by the root route) carries
 * role="application" so the existing landmark test stays green.
 */
function App() {
  return <RouterProvider router={router} />
}

export default App
