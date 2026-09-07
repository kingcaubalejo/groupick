import { Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';

const HOST = 'http://www.groupify.net';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, FormsModule],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class Layout {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  private readonly currentPath = signal<string>('/');
  readonly urlBarValue = signal<string>(HOST + '/groupify');
  readonly loadError = signal<string | null>(null);
  readonly locationText = computed(() => HOST + this.currentPath());

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.currentPath.set(e.urlAfterRedirects);
        this.urlBarValue.set(HOST + e.urlAfterRedirects);
        this.loadError.set(null);
      });
  }

  submitUrl() {
    const raw = this.urlBarValue().trim();
    if (!raw) return;

    const path = this.extractPath(raw);
    if (path === null) {
      this.loadError.set(
        'This location bar only navigates within groupify.net.',
      );
      return;
    }

    this.loadError.set(null);
    this.router.navigateByUrl(path);
  }

  private extractPath(input: string): string | null {
    if (/^https?:\/\//i.test(input)) {
      try {
        const u = new URL(input);
        // Only allow our virtual host or the actual origin
        if (
          u.host === 'www.groupify.net' ||
          u.host === 'groupify.net' ||
          u.origin === window.location.origin
        ) {
          return u.pathname + u.search + u.hash;
        }
        return null;
      } catch {
        return null;
      }
    }
    return input.startsWith('/') ? input : '/' + input;
  }

  goHome() {
    this.router.navigateByUrl('/groupify');
  }

  goBack() {
    this.location.back();
  }

  goForward() {
    this.location.forward();
  }

  reload() {
    this.router.navigateByUrl(this.currentPath());
  }
}
