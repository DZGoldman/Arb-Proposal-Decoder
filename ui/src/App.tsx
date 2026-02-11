import { useState, useEffect, useRef } from 'react'
import { decode, type Action } from '../../src/index'
import { Interface, Contract, JsonRpcProvider } from 'ethers'
import proposalsData from '../../data/proposals.json'

interface FourByteResponse {
  count: number;
  results: Array<{
    id: number;
    text_signature: string;
    hex_signature: string;
  }>;
}

const ETHERSCAN_API_KEY = import.meta.env.VITE_ETHERSCAN_API_KEY || ''

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

function getExplorerApiUrl(chainID: number): { url: string, params: string } | null {
  if (chainID === 1 || chainID === 42161) {
    return { url: 'https://api.etherscan.io/v2/api', params: `chainid=${chainID}&apikey=${ETHERSCAN_API_KEY}` }
  }
  if (chainID === 42170) {
    return { url: 'https://arbitrum-nova.blockscout.com/api', params: '' }
  }
  return null
}

async function fetchContractABI(address: string, chainID: number): Promise<string | null> {
  const explorer = getExplorerApiUrl(chainID)
  console.log('[ABI] Attempting to fetch ABI for:', { address, chainID, explorer })

  if (!explorer) {
    console.log('[ABI] No API URL for chain', chainID)
    return null
  }

  try {
    const params = explorer.params ? `${explorer.params}&` : ''
    const url = `${explorer.url}?${params}module=contract&action=getabi&address=${address}`
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

const sourceCache = new Map<string, Promise<{ name: string, source: string } | null>>()

function fetchContractSource(address: string, chainID: number): Promise<{ name: string, source: string } | null> {
  const key = `${chainID}:${address}`
  const cached = sourceCache.get(key)
  if (cached) return cached

  const promise = fetchContractSourceUncached(address, chainID)
  sourceCache.set(key, promise)
  return promise
}

async function fetchContractSourceUncached(address: string, chainID: number): Promise<{ name: string, source: string } | null> {
  const explorer = getExplorerApiUrl(chainID)
  if (!explorer) return null

  try {
    const data = await fourByteRateLimiter.execute(async () => {
      const params = explorer.params ? `${explorer.params}&` : ''
      const url = `${explorer.url}?${params}module=contract&action=getsourcecode&address=${address}`
      const response = await fetch(url)
      return response.json()
    })

    if (data.status === '1' && data.result?.[0]?.SourceCode) {
      let rawSource: string = data.result[0].SourceCode

      // Etherscan wraps multi-file Solidity sources in {{...}} JSON
      if (rawSource.startsWith('{{')) {
        try {
          // Strip outer braces to get valid JSON
          const parsed = JSON.parse(rawSource.slice(1, -1))
          const sources: Record<string, { content: string }> = parsed.sources || parsed

          // Only keep non-dependency source files
          const projectSources = Object.entries(sources)
            .filter(([path]) => !path.startsWith('node_modules/') && !path.startsWith('@'))
            .map(([path, { content }]) => `// --- ${path} ---\n${content}`)

          rawSource = projectSources.length > 0
            ? projectSources.join('\n\n')
            : Object.values(sources)[0]?.content || rawSource
        } catch {
          // If parsing fails, use raw source as-is
        }
      }

      return {
        name: data.result[0].ContractName,
        source: rawSource,
      }
    }
  } catch (error) {
    console.error('[Source] Fetch error:', error)
  }

  return null
}

const decodeCache = new Map<string, Promise<string>>()

function decodeCallData(callData: string, address: string, chainID: number): Promise<string> {
  const key = `${address}:${callData}`
  const cached = decodeCache.get(key)
  if (cached) return cached

  const promise = decodeCallDataUncached(callData, address, chainID)
  decodeCache.set(key, promise)
  return promise
}

async function decodeCallDataUncached(callData: string, address: string, chainID: number): Promise<string> {
  console.log('[Decode] Starting decode for:', { callData: callData.slice(0, 20) + '...', address, chainID })

  // First try 4byte (works for all chains)
  console.log('[Decode] Trying 4byte...')
  const fourByteResult = await decode4Byte(callData)
  if (fourByteResult) {
    console.log('[Decode] 4byte succeeded, using result')
    return fourByteResult
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
    42170: { base: 'https://arbitrum-nova.blockscout.com/address/', suffix: '?tab=contract' },
  }

  const config = explorerConfigs[chainID] || { base: 'https://etherscan.io/address/', suffix: '#code' }
  return `${config.base}${address}${config.suffix}`
}

const getChainName = (chainID: number): string => {
  const chains: Record<number, string> = {
    1: 'Ethereum',
    42161: 'Arbitrum One',
    42170: 'Arbitrum Nova',
  }

  return chains[chainID] || `Chain ${chainID}`
}

const GOVERNOR_ADDRESS = '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9'
const GOVERNOR_ABI = [
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
]
const ARB_RPC = 'https://arb1.arbitrum.io/rpc'

interface ProposalOption {
  id: string
  label: string
  calldata: string
}

const STATIC_PROPOSALS: ProposalOption[] = proposalsData.map((p) => ({
  id: p.proposalId,
  label: p.description.slice(0, 50).replace(/\n/g, ' '),
  calldata: p.calldatas[0],
})).reverse()

const LATEST_SAVED_BLOCK = Math.max(...proposalsData.map((p) => p.blockNumber))


function ActionCard({ action, index }: { action: Action; index: number }) {
  const [autoDecoded, setAutoDecoded] = useState<string>('')
  const [isDecoding, setIsDecoding] = useState(false)
  const [contractSource, setContractSource] = useState<{ name: string, source: string } | null>(null)
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    if (!action.decodedCallData && action.callData) {
      setIsDecoding(true)
      decodeCallData(action.callData, action.address, action.chainID).then((result) => {
        setAutoDecoded(result)
        setIsDecoding(false)
      })
    }
    fetchContractSource(action.address, action.chainID).then((result) => {
      setContractSource(result)
    })
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
            {action.type === 'DELEGATECALL' ? 'Action Contract:' : 'Target:'}
          </span>
          <a
            href={getExplorerUrl(action.chainID, action.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-yellow-400 hover:text-yellow-300 bg-gray-900 px-2 py-1 rounded border border-yellow-600 text-xs break-all inline-block hover:border-yellow-400 hover:shadow-[0_0_10px_rgba(250,204,21,0.4)] transition-all"
          >
            {action.address} ↗
          </a>
          {contractSource && (
            <span className="ml-2 text-green-300 text-xs">({contractSource.name})</span>
          )}
        </div>
        {contractSource && (
          <div>
            <button
              onClick={() => setShowSource(!showSource)}
              className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-600 bg-cyan-950 px-2 py-1 rounded hover:border-cyan-400 hover:shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all uppercase tracking-wide font-bold"
            >
              {showSource ? '▼ Hide Source' : '▶ View Source'}
            </button>
            {showSource && (
              <pre className="mt-2 text-xs text-green-300 bg-gray-900 border border-green-600 rounded p-3 overflow-auto max-h-96">
                {contractSource.source}
              </pre>
            )}
          </div>
        )}
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
  const [copied, setCopied] = useState(false)
  const [showProposalDropdown, setShowProposalDropdown] = useState(false)
  const [proposalOptions, setProposalOptions] = useState<ProposalOption[]>(STATIC_PROPOSALS)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load data from URL parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const dataParam = params.get('data')
    if (dataParam) {
      setInputData(dataParam)
    }
  }, [])

  // Check for new proposals on mount
  useEffect(() => {
    async function fetchNewProposals() {
      try {
        const provider = new JsonRpcProvider(ARB_RPC)
        const governor = new Contract(GOVERNOR_ADDRESS, GOVERNOR_ABI, provider)
        const latestBlock = await provider.getBlockNumber()
        const fromBlock = LATEST_SAVED_BLOCK + 1

        if (fromBlock > latestBlock) return

        console.log(`[Proposals] Checking for new proposals from block ${fromBlock} to ${latestBlock}`)
        const events = await governor.queryFilter('ProposalCreated', fromBlock, latestBlock)

        if (events.length === 0) return console.log("No new proposals found");
        
        console.log(`[Proposals] Found ${events.length} new proposal(s)`)

        const newOptions: ProposalOption[] = events.map((event) => {
          const e = event as any
          const [proposalId, , , , , calldatas, , , description] = e.args
          return {
            id: proposalId.toString(),
            label: description.slice(0, 50).replace(/\n/g, ' '),
            calldata: calldatas[0],
          }
        }).reverse()

        setProposalOptions((prev) => [...newOptions, ...prev])
      } catch (err) {
        console.error('[Proposals] Failed to fetch new proposals:', err)
      }
    }

    fetchNewProposals()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowProposalDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const shareUrl = async () => {
    if (!inputData) return

    const url = new URL(window.location.href)
    url.searchParams.set('data', inputData)

    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setError(null)
      setActions(null)

      if (!inputData.trim()) {
        return
      }

      const trimmed = inputData.trim()

      // Check if input is a proposal ID (all digits, ~77 chars)
      let dataToDecode = trimmed
      if (/^\d{70,80}$/.test(trimmed)) {
        const staticMatch = proposalsData.find((p) => p.proposalId === trimmed)
        const liveMatch = proposalOptions.find((p) => p.id === trimmed)
        if (staticMatch) {
          dataToDecode = staticMatch.calldatas[0]
        } else if (liveMatch) {
          dataToDecode = liveMatch.calldata
        } else {
          setError(`Proposal ID not found: ${trimmed}`)
          return
        }
      }

      try {
        const result = decode(dataToDecode)
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
          <div className="flex items-center justify-center gap-4 mb-2">
            <img
              src="https://cryptologos.cc/logos/arbitrum-arb-logo.png"
              alt="Arbitrum Logo"
              className="w-16 h-16 spin-3d"
            />
            <h1 className="text-4xl font-bold text-cyan-400 tracking-wider animate-pulse">
              CONSTITUTIONAL PROPOSAL DECODER
            </h1>
            <img
              src="https://cryptologos.cc/logos/arbitrum-arb-logo.png"
              alt="Arbitrum Logo"
              className="w-16 h-16 spin-3d"
              style={{ animationDelay: '2s' }}
            />
          </div>
        </div>

        <div className="bg-black border-2 border-cyan-500 rounded-lg p-6 mb-6 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="data-input" className="block text-sm font-medium text-green-400 uppercase tracking-wide">
              {'>'} INPUT ARBITRUM PROP DATA
            </label>
            <div className="flex gap-2">
              <button
                onClick={shareUrl}
                disabled={!inputData}
                className={`px-3 py-1 text-xs border rounded uppercase tracking-wide font-bold transition-all ${
                  copied
                    ? 'bg-green-950 border-green-500 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.3)]'
                    : 'bg-cyan-950 border-cyan-500 text-cyan-400 hover:bg-cyan-900 hover:shadow-[0_0_10px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {copied ? '✓ Copied!' : 'Share URL'}
              </button>
              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => setShowProposalDropdown(!showProposalDropdown)}
                  className="px-3 py-1 text-xs bg-fuchsia-950 border border-fuchsia-500 text-fuchsia-400 rounded hover:bg-fuchsia-900 hover:shadow-[0_0_10px_rgba(217,70,239,0.3)] transition-all uppercase tracking-wide font-bold"
                >
                  Select Proposal {showProposalDropdown ? '▲' : '▼'}
                </button>
                {showProposalDropdown && (
                  <div className="absolute right-0 mt-1 w-96 max-h-64 overflow-auto bg-gray-950 border border-fuchsia-500 rounded shadow-[0_0_15px_rgba(217,70,239,0.3)] z-10">
                    {proposalOptions.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setInputData(p.calldata)
                          setShowProposalDropdown(false)
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-fuchsia-300 hover:bg-fuchsia-950 hover:text-fuchsia-200 border-b border-fuchsia-900 last:border-b-0 transition-colors"
                      >
                        <div className="truncate">{p.label}</div>
                        <div className="text-fuchsia-600 truncate text-[10px]">ID: {p.id.slice(0, 20)}...</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <textarea
            id="data-input"
            value={inputData}
            onChange={(e) => setInputData(e.target.value)}
            className="w-full h-32 px-3 py-2 text-sm bg-gray-900 border border-green-500 rounded text-green-400 focus:outline-none focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(6,182,212,0.5)] font-mono placeholder-green-700"
            placeholder="select proposal from dropdown, paste proposal id, or paste raw data (as found in tally ui) here..."
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
                <p className="mt-1 text-sm text-red-300 font-mono break-all">{error}</p>
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

        <footer className="fixed bottom-4 left-4 flex gap-4">
          <a
            href="https://github.com/DZGoldman/Arb-Proposal-Decoder"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative text-green-400 hover:text-cyan-400 transition-colors"
          >
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-green-400 bg-gray-900 border border-green-500 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">GitHub</span>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          </a>
          <a
            href="https://danielzgoldman.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative text-green-400 hover:text-cyan-400 transition-colors"
          >
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs text-green-400 bg-gray-900 border border-green-500 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">Contact</span>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </a>
          <div className="group relative text-green-400 hover:text-cyan-400 transition-colors cursor-pointer">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div className="absolute bottom-full left-0 pb-4 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto"><div className="px-3 py-2 text-xs bg-gray-900 border border-green-500 rounded whitespace-nowrap flex flex-col gap-1">
              <span className="text-green-400 font-bold mb-1">More Info</span>
              <a href="https://www.tally.xyz/gov/arbitrum" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">Tally</a>
              <a href="https://docs.arbitrum.foundation/concepts/lifecycle-anatomy-aip-proposal" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">Foundation Docs</a>
            </div></div>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default App
