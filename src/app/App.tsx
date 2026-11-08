import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { routes } from './routes';
import { ArchiveProvider } from './ArchiveProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';

const router = createBrowserRouter(routes);

export function App() {
  return (
    <ErrorBoundary>
      <ArchiveProvider>
        <RouterProvider router={router} />
      </ArchiveProvider>
    </ErrorBoundary>
  );
}
