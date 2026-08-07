const { ethers, network } = require('hardhat');

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

async function main() {
  if (network.config.chainId !== 48816) throw new Error('Deployment is restricted to GOAT Testnet3');
  const [deployer] = await ethers.getSigners();
  const settlementAgent = readAddress('SETTLEMENT_AGENT_ADDRESS', deployer.address);
  const treasury = readAddress('PLATFORM_TREASURY_ADDRESS', deployer.address);
  const platformFeeBps = readFeeBps();
  let paymentToken = process.env.PAYMENT_TOKEN_ADDRESS || '';
  let testTokenDeployed = false;

  if (!paymentToken) {
    const token = await ethers.deployContract('OwlPayTestUSDC', [deployer.address]);
    await token.waitForDeployment();
    paymentToken = await token.getAddress();
    testTokenDeployed = true;
  } else if (!ADDRESS_PATTERN.test(paymentToken)) {
    throw new Error('PAYMENT_TOKEN_ADDRESS must be a valid address');
  }

  const contract = await ethers.deployContract('OwlPayBounty', [
    deployer.address,
    settlementAgent,
    paymentToken,
    treasury,
    platformFeeBps
  ]);
  await contract.waitForDeployment();

  console.log(JSON.stringify({
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    settlementAgent,
    treasury,
    platformFeeBps,
    paymentToken,
    testTokenDeployed,
    owlPayContract: await contract.getAddress()
  }, null, 2));
}

function readFeeBps() {
  const value = Number(process.env.PLATFORM_FEE_BPS || 300);
  if (!Number.isInteger(value) || value < 0 || value > 500) {
    throw new Error('PLATFORM_FEE_BPS must be an integer between 0 and 500');
  }
  return value;
}

function readAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!ADDRESS_PATTERN.test(value)) throw new Error(`${name} must be a valid address`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
