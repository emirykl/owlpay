const { expect } = require('chai');
const { ethers } = require('hardhat');
const { takeSnapshot } = require('@nomicfoundation/hardhat-network-helpers');

/**
 * Property tests for the escrow.
 *
 * The suite next door checks named scenarios. This one drives random operation
 * sequences instead and asserts the properties that must hold no matter which
 * order the calls arrive in. The generator is seeded so a failure names the seed
 * that produced it and can be replayed exactly.
 */

const FEE_BPS = 300n;
const BPS_DENOMINATOR = 10_000n;
const DAY = 24 * 60 * 60;
const MAX_BOUNTY_DURATION = 30 * DAY;
const MAINTAINER_REVIEW_PERIOD = 7 * DAY;

// Statuses that still hold escrow. Anything else has already paid out or
// refunded, so its reward must no longer sit in the contract.
const ESCROWED = new Set([1, 2, 3, 4, 5, 6]); // Open, Assigned, Submitted, RevisionRequired, HumanReview, Approved

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    // xorshift32: small, deterministic, and good enough to shuffle call order.
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

async function deployFixture() {
  const [admin, settlement, treasury, owner, developer, outsider] = await ethers.getSigners();
  const token = await ethers.deployContract('MockUSDC');
  const contract = await ethers.deployContract('OwlPayBounty', [
    admin.address,
    settlement.address,
    await token.getAddress(),
    treasury.address,
    Number(FEE_BPS)
  ]);
  for (const account of [owner, developer, outsider]) {
    await token.mint(account.address, 1_000_000_000n);
    await token.connect(account).approve(await contract.getAddress(), 1_000_000_000n);
  }
  return { admin, settlement, treasury, owner, developer, outsider, token, contract };
}

async function escrowedTotal(contract, createdIds) {
  let total = 0n;
  for (const id of createdIds) {
    const bounty = await contract.getBounty(id);
    if (ESCROWED.has(Number(bounty.status))) total += bounty.rewardAmount;
  }
  return total;
}

describe('OwlPayBounty invariants', function () {
  // These tests move the chain clock forward. Without restoring the node
  // afterwards that time travel leaks into every suite that runs later, and the
  // scenario tests next door pick their deadlines relative to wall clock time.
  let snapshot;
  beforeEach(async function () { snapshot = await takeSnapshot(); });
  afterEach(async function () { await snapshot.restore(); });

  for (const seed of [1, 20260809, 987654321]) {
    it(`holds exactly the escrow it owes across a random call sequence (seed ${seed})`, async function () {
      const fixture = await deployFixture();
      const random = randomGenerator(seed);
      const contractAddress = await fixture.contract.getAddress();
      const createdIds = [];
      const owners = new Map();
      const actors = [fixture.owner, fixture.developer, fixture.outsider];
      let applied = 0;

      // Status the escrow is in -> the call that legitimately follows it.
      const nextByStatus = { 1: 1, 2: 2, 3: 3, 4: 2, 6: 4 };

      for (let step = 0; step < 40; step += 1) {
        const id = createdIds.length ? createdIds[Math.floor(random() * createdIds.length)] : 0;
        const status = id ? Number((await fixture.contract.getBounty(id)).status) : 0;
        // Mostly walk a bounty forward so sequences get deep enough to reach
        // settlement; the rest of the time fire something arbitrary so wrong
        // caller and wrong state paths keep getting exercised.
        const choice = random() < 0.75 && nextByStatus[status] !== undefined
          ? nextByStatus[status]
          : Math.floor(random() * 6);
        const actor = random() < 0.8 && owners.has(id) ? owners.get(id) : actors[Math.floor(random() * actors.length)];

        try {
          if (choice === 0 || createdIds.length === 0) {
            const reward = BigInt(1 + Math.floor(random() * 1_000_000));
            const latest = await ethers.provider.getBlock('latest');
            const deadline = latest.timestamp + 60 + Math.floor(random() * (MAX_BOUNTY_DURATION - 120));
            await fixture.contract.connect(actor).createBounty(reward, deadline, ethers.id(`task-${step}-${seed}`));
            createdIds.push(createdIds.length + 1);
            owners.set(createdIds.length, actor);
          } else if (choice === 1) {
            await fixture.contract.connect(actor).assignDeveloper(id, fixture.developer.address);
          } else if (choice === 2) {
            await fixture.contract.connect(fixture.developer).submitWork(id, ethers.id(`submission-${step}-${seed}`));
          } else if (choice === 3) {
            await fixture.contract.connect(fixture.settlement).approveSubmission(id, ethers.id(`verified-${step}`));
          } else if (choice === 4) {
            await fixture.contract.connect(fixture.settlement).releasePayment(id);
          } else {
            await fixture.contract.connect(actor).refundExpiredBounty(id);
          }
          applied += 1;
        } catch {
          // A rejected call is a valid outcome: the generator deliberately makes
          // calls from the wrong actor and in the wrong state. What matters is
          // that the invariants below survive whichever ones went through.
        }

        const owed = await escrowedTotal(fixture.contract, createdIds);
        const held = await fixture.token.balanceOf(contractAddress);
        // Never short: a paid or refunded bounty must never have been funded
        // out of another bounty's escrow.
        expect(held).to.equal(owed);
      }

      // Guards the property test against quietly going vacuous: if a later
      // change made every generated call revert, the balance check above would
      // still pass while testing nothing.
      expect(applied).to.be.greaterThan(10);
      const settled = await Promise.all(createdIds.map(async (id) => Number((await fixture.contract.getBounty(id)).status)));
      expect(settled.some((status) => !ESCROWED.has(status))).to.equal(true);
    });
  }

  it('never pays out more than the reward, and splits it exactly', async function () {
    const fixture = await deployFixture();
    const random = randomGenerator(42);
    const contractAddress = await fixture.contract.getAddress();

    for (let round = 0; round < 8; round += 1) {
      const reward = BigInt(1 + Math.floor(random() * 5_000_000));
      const latest = await ethers.provider.getBlock('latest');
      const bountyId = round + 1;
      await fixture.contract.connect(fixture.owner).createBounty(reward, latest.timestamp + DAY, ethers.id(`task-${round}`));
      await fixture.contract.connect(fixture.owner).assignDeveloper(bountyId, fixture.developer.address);
      await fixture.contract.connect(fixture.developer).submitWork(bountyId, ethers.id(`submission-${round}`));
      await fixture.contract.connect(fixture.settlement).approveSubmission(bountyId, ethers.id(`verified-${round}`));

      const developerBefore = await fixture.token.balanceOf(fixture.developer.address);
      const treasuryBefore = await fixture.token.balanceOf(fixture.treasury.address);
      await fixture.contract.connect(fixture.settlement).releasePayment(bountyId);
      const developerGain = (await fixture.token.balanceOf(fixture.developer.address)) - developerBefore;
      const treasuryGain = (await fixture.token.balanceOf(fixture.treasury.address)) - treasuryBefore;

      const expectedFee = reward * FEE_BPS / BPS_DENOMINATOR;
      expect(treasuryGain).to.equal(expectedFee);
      expect(developerGain).to.equal(reward - expectedFee);
      // Rounding must never mint or strand a unit of the token.
      expect(developerGain + treasuryGain).to.equal(reward);
      expect(await fixture.token.balanceOf(contractAddress)).to.equal(0n);
    }
  });

  it('settles every bounty exactly once, whichever path it takes', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const reward = 3_000_000n;

    for (let index = 0; index < 3; index += 1) {
      await fixture.contract.connect(fixture.owner).createBounty(reward, latest.timestamp + DAY, ethers.id(`task-${index}`));
    }
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission-1'));
    await fixture.contract.connect(fixture.settlement).approveSubmission(1, ethers.id('verified-1'));
    await fixture.contract.connect(fixture.settlement).releasePayment(1);

    // A settled bounty rejects every further settlement attempt.
    await expect(fixture.contract.connect(fixture.settlement).releasePayment(1)).to.be.reverted;
    await expect(fixture.contract.connect(fixture.settlement).approveSubmission(1, ethers.id('again'))).to.be.reverted;
    await expect(fixture.contract.connect(fixture.owner).refundExpiredBounty(1)).to.be.reverted;

    await fixture.contract.connect(fixture.owner).cancelUnassignedBounty(2);
    await expect(fixture.contract.connect(fixture.owner).cancelUnassignedBounty(2)).to.be.reverted;
    await expect(fixture.contract.connect(fixture.owner).assignDeveloper(2, fixture.developer.address)).to.be.reverted;

    await ethers.provider.send('evm_increaseTime', [DAY + MAINTAINER_REVIEW_PERIOD + 1]);
    await ethers.provider.send('evm_mine', []);
    await fixture.contract.connect(fixture.owner).refundExpiredBounty(3);
    await expect(fixture.contract.connect(fixture.owner).refundExpiredBounty(3)).to.be.reverted;

    expect(await fixture.token.balanceOf(await fixture.contract.getAddress())).to.equal(0n);
  });

  it('refuses a submission hash that already bought a payout', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const hash = ethers.id('same-pull-request');

    await fixture.contract.connect(fixture.owner).createBounty(1_000_000n, latest.timestamp + DAY, ethers.id('task-a'));
    await fixture.contract.connect(fixture.owner).createBounty(1_000_000n, latest.timestamp + DAY, ethers.id('task-b'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.owner).assignDeveloper(2, fixture.developer.address);

    await fixture.contract.connect(fixture.developer).submitWork(1, hash);
    // The same delivery must not be sold twice, on any bounty.
    await expect(fixture.contract.connect(fixture.developer).submitWork(2, hash))
      .to.be.revertedWithCustomError(fixture.contract, 'SubmissionAlreadyUsed');
  });

  it('rejects the malformed inputs that would corrupt escrow accounting', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = latest.timestamp + DAY;

    await expect(fixture.contract.connect(fixture.owner).createBounty(0, deadline, ethers.id('task')))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidAmount');
    await expect(fixture.contract.connect(fixture.owner).createBounty(1_000n, deadline, ethers.ZeroHash))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidAmount');
    await expect(fixture.contract.connect(fixture.owner).createBounty(1_000n, latest.timestamp - 1, ethers.id('task')))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidDeadline');
    await expect(fixture.contract.connect(fixture.owner).createBounty(1_000n, latest.timestamp + MAX_BOUNTY_DURATION + DAY, ethers.id('task')))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidDeadline');

    await fixture.contract.connect(fixture.owner).createBounty(1_000n, deadline, ethers.id('task'));
    await expect(fixture.contract.connect(fixture.owner).assignDeveloper(1, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidAddress');
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await expect(fixture.contract.connect(fixture.developer).submitWork(1, ethers.ZeroHash))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidAmount');
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission'));
    await expect(fixture.contract.connect(fixture.settlement).approveSubmission(1, ethers.ZeroHash))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidAmount');
    await expect(fixture.contract.connect(fixture.settlement).resolveReviewTimeout(1, ethers.ZeroHash, true))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidAmount');

    // An id that was never created has no owner and no escrow to act on.
    await expect(fixture.contract.getBounty(99)).to.be.reverted;
    await expect(fixture.contract.connect(fixture.owner).assignDeveloper(99, fixture.developer.address)).to.be.reverted;
  });
});
