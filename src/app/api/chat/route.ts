import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const roomId = searchParams.get('roomId')
    const sessionId = searchParams.get('sessionId')
    const limit = parseInt(searchParams.get('limit') || '50')
    const before = searchParams.get('before')

    if (!roomId || !sessionId) {
      return NextResponse.json({ error: 'Room ID and session ID required' }, { status: 400 })
    }

    const { data: room } = await supabaseAdmin
      .from('chat_rooms')
      .select('id, user1_session_id, user2_session_id')
      .eq('id', roomId)
      .single()

    if (!room || (room.user1_session_id !== sessionId && room.user2_session_id !== sessionId)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    let query = supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (before) {
      query = query.lt('created_at', before)
    }

    const { data: messages, error } = await query

    if (error) throw error

    return NextResponse.json({ 
      messages: messages?.reverse() || []
    })
  } catch (error) {
    console.error('Get messages error:', error)
    return NextResponse.json({ error: 'Failed to get messages' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { roomId, sessionId, content, messageType = 'text' } = await req.json()

    if (!roomId || !sessionId || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: room } = await supabaseAdmin
      .from('chat_rooms')
      .select('id, user1_session_id, user2_session_id, status')
      .eq('id', roomId)
      .single()

    if (!room || room.status !== 'active') {
      return NextResponse.json({ error: 'Chat room not active' }, { status: 400 })
    }

    if (room.user1_session_id !== sessionId && room.user2_session_id !== sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { data: message, error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        room_id: roomId,
        sender_session_id: sessionId,
        message_type: messageType,
        content: content.substring(0, 5000)
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ message })
  } catch (error) {
    console.error('Send message error:', error)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const roomId = searchParams.get('roomId')
    const sessionId = searchParams.get('sessionId')

    if (!roomId || !sessionId) {
      return NextResponse.json({ error: 'Room ID and session ID required' }, { status: 400 })
    }

    const { data: room } = await supabaseAdmin
      .from('chat_rooms')
      .select('id, user1_session_id, user2_session_id')
      .eq('id', roomId)
      .single()

    if (!room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    if (room.user1_session_id !== sessionId && room.user2_session_id !== sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    await supabaseAdmin
      .from('chat_messages')
      .insert({
        room_id: roomId,
        sender_session_id: 'system',
        message_type: 'system',
        content: 'Stranger has disconnected.'
      })

    await supabaseAdmin
      .from('chat_rooms')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', roomId)

    const partnerId = room.user1_session_id === sessionId 
      ? room.user2_session_id 
      : room.user1_session_id

    await supabaseAdmin
      .from('online_users')
      .update({ status: 'idle', chat_type: null })
      .in('session_id', [sessionId, partnerId])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('End chat error:', error)
    return NextResponse.json({ error: 'Failed to end chat' }, { status: 500 })
  }
}
