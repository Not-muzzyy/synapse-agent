'use client';

import { useVoiceAgent } from '@/hooks/useVoiceAgent';
import { useState, useEffect } from 'react';
import { X, Send, Mic, History, ChevronDown, ChevronUp, Volume2, VolumeX } from 'lucide-react';

export default function Home() {
  const [language, setLanguage] = useState<'en' | 'hi' | null>(null);
  const [voiceMode, setVoiceMode] = useState<boolean>(false);
  const [textInput, setTextInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<any[]>([]);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      if (data.sessions) setHistorySessions(data.sessions);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenHistory = () => {
    fetchHistory();
    setShowHistory(true);
  };
  
  const {
    agentState,
    messages,
    sessionComplete,
    summary,
    error,
    sessionId,
    toggleListening,
    resetAgent,
    startConversation,
    restoreSession,
    sendMessage,
  } = useVoiceAgent(language, voiceMode);

  const [displayError, setDisplayError] = useState<string | null>(null);
  useEffect(() => {
    if (error) {
      setDisplayError(error);
      const timer = setTimeout(() => setDisplayError(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleStartCall = (lang: 'en' | 'hi') => {
    setLanguage(lang);
    startConversation(lang);
  };

  const handleReset = () => {
    if (messages.length > 0 && !sessionComplete) {
      // Fire and forget so UI resets instantly
      fetch('/api/save-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, sessionId })
      }).catch(err => {
        console.error('Failed to save session on exit', err);
      });
    }
    resetAgent();
    setLanguage(null);
  };

  const handleContinueSession = (session: any) => {
    setShowHistory(false);
    setLanguage('en'); // Defaulting to english for restored sessions
    restoreSession(session);
  };

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  const getStatusLabel = () => {
    switch (agentState) {
      case 'idle': return 'Tap orb to speak';
      case 'listening': return 'Listening...';
      case 'processing': return 'Thinking...';
      case 'speaking': return 'Speaking...';
      default: return '';
    }
  };

  if (sessionComplete) {
    return (
      <main className="app-container start-bg">
        <div className="result-screen">
          <div className="result-card">
            <h2>Session Complete</h2>
            <p className="summary-text">{summary || 'Great job today! Review your notes and come back anytime.'}</p>
            <button className="notion-btn primary" onClick={handleReset}>
              Start New Session
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (language === null) {
    return (
      <main className="app-container start-bg">
        <div className="start-screen">
          <h1 className="animate-blur-in">Synapse</h1>
          <p className="start-subtitle animate-blur-in delay-100">Connecting ideas together at lightning speed.</p>
          <div className="lang-buttons animate-blur-in delay-200">
            <button className="notion-btn" onClick={() => handleStartCall('en')}>
              English
            </button>
            <button className="notion-btn" onClick={() => handleStartCall('hi')}>
              Hindi
            </button>
          </div>
          
          <button className="history-btn" onClick={handleOpenHistory}>
            <History size={18} />
            View Past Sessions
          </button>
        </div>

        {/* History Modal */}
        {showHistory && (
          <div className="history-modal-overlay" onClick={() => setShowHistory(false)}>
            <div className="history-modal" onClick={e => e.stopPropagation()}>
              <div className="history-header">
                <h2>Your Study History</h2>
                <button className="icon-btn" onClick={() => setShowHistory(false)}>
                  <X size={20} />
                </button>
              </div>
              <div className="history-content">
                {historySessions.length === 0 ? (
                  <p className="empty-history">No past sessions found. Start studying!</p>
                ) : (
                  historySessions.map((session, idx) => (
                    <div key={idx} className="history-card">
                      <div className="history-card-header">
                        <span className="history-date">
                          {new Date(session.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="history-summary">{session.summary}</p>
                      
                      <div className="history-actions">
                        <button 
                          className="toggle-transcript-btn" 
                          onClick={() => setExpandedSession(expandedSession === idx ? null : idx)}
                        >
                          {expandedSession === idx ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          {expandedSession === idx ? 'Hide Transcript' : 'View Transcript'}
                        </button>
                        <button 
                          className="continue-session-btn"
                          onClick={() => handleContinueSession(session)}
                        >
                          Continue Session
                        </button>
                      </div>
                      
                      {expandedSession === idx && (
                        <div className="history-transcript">
                          {session.transcript.map((m: any, mIdx: number) => (
                            <div key={mIdx} className={`note-bubble ${m.role}`}>
                              {m.content}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="app-container">
      
      {/* Sidebar (Only when active) */}
      {agentState !== 'idle' && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <h3>Live Notes</h3>
            <button 
              className="icon-btn" 
              title={voiceMode ? "Disable Voice" : "Enable Voice"} 
              onClick={() => setVoiceMode(!voiceMode)}
            >
              {voiceMode ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>
          <div className="notes-scroll">
            {messages.map((m, i) => (
              <div key={i} className={`note-bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <section className="main-content">
        
        {/* Top Controls */}
        <header className="top-header">
          <button className="icon-btn" onClick={handleReset} title="End Session">
            <X size={20} />
          </button>
        </header>

        {/* Center Stage (Orb + Subtitle) */}
        <div className="center-stage">
          <div className="orb-wrapper" onClick={toggleListening}>
            <div className={`clean-orb ${agentState}`}>
              <div className="orb-core"></div>
              <div className="orb-ring ring-1"></div>
              <div className="orb-ring ring-2"></div>
            </div>
          </div>
          
          <div className="status-label">{getStatusLabel()}</div>

          <div className="subtitle-container">
            {displayError ? (
              <div className="subtitle error-text">{displayError}</div>
            ) : lastMessage ? (
              <div key={lastMessage.content} className={`subtitle ${lastMessage.role}`}>
                {lastMessage.content}
              </div>
            ) : (
              <div className="subtitle connecting-text">Connecting...</div>
            )}
          </div>
        </div>

        {/* Bottom Input Bar */}
        <div className="bottom-bar">
          <form onSubmit={(e) => {
            e.preventDefault();
            if (textInput.trim()) {
              sendMessage(textInput);
              setTextInput('');
            }
          }}>
            <div className="input-wrapper">
              <Mic 
                size={20} 
                className={`mic-icon ${agentState === 'listening' ? 'active' : ''}`} 
                onClick={toggleListening} 
              />
              <input 
                type="text" 
                placeholder="Message your tutor..." 
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                disabled={agentState === 'processing'}
              />
              <button type="submit" className="send-btn" disabled={!textInput.trim() || agentState === 'processing'}>
                <Send size={18} />
              </button>
            </div>
          </form>
        </div>

      </section>
    </main>
  );
}
