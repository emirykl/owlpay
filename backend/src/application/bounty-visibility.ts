import type { Bounty } from '../domain/schemas.js';

export function bountyForViewer(bounty: Bounty, viewerUserId?: string | null): Bounty {
  if (!bounty.decision || bounty.ownerUserId === viewerUserId) return bounty;
  const visibleBounty = { ...bounty };
  delete visibleBounty.decision;
  return visibleBounty;
}
