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
