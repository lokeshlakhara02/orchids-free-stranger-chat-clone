import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

export type MatchmakingStatus = 'idle' | 'searching' | 'matched' | 'disconnected'

export function useMatchmaking(chatType: 'text' | 'video') {
  const [status, setStatus] = useState<MatchmakingStatus>('idle')
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [myId, setMyId] = useState<string>('')
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const isSearchingRef = useRef(false)

  const checkMatch = useCallback(async () => {
    if (!myId) return null
    
    try {
      const res = await fetch(`/api/matchmaking?sessionId=${encodeURIComponent(myId)}`)
      const data = await res.json()
      
      if (data.matched && data.partnerId) {
        return data.partnerId
      }
      return null
    } catch {
      return null
    }
  }, [myId])

  const findPartner = useCallback(async () => {
    if (!myId || isSearchingRef.current) return
    
    isSearchingRef.current = true
    setStatus('searching')
    setPartnerId(null)

    try {
      const res = await fetch('/api/matchmaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: myId, chatType })
      })
      const data = await res.json()

      if (data.matched && data.partnerId) {
        setPartnerId(data.partnerId)
        setStatus('matched')
        isSearchingRef.current = false
        return
      }
    } catch (err) {
      console.error('Matchmaking error:', err)
    }

    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current)
    }
    
    const channel = supabase
      .channel(`matchmaking:${myId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matchmaking_queue',
          filter: `session_id=eq.${myId}`
        },
        (payload) => {
          const newData = payload.new as { matched_with?: string }
          if (newData.matched_with) {
            setPartnerId(newData.matched_with)
            setStatus('matched')
            isSearchingRef.current = false
            
            if (pollingRef.current) {
              clearInterval(pollingRef.current)
              pollingRef.current = null
            }
          }
        }
      )
      .subscribe()

    subscriptionRef.current = channel

    pollingRef.current = setInterval(async () => {
      const partner = await checkMatch()
      if (partner) {
        setPartnerId(partner)
        setStatus('matched')
        isSearchingRef.current = false
        
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }
    }, 2000)

  }, [myId, chatType, checkMatch])

  const disconnect = useCallback(async () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current)
      subscriptionRef.current = null
    }
    
    if (myId) {
      try {
        await fetch(`/api/matchmaking?sessionId=${encodeURIComponent(myId)}`, {
          method: 'DELETE'
        })
      } catch {}
    }
    
    isSearchingRef.current = false
    setStatus('idle')
    setPartnerId(null)
  }, [myId])

  useEffect(() => {
    let id = sessionStorage.getItem('lakhari_user_id')
    if (!id) {
      id = `user_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`
      sessionStorage.setItem('lakhari_user_id', id)
    }
    setMyId(id)
  }, [])

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current)
      }
    }
  }, [])

  return { status, partnerId, myId, findPartner, disconnect }
}
