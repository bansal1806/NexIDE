import { memo, useCallback, useEffect, useRef } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward,
  RotateCcw, Bug, ChevronsLeft, ChevronsRight,
  Zap, Clock
} from 'lucide-react';

const SPEEDS = [0.5, 1, 2, 4];

export const DebugTimeline = memo(function DebugTimeline({
  snapshots,
  currentIndex,
  onSeek,
  onStepBack,
  onStepForward,
  onJumpToStart,
  onJumpToEnd,
  onReset,
  onTogglePlay,
  isPlaying = false,
  playSpeed = 1,
  onSpeedChange,
  breakpoints = new Set(),
  stats = null,
  isLive = false,
}) {
  const total = snapshots.length;
  const percentage = total > 1 ? (currentIndex / (total - 1)) * 100 : 0;
  const trackRef = useRef(null);

  // Keyboard controls for the timeline
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onStepBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onStepForward();
          break;
        case ' ':
          e.preventDefault();
          onTogglePlay?.();
          break;
        case 'Home':
          e.preventDefault();
          onJumpToStart?.();
          break;
        case 'End':
          e.preventDefault();
          onJumpToEnd?.();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onStepBack, onStepForward, onTogglePlay, onJumpToStart, onJumpToEnd]);

  const currentSnap = snapshots[currentIndex];
  const currentLine = currentSnap?.line;

  // Build waveform data: execution frequency per "bucket"
  const BUCKET_COUNT = 60;
  const waveform = buildWaveform(snapshots, BUCKET_COUNT);
  const maxFreq = Math.max(1, ...waveform);

  // Speed cycle
  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(playSpeed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    onSpeedChange?.(next);
  }, [playSpeed, onSpeedChange]);

  if (total === 0) return null;

  return (
    <div className="debug-timeline" id="debug-timeline">
      {/* ── Control Row ── */}
      <div className="dtl-controls">
        <div className="dtl-btn-group">
          <button
            onClick={onReset}
            className="dtl-btn dtl-btn-reset"
            title="Reset Debugger (Escape)"
          >
            <RotateCcw size={14} />
          </button>

          <div className="dtl-divider" />

          <button
            onClick={onJumpToStart}
            disabled={currentIndex <= 0}
            className="dtl-btn"
            title="Jump to Start (Home)"
          >
            <ChevronsLeft size={14} />
          </button>

          <button
            onClick={onStepBack}
            disabled={currentIndex <= 0}
            className="dtl-btn"
            title="Step Back (←)"
          >
            <SkipBack size={14} />
          </button>

          <button
            onClick={onTogglePlay}
            className={`dtl-btn dtl-btn-play ${isPlaying ? 'playing' : ''}`}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
          </button>

          <button
            onClick={onStepForward}
            disabled={currentIndex >= total - 1}
            className="dtl-btn"
            title="Step Forward (→)"
          >
            <SkipForward size={14} />
          </button>

          <button
            onClick={onJumpToEnd}
            disabled={currentIndex >= total - 1}
            className="dtl-btn"
            title="Jump to End (End)"
          >
            <ChevronsRight size={14} />
          </button>

          <div className="dtl-divider" />

          <button
            onClick={cycleSpeed}
            className="dtl-btn dtl-speed-btn"
            title="Playback Speed"
          >
            <Zap size={10} />
            {playSpeed}x
          </button>
        </div>

        {/* Step Counter */}
        <div className="dtl-step-counter">
          <span className="dtl-step-num">{currentIndex + 1}</span>
          <span className="dtl-step-sep">/</span>
          <span className="dtl-step-total">{total}</span>
        </div>

        {/* Current line display */}
        {currentLine && (
          <div className="dtl-line-badge">
            Line {currentLine}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="dtl-stats">
            <Clock size={10} />
            {stats.durationMs > 0 ? `${stats.durationMs}ms` : '<1ms'}
          </div>
        )}

        {/* Status lozenge */}
        <div className="dtl-status">
          {isLive ? (
            <span className="dtl-status-live">
              <span className="dtl-pulse" />
              REC
            </span>
          ) : isPlaying ? (
            <span className="dtl-status-playing">
              <Play size={10} fill="currentColor" />
              PLAYING
            </span>
          ) : (
            <span className="dtl-status-paused">
              <Bug size={10} />
              TIME TRAVEL
            </span>
          )}
        </div>
      </div>

      {/* ── Waveform + Scrubber Row ── */}
      <div className="dtl-track-row">
        {/* Waveform */}
        <div className="dtl-waveform" ref={trackRef}>
          {waveform.map((freq, i) => {
            const height = Math.max(3, (freq / maxFreq) * 100);
            const isCurrent = total > 1 && Math.round((currentIndex / (total - 1)) * (BUCKET_COUNT - 1)) === i;
            const isPast = total > 1 && i <= Math.round((currentIndex / (total - 1)) * (BUCKET_COUNT - 1));
            return (
              <div
                key={i}
                className={`dtl-wave-bar ${isPast ? 'past' : ''} ${isCurrent ? 'current' : ''}`}
                style={{ height: `${height}%` }}
              />
            );
          })}

          {/* Breakpoint markers */}
          {snapshots.map((snap, idx) => {
            if (!breakpoints.has(snap.line)) return null;
            const pos = total > 1 ? (idx / (total - 1)) * 100 : 50;
            return (
              <div
                key={`bp-${idx}`}
                className="dtl-breakpoint-marker"
                style={{ left: `${pos}%` }}
                title={`Breakpoint at line ${snap.line}`}
              />
            );
          })}

          {/* Scrubber input */}
          <input
            type="range"
            min="0"
            max={Math.max(0, total - 1)}
            value={currentIndex >= 0 ? currentIndex : 0}
            onChange={(e) => onSeek(parseInt(e.target.value))}
            className="dtl-scrubber-input"
          />

          {/* Thumb indicator */}
          <motion.div
            className="dtl-thumb"
            initial={false}
            animate={{ left: `calc(${percentage}% - 6px)` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
      </div>

      {/* ── Mini Code Preview ── */}
      {currentSnap && (
        <div className="dtl-code-preview">
          <span className="dtl-code-line-num">L{currentLine}</span>
          <span className="dtl-code-text">
            {currentSnap.consoleOutput ? `→ ${currentSnap.consoleOutput}` : `Step ${currentIndex + 1}`}
          </span>
        </div>
      )}
    </div>
  );
});

// Build a histogram of execution frequency for waveform bars
function buildWaveform(snapshots, bucketCount) {
  const buckets = new Array(bucketCount).fill(0);
  if (snapshots.length === 0) return buckets;

  snapshots.forEach((_, idx) => {
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor((idx / snapshots.length) * bucketCount)
    );
    buckets[bucket]++;
  });

  return buckets;
}
