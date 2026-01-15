import { Suspense } from "react"
import { ChatInterface } from "@/components/chat/ChatInterface"
import { Zap } from "lucide-react"
import Link from "next/link"

function ChatContent({ searchParams }: { searchParams: { type?: string } }) {
  const type = searchParams.type === "video" ? "video" : "text"

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50" suppressHydrationWarning>
      <header className="border-b bg-white py-3 px-6 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 text-white">
              <Zap className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-orange-600">Lakhari</h1>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              {type} chat mode
            </span>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <ChatInterface type={type} />
      </main>
    </div>
  )
}

export default async function ChatPage(props: { searchParams: Promise<{ type?: string }> }) {
  const searchParams = await props.searchParams
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
      </div>
    }>
      <ChatContent searchParams={searchParams} />
    </Suspense>
  )
}
