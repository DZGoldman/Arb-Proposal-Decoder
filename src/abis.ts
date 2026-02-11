

 export const l1TimelockABI = [
    'function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)',
    'function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)',
  ];

export const upgradeExecutorABI = [
  'function execute(address upgrade, bytes upgradeCallData) payable',
  'function executeCall(address target, bytes targetCallData) payable',
];

export const arbSysABI = [
  'function arbBlockNumber() external view returns (uint256)',
  'function arbBlockHash(uint256 arbBlockNum) external view returns (bytes32)',
  'function arbChainID() external view returns (uint256)',
  'function arbOSVersion() external view returns (uint256)',
  'function getStorageGasAvailable() external view returns (uint256)',
  'function isTopLevelCall() external view returns (bool)',
  'function mapL1SenderContractAddressToL2Alias(address sender, address unused) external pure returns (address)',
  'function wasMyCallersAddressAliased() external view returns (bool)',
  'function myCallersAddressWithoutAliasing() external view returns (address)',
  'function withdrawEth(address destination) external payable returns (uint256)',
  'function sendTxToL1(address destination, bytes data) external payable returns (uint256)',
  'function sendMerkleTreeState() external view returns (uint256 size, bytes32 root, bytes32[] partials)',
  'event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)',
  'event L2ToL1Transaction(address caller, address indexed destination, uint256 indexed uniqueId, uint256 indexed batchNumber, uint256 indexInBatch, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)',
  'event SendMerkleUpdate(uint256 indexed reserved, bytes32 indexed hash, uint256 indexed position)',
];