require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } }
  },
  networks: {
    goatTestnet: {
      url: process.env.GOAT_RPC_URL || 'https://rpc.testnet3.goat.network',
      chainId: 48816,
      accounts: privateKey ? [privateKey] : []
    }
  }
};

