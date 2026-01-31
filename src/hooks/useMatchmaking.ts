import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { getOrCreateUserId } from '@/lib/session-manager'
import { createError, parseError, logError, type AppError } from '@/lib/error-handler'

export type MatchmakingStatus = 'idle' | 'searching' | 'matched' | 'disconnected' | 'error'

interface MatchmakingState {
  status: MatchmakingStatus
  partnerId: string | null
  myId: string
  error: AppError | null
}

interface UseMatchmakingReturn extends MatchmakingState {
  findPartner: () => Promise<void>
  disconnect: () => Promise<void>
  clearError: () => void
  retry: () => Promise<void>
}

const MAX_RETRIES = 3
const POLL_INTERVAL = 2000
const INITIAL_RETRY_DELAY = 1000

export function useMatchmaking(chatType: 'text' | 'video'): UseMatchmakingReturn {
  const [state, setState] = useState<MatchmakingState>({
    status: 'idle',
    partnerId: null,
    myId: '',
    error: null
  })
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const isSearchingRef = useRef(false)
  const retryCountRef = useRef(0)
  const mountedRef = useRef(true)

  // Safe state update that checks if component is still mounted
  const safeSetState = useCallback((updater: Partial<MatchmakingState> | ((prev: MatchmakingState) => MatchmakingState)) => {
    if (!mountedRef.current) return
    setState(prev => typeof updater === 'function' ? updater(prev) : { ...prev, ...updater })
  }, [])

  const checkMatch = useCallback(async (): Promise<string | null> => {
    if (!state.myId) return null
    
    try {
      const res = await fetch(`/api/matchmaking?sessionId=${encodeURIComponent(state.myId)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      
      const data = await res.json()
      
      if (data.matched && data.partnerId) {
        return data.partnerId
      }
      return null
    } catch (error) {
      const appError = parseError(error)
      logError(appError, 'checkMatch')
      return null
    }
  }, [state.myId])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const stopSubscription = useCallback(() => {
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current)
      subscriptionRef.current = null
    }
  }, [])

  const handleMatchFound = useCallback((partnerId: string) => {
    if (!mountedRef.current) return
    
    stopPolling()
    isSearchingRef.current = false
    retryCountRef.current = 0
    
    safeSetState({
      partnerId,
      status: 'matched',
      error: null
    })
  }, [stopPolling, safeSetState])

  const findPartner = useCallback(async () => {
    if (!state.myId || isSearchingRef.current) return
    
    isSearchingRef.current = true
    safeSetState({
      status: 'searching',
      partnerId: null,
      error: null
    })

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      
      const res = await fetch('/api/matchmaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.myId, chatType }),
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json()

      if (data.matched && data.partnerId) {
        handleMatchFound(data.partnerId)
        return
      }

      // Set up real-time subscription for match updates
      stopSubscription()
      
      const channel = supabase
        .channel(`matchmaking:${state.myId}`, {
          config: { broadcast: { self: false } }
        })
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'matchmaking_queue',
            filter: `session_id=eq.${state.myId}`
          },
          (payload) => {
            const newData = payload.new as { matched_with?: string }
            if (newData.matched_with) {
              handleMatchFound(newData.matched_with)
            }
          }
        )
        .subscribe()

      subscriptionRef.current = channel

      // Set up polling as fallback
      pollingRef.current = setInterval(async () => {
        if (!mountedRef.current || !isSearchingRef.current) {
          stopPolling()
          return
        }
        
        const partner = await checkMatch()
        if (partner) {
          handleMatchFound(partner)
        }
      }, POLL_INTERVAL)

    } catch (error) {
      isSearchingRef.current = false
      
      const appError = error instanceof Error && error.name === 'AbortError'
        ? createError('CONNECTION_TIMEOUT')
        : parseError(error)
      
      logError(appError, 'findPartner')
      
      // Auto-retry with exponential backoff
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current - 1)
        
        setTimeout(() => {
          if (mountedRef.current) {
            findPartner()
          }
        }, delay)
      } else {
        safeSetState({
          status: 'error',
          error: createError('MATCHMAKING_FAILED')
        })
      }
    }
  }, [state.myId, chatType, checkMatch, handleMatchFound, stopPolling, stopSubscription, safeSetState])

  const disconnect = useCallback(async () => {
    stopPolling()
    stopSubscription()
    isSearchingRef.current = false
    
    if (state.myId) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)
        
        await fetch(`/api/matchmaking?sessionId=${encodeURIComponent(state.myId)}`, {
          method: 'DELETE',
          signal: controller.signal
        })
        
        clearTimeout(timeoutId)
      } catch (error) {
        // Silent fail on disconnect - not critical
        console.error('Disconnect cleanup failed:', error)
      }
    }
    
    safeSetState({
      status: 'disconnected',
      partnerId: null,
      error: null
    })
  }, [state.myId, stopPolling, stopSubscription, safeSetState])

  const clearError = useCallback(() => {
    safeSetState({ error: null })
  }, [safeSetState])

  const retry = useCallback(async () => {
    retryCountRef.current = 0
    await disconnect()
    setTimeout(() => findPartner(), 500)
  }, [disconnect, findPartner])

  // Initialize user ID on mount
  useEffect(() => {
    mountedRef.current = true
    const userId = getOrCreateUserId()
    setState(prev => ({ ...prev, myId: userId }))
    
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling()
      stopSubscription()
    }
  }, [stopPolling, stopSubscription])

  // Handle page visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isSearchingRef.current) {
        // Pause polling when tab is hidden to save resources
        stopPolling()
      } else if (!document.hidden && state.status === 'searching' && !pollingRef.current) {
        // Resume polling when tab becomes visible
        pollingRef.current = setInterval(async () => {
          const partner = await checkMatch()
          if (partner) {
            handleMatchFound(partner)
          }
        }, POLL_INTERVAL)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [state.status, checkMatch, handleMatchFound, stopPolling])

  // Handle beforeunload to cleanup
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (state.myId) {
        navigator.sendBeacon(
          `/api/matchmaking?sessionId=${encodeURIComponent(state.myId)}`,
          JSON.stringify({ _method: 'DELETE' })
        )
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [state.myId])

  return {
    ...state,
    findPartner,
    disconnect,
    clearError,
    retry
  }
}
