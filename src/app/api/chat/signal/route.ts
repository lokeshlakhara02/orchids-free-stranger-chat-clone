import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { roomId, sessionId, signal, type } = await req.json()

    if (!roomId || !sessionId || !signal || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: room } = await supabaseAdmin
      .from('chat_rooms')
      .select('id, user1_session_id, user2_session_id, status')
      .eq('id', roomId)
      .single()

    if (!room || room.status !== 'active') {
      return NextResponse.json({ error: 'Room not active' }, { status: 400 })
    }

    if (room.user1_session_id !== sessionId && room.user2_session_id !== sessionId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { error } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        room_id: roomId,
        sender_session_id: sessionId,
        message_type: 'signal',
        content: JSON.stringify({ type, signal })
      })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Signal error:', error)
    return NextResponse.json({ error: 'Failed to send signal' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const roomId = searchParams.get('roomId')
    const sessionId = searchParams.get('sessionId')
    const after = searchParams.get('after')

    if (!roomId || !sessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

    let query = supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .eq('message_type', 'signal')
      .neq('sender_session_id', sessionId)
      .order('created_at', { ascending: true })

    if (after) {
      query = query.gt('created_at', after)
    }

    const { data: signals, error } = await query.limit(10)

    if (error) throw error

    const parsedSignals = signals?.map(s => ({
      id: s.id,
      ...JSON.parse(s.content || '{}'),
      created_at: s.created_at
    })) || []

    return NextResponse.json({ signals: parsedSignals })
  } catch (error) {
    console.error('Get signals error:', error)
    return NextResponse.json({ error: 'Failed to get signals' }, { status: 500 })
  }
}
