'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Check, GitHubMark, OwlMark } from './icons';
import { useAuth } from './auth-provider';

const phases = ['Confirming GitHub identity', 'Securing your session', 'Opening your workspace'];

export function AuthCallbackScreen({ callbackError }: { callbackError?: string }) {
  const reduceMotion = useReducedMotion();
  const { user, isLoading } = useAuth();
  const [phase, setPhase] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (user || callbackError) return;
    const phaseTimer = window.setInterval(() => setPhase((current) => Math.min(current + 1, phases.length - 1)), 750);
    const timeout = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => {
      window.clearInterval(phaseTimer);
      window.clearTimeout(timeout);
    };
  }, [callbackError, user]);

  const failed = Boolean(callbackError || (!isLoading && timedOut && !user));
  const activePhase = user ? phases.length - 1 : phase;

  return (
    <main className="authCallbackPage">
      <motion.div className="callbackGlow callbackGlowOne" animate={reduceMotion ? undefined : { x: [0, 28, 0], y: [0, -18, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="callbackGlow callbackGlowTwo" animate={reduceMotion ? undefined : { x: [0, -22, 0], y: [0, 24, 0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />

      <motion.section className="authCallbackCard" initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .55, ease: [0.22, 1, 0.36, 1] }}>
        <div className="callbackBrand"><OwlMark /><span>OwlPay</span></div>

        <div className="providerBridge" aria-hidden="true">
          <motion.span className="bridgeProvider bridgeGithub" animate={reduceMotion || failed ? undefined : { scale: [1, 1.06, 1] }} transition={{ duration: 1.8, repeat: Infinity }}><GitHubMark /></motion.span>
          <span className="bridgeLine"><motion.i animate={reduceMotion || failed ? undefined : { x: ['-110%', '240%'] }} transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }} /></span>
          <motion.span className="bridgeProvider bridgeOwl" animate={reduceMotion || failed ? undefined : { scale: [1, 1.06, 1] }} transition={{ duration: 1.8, delay: .45, repeat: Infinity }}><OwlMark /></motion.span>
        </div>

        {failed ? (
          <motion.div className="callbackCopy" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <span className="eyebrow">Connection paused</span>
            <h1>GitHub could not be connected.</h1>
            <p>{callbackError ? decodeURIComponent(callbackError) : 'The authorization took longer than expected. Return to the workspace and try once more.'}</p>
            <Link className="primaryButton callbackAction" href="/app">Return to workspace</Link>
          </motion.div>
        ) : (
          <div className="callbackCopy">
            <span className="eyebrow">Secure GitHub connection</span>
            <h1>{user ? 'You’re connected.' : 'Preparing your workspace.'}</h1>
            <p>{user ? 'Identity confirmed. Taking you back to where you left off.' : phases[activePhase]}</p>
          </div>
        )}

        {!failed && (
          <div className="callbackProgress" aria-label="GitHub connection progress">
            {phases.map((label, index) => <div className={index < activePhase || user ? 'complete' : index === activePhase ? 'active' : ''} key={label}><span>{index < activePhase || user ? <Check /> : index + 1}</span><small>{label}</small></div>)}
          </div>
        )}

        <div className="callbackPrivacy"><span className="statusDot" />OAuth credentials stay between GitHub and Supabase.</div>
      </motion.section>
    </main>
  );
}
