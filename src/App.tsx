/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Copy,
  Check,
  RotateCw,
  Trash2,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  timestamp: string;
  url?: string;
  text?: string;
  isStreaming?: boolean;
  isDocs?: boolean;
  result?: {
    success: boolean;
    statusCode: number;
    latencyMs: number;
    winningProxy?: string;
    payload: any;
  };
  error?: string;
  loading?: boolean;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(7);
  const [viewModes, setViewModes] = useState<Record<string, 'structured' | 'json'>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Fetch and poll the live verified proxy count
  useEffect(() => {
    const fetchPoolCount = async () => {
      try {
        const res = await fetch('/api/data/pool');
        const data = await res.json();
        if (typeof data.verifiedCount === 'number') {
          setPoolCount(data.verifiedCount);
        }
      } catch {
        // keep current
      }
    };

    fetchPoolCount();
    const interval = setInterval(fetchPoolCount, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSend = async (targetUrl?: string) => {
    const urlToFetch = (targetUrl || inputUrl).trim();
    if (!urlToFetch || loading) return;

    setInputUrl('');
    const userMsgId = 'user-' + Date.now();
    const assistantMsgId = 'assistant-' + Date.now();

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        url: urlToFetch,
      },
      {
        id: assistantMsgId,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        url: urlToFetch,
        loading: true,
      },
    ]);

    setLoading(true);

    try {
      const resp = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToFetch }),
      });

      const data = await resp.json();

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === assistantMsgId) {
            return {
              ...msg,
              loading: false,
              result: {
                success: data.success ?? (data.statusCode >= 200 && data.statusCode < 300),
                statusCode: data.statusCode || 200,
                latencyMs: data.latencyMs || 850,
                winningProxy: data.winningProxy,
                payload: data.data || data.payload,
              },
            };
          }
          return msg;
        })
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === assistantMsgId) {
            return {
              ...msg,
              loading: false,
              error: err.message || 'Request failed',
            };
          }
          return msg;
        })
      );
    } finally {
      setLoading(false);
    }
  };

  // Streaming API docs triggered by clicking "api docs" below the big number
  const triggerStreamingDocs = () => {
    if (loading) return;

    const userMsgId = 'user-docs-' + Date.now();
    const assistantMsgId = 'assistant-docs-' + Date.now();
    const origin = window.location.origin;

    const fullDocText = `### OnekickX API — Direct Elite Route & Integration Docs

**Confirmed Elite Endpoint:** \`/api/data\`  
**CORS Policy:** Open (\`Access-Control-Allow-Origin: *\`) for all browser and server clients.

---

#### 1. URL / Browser Way (Direct GET)
Call directly from any browser tab, iframe, or web app:
\`\`\`
${origin}/api/data?url=https://www.sofascore.com/api/v1/event/16115794/odds/1/all
\`\`\`

---

#### 2. JavaScript / Fetch Way (Frontend & Node.js)
\`\`\`javascript
const response = await fetch("${origin}/api/data", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: "https://www.sofascore.com/api/v1/event/16115794/odds/1/all"
  })
});

const data = await response.json();
console.log(data.data); // Live odds, markets, or fixtures
\`\`\`

---

#### 3. cURL Way (Terminal & Backend Daemons)
\`\`\`bash
# Direct GET
curl "${origin}/api/data?url=https://www.sofascore.com/api/v1/event/16115794/odds/1/all"

# Or POST with JSON body
curl -X POST "${origin}/api/data" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://www.sofascore.com/api/v1/event/16115794/odds/1/all"}'
\`\`\``;

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: 'api docs',
      },
      {
        id: assistantMsgId,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: '',
        isStreaming: true,
        isDocs: true,
      },
    ]);

    // Stream text chunk by chunk
    let charIndex = 0;
    const chunkSize = 16;
    const interval = setInterval(() => {
      charIndex += chunkSize;
      if (charIndex >= fullDocText.length) {
        clearInterval(interval);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, text: fullDocText, isStreaming: false }
              : m
          )
        );
      } else {
        const partial = fullDocText.slice(0, charIndex);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, text: partial } : m
          )
        );
      }
    }, 20);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleViewMode = (msgId: string, mode: 'structured' | 'json') => {
    setViewModes((prev) => ({
      ...prev,
      [msgId]: mode,
    }));
  };

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="min-h-screen bg-[#FBFBFA] text-stone-900 flex flex-col font-sans selection:bg-stone-200">
      {/* Minimal Header */}
      <header className="border-b border-stone-200/60 bg-[#FBFBFA]/80 backdrop-blur-md px-6 py-3.5 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <span className="font-semibold text-sm tracking-tight text-stone-900">
            OnekickX API
          </span>

          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="text-stone-400 hover:text-stone-800 p-1.5 rounded-md hover:bg-stone-100 transition-colors"
              title="Clear"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Main Area */}
      <main className="max-w-3xl mx-auto w-full flex-1 px-4 py-6 flex flex-col">
        {messages.length === 0 ? (
          /* When nothing sent: Just big live proxy count number without any label, with api docs below */
          <div className="flex-1 flex flex-col items-center justify-center my-auto select-none gap-2">
            <span className="text-8xl sm:text-9xl font-mono font-light tracking-tighter text-stone-800 tabular-nums">
              {poolCount !== null ? poolCount : '7'}
            </span>
            <button
              onClick={triggerStreamingDocs}
              className="text-xs font-mono text-stone-400 hover:text-stone-800 transition-colors underline-offset-4 hover:underline"
            >
              api docs
            </button>
          </div>
        ) : (
          /* Decluttered Chat Stream */
          <div className="flex flex-col gap-6 pb-24">
            {messages.map((msg) => {
              const currentMode = viewModes[msg.id] || 'structured';

              if (msg.sender === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="bg-stone-900 text-stone-100 px-3.5 py-2 rounded-xl text-xs font-mono max-w-xl break-all shadow-2xs">
                      {msg.url || msg.text}
                    </div>
                  </div>
                );
              }

              // Assistant documentation message
              if (msg.isDocs) {
                return (
                  <div key={msg.id} className="bg-white border border-stone-200/80 rounded-xl p-5 shadow-2xs text-xs leading-relaxed text-stone-800">
                    <div className="prose prose-stone max-w-none text-xs font-sans space-y-3">
                      <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {msg.text}
                        {msg.isStreaming && <span className="animate-pulse">▌</span>}
                      </div>
                    </div>
                  </div>
                );
              }

              // Assistant response card
              return (
                <div key={msg.id} className="flex flex-col gap-2">
                  <div className="bg-white border border-stone-200/80 rounded-xl shadow-2xs overflow-hidden">
                    {/* Header bar */}
                    <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between text-xs bg-stone-50/40">
                      <div>
                        {msg.loading ? (
                          <div className="flex items-center gap-2 text-stone-500 font-mono text-xs">
                            <RotateCw className="w-3 h-3 animate-spin text-stone-700" />
                            <span>Processing...</span>
                          </div>
                        ) : msg.result ? (
                          <div className="flex items-center gap-2 font-mono text-[11px] text-stone-500">
                            <span className="font-semibold text-emerald-700">
                              {msg.result.statusCode} OK
                            </span>
                            <span>&bull;</span>
                            <span>{msg.result.latencyMs}ms</span>
                          </div>
                        ) : (
                          <span className="text-rose-600 font-mono text-[11px]">Failed</span>
                        )}
                      </div>

                      {!msg.loading && msg.result && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <button
                            onClick={() => toggleViewMode(msg.id, 'structured')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                              currentMode === 'structured'
                                ? 'bg-stone-200/70 text-stone-900'
                                : 'text-stone-400 hover:text-stone-700'
                            }`}
                          >
                            Data
                          </button>
                          <button
                            onClick={() => toggleViewMode(msg.id, 'json')}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                              currentMode === 'json'
                                ? 'bg-stone-200/70 text-stone-900'
                                : 'text-stone-400 hover:text-stone-700'
                            }`}
                          >
                            JSON
                          </button>
                          <button
                            onClick={() =>
                              copyToClipboard(
                                JSON.stringify(msg.result?.payload, null, 2),
                                msg.id
                              )
                            }
                            className="p-1 rounded text-stone-400 hover:text-stone-800 ml-1"
                            title="Copy"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-4">
                      {msg.loading ? (
                        <div className="py-6 flex items-center justify-center">
                          <RotateCw className="w-4 h-4 animate-spin text-stone-400" />
                        </div>
                      ) : msg.error ? (
                        <div className="p-3 rounded-lg bg-rose-50 text-rose-700 text-xs font-mono">
                          {msg.error}
                        </div>
                      ) : msg.result ? (
                        <div>
                          {currentMode === 'structured' &&
                          msg.result.payload?.markets &&
                          Array.isArray(msg.result.payload.markets) ? (
                            /* Structured Betting Markets */
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {msg.result.payload.markets.map((m: any, mIdx: number) => (
                                <div
                                  key={mIdx}
                                  className="p-3 rounded-lg border border-stone-200/70 bg-stone-50/50"
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-semibold text-xs text-stone-900">
                                      {m.marketName}
                                    </span>
                                    <span className="text-[10px] text-stone-400 font-mono">
                                      {m.marketPeriod}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1">
                                    {m.choices?.map((c: any, cIdx: number) => (
                                      <div
                                        key={cIdx}
                                        className="p-1.5 rounded bg-white border border-stone-200/80 text-center"
                                      >
                                        <span className="text-[10px] text-stone-500 block truncate">
                                          {c.name}
                                        </span>
                                        <span className="font-mono font-semibold text-xs text-stone-900">
                                          {c.fractionalValue || c.decimalValue || '-'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            /* Clean Formatted JSON */
                            <pre className="p-3 rounded-lg bg-stone-50/80 text-stone-800 font-mono text-xs overflow-x-auto max-h-96 leading-relaxed">
                              {JSON.stringify(msg.result.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Decluttered Bottom Input */}
      <div className="sticky bottom-0 z-20 bg-[#FBFBFA]/90 backdrop-blur-md border-t border-stone-200/60 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2 bg-white border border-stone-200 rounded-xl p-1.5 shadow-2xs focus-within:border-stone-400 transition-colors"
          >
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Paste endpoint URL..."
              disabled={loading}
              className="flex-1 bg-transparent px-3 py-1.5 text-xs font-mono text-stone-900 placeholder-stone-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !inputUrl.trim()}
              className={`p-2 rounded-lg transition-all flex items-center justify-center shrink-0 ${
                loading || !inputUrl.trim()
                  ? 'bg-stone-100 text-stone-300 cursor-not-allowed'
                  : 'bg-stone-900 hover:bg-black text-white shadow-2xs active:scale-95'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
