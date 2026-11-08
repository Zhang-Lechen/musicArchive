import { Navigate, useLocation } from 'react-router-dom';

export function CollectionRedirect() {
  const location = useLocation();
  return <Navigate to={`/favorites${location.search}${location.hash}`} replace />;
}
