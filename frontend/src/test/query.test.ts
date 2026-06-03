import { it, expect, beforeEach } from 'vitest';
import { getQueryData, setQueryData, clearCache } from '../lib/query.ts';

beforeEach(() => {
  clearCache();
  localStorage.clear();
});

it('round-trips data through the cache', () => {
  expect(getQueryData('notes')).toBeUndefined();
  setQueryData('notes', [{ id: '1' }]);
  expect(getQueryData('notes')).toEqual([{ id: '1' }]);
});

it('persists to localStorage so data survives a reload', () => {
  setQueryData('k', { a: 1 });
  expect(JSON.parse(localStorage.getItem('q:k')!)).toEqual({ a: 1 });
});

it('clearCache wipes memory and localStorage', () => {
  setQueryData('k', 1);
  clearCache();
  expect(getQueryData('k')).toBeUndefined();
  expect(localStorage.getItem('q:k')).toBeNull();
});
