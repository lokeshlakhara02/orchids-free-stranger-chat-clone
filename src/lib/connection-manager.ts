// Connection Manager - Centralized connection state management with retry logic

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'

export interface ConnectionConfig {
  maxRetries: number
  retryDelay: number
  retryBackoffMultiplier: number
  connectionTimeout: number
  heartbeatInterval: number
}

export const DEFAULT_CONFIG: ConnectionConfig = {
  maxRetries: 5,
  retryDelay: 1000,
  retryBackoffMultiplier: 1.5,
  connectionTimeout: 30000,
  heartbeatInterval: 25000,
}

export class ConnectionManager {
  private state: ConnectionState = 'idle'
  private retryCount = 0
  private retryTimeoutId: NodeJS.Timeout | null = null
  private heartbeatId: NodeJS.Timeout | null = null
  private config: ConnectionConfig
  private listeners: Set<(state: ConnectionState) => void> = new Set()

  constructor(config: Partial<ConnectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  getState(): ConnectionState {
    return this.state
  }

  setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state
      this.notifyListeners()
    }
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state))
  }

  async retry<T>(operation: () => Promise<T>, onRetry?: (attempt: number) => void): Promise<T> {
    this.retryCount = 0
    let lastError: Error | null = null

    while (this.retryCount < this.config.maxRetries) {
      try {
        this.setState(this.retryCount === 0 ? 'connecting' : 'reconnecting')
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Connection timeout')), this.config.connectionTimeout)
          )
        ])
        this.setState('connected')
        this.retryCount = 0
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        this.retryCount++
        
        if (this.retryCount < this.config.maxRetries) {
          onRetry?.(this.retryCount)
          const delay = this.config.retryDelay * Math.pow(this.config.retryBackoffMultiplier, this.retryCount - 1)
          await new Promise(resolve => {
            this.retryTimeoutId = setTimeout(resolve, delay)
          })
        }
      }
    }

    this.setState('failed')
    throw lastError
  }

  startHeartbeat(heartbeatFn: () => Promise<void>): void {
    this.stopHeartbeat()
    this.heartbeatId = setInterval(async () => {
      try {
        await heartbeatFn()
      } catch (error) {
        console.error('Heartbeat failed:', error)
        this.setState('reconnecting')
      }
    }, this.config.heartbeatInterval)
  }

  stopHeartbeat(): void {
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId)
      this.heartbeatId = null
    }
  }

  reset(): void {
    this.stopHeartbeat()
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
      this.retryTimeoutId = null
    }
    this.retryCount = 0
    this.setState('idle')
  }

  cleanup(): void {
    this.reset()
    this.listeners.clear()
  }
}

export const createConnectionManager = (config?: Partial<ConnectionConfig>) => new ConnectionManager(config)
