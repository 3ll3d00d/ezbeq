import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {act, renderHook} from '@testing-library/react';
import {pushData, useLocalStorage} from './util';

describe('pushData', () => {
    it('calls the setter with the getter result on success', async () => {
        const setter = vi.fn();
        const setError = vi.fn();

        await pushData(setter, () => Promise.resolve({a: 1}), setError);

        expect(setter).toHaveBeenCalledWith({a: 1});
        expect(setError).not.toHaveBeenCalled();
    });

    it('calls setError and not the setter when the getter rejects', async () => {
        const setter = vi.fn();
        const setError = vi.fn();
        const failure = new Error('boom');

        await pushData(setter, () => Promise.reject(failure), setError);

        expect(setError).toHaveBeenCalledWith(failure);
        expect(setter).not.toHaveBeenCalled();
    });
});

describe('useLocalStorage', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the initial value when nothing is stored yet', () => {
        const {result} = renderHook(() => useLocalStorage('missing-key', 'default'));
        expect(result.current[0]).toBe('default');
    });

    it('reads an existing value out of localStorage', () => {
        window.localStorage.setItem('existing-key', JSON.stringify({value: 'stored'}));
        const {result} = renderHook(() => useLocalStorage('existing-key', 'default'));
        expect(result.current[0]).toBe('stored');
    });

    it('falls back to the initial value when the stored value is corrupt JSON', () => {
        window.localStorage.setItem('corrupt-key', 'not json');
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const {result} = renderHook(() => useLocalStorage('corrupt-key', 'default'));

        expect(result.current[0]).toBe('default');
        expect(logSpy).toHaveBeenCalled();
    });

    it('updates state and persists the new value', () => {
        const {result} = renderHook(() => useLocalStorage('key', 'default'));

        act(() => result.current[1]('updated'));

        expect(result.current[0]).toBe('updated');
        expect(JSON.parse(window.localStorage.getItem('key'))).toEqual({value: 'updated'});
    });

    it('accepts an updater function, like useState', () => {
        window.localStorage.setItem('counter', JSON.stringify({value: 1}));
        const {result} = renderHook(() => useLocalStorage('counter', 0));

        act(() => result.current[1](v => v + 1));

        expect(result.current[0]).toBe(2);
        expect(JSON.parse(window.localStorage.getItem('counter'))).toEqual({value: 2});
    });

    it('still updates in-memory state even if persisting to localStorage throws', () => {
        vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const {result} = renderHook(() => useLocalStorage('key', 'default'));

        act(() => result.current[1]('updated'));

        expect(result.current[0]).toBe('updated');
        expect(logSpy).toHaveBeenCalled();
    });
});
