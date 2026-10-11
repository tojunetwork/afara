/**
 * SOL Price Service
 *
 * Helps us get realtime SOL/USD price ticks from free public sources:
 * CoinGecko -> Binance -> Jupiter (in that fallback order).
 */

import { logger } from '../../utils/logger.js'

interface PriceCache {
  price: number
  timestamp: number
}

const CACHE_TTL_MS = 60 * 1000 // 60 secs
let priceCache: PriceCache | null = null

// Mint address of native SOL on Solana
const SOL_MINT = 'So11111111111111111111111111111111111111112'

async function fetchCoinGeckoPrice(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
  )
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)
  const data = (await res.json()) as { solana?: { usd?: number } }
  const price = data.solana?.usd
  if (typeof price !== 'number' || price <= 0 || !Number.isFinite(price))
    throw new Error('CoinGecko returned invalid price')
  return price
}

async function fetchBinancePrice(): Promise<number> {
  const res = await fetch(
    'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
  )
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)
  const data = (await res.json()) as { price?: string }
  const price = parseFloat(data.price ?? '')
  if (typeof price !== 'number' || price <= 0 || !Number.isFinite(price))
    throw new Error('Binance returned invalid price')
  return price
}

async function fetchJupiterPrice(): Promise<number> {
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`)
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`)
  const data = (await res.json()) as {
    [SOL_MINT]?: { usdPrice?: number }
  }
  const price = data[SOL_MINT]?.usdPrice
  if (typeof price !== 'number' || price <= 0 || !Number.isFinite(price))
    throw new Error('Jupiter returned invalid price')
  return price
}

const PRICE_FETCHERS: Array<[string, () => Promise<number>]> = [
  ['coingecko', fetchCoinGeckoPrice],
  ['binance', fetchBinancePrice],
  ['jupiter', fetchJupiterPrice],
]

export async function getSolPrice(): Promise<number> {
  if (priceCache && Date.now() - priceCache.timestamp < CACHE_TTL_MS)
    return priceCache.price

  const errors: string[] = []

  for (const [source, fetcher] of PRICE_FETCHERS) {
    try {
      const price = await fetcher()

      priceCache = {
        price,
        timestamp: Date.now(),
      }

      return price
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${source}: ${message}`)
      logger.warn(`SOL price source failed: ${source}`, { error: message })
    }
  }

  logger.error('All SOL price sources failed', {
    error: errors.join(' | '),
  })

  if (priceCache) {
    logger.warn('Falling back to stale price data due to an error')
    return priceCache.price
  }

  throw new Error('Unable to get SOL price')
}
