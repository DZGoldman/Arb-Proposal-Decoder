import { ethers } from 'ethers'
import { writeFileSync, mkdirSync } from 'fs'

const CORE_GOVERNOR = '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9'
const TREASURY_GOVERNOR = '0x789fC99093B09aD01C34DC7251D0C89ce743e5a4'
const START_BLOCK = 98424025
const CHUNK_SIZE = 5_000_000 // Arbitrum RPC block range limit

const abi = [
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
]

async function fetchProposals(provider: ethers.JsonRpcProvider, governorAddress: string, latestBlock: number) {
  const contract = new ethers.Contract(governorAddress, abi, provider)
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

  return allProposals
}

async function main() {
  const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc')
  const latestBlock = await provider.getBlockNumber()

  mkdirSync('data', { recursive: true })

  console.log(`Fetching Core Governor proposals (blocks ${START_BLOCK} to ${latestBlock})...`)
  const coreProposals = await fetchProposals(provider, CORE_GOVERNOR, latestBlock)
  console.log(`Found ${coreProposals.length} core proposals`)
  writeFileSync('data/proposals.json', JSON.stringify(coreProposals, null, 2))
  console.log('Saved to data/proposals.json')

  console.log(`\nFetching Treasury Governor proposals (blocks ${START_BLOCK} to ${latestBlock})...`)
  const treasuryProposals = await fetchProposals(provider, TREASURY_GOVERNOR, latestBlock)
  console.log(`Found ${treasuryProposals.length} treasury proposals`)
  writeFileSync('data/treasury-proposals.json', JSON.stringify(treasuryProposals, null, 2))
  console.log('Saved to data/treasury-proposals.json')
}

main().catch(console.error)
