const { ethers, network } = require('hardhat');

async function main() {
  if (network.config.chainId !== 48816) throw new Error('Deployment is restricted to GOAT Testnet3');
  const [deployer] = await ethers.getSigners();
  const settlementAgent = process.env.SETTLEMENT_AGENT_ADDRESS || deployer.address;
  const contract = await ethers.deployContract('OwlPayBounty', [deployer.address, settlementAgent]);
  await contract.waitForDeployment();
  console.log(JSON.stringify({
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    settlementAgent,
    contract: await contract.getAddress()
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

