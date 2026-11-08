import type { RouteObject } from 'react-router-dom';
import { HomePage } from '../features/composers/HomePage';
import { ComposerPage } from '../features/composers/ComposerPage';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';
import { PreferencesPage } from '../features/preferences/PreferencesPage';
import { StatisticsPage } from '../features/statistics/StatisticsPage';
import { CollectionRedirect } from './CollectionRedirect';

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'composers', element: <HomePage /> },
      { path: 'favorites', element: <PreferencesPage /> },
      { path: 'collection', element: <CollectionRedirect /> },
      { path: 'statistics', element: <StatisticsPage /> },
      { path: 'composers/:composerId', element: <ComposerPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
