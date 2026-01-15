"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { Video, MessageSquare, Shield, Users, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function LandingPage() {
  const [mounted, setMounted] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)

  useEffect(() => {
    setMounted(true)

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats')
        const data = await res.json()
        setOnlineCount(data.online || 2451)
      } catch {
        setOnlineCount(2451)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 10000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-[#fdfdfd] text-[#333]">
      <header className="border-b bg-white py-4 px-6 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-white shadow-md">
              <Zap className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-orange-600">Lakhari</h1>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <span className="text-sm font-medium text-gray-500">
              {mounted ? `${onlineCount.toLocaleString()} people online now` : "Loading..."}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-12 md:py-24">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div className="flex flex-col gap-6">
              <h2 className="text-4xl font-extrabold leading-tight text-gray-900 md:text-6xl">
                Talk to strangers, <span className="text-orange-500">instantly.</span>
              </h2>
              <p className="text-lg text-gray-600 md:text-xl">
                Experience the thrill of meeting new people from around the world. Free, anonymous, and exciting. No registration required.
              </p>
              
              <div className="flex flex-col gap-4 sm:flex-row pt-4">
                <Button asChild size="lg" className="h-16 rounded-2xl bg-orange-500 px-8 text-lg font-bold hover:bg-orange-600 shadow-lg transition-all hover:scale-105 active:scale-95">
                  <Link href="/chat?type=video" className="flex items-center gap-3">
                    <Video className="h-6 w-6" />
                    Video Chat
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-16 rounded-2xl border-2 border-gray-200 px-8 text-lg font-bold hover:bg-gray-50 shadow-sm transition-all hover:scale-105 active:scale-95">
                  <Link href="/chat?type=text" className="flex items-center gap-3">
                    <MessageSquare className="h-6 w-6" />
                    Text Chat
                  </Link>
                </Button>
              </div>

              <p className="text-xs text-gray-400">
                By clicking, you agree to our Terms of Service. Must be 18+.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="border-none bg-orange-50 shadow-none">
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                  <div className="rounded-full bg-orange-100 p-4 text-orange-600">
                    <Shield className="h-8 w-8" />
                  </div>
                  <h3 className="font-bold">Safe & Private</h3>
                  <p className="text-sm text-gray-500">Encrypted connections and community moderation.</p>
                </CardContent>
              </Card>
              <Card className="border-none bg-blue-50 shadow-none">
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                  <div className="rounded-full bg-blue-100 p-4 text-blue-600">
                    <Users className="h-8 w-8" />
                  </div>
                  <h3 className="font-bold">Global Community</h3>
                  <p className="text-sm text-gray-500">Connect with people from over 190 countries.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-gray-50 py-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center">
              <h3 className="text-2xl font-bold">Why Lakhari?</h3>
              <p className="mt-2 text-gray-600">The most dynamic way to meet people online.</p>
            </div>
            
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 text-orange-500 font-black text-4xl">100%</div>
                <h4 className="font-bold">Always Free</h4>
                <p className="mt-2 text-sm text-gray-500">No premium features, no hidden costs. Just pure human connection.</p>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 text-orange-500 font-black text-4xl">Fast</div>
                <h4 className="font-bold">Instant Matching</h4>
                <p className="mt-2 text-sm text-gray-500">Our advanced algorithm finds you a partner in seconds.</p>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 text-orange-500 font-black text-4xl">Ads</div>
                <h4 className="font-bold">Unobtrusive Experience</h4>
                <p className="mt-2 text-sm text-gray-500">Minimal ads to keep the service free for everyone.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 px-6 text-center text-gray-400">
        <p className="text-sm">© 2025 Lakhari. Keep it respectful.</p>
      </footer>
    </div>
  )
}
