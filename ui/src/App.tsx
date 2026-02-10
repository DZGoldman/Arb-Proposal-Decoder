import { useState } from 'react'
import { decodeL1TimelockSchedule } from './decoder'

interface Action {
  type: string;
  address: string;
  chainID: number;
  callData: string;
  decodedCallData?: string;
}

function App() {
  const [inputData, setInputData] = useState('')
  const [actions, setActions] = useState<Action[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleDecode = () => {
    setError(null)
    setActions(null)

    if (!inputData.trim()) {
      setError('Please paste data to decode')
      return
    }

    try {
      const result = decodeL1TimelockSchedule(inputData.trim())
      setActions(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8 text-center">
          Arbitrum DAO Proposal Decoder
        </h1>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <label htmlFor="data-input" className="block text-sm font-medium text-gray-700 mb-2">
            Paste proposal data blob:
          </label>
          <textarea
            id="data-input"
            value={inputData}
            onChange={(e) => setInputData(e.target.value)}
            className="w-full h-32 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
            placeholder="0x8f2a0bb0..."
          />
          <button
            onClick={handleDecode}
            className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md transition-colors duration-200"
          >
            Decode
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error decoding data</h3>
                <p className="mt-1 text-sm text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {actions && actions.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              Decoded Actions ({actions.length})
            </h2>
            <div className="space-y-4">
              {actions.map((action, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-gray-800">Action {index + 1}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      action.type === 'DELEGATECALL'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {action.type}
                    </span>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Chain ID:</span>
                      <span className="ml-2 text-gray-600">{action.chainID}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Address:</span>
                      <code className="ml-2 text-gray-600 bg-gray-50 px-2 py-1 rounded text-xs break-all">
                        {action.address}
                      </code>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Call Data:</span>
                      <code className="ml-2 block mt-1 text-gray-600 bg-gray-50 px-2 py-1 rounded text-xs break-all">
                        {action.callData}
                      </code>
                    </div>
                    {action.decodedCallData && (
                      <div>
                        <span className="font-medium text-gray-700">Decoded Call Data:</span>
                        <code className="ml-2 text-gray-600 bg-blue-50 px-2 py-1 rounded text-xs">
                          {action.decodedCallData}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
