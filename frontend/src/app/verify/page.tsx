"use client";

import { useState } from "react";

export default function VerifyPage() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const handleVerify = async () => {
    if (!text) return;
    
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to extract shadow");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 flex flex-col items-center">
      <div className="w-full max-w-2xl space-y-6">
        
        <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
          🔍 Verify Copied Content
        </h1>

        <div className="space-y-4">
          <textarea
            className="w-full h-64 p-4 bg-transparent border border-gray-600 rounded-xl focus:outline-none focus:border-blue-500 font-mono text-sm resize-none"
            placeholder="Paste the alleged copied text here to extract its Semantic Shadow (This will NOT be saved to the database)..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <button
            onClick={handleVerify}
            disabled={loading || !text}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors duration-200"
          >
            {loading ? "⚙️ Extracting Shadow..." : "🕵️‍♂️ Generate Semantic Shadow"}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-900/50 border border-red-500 rounded-xl text-red-200">
            Error: {error}
          </div>
        )}

        {/* Display the JSON output so Student 3 can see the structure */}
        {result && (
          <div className="mt-8 space-y-4">
            <h2 className="text-xl font-semibold text-green-400">✅ Shadow Generated Successfully</h2>
            <div className="bg-gray-900 p-4 rounded-xl border border-gray-700 overflow-x-auto">
              <pre className="text-xs text-green-300 font-mono">
                {JSON.stringify(result.extractedShadows, null, 2)}
              </pre>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}