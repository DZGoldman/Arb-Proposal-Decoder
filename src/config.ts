interface ArbChain {
  chainID: number;
  inboxAddress: string;
  upgradeExecutorAddress: string;
}

interface Config {
  retryableMagic: string;
  l1UpgradeExecutor: string;
  chains: ArbChain[];
//   TODO explorer URL
}

export const config: Config = {
  retryableMagic: '0xa723C008e76E379c55599D2E4d93879BeaFDa79C',
  l1UpgradeExecutor: '0x3ffFbAdAF827559da092217e474760E2b2c3CeDd',
  // l1explorerurl
  chains: [
    {
      chainID: 42162,
      inboxAddress: '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f',
      upgradeExecutorAddress: '0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827',
    },
    {
      chainID: 42170,
      inboxAddress: '0xc4448b71118c9071Bcb9734A0EAc55D18A153949',
      upgradeExecutorAddress: '0x86a02dD71363c440b21F4c0E5B2Ad01Ffe1A7482',
    },
  ],
};
