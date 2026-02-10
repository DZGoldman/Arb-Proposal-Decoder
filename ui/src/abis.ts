

 export const l1TimelockABI = [
    'function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)',
    'function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)',
  ];

export const upgradeExecutorABI = [
  'function execute(address upgrade, bytes upgradeCallData) payable',
  'function executeCall(address target, bytes targetCallData) payable',
];