// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './landing-page';

vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
  useScroll: () => ({ scrollYProgress: 0 }),
  useSpring: (value: unknown) => value,
  useTransform: () => 0,
  motion: new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) => function MotionElement(props: Record<string, unknown>) {
      const { children, initial, animate, exit, transition, whileHover, style, ...rest } = props;
      void initial; void animate; void exit; void transition; void whileHover; void style;
      return createElement(tag, rest, children as ReactNode);
    }
  })
}));

afterEach(cleanup);

function hrefOf(name: string | RegExp) {
  return screen.getByRole('link', { name }).getAttribute('href');
}

describe('LandingPage', () => {
  it('routes both calls to action into the app with their intent', () => {
    render(<LandingPage />);

    expect(hrefOf('Open app')).toBe('/app');
    // The workspace reads these intents to open on the right view, so a typo
    // here silently drops the visitor on the default screen.
    expect(screen.getAllByRole('link', { name: /Explore bounties/ }).every((link) => link.getAttribute('href') === '/app?intent=explore')).toBe(true);
    expect(hrefOf('Post a bounty')).toBe('/app?intent=create');
  });

  it('opens every outbound link without handing over the opener', () => {
    render(<LandingPage />);

    const outbound = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('http'));
    expect(outbound.length).toBeGreaterThan(0);
    for (const link of outbound) {
      expect(link.getAttribute('target')).toBe('_blank');
      // Without this a target=_blank page can reach back through window.opener.
      expect(link.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('keeps the in-page navigation anchored to sections that exist', () => {
    const { container } = render(<LandingPage />);

    const anchors = screen.getAllByRole('link')
      .map((link) => link.getAttribute('href'))
      .filter((href): href is string => Boolean(href?.startsWith('#')));
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(container.querySelector(`[id="${anchor.slice(1)}"]`), `no section for ${anchor}`).toBeTruthy();
    }
  });

  it('states what the product does above the fold', () => {
    render(<LandingPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Code the task.');
  });
});
