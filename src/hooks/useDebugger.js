import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

/**
 * Time-travel debugger state engine.
 * Records execution snapshots and provides playback, breakpoints,
 * variable diff detection, call-stack tracking, and watch expressions.
 */
export function useDebugger() {
  // ── Core state ───────────────────────────────────────────────────
  const [snapshots, setSnapshots]       = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isDebugging, setIsDebugging]   = useState(false);

  // ── Breakpoints ──────────────────────────────────────────────────
  const [breakpoints, setBreakpoints]   = useState(new Set());

  // ── Auto-play ────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying]       = useState(false);
  const [playSpeed, setPlaySpeed]       = useState(1);   // 0.5 | 1 | 2 | 4
  const playTimerRef                    = useRef(null);

  // ── Watch expressions ────────────────────────────────────────────
  const [watchList, setWatchList]       = useState([]);   // string[]

  // ── Derived: current snapshot ────────────────────────────────────
  const currentSnapshot = useMemo(() => {
    if (currentIndex >= 0 && currentIndex < snapshots.length) {
      return snapshots[currentIndex];
    }
    return null;
  }, [snapshots, currentIndex]);

  // ── Derived: previous snapshot (for diff) ────────────────────────
  const previousSnapshot = useMemo(() => {
    if (currentIndex > 0) return snapshots[currentIndex - 1];
    return null;
  }, [snapshots, currentIndex]);

  // ── Derived: changed variables between prev → current ───────────
  const changedVars = useMemo(() => {
    if (!currentSnapshot || !previousSnapshot) return new Set();
    const changed = new Set();
    const currState = currentSnapshot.state || {};
    const prevState = previousSnapshot.state || {};

    // Check for additions / modifications
    for (const key of Object.keys(currState)) {
      if (!(key in prevState)) {
        changed.add(key);
      } else {
        try {
          if (JSON.stringify(currState[key]) !== JSON.stringify(prevState[key])) {
            changed.add(key);
          }
        } catch {
          // If stringify fails, assume changed
          changed.add(key);
        }
      }
    }
    // Check for deletions
    for (const key of Object.keys(prevState)) {
      if (!(key in currState)) changed.add(key);
    }
    return changed;
  }, [currentSnapshot, previousSnapshot]);

  // ── Derived: execution statistics ────────────────────────────────
  const stats = useMemo(() => {
    if (snapshots.length === 0) return null;
    const uniqueLines = new Set(snapshots.map(s => s.line));
    const firstTime = snapshots[0]?.timestamp || 0;
    const lastTime  = snapshots[snapshots.length - 1]?.timestamp || 0;
    const allVars = new Set();
    snapshots.forEach(s => {
      Object.keys(s.state || {}).forEach(k => allVars.add(k));
    });

    // Line frequency map (for the waveform visualization)
    const lineFrequency = {};
    snapshots.forEach(s => {
      lineFrequency[s.line] = (lineFrequency[s.line] || 0) + 1;
    });

    return {
      totalSteps: snapshots.length,
      uniqueLines: uniqueLines.size,
      totalVars: allVars.size,
      durationMs: lastTime - firstTime,
      lineFrequency,
    };
  }, [snapshots]);

  // ── Derived: variable history for sparkline / watch ──────────────
  const variableHistory = useMemo(() => {
    const history = {};
    snapshots.forEach((snap, idx) => {
      const state = snap.state || {};
      for (const key of Object.keys(state)) {
        if (!history[key]) history[key] = [];
        history[key].push({ index: idx, value: state[key], line: snap.line });
      }
    });
    return history;
  }, [snapshots]);

  // ── Actions ──────────────────────────────────────────────────────

  const startDebug = useCallback(() => {
    setSnapshots([]);
    setCurrentIndex(-1);
    setIsDebugging(true);
    setIsPlaying(false);
  }, []);

  const endDebug = useCallback(() => {
    setIsDebugging(false);
    setIsPlaying(false);
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
  }, []);

  const addSnapshot = useCallback((snapshot) => {
    setSnapshots(prev => {
      const enriched = {
        ...snapshot,
        timestamp: Date.now(),
        callStack: snapshot.callStack || [],
      };
      const next = [...prev, enriched];
      setCurrentIndex(curr => curr === prev.length - 1 || curr === -1
        ? next.length - 1
        : curr
      );
      return next;
    });
  }, []);

  const setPlayhead = useCallback((index) => {
    setSnapshots(snaps => {
      if (index >= -1 && index < snaps.length) {
        setCurrentIndex(index);
      }
      return snaps;
    });
  }, []);

  const stepForward = useCallback(() => {
    setCurrentIndex(prev => {
      const max = snapshots.length - 1;
      return prev < max ? prev + 1 : prev;
    });
  }, [snapshots.length]);

  const stepBackward = useCallback(() => {
    setCurrentIndex(prev => prev > 0 ? prev - 1 : prev);
  }, []);

  const jumpToStart = useCallback(() => {
    if (snapshots.length > 0) setCurrentIndex(0);
  }, [snapshots.length]);

  const jumpToEnd = useCallback(() => {
    if (snapshots.length > 0) setCurrentIndex(snapshots.length - 1);
  }, [snapshots.length]);

  const clearSnapshots = useCallback(() => {
    setSnapshots([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
  }, []);

  // ── Breakpoints ──────────────────────────────────────────────────

  const toggleBreakpoint = useCallback((line) => {
    setBreakpoints(prev => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }, []);

  const clearBreakpoints = useCallback(() => {
    setBreakpoints(new Set());
  }, []);

  // Jump to next snapshot that hits a breakpoint
  const jumpToNextBreakpoint = useCallback(() => {
    if (breakpoints.size === 0) return;
    for (let i = currentIndex + 1; i < snapshots.length; i++) {
      if (breakpoints.has(snapshots[i].line)) {
        setCurrentIndex(i);
        return;
      }
    }
  }, [breakpoints, currentIndex, snapshots]);

  const jumpToPrevBreakpoint = useCallback(() => {
    if (breakpoints.size === 0) return;
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (breakpoints.has(snapshots[i].line)) {
        setCurrentIndex(i);
        return;
      }
    }
  }, [breakpoints, currentIndex, snapshots]);

  // ── Auto-Play ────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  // Effect: drive auto-play timer
  useEffect(() => {
    if (playTimerRef.current) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }

    if (isPlaying && snapshots.length > 0) {
      const interval = Math.round(400 / playSpeed);
      playTimerRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= snapshots.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, interval);
    }

    return () => {
      if (playTimerRef.current) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, playSpeed, snapshots.length]);

  // ── Watch expressions ────────────────────────────────────────────

  const addWatch = useCallback((expr) => {
    setWatchList(prev => prev.includes(expr) ? prev : [...prev, expr]);
  }, []);

  const removeWatch = useCallback((expr) => {
    setWatchList(prev => prev.filter(w => w !== expr));
  }, []);

  // ── Return ───────────────────────────────────────────────────────
  return {
    // State
    snapshots,
    currentIndex,
    currentSnapshot,
    previousSnapshot,
    isDebugging,
    isPlaying,
    playSpeed,
    changedVars,
    stats,
    variableHistory,
    breakpoints,
    watchList,

    // Actions
    startDebug,
    endDebug,
    addSnapshot,
    setPlayhead,
    stepForward,
    stepBackward,
    jumpToStart,
    jumpToEnd,
    clearSnapshots,

    // Breakpoints
    toggleBreakpoint,
    clearBreakpoints,
    jumpToNextBreakpoint,
    jumpToPrevBreakpoint,

    // Playback
    togglePlay,
    setPlaySpeed,
    setIsPlaying,

    // Watch
    addWatch,
    removeWatch,
  };
}
