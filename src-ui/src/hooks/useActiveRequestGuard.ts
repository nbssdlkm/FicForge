// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * useActiveRequestGuard — protect async results against stale navigation.
 *
 * Replaces the hand-written `activeAuPathRef + loadRequestIdRef` boilerplate
 * found in WriterLayout, FactsLayout, AuLoreLayout, AuSettingsLayout,
 * AuWorkspaceLayout. A typical symptom is: user clicks AU A → async load
 * starts → user clicks AU B → async load starts → AU A's response arrives
 * late and overwrites AU B's state.
 *
 * The guard binds each async call to two things:
 *   1. A monotonic request id (defends against concurrent calls on same key)
 *   2. The current key value (defends against key changing mid-flight)
 *
 * @example
 *   const guard = useActiveRequestGuard(auPath);
 *
 *   const load = async () => {
 *     const token = guard.start();
 *     setLoading(true);
 *     try {
 *       const data = await fetchData(auPath);
 *       if (guard.isStale(token)) return;
 *       setData(data);
 *     } finally {
 *       if (!guard.isStale(token)) setLoading(false);
 *     }
 *   };
 */

import { useMemo, useRef } from 'react';

export interface GuardToken<K> {
  readonly id: number;
  readonly key: K;
}

export interface ActiveRequestGuard<K> {
  /** Begin an async operation. Returns an opaque token to check against later. */
  start(): GuardToken<K>;
  /** True when the token is stale — either a newer `start()` was called, or the key changed. */
  isStale(token: GuardToken<K>): boolean;
  /**
   * Light-weight variant: check only whether the key has changed since a snapshot.
   * Use for async handlers that don't need "latest call wins" semantics — just
   * "did the user navigate away?".
   */
  isKeyStale(snapshotKey: K): boolean;
}

export function useActiveRequestGuard<K>(key: K): ActiveRequestGuard<K> {
  const idRef = useRef(0);
  const keyRef = useRef<K>(key);
  keyRef.current = key;

  return useMemo<ActiveRequestGuard<K>>(
    () => ({
      start: () => ({ id: ++idRef.current, key: keyRef.current }),
      isStale: (token) => token.id !== idRef.current || token.key !== keyRef.current,
      isKeyStale: (snapshotKey) => snapshotKey !== keyRef.current,
    }),
    [],
  );
}
