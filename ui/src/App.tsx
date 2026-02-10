import { useState, useEffect } from 'react'
import { decodeL1TimelockSchedule } from './decoder'
import { Interface } from 'ethers'

interface Action {
  type: string;
  address: string;
  chainID: number;
  callData: string;
  decodedCallData?: string;
}

interface FourByteResponse {
  count: number;
  results: Array<{
    id: number;
    text_signature: string;
    hex_signature: string;
  }>;
}

const ETHERSCAN_API_KEY = 'EIW92DMXJHRPQMTZ9KHMCGN7SSCJAYIQ84' // Free tier public key

// Rate limiter for 4byte API (max 3 calls/sec)
class RateLimiter {
  private queue: Array<{ fn: () => Promise<any>; resolve: (value: any) => void; reject: (error: any) => void }> = []
  private processing = false
  private lastCallTime = 0
  private readonly minInterval = 350 // ~3 calls per second with buffer

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject })
      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const now = Date.now()
      const timeSinceLastCall = now - this.lastCallTime

      if (timeSinceLastCall < this.minInterval) {
        await new Promise(resolve => setTimeout(resolve, this.minInterval - timeSinceLastCall))
      }

      const item = this.queue.shift()
      if (item) {
        this.lastCallTime = Date.now()
        try {
          const result = await item.fn()
          item.resolve(result)
        } catch (error) {
          item.reject(error)
        }
      }
    }

    this.processing = false
  }
}

const fourByteRateLimiter = new RateLimiter()

function getExplorerApiUrl(chainID: number): string | null {
  // Etherscan V2 is unified across all chains
  const supportedChains = [1, 42161, 42161] // Ethereum, Arbitrum One
  if (supportedChains.includes(chainID)) {
    return 'https://api.etherscan.io/v2/api'
  }
  // Nova (42170) not supported
  return null
}

async function fetchContractABI(address: string, chainID: number): Promise<string | null> {
  const apiUrl = getExplorerApiUrl(chainID)
  console.log('[ABI] Attempting to fetch ABI for:', { address, chainID, apiUrl })

  if (!apiUrl) {
    console.log('[ABI] No API URL for chain', chainID)
    return null
  }

  try {
    // V2 API format: unified endpoint with chainid parameter
    const url = `${apiUrl}?chainid=${chainID}&module=contract&action=getabi&address=${address}&apikey=${ETHERSCAN_API_KEY}`
    console.log('[ABI] Fetching from:', url)

    const response = await fetch(url)
    const data = await response.json()

    console.log('[ABI] Response for chainID', chainID, ':', data)

    if (data.status === '1' && data.result) {
      console.log('[ABI] Successfully fetched ABI')
      return data.result
    } else {
      console.log('[ABI] Failed to fetch ABI:', data.message || data.result)
    }
  } catch (error) {
    console.error('[ABI] Fetch error:', error)
  }

  return null
}

async function decodeWithABI(callData: string, address: string, chainID: number): Promise<string> {
  const abiJson = await fetchContractABI(address, chainID)
  if (!abiJson) return ''

  try {
    const abi = JSON.parse(abiJson)
    const iface = new Interface(abi)
    const selector = callData.slice(0, 10)

    // Find the function in the ABI
    const fragment = iface.getFunction(selector)
    if (!fragment) return ''

    // Decode the function data
    const decoded = iface.decodeFunctionData(fragment, callData)

    // Format the output
    const params = fragment.inputs.map((input, i) => {
      return `${input.name || `arg${i}`}: ${decoded[i]}`
    }).join(', ')

    return `${fragment.name}(${params})`
  } catch (error) {
    console.error('ABI decoding failed:', error)
    return ''
  }
}

async function decode4Byte(callData: string): Promise<string> {
  if (!callData || callData.length < 10) {
    return ''
  }

  const selector = callData.slice(0, 10)
  console.log('[4byte] Attempting to decode selector:', selector)

  try {
    // Use rate limiter to avoid hitting 3 calls/sec limit
    const data: FourByteResponse = await fourByteRateLimiter.execute(async () => {
      const response = await fetch(
        `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`
      )
      return response.json()
    })

    console.log('[4byte] Response:', data)

    if (data.results && data.results.length > 0) {
      const signature = data.results[0].text_signature
      console.log('[4byte] Found signature:', signature)

      // Try to decode the parameters
      try {
        const iface = new Interface([`function ${signature}`])
        const decoded = iface.decodeFunctionData(signature.split('(')[0], callData)

        // Format the decoded parameters
        const params = signature.match(/\(([^)]+)\)/)?.[1].split(',') || []
        const formattedParams = params.map((param, i) => {
          const value = decoded[i]
          return `${param.trim()}: ${value}`
        }).join(', ')

        const result = `${signature.split('(')[0]}(${formattedParams})`
        console.log('[4byte] Decoded successfully:', result)
        return result
      } catch (err) {
        console.log('[4byte] Decoding failed, returning signature only:', err)
        // If decoding fails, just return the signature
        return signature
      }
    } else {
      console.log('[4byte] No results found')
    }
  } catch (error) {
    console.error('[4byte] Lookup failed:', error)
  }

  return ''
}

async function decodeCallData(callData: string, address: string, chainID: number): Promise<string> {
  console.log('[Decode] Starting decode for:', { callData: callData.slice(0, 20) + '...', address, chainID })

  // First try 4byte (works for all chains)
  console.log('[Decode] Trying 4byte...')
  const fourByteResult = await decode4Byte(callData)
  if (fourByteResult) {
    console.log('[Decode] 4byte succeeded, using result')
    return fourByteResult
  }

  // Skip Etherscan API for Nova
  if (chainID === 42170) {
    console.log('[Decode] Skipping Etherscan for Nova (chain 42170)')
    return ''
  }

  // Fallback to ABI lookup (V2 API) for L1 and Arb One only
  console.log('[Decode] 4byte failed, trying ABI lookup...')
  const abiResult = await decodeWithABI(callData, address, chainID)
  if (abiResult) {
    console.log('[Decode] ABI decode succeeded')
  } else {
    console.log('[Decode] ABI decode failed, no result')
  }
  return abiResult
}

const getExplorerUrl = (chainID: number, address: string): string => {
  const explorerConfigs: Record<number, { base: string; suffix: string }> = {
    1: { base: 'https://etherscan.io/address/', suffix: '#code' },
    42161: { base: 'https://arbiscan.io/address/', suffix: '#code' },
    42161: { base: 'https://arbiscan.io/address/', suffix: '#code' },
    42170: { base: 'https://arbitrum-nova.blockscout.com/address/', suffix: '?tab=contract' },
  }

  const config = explorerConfigs[chainID] || { base: 'https://etherscan.io/address/', suffix: '#code' }
  return `${config.base}${address}${config.suffix}`
}

const getChainName = (chainID: number): string => {
  const chains: Record<number, string> = {
    1: 'Ethereum',
    42161: 'Arbitrum One',
    42161: 'Arbitrum One',
    42170: 'Arbitrum Nova',
  }

  return chains[chainID] || `Chain ${chainID}`
}

function ActionCard({ action, index }: { action: Action; index: number }) {
  const [autoDecoded, setAutoDecoded] = useState<string>('')
  const [isDecoding, setIsDecoding] = useState(false)

  useEffect(() => {
    if (!action.decodedCallData && action.callData) {
      setIsDecoding(true)
      decodeCallData(action.callData, action.address, action.chainID).then((result) => {
        setAutoDecoded(result)
        setIsDecoding(false)
      })
    }
  }, [action.callData, action.decodedCallData, action.address, action.chainID])

  const displayDecoded = action.decodedCallData || autoDecoded

  return (
    <div className="border-2 border-green-500 bg-gray-950 rounded-lg p-4 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-green-400">ACTION #{index + 1}</h3>
        <span className={`px-3 py-1 border-2 rounded text-xs font-bold uppercase tracking-wider ${
          action.type === 'DELEGATECALL'
            ? 'border-fuchsia-500 text-fuchsia-400 bg-fuchsia-950 shadow-[0_0_10px_rgba(217,70,239,0.3)]'
            : 'border-lime-500 text-lime-400 bg-lime-950 shadow-[0_0_10px_rgba(132,204,22,0.3)]'
        }`}>
          {action.type === 'DELEGATECALL' ? 'Action Contract Call' : action.type}
        </span>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-baseline">
          <span className="font-bold text-cyan-400 uppercase">Chain:</span>
          <span className="ml-2 text-green-400">{getChainName(action.chainID)} (ID: {action.chainID})</span>
        </div>
        <div>
          <span className="font-bold text-cyan-400 uppercase">
            {action.type === 'DELEGATECALL' ? 'Action Contract Address:' : 'Address:'}
          </span>
          <a
            href={getExplorerUrl(action.chainID, action.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-yellow-400 hover:text-yellow-300 bg-gray-900 px-2 py-1 rounded border border-yellow-600 text-xs break-all inline-block hover:border-yellow-400 hover:shadow-[0_0_10px_rgba(250,204,21,0.4)] transition-all"
          >
            {action.address} ↗
          </a>
        </div>
        {displayDecoded ? (
          <div>
            <span className="font-bold text-cyan-400 uppercase">Decoded Call Data:</span>
            <code className="ml-2 text-cyan-300 bg-cyan-950 px-2 py-1 rounded border border-cyan-600 text-xs break-all block mt-1">
              {displayDecoded}
            </code>
          </div>
        ) : isDecoding ? (
          <div>
            <span className="font-bold text-cyan-400 uppercase">Call Data:</span>
            <code className="ml-2 block mt-1 text-green-300 bg-gray-900 px-2 py-1 rounded border border-green-600 text-xs break-all">
              {action.callData}
            </code>
            <div className="mt-1 text-xs text-cyan-400 animate-pulse">Decoding...</div>
          </div>
        ) : (
          <div>
            <span className="font-bold text-cyan-400 uppercase">Call Data:</span>
            <code className="ml-2 block mt-1 text-green-300 bg-gray-900 px-2 py-1 rounded border border-green-600 text-xs break-all">
              {action.callData}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  const [inputData, setInputData] = useState('')
  const [actions, setActions] = useState<Action[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setError(null)
      setActions(null)

      if (!inputData.trim()) {
        return
      }

      try {
        const result = decodeL1TimelockSchedule(inputData.trim())
        setActions(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred')
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [inputData])

  return (
    <div className="min-h-screen bg-black py-8 px-4 font-mono">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-cyan-400 mb-2 tracking-wider animate-pulse">
            ARBITRUM DAO PROPOSAL DECODER
          </h1>
          <div className="text-green-500 text-xs">{'>'} CHAIN ANALYSIS TERMINAL v1.0</div>
        </div>

        <div className="bg-black border-2 border-cyan-500 rounded-lg p-6 mb-6 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
          <label htmlFor="data-input" className="block text-sm font-medium text-green-400 mb-2 uppercase tracking-wide">
            {'>'} INPUT DATA BLOB
          </label>
          <textarea
            id="data-input"
            value={inputData}
            onChange={(e) => setInputData(e.target.value)}
            className="w-full h-32 px-3 py-2 text-sm bg-gray-900 border border-green-500 rounded text-green-400 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(6,182,212,0.5)] font-mono placeholder-green-700"
            placeholder="0x8f2a0bb0..."
          />
        </div>

        {error && (
          <div className="bg-red-950 border-2 border-red-500 rounded-lg p-4 mb-6 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <div className="text-red-400 text-xl">⚠</div>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-bold text-red-400 uppercase tracking-wide">ERROR</h3>
                <p className="mt-1 text-sm text-red-300 font-mono">{error}</p>
              </div>
            </div>
          </div>
        )}

        {actions && actions.length > 0 && (
          <div className="bg-black border-2 border-cyan-500 rounded-lg p-6 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
            <h2 className="text-2xl font-bold text-cyan-400 mb-4 uppercase tracking-wide">
              {'>'} DECODED ACTIONS [{actions.length}]
            </h2>
            <div className="space-y-4">
              {actions.map((action, index) => (
                <ActionCard key={index} action={action} index={index} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
