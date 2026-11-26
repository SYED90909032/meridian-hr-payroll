/**
 * Profile avatars: a set of illustrated portraits a person can pick for their profile.
 * The choice is kept in this browser (localStorage), keyed by the person's display name, so every
 * <Avatar name=…> across the app shows the picture without any API change. Without a choice,
 * the tinted initials are shown as before.
 */
import { useSyncExternalStore } from 'react';

export const AVATARS = [
  { id: 'avatar-1', label: 'Short black bob, purple hoodie' },
  { id: 'avatar-2', label: 'Beard, charcoal overshirt' },
  { id: 'avatar-3', label: 'Wavy hair, round glasses' },
  { id: 'avatar-4', label: 'Beard, navy jacket' },
  { id: 'avatar-5', label: 'Curly hair, mint sweater' },
  { id: 'avatar-6', label: 'Cap and sunglasses' },
  { id: 'avatar-7', label: 'Headphones, green jacket' },
  { id: 'avatar-8', label: 'White thobe and ghutra' },
] as const;
export type AvatarId = (typeof AVATARS)[number]['id'];
export const avatarSrc = (id: string) => `/images/avatars/${id}.png`;

const KEY = 'meridian:avatars';
const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
let cache: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) { try { cache = JSON.parse(e.newValue || '{}'); } catch { cache = {}; } emit(); } });

export function setAvatar(name: string, id: string | null) {
  if (!name.trim()) return;
  const next = { ...cache };
  if (id) next[norm(name)] = id; else delete next[norm(name)];
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  emit();
}
export const getAvatar = (name: string): string | null => cache[norm(name)] ?? null;
export function useAvatar(name: string): string | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => getAvatar(name), () => null);
}
