import { ethers } from 'ethers'
import { writeFileSync, mkdirSync } from 'fs'

const GOVERNOR = '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9'
const START_BLOCK = 98424025
const CHUNK_SIZE = 100_000 // Arbitrum RPC block range limit

const abi = [
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
]

async function main() {
  const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc')
  const contract = new ethers.Contract(GOVERNOR, abi, provider)

  const latestBlock = await provider.getBlockNumber()
  console.log(`Querying blocks ${START_BLOCK} to ${latestBlock}...`)

  const allProposals: any[] = []

  for (let from = START_BLOCK; from <= latestBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, latestBlock)
    console.log(`  Chunk ${from}-${to}...`)

    const events = await contract.queryFilter('ProposalCreated', from, to)

    for (const event of events) {
      const e = event as ethers.EventLog
      const [proposalId, proposer, targets, values, signatures, calldatas, startBlock, endBlock, description] = e.args

      allProposals.push({
        proposalId: proposalId.toString(),
        proposer,
        targets: [...targets],
        values: values.map((v: bigint) => v.toString()),
        signatures: [...signatures],
        calldatas: [...calldatas],
        startBlock: Number(startBlock),
        endBlock: Number(endBlock),
        description,
        blockNumber: e.blockNumber,
        transactionHash: e.transactionHash,
      })
    }
  }

  console.log(`Found ${allProposals.length} proposals`)

  mkdirSync('data', { recursive: true })
  writeFileSync(
    'data/proposals.json',
    JSON.stringify(allProposals, null, 2),
  )
  console.log('Saved to data/proposals.json')
}

main().catch(console.error)
