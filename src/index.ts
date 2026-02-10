import { Interface, AbiCoder } from 'ethers';
import { l1TimelockABI, upgradeExecutorABI } from './abis';
import { config } from './config';

const abiCoder = new AbiCoder();
// ABI for TimelockController contract

// Example: Decode function call data

interface L1TimelockAction {
  target: string;
  payload: string;
}

enum ActionType {
  CALL = 'CALL',
  DELEGATECALL = 'DELEGATECALL',
}

interface Action {
  type: ActionType;
  address: string; // for DELEGATECALLs this is the action contract; for CALLs this is the target
  chainID: number;
  callData: string;
  decodedCallData?: string;
}

export function decodeL1TimelockSchedule(calldata: string) {
  const iface = new Interface(l1TimelockABI);

  const selector = calldata.slice(0, 10);
  const fragment = iface.getFunction(selector);
  if (!fragment) throw new Error('no function selector');

  const decoded = iface.decodeFunctionData(fragment, calldata);
  // console.log('Function:', fragment.name);

  switch (fragment.name) {
    case 'scheduleBatch': {
      return decoded[0].map((arg: any, i: number) => {
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
      throw new Error('unrecognid function name:');
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
        throw new Error('Unrecognized inbox');
      }
      return handleUpradeExecutorCall(targetAddr, payload, chain.chainID);
    }

    default:
      // TODO: this case   '0x01d5062a000000000000000000000000c4448b71118c9071bcb9734a0eac55d18a153949000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000001d64bfd58bbc5089313cbb4cac6bc0dc5cf3e849834e8a91537a8ba2ba553146000000000000000000000000000000000000000000000000000000000003f48000000000000000000000000000000000000000000000000000000000000001246e6e8a6a00000000000000000000000036d0170d92f66e8949eb276c3ac4fea64f83704d0000000000000000000000000000000000000000000000663a9d579527ee69800000000000000000000000000000000000000000000000000004f94ae6af800000000000000000000000000036d0170d92f66e8949eb276c3ac4fea64f83704d00000000000000000000000036d0170d92f66e8949eb276c3ac4fea64f83704d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', // <- wierd one
      // is a direct call to the Arb Nova inbox (fee routing thing). handle it
      throw new Error(`Unrecognid target ${l1timelockAction.target}`);
  }
};

const handleUpradeExecutorCall = (target: string, payload: string, chainID: number): Action => {
  const iface = new Interface(upgradeExecutorABI);

  const selector = payload.slice(0, 10);
  const fragment = iface.getFunction(selector);
  if (!fragment) throw new Error('no function selector');

  switch (fragment.name) {
    case 'execute': {
      const decoded = iface.decodeFunctionData(fragment, payload);
      const [actionContractAddress, actionPayload] = decoded;
      // console.log(actionContractAddress, actionPayload);

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
      throw new Error('unrecognieed error');
  }
};
