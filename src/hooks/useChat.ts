import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ChatType, ChatMessage } from '@/lib/supabase'

interface UseSessionReturn {
  sessionId: string | null
  isConnected: boolean
  error: string | null
}

export function useSession(): UseSessionReturn {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('lakhari_session')
    if (stored) {
      setSessionId(stored)
      setIsConnected(true)
      return
    }

    const createSession = async () => {
      try {
        const res = await fetch('/api/session', { method: 'POST' })
        const data = await res.json()
        if (data.sessionId) {
          sessionStorage.setItem('lakhari_session', data.sessionId)
          setSessionId(data.sessionId)
          setIsConnected(true)
        } else {
          setError(data.error || 'Failed to create session')
        }
      } catch {
        setError('Connection failed')
      }
    }

    createSession()

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return

    const sendHeartbeat = async () => {
      try {
        await fetch('/api/session', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        })
      } catch (e) {
        console.error('Heartbeat failed:', e)
      }
    }

    sendHeartbeat()
    heartbeatRef.current = setInterval(sendHeartbeat, 30000)

    const handleUnload = () => {
      navigator.sendBeacon(`/api/session?sessionId=${sessionId}`, '')
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [sessionId])

  return { sessionId, isConnected, error }
}

interface MatchState {
  status: 'idle' | 'searching' | 'matched'
  roomId: string | null
  roomCode: string | null
  partnerId: string | null
}

interface UseMatchmakingReturn {
  matchState: MatchState
  startSearching: (chatType: ChatType) => Promise<void>
  cancelSearching: () => Promise<void>
  isSearching: boolean
}

export function useMatchmaking(sessionId: string | null): UseMatchmakingReturn {
  const [matchState, setMatchState] = useState<MatchState>({
    status: 'idle',
    roomId: null,
    roomCode: null,
    partnerId: null
  })
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  const checkStatus = useCallback(async () => {
    if (!sessionId) return

    try {
      const res = await fetch(`/api/matchmaking?sessionId=${sessionId}`)
      const data = await res.json()

      if (data.matched) {
        setMatchState({
          status: 'matched',
          roomId: data.roomId,
          roomCode: data.roomCode,
          partnerId: data.partnerId
        })
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }
    } catch (e) {
      console.error('Status check failed:', e)
    }
  }, [sessionId])

  const startSearching = useCallback(async (chatType: ChatType) => {
    if (!sessionId) return

    try {
      const res = await fetch('/api/matchmaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, chatType })
      })
      const data = await res.json()

      if (data.matched) {
        setMatchState({
          status: 'matched',
          roomId: data.roomId,
          roomCode: data.roomCode,
          partnerId: data.partnerId
        })
      } else {
        setMatchState(prev => ({ ...prev, status: 'searching' }))
        pollingRef.current = setInterval(checkStatus, 2000)
      }
    } catch (e) {
      console.error('Start searching failed:', e)
    }
  }, [sessionId, checkStatus])

  const cancelSearching = useCallback(async () => {
    if (!sessionId) return

    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    try {
      await fetch(`/api/matchmaking?sessionId=${sessionId}`, { method: 'DELETE' })
      setMatchState({ status: 'idle', roomId: null, roomCode: null, partnerId: null })
    } catch (e) {
      console.error('Cancel failed:', e)
    }
  }, [sessionId])

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  return {
    matchState,
    startSearching,
    cancelSearching,
    isSearching: matchState.status === 'searching'
  }
}

interface UseChatReturn {
  messages: ChatMessage[]
  sendMessage: (content: string) => Promise<void>
  endChat: () => Promise<void>
  isEnded: boolean
}

export function useChat(sessionId: string | null, roomId: string | null): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isEnded, setIsEnded] = useState(false)

  useEffect(() => {
    if (!sessionId || !roomId) return

    const loadMessages = async () => {
      try {
        const res = await fetch(`/api/chat?roomId=${roomId}&sessionId=${sessionId}`)
        const data = await res.json()
        if (data.messages) {
          setMessages(data.messages)
        }
      } catch (e) {
        console.error('Load messages failed:', e)
      }
    }

    loadMessages()

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          const newMessage = payload.new as ChatMessage
          if (newMessage.message_type !== 'signal') {
            setMessages(prev => [...prev, newMessage])
            if (newMessage.content === 'Stranger has disconnected.') {
              setIsEnded(true)
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, roomId])

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId || !roomId || !content.trim()) return

    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, sessionId, content })
      })
    } catch (e) {
      console.error('Send message failed:', e)
    }
  }, [sessionId, roomId])

  const endChat = useCallback(async () => {
    if (!sessionId || !roomId) return

    try {
      await fetch(`/api/chat?roomId=${roomId}&sessionId=${sessionId}`, { method: 'DELETE' })
      setIsEnded(true)
    } catch (e) {
      console.error('End chat failed:', e)
    }
  }, [sessionId, roomId])

  return { messages, sendMessage, endChat, isEnded }
}

interface Stats {
  online: number
  searching: number
  activeChats: number
}

export function useStats(): Stats {
  const [stats, setStats] = useState<Stats>({ online: 0, searching: 0, activeChats: 0 })

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats')
        const data = await res.json()
        setStats({
          online: data.online || 0,
          searching: data.searching || 0,
          activeChats: data.activeChats || 0
        })
      } catch (e) {
        console.error('Stats fetch failed:', e)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 10000)

    return () => clearInterval(interval)
  }, [])

  return stats
}
