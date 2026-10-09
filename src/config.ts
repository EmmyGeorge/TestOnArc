/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

export const config = getDefaultConfig({
  appName: 'NairaLock',
  projectId: (import.meta.env.VITE_WC_PROJECT_ID as string | undefined) ?? '2b4d8c9e1f3a7b5d2e4f6a8c0b1d3e5f',
  chains: [arcTestnet, mainnet],
  transports: {
    [arcTestnet.id]: http(),
    [mainnet.id]: http(),
  },
})
