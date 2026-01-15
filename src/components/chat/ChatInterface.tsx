"use client"

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useMatchmaking } from '@/hooks/useMatchmaking'
import { useWebRTC } from '@/hooks/useWebRTC'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card } from '@/components/ui/card'
import { Send, SkipForward, X, Mic, MicOff, Video, VideoOff, Flag, AlertTriangle, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Message {
  id: string
  sender: 'me' | 'stranger' | 'system'
  text: string
  timestamp: Date
}

function VideoDisplay({ 
  stream, 
  label, 
  muted = false,
  isLocal = false,
  showConnectionStatus = false,
  connectionState = 'idle'
}: { 
  stream: MediaStream | null
  label: string
  muted?: boolean
  isLocal?: boolean
  showConnectionStatus?: boolean
  connectionState?: 'idle' | 'connecting' | 'connected' | 'failed'
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasVideo, setHasVideo] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (stream) {
      video.srcObject = stream
      video.play().catch(() => {})
      
      const checkVideo = () => {
        const videoTracks = stream.getVideoTracks()
        setHasVideo(videoTracks.length > 0 && videoTracks.some(t => t.readyState === 'live'))
      }
      checkVideo()
      
      stream.getVideoTracks().forEach(track => {
        track.onended = checkVideo
        track.onmute = checkVideo
        track.onunmute = checkVideo
      })
    } else {
      video.srcObject = null
      setHasVideo(false)
    }
  }, [stream])

  const getStatusDisplay = () => {
    if (connectionState === 'connected' && hasVideo) return { color: 'bg-green-500', text: 'Connected' }
    if (connectionState === 'connected' && !hasVideo) return { color: 'bg-yellow-500 animate-pulse', text: 'Video loading...' }
    if (connectionState === 'connecting') return { color: 'bg-orange-500 animate-pulse', text: 'Connecting...' }
    if (connectionState === 'failed') return { color: 'bg-red-500', text: 'Connection failed' }
    return { color: 'bg-orange-500 animate-pulse', text: 'Searching...' }
  }

  const statusDisplay = getStatusDisplay()

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-zinc-900">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${isLocal ? 'scale-x-[-1]' : ''} ${!hasVideo ? 'hidden' : ''}`}
      />
      {!hasVideo && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-zinc-500">
            {connectionState === 'connecting' ? (
              <>
                <div className="h-16 w-16 rounded-full bg-zinc-800 flex items-center justify-center">
                  <div className="h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <p className="text-sm font-medium">Connecting video...</p>
              </>
            ) : connectionState === 'failed' ? (
              <>
                <div className="h-16 w-16 rounded-full bg-red-900/50 flex items-center justify-center">
                  <VideoOff className="h-8 w-8 text-red-400" />
                </div>
                <p className="text-sm font-medium text-red-400">Connection failed</p>
                <p className="text-xs text-zinc-500">Try clicking Next</p>
              </>
            ) : (
              <>
                <div className="h-16 w-16 rounded-full bg-zinc-800 flex items-center justify-center">
                  <VideoOff className="h-8 w-8" />
                </div>
                <p className="text-sm font-medium">{isLocal ? 'Starting camera...' : 'Waiting for video...'}</p>
              </>
            )}
          </div>
        </div>
      )}
      <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
        {label}
      </div>
      {showConnectionStatus && (
        <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-sm">
          <div className={`h-2 w-2 rounded-full ${statusDisplay.color}`} />
          <span className="text-xs font-medium text-white">
            {statusDisplay.text}
          </span>
        </div>
      )}
    </div>
  )
}

export function ChatInterface({ type }: { type: 'text' | 'video' }) {
  const { status, partnerId, myId, findPartner, disconnect } = useMatchmaking(type)
  const { localStream, remoteStream, connectionStatus } = useWebRTC(myId, partnerId, type === 'video')
  
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isCameraOn, setIsCameraOn] = useState(true)
  const [isMicOn, setIsMicOn] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [showReport, setShowReport] = useState(false)
  
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasStartedRef = useRef(false)
  const [showMobileChat, setShowMobileChat] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted && !hasStartedRef.current) {
      hasStartedRef.current = true
      findPartner()
    }
  }, [mounted, findPartner])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  useEffect(() => {
    if (!mounted || !myId) return

    if (!partnerId) {
      setMessages([{ 
        id: 'init', 
        sender: 'system', 
        text: 'Looking for someone to chat with...', 
        timestamp: new Date() 
      }])
      return
    }

    setMessages([{ 
      id: 'matched', 
      sender: 'system', 
      text: 'You\'re now chatting with a stranger. Say hi!', 
      timestamp: new Date() 
    }])

    const roomId = [myId, partnerId].sort().join('-')
    const channel = supabase.channel(`chat:${roomId}`, {
      config: { broadcast: { self: false } }
    })
    channelRef.current = channel

    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        if (payload.from !== myId) {
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            sender: 'stranger',
            text: payload.text,
            timestamp: new Date()
          }])
        }
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        // Could show typing indicator
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [partnerId, myId, mounted])

  useEffect(() => {
    if (status === 'disconnected') {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'system',
        text: 'Stranger has disconnected.',
        timestamp: new Date()
      }])
    }
  }, [status])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(() => {
    if (!inputText.trim() || !partnerId || !channelRef.current) return

    const newMessage: Message = {
      id: crypto.randomUUID(),
      sender: 'me',
      text: inputText.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, newMessage])
    
    channelRef.current.send({
      type: 'broadcast',
      event: 'message',
      payload: { text: inputText.trim(), from: myId }
    })

    setInputText('')
  }, [inputText, partnerId, myId])

  const handleNext = useCallback(async () => {
    hasStartedRef.current = false
    await disconnect()
    setMessages([])
    hasStartedRef.current = true
    findPartner()
  }, [disconnect, findPartner])

  const handleStop = useCallback(() => {
    disconnect()
    window.location.href = '/'
  }, [disconnect])

  const toggleCamera = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsCameraOn(prev => !prev)
    }
  }, [localStream])

  const toggleMic = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled
      })
      setIsMicOn(prev => !prev)
    }
  }, [localStream])

  const reportUser = useCallback(async () => {
    if (!partnerId) return
    
    try {
      await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: myId,
          reportedSessionId: partnerId,
          reason: 'inappropriate'
        })
      })
      setShowReport(false)
      handleNext()
    } catch (e) {
      console.error('Report failed:', e)
    }
  }, [partnerId, myId, handleNext])

  if (!mounted) {
    return (
      <div className="flex h-[calc(100vh-60px)] w-full items-center justify-center bg-zinc-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
      </div>
    )
  }

    return (
      <div className="flex h-[calc(100vh-60px)] w-full bg-zinc-950 overflow-hidden">
        {type === 'video' ? (
          <>
            <div className="hidden lg:flex flex-1 flex-row h-full overflow-hidden">
              <div className="flex flex-col flex-1 min-h-0 p-3 gap-3">
                <div className="flex-[3] min-h-0">
                  <VideoDisplay 
                    stream={remoteStream} 
                    label="Stranger" 
                    muted={false}
                    isLocal={false}
                  />
                </div>
                
                <div className="flex-[2] min-h-0 relative">
                  <VideoDisplay 
                    stream={localStream} 
                    label="You" 
                    muted={true}
                    isLocal={true}
                  />
                  
                  <div className="absolute bottom-3 right-3 flex gap-2">
                    <Button 
                      size="icon" 
                      variant="secondary" 
                      className={`h-10 w-10 rounded-full ${isMicOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'} text-white border-none`}
                      onClick={toggleMic}
                    >
                      {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                    </Button>
                    <Button 
                      size="icon" 
                      variant="secondary" 
                      className={`h-10 w-10 rounded-full ${isCameraOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'} text-white border-none`}
                      onClick={toggleCamera}
                    >
                      {isCameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="h-full w-80 flex-shrink-0 p-3 pl-0">
                <ChatPanel 
                  status={status}
                  connectionStatus={connectionStatus}
                  messages={messages}
                  inputText={inputText}
                  setInputText={setInputText}
                  sendMessage={sendMessage}
                  handleNext={handleNext}
                  handleStop={handleStop}
                  showReport={showReport}
                  setShowReport={setShowReport}
                  reportUser={reportUser}
                  partnerId={partnerId}
                  messagesEndRef={messagesEndRef}
                />
              </div>
            </div>

              <div className="flex lg:hidden flex-col h-full w-full overflow-hidden relative">
                {!showMobileChat ? (
                  <div className="h-full flex flex-col p-2 gap-2">
                    <div className="flex-1 min-h-0">
                      <VideoDisplay 
                        stream={remoteStream} 
                        label="Stranger" 
                        muted={false}
                        isLocal={false}
                        showConnectionStatus={true}
                        isConnected={status === 'matched' && connectionStatus === 'connected'}
                      />
                    </div>
                    
                    <div className="flex-1 min-h-0 relative">
                      <VideoDisplay 
                        stream={localStream} 
                        label="You" 
                        muted={true}
                        isLocal={true}
                      />
                      
                      <div className="absolute bottom-3 right-3 flex gap-2">
                        <Button 
                          size="icon" 
                          variant="secondary" 
                          className={`h-10 w-10 rounded-full ${isMicOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'} text-white border-none`}
                          onClick={toggleMic}
                        >
                          {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                        </Button>
                        <Button 
                          size="icon" 
                          variant="secondary" 
                          className={`h-10 w-10 rounded-full ${isCameraOn ? 'bg-white/20 hover:bg-white/30' : 'bg-red-500 hover:bg-red-600'} text-white border-none`}
                          onClick={toggleCamera}
                        >
                          {isCameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
                        </Button>
                        <Button 
                          size="icon" 
                          variant="secondary" 
                          className="h-10 w-10 rounded-full bg-white/20 hover:bg-white/30 text-white border-none"
                          onClick={handleNext}
                        >
                          <SkipForward className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <button 
                      onClick={() => setShowMobileChat(true)}
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-white/70 animate-bounce z-20 bg-zinc-900/80 px-4 py-2 rounded-full backdrop-blur-sm"
                    >
                      <span className="text-xs font-medium">Messages</span>
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="h-full p-2">
                    <ChatPanel 
                      status={status}
                      connectionStatus={connectionStatus}
                      messages={messages}
                      inputText={inputText}
                      setInputText={setInputText}
                      sendMessage={sendMessage}
                      handleNext={handleNext}
                      handleStop={handleStop}
                      showReport={showReport}
                      setShowReport={setShowReport}
                      reportUser={reportUser}
                      partnerId={partnerId}
                      messagesEndRef={messagesEndRef}
                      hideNextButton
                      onClose={() => setShowMobileChat(false)}
                    />
                  </div>
                )}
              </div>
          </>
        ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-2xl h-full">
            <ChatPanel 
              status={status}
              connectionStatus={connectionStatus}
              messages={messages}
              inputText={inputText}
              setInputText={setInputText}
              sendMessage={sendMessage}
              handleNext={handleNext}
              handleStop={handleStop}
              showReport={showReport}
              setShowReport={setShowReport}
              reportUser={reportUser}
              partnerId={partnerId}
              messagesEndRef={messagesEndRef}
              fullWidth
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ChatPanel({
  status,
  connectionStatus,
  messages,
  inputText,
  setInputText,
  sendMessage,
  handleNext,
  handleStop,
  showReport,
  setShowReport,
  reportUser,
  partnerId,
  messagesEndRef,
  fullWidth = false,
  hideNextButton = false,
  onClose
}: {
  status: string
  connectionStatus: string
  messages: Message[]
  inputText: string
  setInputText: (v: string) => void
  sendMessage: () => void
  handleNext: () => void
  handleStop: () => void
  showReport: boolean
  setShowReport: (v: boolean) => void
  reportUser: () => void
  partnerId: string | null
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  fullWidth?: boolean
  hideNextButton?: boolean
  onClose?: () => void
}) {
  const isConnected = status === 'matched'
  
  return (
    <Card className="flex flex-col bg-zinc-900 border-zinc-800 overflow-hidden h-full">
      <div className="flex items-center justify-between border-b border-zinc-800 p-3 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-orange-500 animate-pulse'}`} />
          <span className="text-sm font-medium text-zinc-300">
            {isConnected ? 'Connected' : status === 'searching' ? 'Searching...' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {partnerId && (
            <Button 
              variant="ghost" 
              size="icon"
              className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
              onClick={() => setShowReport(true)}
            >
              <Flag className="h-4 w-4" />
            </Button>
          )}
          {onClose && (
            <Button 
              variant="ghost" 
              size="icon"
              className="h-8 w-8 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {!onClose && (
            <Button 
              variant="ghost" 
              size="icon"
              className="h-8 w-8 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              onClick={handleStop}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {showReport && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-sm mx-4">
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <AlertTriangle className="h-6 w-6" />
              <h3 className="font-semibold text-lg">Report User</h3>
            </div>
            <p className="text-zinc-400 text-sm mb-6">
              Report this user for inappropriate behavior? This will skip to the next person.
            </p>
            <div className="flex gap-3">
              <Button 
                variant="outline" 
                className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                onClick={() => setShowReport(false)}
              >
                Cancel
              </Button>
              <Button 
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={reportUser}
              >
                Report
              </Button>
            </div>
          </div>
        </div>
      )}

        <ScrollArea className="flex-1 min-h-0 overflow-auto">
          <div className="flex flex-col gap-3 p-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.sender === 'me' ? 'justify-end' : msg.sender === 'system' ? 'justify-center' : 'justify-start'
              }`}
            >
              {msg.sender === 'system' ? (
                <span className="rounded-full bg-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-400">
                  {msg.text}
                </span>
              ) : (
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.sender === 'me'
                      ? 'bg-orange-500 text-white rounded-br-sm'
                      : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
                  }`}
                >
                  {msg.text}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-zinc-800 bg-zinc-900/50">
          <div className="flex gap-2">
            {!hideNextButton && (
              <Button 
                variant="outline" 
                size="icon" 
                onClick={handleNext} 
                className="shrink-0 h-11 w-11 rounded-xl border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              >
                <SkipForward className="h-5 w-5" />
              </Button>
            )}
            <div className="relative flex-1">
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={isConnected ? "Type a message..." : "Waiting for connection..."}
                className="h-11 rounded-xl border-zinc-700 bg-zinc-800 text-zinc-200 placeholder:text-zinc-500 pr-12 focus-visible:ring-1 focus-visible:ring-orange-500"
                disabled={!isConnected}
              />
              <Button 
                size="icon" 
                onClick={sendMessage} 
                disabled={!isConnected || !inputText.trim()}
                className="absolute right-1 top-1 h-9 w-9 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                <Send className="h-4 w-4" />
              </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
