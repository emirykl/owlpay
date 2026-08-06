'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { ArrowUpRight, Check, OwlMark } from './icons';

export function LandingPage() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 110, damping: 28, restDelta: .001 });
  const heroY = useTransform(scrollYProgress, [0, .18], [0, reduceMotion ? 0 : 72]);
  const heroOpacity = useTransform(scrollYProgress, [0, .16], [1, reduceMotion ? 1 : .2]);

  return (
    <main className="landingPage" id="top">
      <motion.div className="scrollProgress" style={{ scaleX: progress }} />
      <nav className="landingNav shell" aria-label="Landing navigation">
        <a className="brand" href="#top" aria-label="OwlPay home"><OwlMark className="brandMark" /><span>OwlPay</span></a>
        <div className="landingLinks"><a href="#product">Product</a><a href="#how">How it works</a></div>
        <Link className="launchButton" href="/app">Open app <ArrowUpRight /></Link>
      </nav>

      <section className="landingHero shell">
        <motion.div className="landingHeroCopy" style={{ y: heroY, opacity: heroOpacity }} initial={false}>
          <div className="heroEmblem">
            <motion.div className="heroOwl heroOwlLeft" aria-hidden="true" animate={reduceMotion ? undefined : { y: [0, -8, 0], rotate: [-4, -2, -4] }} transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}><OwlMark /></motion.div>
            <motion.a className="heroGoatCoin" href="https://www.goat.network" target="_blank" rel="noreferrer" aria-label="GOAT Network" whileHover={reduceMotion ? undefined : { scale: 1.035, rotate: 1 }} transition={{ type: 'spring', stiffness: 280, damping: 22 }}>
              <span className="heroCoinFace">
                <Image src="/goat-network-symbol.svg" width={108} height={108} alt="" aria-hidden="true" priority />
                <strong>GOAT NETWORK</strong>
              </span>
            </motion.a>
            <motion.div className="heroOwl heroOwlRight" aria-hidden="true" animate={reduceMotion ? undefined : { y: [0, 8, 0], rotate: [4, 2, 4] }} transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}><OwlMark /></motion.div>
          </div>
          <h1>Code the task.<br /><span>Claim the reward.</span></h1>
          <p>Owl Agent verifies each pull request. x402 unlocks the pay-per-use AI review, then approved work earns the funded reward on GOAT Network.</p>
          <div className="landingActions">
            <Link className="primaryButton large" href="/app?intent=explore">Explore bounties <ArrowUpRight /></Link>
            <Link className="textLink" href="/app?intent=create">Post a bounty</Link>
          </div>
        </motion.div>
      </section>

      <section id="product" className="productShowcase">
        <div className="productShowcaseSticky shell">
          <div className="productShowcaseHeading">
            <span className="eyebrow">Owl Agent + x402</span>
            <h2>AI verifies. Rewards settle.</h2>
          </div>
          <div className="productFrame" aria-label="OwlPay product preview">
            <div className="productFrameBar">
              <div className="productFrameBrand"><OwlMark /><strong>OwlPay</strong></div>
              <span className="productNetwork"><Image className="productNetworkLogo" src="/goat-network-symbol.svg" width={16} height={16} alt="" aria-hidden="true" /> GOAT Testnet3</span>
            </div>
            <div className="productFrameBody">
              <article className="productBountyPreview">
                <div className="previewTop">
                  <div className="previewRepo"><span className="previewRepoMark">O</span><div><small>Repository</small><strong>owlpay/app</strong></div></div>
                  <span className="previewReward">50 USDC</span>
                </div>
                <div className="previewTitle"><span>OPEN BOUNTY</span><h3>Verify the checkout flow</h3></div>
                <div className="previewCriteria">
                  <div><span><Check /></span><strong>Payment succeeds</strong></div>
                  <div><span><Check /></span><strong>Existing tests pass</strong></div>
                </div>
              </article>

              <article className="productReviewPreview">
                <div className="reviewPreviewHeader"><OwlMark /><div><small>OWL AI AGENT</small><h3>Pull request verified</h3></div><span><Check /></span></div>
                <div className="reviewPreviewChecks"><span>Criteria</span><strong>2 / 2</strong><span>Tests</span><strong>Passed</strong><span>x402 review</span><strong>Paid</strong></div>
                <div className="previewSettlement"><span>Verified reward</span><strong>50 USDC</strong></div>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="minimalFlow shell">
        <div className="minimalFlowHeading">
          <span className="eyebrow">How it works</span>
          <h2>Fund it. AI checks it. Get paid.</h2>
        </div>
        <div className="minimalFlowGrid">
          {[
            ['01', 'Fund', 'Create the bounty and lock its reward.'],
            ['02', 'Verify', 'x402 unlocks Owl Agent review for the submitted PR.'],
            ['03', 'Settle', 'Approved evidence releases the onchain reward.']
          ].map(([number, title, copy], index) => (
            <motion.article key={number} initial={false} whileHover={reduceMotion ? undefined : { y: -6 }} transition={{ type: 'spring', stiffness: 360, damping: 28 }}>
              <span>{number}</span><h3>{title}</h3><p>{copy}</p>{index === 2 && <Check />}
            </motion.article>
          ))}
        </div>
      </section>

      <section className="landingFinal shell">
        <motion.div initial={false}>
          <OwlMark className="ctaMark" />
          <h2>Find your next reward.</h2>
          <Link className="primaryButton large" href="/app?intent=explore">Explore bounties <ArrowUpRight /></Link>
        </motion.div>
      </section>

      <footer className="footer shell"><a className="brand" href="#top"><OwlMark className="brandMark" /><span>OwlPay</span></a><span /><a href="https://explorer.testnet3.goat.network" target="_blank" rel="noreferrer">Testnet explorer <ArrowUpRight /></a></footer>
    </main>
  );
}
