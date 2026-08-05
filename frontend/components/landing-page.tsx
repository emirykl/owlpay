'use client';

import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { ArrowUpRight, Check, OwlMark } from './icons';

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 }
};

export function LandingPage() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 110, damping: 28, restDelta: 0.001 });
  const heroY = useTransform(scrollYProgress, [0, 0.32], [0, reduceMotion ? 0 : 72]);
  const cardY = useTransform(scrollYProgress, [0, 0.32], [0, reduceMotion ? 0 : -42]);
  const enter = reduceMotion ? undefined : { duration: 0.65, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <main className="landingPage" id="top">
      <motion.div className="scrollProgress" style={{ scaleX: progress }} />
      <nav className="landingNav shell" aria-label="Landing navigation">
        <a className="brand" href="#top" aria-label="OwlPay home"><OwlMark className="brandMark" /><span>OwlPay</span></a>
        <div className="landingLinks"><a href="#how">How it works</a><a href="#for-who">For teams</a></div>
        <Link className="launchButton" href="/app">Launch app <ArrowUpRight /></Link>
      </nav>

      <section className="landingHero shell">
        <motion.div className="landingHeroCopy" style={{ y: heroY }} initial={reduceMotion ? false : 'hidden'} animate="visible" variants={reveal} transition={enter}>
          <span className="eyebrow">GitHub work · verified settlement</span>
          <h1>Ship the work.<br /><span>Know you&apos;ll get paid.</span></h1>
          <p>Create a GitHub bounty, verify the pull request against clear acceptance criteria, and release testnet payment only when the evidence passes.</p>
          <div className="landingActions">
            <Link className="primaryButton large" href="/app">Launch OwlPay <ArrowUpRight /></Link>
            <a className="textLink" href="#how">See the flow</a>
          </div>
          <div className="heroProof"><span><Check /> GitHub-native</span><span><Check /> Evidence-based</span><span><Check /> Testnet ready</span></div>
        </motion.div>

        <motion.div className="landingAgentWrap" style={{ y: cardY }} initial={reduceMotion ? false : { opacity: 0, scale: 0.94, rotate: 2 }} animate={{ opacity: 1, scale: 1, rotate: 0.8 }} transition={{ ...enter, delay: 0.12 }}>
          <div className="agentCard" aria-label="Owl Agent verification preview">
            <div className="agentTop"><div><span className="miniLabel">OWL AGENT · COMPLETE</span><h2>Pull request verified</h2></div><div className="score">94<span>%</span></div></div>
            <div className="divider" />
            <div className="checkList">
              <div><span className="checkIcon"><Check /></span><p><strong>Acceptance criteria</strong><small>3 of 3 requirements passed</small></p></div>
              <div><span className="checkIcon"><Check /></span><p><strong>Test suite</strong><small>42 checks passed on GitHub</small></p></div>
              <div><span className="checkIcon"><Check /></span><p><strong>Commit integrity</strong><small>Bound to 8f2c…91ad</small></p></div>
            </div>
            <div className="settlementBar"><span>Ready to settle</span><strong>20.00 USDC</strong></div>
          </div>
          <motion.div className="floatingStatus" animate={reduceMotion ? undefined : { y: [0, -8, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}><span className="statusDot" /> Evidence locked</motion.div>
        </motion.div>
      </section>

      <section className="trustStrip shell" aria-label="OwlPay product promise">
        <span>Built for measurable work</span><strong>Repository</strong><i /> <strong>Pull request</strong><i /> <strong>Agent evidence</strong><i /> <strong>Settlement</strong>
      </section>

      <section id="how" className="landingSection shell">
        <motion.div className="sectionIntro" initial={reduceMotion ? false : 'hidden'} whileInView="visible" viewport={{ once: true, amount: 0.35 }} variants={reveal} transition={enter}>
          <span className="eyebrow">One clear workflow</span>
          <h2>GitHub does the coding.<br />OwlPay handles certainty.</h2>
          <p>No confusing handoff. Every step tells the next person exactly what to do.</p>
        </motion.div>
        <div className="flowGrid">
          {[
            ['01', 'Create the bounty', 'Select a repository, define the outcome, set measurable criteria, and fund the reward.'],
            ['02', 'Open the pull request', 'The developer works on GitHub, opens a PR, then submits its URL to OwlPay.'],
            ['03', 'Verify and settle', 'The Owl Agent checks the exact commit and releases payment when the evidence passes.']
          ].map(([number, title, copy], index) => (
            <motion.article key={number} initial={reduceMotion ? false : 'hidden'} whileInView="visible" viewport={{ once: true, amount: 0.35 }} variants={reveal} transition={{ ...enter, delay: index * 0.1 }}>
              <span>{number}</span><div className="flowIcon">{index === 2 ? <Check /> : <ArrowUpRight />}</div><h3>{title}</h3><p>{copy}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section id="for-who" className="roleSection shell">
        <motion.div className="rolePanel ownerPanel" initial={reduceMotion ? false : { opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.35 }} transition={enter}>
          <span className="eyebrow">For repository owners</span><h2>Turn an issue into a funded outcome.</h2><p>Choose your repository, explain the expected result, and define exactly what evidence must pass.</p><Link href="/app?intent=create">Create a bounty <ArrowUpRight /></Link>
        </motion.div>
        <motion.div className="rolePanel developerPanel" initial={reduceMotion ? false : { opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: 0.35 }} transition={enter}>
          <span className="eyebrow">For developers</span><h2>Find clear work with a visible reward.</h2><p>Review the criteria before you start, build on GitHub, and submit the pull request when it is ready.</p><Link href="/app?intent=explore">Explore bounties <ArrowUpRight /></Link>
        </motion.div>
      </section>

      <section className="finalCta shell">
        <motion.div initial={reduceMotion ? false : 'hidden'} whileInView="visible" viewport={{ once: true, amount: 0.5 }} variants={reveal} transition={enter}>
          <OwlMark className="ctaMark" /><span className="eyebrow">GOAT Testnet3</span><h2>Make the next task unmistakably clear.</h2><p>Enter the workspace, choose what you want to do, and OwlPay will guide the rest.</p><Link className="primaryButton large" href="/app">Launch app <ArrowUpRight /></Link>
        </motion.div>
      </section>

      <footer className="footer shell"><a className="brand" href="#top"><OwlMark className="brandMark" /><span>OwlPay</span></a><p>Inspect the work. Release the payment.</p><a href="https://explorer.testnet3.goat.network" target="_blank" rel="noreferrer">Testnet explorer <ArrowUpRight /></a></footer>
    </main>
  );
}
