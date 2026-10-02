import { lazy, Suspense } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { ChunkErrorBoundary } from './ChunkErrorBoundary';
import { AIChat } from './AIChat';
import { VariableInspector } from './VariableInspector';
import { Terminal } from './Terminal';
import { ConsoleOutput } from './ConsoleOutput';

// Heavy panels (d3, sucrase) load on demand
const CodeMap     = lazy(() => import('./CodeMap'));
const LivePreview = lazy(() => import('./LivePreview'));

const label = (id) => id.charAt(0).toUpperCase() + id.slice(1);
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, style: { height: '100%' } };

function PanelTabs({ tabs, active, onSelect, onClose }) {
  return (
    <div className="panel-tabs">
      {tabs.map(id => (
        <button key={id} className={`panel-tab ${active === id ? 'active' : ''}`} onClick={() => onSelect(id)}>
          {label(id)}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button className="panel-close-btn" onClick={onClose} aria-label="Close panel">×</button>
    </div>
  );
}

/** Bottom panel: terminal and console (with program input). */
export function BottomPanel({ panel, onSelect, onClose, terminal, console: consoleProps }) {
  return (
    <div className="bottom-panel">
      <PanelTabs tabs={['terminal', 'console']} active={panel} onSelect={onSelect} onClose={onClose} />
      <div className="panel-content">
        {panel === 'terminal' && <Terminal open={true} onClose={onClose} {...terminal} />}
        {panel === 'console' && <ConsoleOutput {...consoleProps} />}
      </div>
    </div>
  );
}

/** Right panel: live preview, AI chat, code map, debugger state. Each section's props are passed through. */
export function RightPanel({ panel, onSelect, onClose, preview, ai, map, debug }) {
  return (
    <div className="right-panel">
      <PanelTabs tabs={['preview', 'ai', 'map', 'debug']} active={panel} onSelect={onSelect} onClose={onClose} />
      <div className="panel-content">
        <ChunkErrorBoundary name="Panel" key={panel}>
          <Suspense fallback={<div className="panel-loading" style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</div>}>
            <AnimatePresence mode="wait">
              {panel === 'preview' && <motion.div key="preview" {...fade}><LivePreview {...preview} /></motion.div>}
              {panel === 'ai' && <motion.div key="ai" {...fade}><AIChat {...ai} /></motion.div>}
              {panel === 'map' && <motion.div key="map" {...fade}><CodeMap {...map} /></motion.div>}
              {panel === 'debug' && <motion.div key="debug" {...fade}><VariableInspector {...debug} /></motion.div>}
            </AnimatePresence>
          </Suspense>
        </ChunkErrorBoundary>
      </div>
    </div>
  );
}
