// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { FolderOpen, ArrowRight } from 'lucide-react';
import { GithubIcon as Github } from './icons';
import { PROJECT_TEMPLATES } from '../projects/templates';

const TEMPLATES = [
  { id: 'js',   emoji: '🍋', label: 'JavaScript', blurb: 'console.log your way in', tone: 'lemon' },
  { id: 'py',   emoji: '🐍', label: 'Python',     blurb: 'numpy & friends, no install', tone: 'mint' },
  { id: 'html', emoji: '🎨', label: 'HTML / CSS', blurb: 'live preview as you type', tone: 'peach' },
  { id: 'ts',   emoji: '🧩', label: 'TypeScript', blurb: 'types, then run it', tone: 'sky' },
];

const SHORTCUTS = [
  ['Ctrl', 'Enter', 'run'],
  ['F5', null, 'time-travel debug'],
  ['Ctrl', 'P', 'find anything'],
  ['Ctrl', '\\', 'ask AI'],
];

// Decorative floaties (aria-hidden): position, colour token, rotation, delay
const FLOATIES = [
  { shape: 'star',     top: '9%',  left: '6%',  tone: 'lemon', r: '-12deg', delay: '0s' },
  { shape: 'circle',   top: '18%', left: '88%', tone: 'pink',  r: '0deg',   delay: '-2s' },
  { shape: 'squiggle', top: '72%', left: '4%',  tone: 'mint',  r: '8deg',   delay: '-4s' },
  { shape: 'triangle', top: '80%', left: '90%', tone: 'sky',   r: '14deg',  delay: '-1s' },
  { shape: 'plus',     top: '46%', left: '94%', tone: 'peach', r: '0deg',   delay: '-3s' },
];

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } };
const item = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 24 } },
};

function Floatie({ shape, tone }) {
  switch (shape) {
    case 'star':     return <svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6z" className={`pg-fill-${tone}`} /></svg>;
    case 'circle':   return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" className={`pg-fill-${tone}`} /></svg>;
    case 'triangle': return <svg viewBox="0 0 24 24"><path d="M12 3l9 17H3z" className={`pg-fill-${tone}`} /></svg>;
    case 'plus':     return <svg viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" className={`pg-fill-${tone}`} /></svg>;
    default:         return <svg viewBox="0 0 48 16"><path d="M2 8c5-8 9 8 14 0s9 8 14 0 9 8 14 0" fill="none" strokeWidth="4" strokeLinecap="round" className={`pg-stroke-${tone}`} /></svg>;
  }
}

export function WelcomeScreen({ onOpenFolder, onOpenGitHub, onNewFile, onNewProject, projectsUnsupported, isSupported }) {
  return (
    <div className="welcome-screen" id="welcome-screen">
      <div className="pg-floaties" aria-hidden="true">
        {FLOATIES.map((f, i) => (
          <span key={i} className="pg-floatie" style={{ top: f.top, left: f.left, '--r': f.r, animationDelay: f.delay }}>
            <Floatie shape={f.shape} tone={f.tone} />
          </span>
        ))}
      </div>

      <motion.div className="pg-welcome" variants={container} initial="hidden" animate="show">
        <motion.div className="pg-hero" variants={item}>
          <h2 className="pg-wordmark">nexide</h2>
          <p className="pg-tagline">Write it. Run it. <span className="pg-highlight">Rewind it.</span></p>
          <p className="pg-subtitle">
            A playful browser IDE for JavaScript, TypeScript &amp; Python — plus full Next.js, React, Vue
            and Node.js projects running right in your tab. Time-travel debugging, live preview and an AI
            sidekick. Nothing to install.
          </p>
        </motion.div>

        <motion.section variants={item} aria-labelledby="pg-start-heading">
          <h3 className="pg-section-title" id="pg-start-heading">Start something fresh</h3>
          <div className="pg-template-grid">
            {TEMPLATES.map(t => (
              <motion.button
                key={t.id}
                id={`welcome-template-${t.id}`}
                className={`pg-template pg-tone-${t.tone}`}
                onClick={() => onNewFile(t)}
                variants={item}
                whileTap={{ scale: 0.97 }}
              >
                <span className="pg-template-emoji" aria-hidden="true">{t.emoji}</span>
                <span className="pg-template-label">{t.label}</span>
                <span className="pg-template-blurb">{t.blurb}</span>
                <ArrowRight size={16} className="pg-template-arrow" aria-hidden="true" />
              </motion.button>
            ))}
          </div>
        </motion.section>

        <motion.section variants={item} aria-labelledby="pg-project-heading">
          <h3 className="pg-section-title" id="pg-project-heading">Spin up a full project</h3>
          <div className="pg-template-grid">
            {PROJECT_TEMPLATES.map(t => (
              <motion.button
                key={t.id}
                id={`welcome-project-${t.id}`}
                className={`pg-template pg-template-project pg-tone-${t.tone}`}
                onClick={() => onNewProject(t)}
                disabled={!!projectsUnsupported}
                variants={item}
                whileTap={{ scale: 0.97 }}
              >
                <span className="pg-template-emoji" aria-hidden="true">{t.emoji}</span>
                <span className="pg-template-label">{t.label}</span>
                <span className="pg-template-blurb">{t.blurb}</span>
                <ArrowRight size={16} className="pg-template-arrow" aria-hidden="true" />
              </motion.button>
            ))}
          </div>
          <p className="pg-section-note">
            {projectsUnsupported || 'Real Node.js runs inside your browser: npm install, dev server with hot reload, and a shell.'}
          </p>
        </motion.section>

        <motion.section variants={item} aria-labelledby="pg-open-heading">
          <h3 className="pg-section-title" id="pg-open-heading">…or bring your own code</h3>
          <div className="pg-open-row">
            {isSupported ? (
              <button id="welcome-btn-open-folder" className="pg-chunky" onClick={onOpenFolder}>
                <FolderOpen size={16} aria-hidden="true" /> Open a folder
              </button>
            ) : (
              <div className="welcome-unsupported">⚠ File System Access API not supported natively.</div>
            )}
            <button id="welcome-btn-open-github" className="pg-chunky pg-chunky-alt" onClick={onOpenGitHub}>
              <Github size={16} aria-hidden="true" /> Open a GitHub repo
            </button>
          </div>
        </motion.section>

        <motion.ul className="pg-shortcuts" variants={item} aria-label="Keyboard shortcuts">
          {SHORTCUTS.map(([a, b, what]) => (
            <li key={what}>
              <kbd>{a}</kbd>{b && <>+<kbd>{b}</kbd></>} <span>{what}</span>
            </li>
          ))}
        </motion.ul>
      </motion.div>
    </div>
  );
}
