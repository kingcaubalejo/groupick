import { Routes } from '@angular/router';
import { Layout } from './layout/layout';

export const routes: Routes = [
  {
    path: '',
    component: Layout,
    children: [
      { path: '', redirectTo: 'groupify', pathMatch: 'full' },
      {
        path: 'groupify',
        loadComponent: () =>
          import('./groupify/groupify').then((m) => m.Groupick),
      },
      {
        path: '**',
        loadComponent: () =>
          import('./not-found/not-found').then((m) => m.NotFound),
      },
    ],
  },
];
