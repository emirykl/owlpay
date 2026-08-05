const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('OwlPayBounty', function () {
  async function deployFixture() {
    const [admin, settlement, owner, developer, outsider] = await ethers.getSigners();
    const token = await ethers.deployContract('MockUSDC');
    const contract = await ethers.deployContract('OwlPayBounty', [admin.address, settlement.address]);
    await token.mint(owner.address, 100_000_000n);
    await token.connect(owner).approve(await contract.getAddress(), 20_000_000n);
    return { admin, settlement, owner, developer, outsider, token, contract };
  }

  it('locks, approves and releases a bounty exactly once', async function () {
    const { settlement, owner, developer, token, contract } = await deployFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const taskHash = ethers.id('health-endpoint');
    await contract.connect(owner).createBounty(await token.getAddress(), 20_000_000n, 500_000n, deadline, taskHash);
    await contract.connect(owner).assignDeveloper(1, developer.address);
    await contract.connect(developer).submitWork(1, ethers.id('repo:commit-a'));
    await contract.connect(settlement).approveSubmission(1, ethers.id('verification-a'));
    await expect(contract.connect(settlement).releasePayment(1))
      .to.changeTokenBalance(token, developer, 20_000_000n);
    await expect(contract.connect(settlement).releasePayment(1)).to.be.reverted;
  });

  it('rejects unauthorized approval and overspending', async function () {
    const { settlement, owner, developer, outsider, token, contract } = await deployFixture();
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await contract.connect(owner).createBounty(await token.getAddress(), 20_000_000n, 500_000n, deadline, ethers.id('task'));
    await expect(contract.connect(outsider).assignDeveloper(1, developer.address)).to.be.revertedWithCustomError(contract, 'NotBountyOwner');
    await contract.connect(owner).assignDeveloper(1, developer.address);
    await expect(contract.connect(outsider).submitWork(1, ethers.id('outsider-submission'))).to.be.revertedWithCustomError(contract, 'InvalidAddress');
    await contract.connect(developer).submitWork(1, ethers.id('submission'));
    await expect(contract.connect(outsider).approveSubmission(1, ethers.id('report'))).to.be.reverted;
    await expect(contract.connect(settlement).recordVerificationSpend(1, 500_001n, ethers.id('payment')))
      .to.be.revertedWithCustomError(contract, 'VerificationBudgetExceeded');
  });
});
