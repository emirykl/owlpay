const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('OwlPayBounty', function () {
  async function deployFixture() {
    const [admin, settlement, treasury, owner, developer, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract('MockUSDC');
    const contract = await ethers.deployContract('OwlPayBounty', [
      admin.address,
      settlement.address,
      await token.getAddress(),
      treasury.address,
      300
    ]);
    await token.mint(owner.address, 100_000_000n);
    await token.connect(owner).approve(await contract.getAddress(), 100_000_000n);
    return { admin, settlement, treasury, owner, developer, outsider, token, contract };
  }

  async function createSubmittedBounty(fixture, reward = 20_000_000n) {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(reward, deadline, ethers.id('health-endpoint'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('repo:commit-a'));
  }

  it('locks the gross reward and releases 97% to the developer and 3% to treasury exactly once', async function () {
    const fixture = await deployFixture();
    await createSubmittedBounty(fixture);
    await fixture.contract.connect(fixture.settlement).approveSubmission(1, ethers.id('verification-a'));

    const payout = fixture.contract.connect(fixture.settlement).releasePayment(1);
    await expect(payout)
      .to.emit(fixture.contract, 'PaymentReleased')
      .withArgs(1, fixture.developer.address, 20_000_000n, 600_000n, 19_400_000n);
    expect(await fixture.token.balanceOf(fixture.developer.address)).to.equal(19_400_000n);
    expect(await fixture.token.balanceOf(fixture.treasury.address)).to.equal(600_000n);
    expect(await fixture.token.balanceOf(await fixture.contract.getAddress())).to.equal(0);
    await expect(fixture.contract.connect(fixture.settlement).releasePayment(1)).to.be.reverted;
  });

  it('rejects fees over the immutable 5% safety cap', async function () {
    const [admin, settlement, treasury] = await ethers.getSigners();
    const token = await ethers.deployContract('MockUSDC');
    await expect(ethers.deployContract('OwlPayBounty', [
      admin.address, settlement.address, await token.getAddress(), treasury.address, 501
    ])).to.be.revertedWithCustomError(await ethers.getContractFactory('OwlPayBounty'), 'InvalidFee');
  });

  it('rejects unauthorized assignment, submission and approval', async function () {
    const fixture = await deployFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await expect(fixture.contract.connect(fixture.outsider).assignDeveloper(1, fixture.developer.address))
      .to.be.revertedWithCustomError(fixture.contract, 'NotBountyOwner');
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await expect(fixture.contract.connect(fixture.outsider).submitWork(1, ethers.id('outsider-submission')))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidAddress');
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission'));
    await expect(fixture.contract.connect(fixture.outsider).approveSubmission(1, ethers.id('report'))).to.be.reverted;
  });

  it('returns the entire reward when an unassigned bounty is cancelled', async function () {
    const fixture = await deployFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await expect(fixture.contract.connect(fixture.owner).cancelUnassignedBounty(1))
      .to.changeTokenBalances(fixture.token, [fixture.owner, fixture.contract], [20_000_000n, -20_000_000n]);
  });

  it('pauses creation and settlement transfers', async function () {
    const fixture = await deployFixture();
    await fixture.contract.connect(fixture.admin).pause();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await expect(fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'))).to.be.reverted;
  });

  it('keeps one fixed seven-day maintainer window and allows at most two revisions', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission-1'));

    await fixture.contract.connect(fixture.settlement).requestRevision(1, ethers.id('revision-1'));
    const afterFirst = await fixture.contract.getBounty(1);
    expect(afterFirst.maintainerReviewDeadline).to.equal(BigInt(deadline + 7 * 24 * 60 * 60));
    expect(afterFirst.revisionCount).to.equal(1);
    expect(afterFirst.revisionExtensionUsed).to.equal(true);

    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission-2'));
    await fixture.contract.connect(fixture.settlement).requestRevision(1, ethers.id('revision-2'));
    const afterSecond = await fixture.contract.getBounty(1);
    expect(afterSecond.maintainerReviewDeadline).to.equal(afterFirst.maintainerReviewDeadline);
    expect(afterSecond.revisionCount).to.equal(2);

    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission-3'));
    await expect(fixture.contract.connect(fixture.settlement).requestRevision(1, ethers.id('revision-3')))
      .to.be.revertedWithCustomError(fixture.contract, 'MaximumRevisionsReached');
  });

  it('refunds a missed contributor delivery but protects a timely submitted pull request', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('missed'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('submitted'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(2, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(2, ethers.id('on-time'));
    await ethers.provider.send('evm_setNextBlockTimestamp', [deadline + 1]);
    await ethers.provider.send('evm_mine');

    await expect(fixture.contract.connect(fixture.owner).refundExpiredBounty(1))
      .to.emit(fixture.contract, 'BountyRefunded');
    await expect(fixture.contract.connect(fixture.owner).refundExpiredBounty(2))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidState');
  });

  it('lets only settlement resolve an unanswered review after the fixed deadline', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission'));
    const reviewDeadline = deadline + 7 * 24 * 60 * 60;
    await ethers.provider.send('evm_setNextBlockTimestamp', [reviewDeadline + 1]);
    await ethers.provider.send('evm_mine');

    await expect(fixture.contract.connect(fixture.outsider).resolveReviewTimeout(1, ethers.id('timeout'), true)).to.be.reverted;
    await fixture.contract.connect(fixture.settlement).resolveReviewTimeout(1, ethers.id('timeout'), true);
    await expect(fixture.contract.connect(fixture.settlement).releasePayment(1))
      .to.changeTokenBalance(fixture.token, fixture.developer, 19_400_000n);
  });

  it('allows one developer to hold more than five accepted bounties', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    for (let index = 1; index <= 6; index += 1) {
      await fixture.contract.connect(fixture.owner).createBounty(10_000_000n, deadline, ethers.id(`task-${index}`));
      await fixture.contract.connect(fixture.owner).assignDeveloper(index, fixture.developer.address);
    }
    expect((await fixture.contract.getBounty(6)).developer).to.equal(fixture.developer.address);
  });

  it('settles a bounty escalated to human review instead of stranding the escrow', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission'));
    await fixture.contract.connect(fixture.settlement).requestHumanReview(1, ethers.id('escalation'));

    await ethers.provider.send('evm_setNextBlockTimestamp', [deadline + 7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine');
    await expect(fixture.contract.connect(fixture.settlement).resolveReviewTimeout(1, ethers.id('timeout'), false))
      .to.changeTokenBalance(fixture.token, fixture.owner, 20_000_000n);
  });

  it('caps the bounty deadline so escrow cannot be held indefinitely', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const tooFar = Number(latest.timestamp) + 31 * 24 * 60 * 60;
    await expect(fixture.contract.connect(fixture.owner).createBounty(20_000_000n, tooFar, ethers.id('task')))
      .to.be.revertedWithCustomError(fixture.contract, 'InvalidDeadline');
  });

  it('lets an admin unwind an approved bounty only long after the review window', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission'));
    await fixture.contract.connect(fixture.settlement).approveSubmission(1, ethers.id('approval'));

    await expect(fixture.contract.connect(fixture.admin).rescueStuckBounty(1))
      .to.be.revertedWithCustomError(fixture.contract, 'DeadlineNotPassed');

    const reviewDeadline = deadline + 7 * 24 * 60 * 60;
    await ethers.provider.send('evm_setNextBlockTimestamp', [reviewDeadline + 30 * 24 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine');
    await expect(fixture.contract.connect(fixture.outsider).rescueStuckBounty(1)).to.be.reverted;
    // Already approved, so the rescue honours the approval instead of letting an
    // admin redirect the reward back to the bounty owner.
    await expect(fixture.contract.connect(fixture.admin).rescueStuckBounty(1))
      .to.changeTokenBalances(fixture.token, [fixture.developer, fixture.treasury, fixture.owner], [19_400_000n, 600_000n, 0n]);
  });

  it('keeps the approve and revise paths open after an escalation to human review', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission'));
    await fixture.contract.connect(fixture.settlement).requestHumanReview(1, ethers.id('escalation'));

    // Escalating must not strip the ordinary verdicts from the bounty.
    await fixture.contract.connect(fixture.settlement).approveSubmission(1, ethers.id('approval'));
    expect((await fixture.contract.getBounty(1)).status).to.equal(6n);
    await expect(fixture.contract.connect(fixture.settlement).releasePayment(1))
      .to.changeTokenBalance(fixture.token, fixture.developer, 19_400_000n);
  });

  it('refunds the owner when rescuing a bounty that was never approved', async function () {
    const fixture = await deployFixture();
    const latest = await ethers.provider.getBlock('latest');
    const deadline = Number(latest.timestamp) + 3600;
    await fixture.contract.connect(fixture.owner).createBounty(20_000_000n, deadline, ethers.id('task'));
    await fixture.contract.connect(fixture.owner).assignDeveloper(1, fixture.developer.address);
    await fixture.contract.connect(fixture.developer).submitWork(1, ethers.id('submission'));
    await fixture.contract.connect(fixture.settlement).requestHumanReview(1, ethers.id('escalation'));

    await ethers.provider.send('evm_setNextBlockTimestamp', [deadline + 7 * 24 * 60 * 60 + 30 * 24 * 60 * 60 + 1]);
    await ethers.provider.send('evm_mine');
    await expect(fixture.contract.connect(fixture.admin).rescueStuckBounty(1))
      .to.changeTokenBalance(fixture.token, fixture.owner, 20_000_000n);
  });
});

describe('OwlPayTestUSDC', function () {
  it('uses six decimals and lets a wallet claim test funds', async function () {
    const [owner, user] = await ethers.getSigners();
    const token = await ethers.deployContract('OwlPayTestUSDC', [owner.address]);
    expect(await token.decimals()).to.equal(6);
    await expect(token.connect(user).claim()).to.changeTokenBalance(token, user, 1_000_000_000n);
    await expect(token.connect(user).claim()).to.be.revertedWithCustomError(token, 'FaucetCooldown');
  });
});
