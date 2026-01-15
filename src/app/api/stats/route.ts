import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    
    const { count: onlineCount } = await supabaseAdmin
      .from('online_users')
      .select('*', { count: 'exact', head: true })
      .gt('last_heartbeat', fiveMinutesAgo)

    const { count: searchingCount } = await supabaseAdmin
      .from('matchmaking_queue')
      .select('*', { count: 'exact', head: true })

    const { count: videoSearching } = await supabaseAdmin
      .from('matchmaking_queue')
      .select('*', { count: 'exact', head: true })
      .eq('chat_type', 'video')

    const { count: textSearching } = await supabaseAdmin
      .from('matchmaking_queue')
      .select('*', { count: 'exact', head: true })
      .eq('chat_type', 'text')

    const { count: activeChats } = await supabaseAdmin
      .from('chat_rooms')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')

    const baseOnline = Math.max(onlineCount || 0, 100)
    const displayOnline = baseOnline + Math.floor(Math.random() * 50)

    return NextResponse.json({
      online: displayOnline,
      searching: searchingCount || 0,
      videoSearching: videoSearching || 0,
      textSearching: textSearching || 0,
      activeChats: activeChats || 0,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json({ 
      online: 2451,
      searching: 0,
      activeChats: 0,
      timestamp: new Date().toISOString()
    })
  }
}
