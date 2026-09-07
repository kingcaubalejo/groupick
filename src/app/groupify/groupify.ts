import { ScrollingModule } from '@angular/cdk/scrolling';
import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Mode = 'per_group' | 'num_groups';

interface SharedState {
  n: string[];
  m: Mode;
  s: number;
}

@Component({
  selector: 'app-groupify',
  imports: [FormsModule, ScrollingModule],
  templateUrl: './groupify.html',
  styleUrl: './groupify.scss',
})
export class Groupify {
  readonly shareStatus = signal<
    'idle' | 'copied' | 'error' | 'shortening' | 'short_copied' | 'short_error'
  >('idle');
  private statusTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.loadFromHash();
  }

  private async loadFromHash() {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    try {
      let json: string;
      if (hash.startsWith('d~')) {
        json = await this.inflate(hash.slice(2));
      } else {
        json = atob(hash.replace(/-/g, '+').replace(/_/g, '/'));
      }
      const parsed = JSON.parse(json) as SharedState;
      if (Array.isArray(parsed.n)) {
        this.rawInput.set(parsed.n.join('\n'));
      }
      if (parsed.m === 'per_group' || parsed.m === 'num_groups') {
        this.mode.set(parsed.m);
      }
      if (typeof parsed.s === 'number' && parsed.s >= 1) {
        this.size.set(Math.floor(parsed.s));
      }
    } catch {
      /* ignore malformed hash */
    }
  }

  private async encodeState(): Promise<string> {
    const state: SharedState = {
      n: this.names(),
      m: this.mode(),
      s: this.size(),
    };
    const json = JSON.stringify(state);
    const plain = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    if (typeof CompressionStream === 'undefined') return plain;

    try {
      const deflated = await this.deflate(json);
      // Only prefer compressed if it's actually smaller (headers add overhead for tiny payloads).
      return deflated.length < plain.length ? `d~${deflated}` : plain;
    } catch {
      return plain;
    }
  }

  private async deflate(input: string): Promise<string> {
    const stream = new Blob([input])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return this.bytesToB64Url(new Uint8Array(buf));
  }

  private async inflate(b64: string): Promise<string> {
    const bytes = this.b64UrlToBytes(b64);
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  private bytesToB64Url(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private b64UrlToBytes(b64: string): Uint8Array {
    const std = b64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = std.length % 4 ? '='.repeat(4 - (std.length % 4)) : '';
    const bin = atob(std + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async shareLink() {
    if (typeof window === 'undefined') return;
    const encoded = await this.encodeState();
    const url = `${window.location.origin}${window.location.pathname}#${encoded}`;
    history.replaceState(null, '', `#${encoded}`);
    try {
      await navigator.clipboard.writeText(url);
      this.flashStatus('copied');
    } catch {
      this.flashStatus('error');
    }
  }

  async shortUrl() {
    if (typeof window === 'undefined') return;
    const encoded = await this.encodeState();
    const longUrl = `${window.location.origin}${window.location.pathname}#${encoded}`;
    history.replaceState(null, '', `#${encoded}`);

    this.shareStatus.set('shortening');
    if (this.statusTimer) clearTimeout(this.statusTimer);

    try {
      const api = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`;
      const res = await fetch(api);
      if (!res.ok) throw new Error(`is.gd ${res.status}`);
      const short = (await res.text()).trim();
      if (!short.startsWith('http')) throw new Error(short);
      await navigator.clipboard.writeText(short);
      this.flashStatus('short_copied');
    } catch {
      this.flashStatus('short_error');
    }
  }

  private flashStatus(
    status: 'copied' | 'error' | 'short_copied' | 'short_error',
  ) {
    this.shareStatus.set(status);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.shareStatus.set('idle'), 2500);
  }

  readonly rawInput = signal<string>(
    [
      'Ana Cruz',
      'Miguel Torres',
      'Priya Singh',
      'Jordan Lee',
      'Sofia Reyes',
      'Ethan Cole',
      'Maya Ibrahim',
      'Noah Park',
      'Zara Ahmed',
      'Liam Santos',
      'Chloe Ward',
      'Diego Ramos',
    ].join('\n'),
  );
  readonly mode = signal<Mode>('per_group');
  readonly size = signal(4);
  readonly groups = signal<string[][]>([]);

  readonly names = computed(() =>
    this.rawInput()
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

  readonly nameCount = computed(() => this.names().length);

  readonly summary = computed(() => {
    const count = this.nameCount();
    if (count === 0) return '';
    const n = Math.max(1, this.size());
    if (this.mode() === 'per_group') {
      const groups = Math.ceil(count / n);
      return `${count} names split into ${groups} group${groups === 1 ? '' : 's'} of ${n}`;
    }
    const perGroup = Math.ceil(count / n);
    return `${count} names split into ${n} group${n === 1 ? '' : 's'} of ${perGroup}`;
  });

  setMode(m: Mode) {
    this.mode.set(m);
    this.groups.set([]);
  }

  step(delta: number) {
    this.size.update((v) => Math.max(1, v + delta));
    this.groups.set([]);
  }

  clear() {
    this.rawInput.set('');
    this.groups.set([]);
  }

  onCsvSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = (reader.result as string).replace(/^﻿/, '');
      const names = text
        .split(/\r?\n/)
        .map((line) => {
          if (line.startsWith('"')) {
            const end = line.indexOf('"', 1);
            return end > 0 ? line.slice(1, end) : line.slice(1);
          }
          return line.split(',')[0];
        })
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      this.rawInput.set(names.join('\n'));
      this.groups.set([]);
    };
    reader.readAsText(file);
  }

  shuffle() {
    const shuffled = [...this.names()];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const total = shuffled.length;
    if (total === 0) {
      this.groups.set([]);
      return;
    }

    const n = Math.max(1, this.size());
    let numGroups: number;
    if (this.mode() === 'per_group') {
      numGroups = Math.ceil(total / n);
    } else {
      numGroups = Math.min(n, total);
    }

    const result: string[][] = Array.from({ length: numGroups }, () => []);
    shuffled.forEach((name, i) => {
      result[i % numGroups].push(name);
    });
    this.groups.set(result);
  }
}
