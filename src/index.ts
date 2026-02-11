import { Interface, AbiCoder } from 'ethers';
import { l1TimelockABI, upgradeExecutorABI, arbSysABI } from './abis';
import { config } from './config';

const abiCoder = new AbiCoder();
// ABI for TimelockController contract

// Example: Decode function call data

interface L1TimelockAction {
  target: string;
  payload: string;
}

const ActionType = {
  CALL: 'CALL',
  DELEGATECALL: 'DELEGATECALL',
} as const
type ActionType = typeof ActionType[keyof typeof ActionType]

export interface Action {
  type: ActionType;
  address: string; // for DELEGATECALLs this is the action contract; for CALLs this is the target
  chainID: number;
  callData: string;
  decodedCallData?: string;
}

export function decode(calldata: string) {
  const iface = new Interface(arbSysABI);

  const selector = calldata.slice(0, 10);
  const fragment = iface.getFunction(selector);
  if (fragment && fragment.name === 'sendTxToL1') {
    const decoded = iface.decodeFunctionData(fragment, calldata);
    return decodeL1TimelockSchedule(decoded[1]);
  } else {
    return decodeL1TimelockSchedule(calldata);
  }
}

export function decodeL1TimelockSchedule(calldata: string) {
  const iface = new Interface(l1TimelockABI);

  const selector = calldata.slice(0, 10);
  const fragment = iface.getFunction(selector);
  if (!fragment) throw new Error('Could not find L1Timelock method');

  const decoded = iface.decodeFunctionData(fragment, calldata);

  switch (fragment.name) {
    case 'scheduleBatch': {
      return decoded[0].map((_: any, i: number) => {
        return handleScheduleCall({
          target: decoded[0][i],
          payload: decoded[2][i],
        });
      });
    }
    case 'schedule': {
      return [
        handleScheduleCall({
          target: decoded[0],
          payload: decoded[2],
        }),
      ];
    }
    default:
      throw new Error('Unrecognized L1Timelock method name');
  }
}

const handleScheduleCall = (l1timelockAction: L1TimelockAction) => {
  switch (l1timelockAction.target) {
    case config.l1UpgradeExecutor: {
      return handleUpradeExecutorCall(l1timelockAction.target, l1timelockAction.payload, 1);
      //
    }
    case config.retryableMagic: {
      const [inbox, targetAddr, _, __, ___, payload] = abiCoder.decode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes'],
        l1timelockAction.payload
      );

      const chain = config.chains.find(entry => entry.inboxAddress === inbox);
      if (!chain) {
        throw new Error(`Unrecognized inbox ${inbox}`);
      }
      return handleUpradeExecutorCall(targetAddr, payload, chain.chainID);
    }

    default:
      const isInboxAddress = config.chains.some(
        chain => chain.inboxAddress === l1timelockAction.target
      );

      if (isInboxAddress) {
        throw new Error(`L1Timelock calls directly to inbox not currently supported`);
      }

      throw new Error(`Unrecognized L1timelock target ${l1timelockAction.target}`);
  }
};

const handleUpradeExecutorCall = (_target: string, payload: string, chainID: number): Action => {
  const iface = new Interface(upgradeExecutorABI);

  const selector = payload.slice(0, 10);
  const fragment = iface.getFunction(selector);
  if (!fragment) throw new Error('Could not get UpgradeExecutor method');

  switch (fragment.name) {
    case 'execute': {
      const decoded = iface.decodeFunctionData(fragment, payload);
      const [actionContractAddress, actionPayload] = decoded;

      return {
        type: ActionType.DELEGATECALL,
        address: actionContractAddress,
        callData: actionPayload,
        chainID,
        decodedCallData: actionPayload === '0xb147f40c' ? 'perform()' : '', // TODO: handle more cases
      };
    }
    case 'executeCall': {
      const decoded = iface.decodeFunctionData(fragment, payload);
      const [address, callData] = decoded;

      return {
        type: ActionType.CALL,
        address,
        callData,
        chainID,
        decodedCallData: '', // TODO
      };
    }

    default:
      throw new Error(`Unrecognized UpgradeExecutor Method ${fragment.name}`);
  }
};
