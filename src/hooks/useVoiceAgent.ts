'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type AgentState = 'idle' | 'listening' | 'processing' | 'speaking';

/**
 * Prepare text for spoken delivery.
 * Strips markdown, expands abbreviations, normalizes for TTS.
 */
function prepareForSpeech(text: string): string {
  return text
    .replace(/[*_#`]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\betc\b\.?/gi, 'et cetera')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Adaptive silence threshold based on what the user said.
 * Short answers get fast response, filler words get patience.
 */
function calculateSilenceThreshold(transcript: string): number {
  const trimmed = transcript.trim();
  const endsWithPunctuation = /[.!?]$/.test(trimmed);
  const hasFillers = /\b(um|uh|like|well|hmm|so|actually|let me think)\b/i.test(trimmed);
  const isShortAnswer = trimmed.split(/\s+/).length <= 4;

  if (isShortAnswer && !hasFillers) return 800;
  if (endsWithPunctuation && !hasFillers) return 900;
  if (hasFillers) return 1800;
  return 1200;
}

export function useVoiceAgent(language: 'en' | 'hi' | null, voiceMode: boolean = true) {
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionComplete, setSessionComplete] = useState<boolean>(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>('');

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const agentStateRef = useRef<AgentState>('idle');
  const voiceModeRef = useRef<boolean>(voiceMode);

  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  const silenceTimerRef = useRef<any>(null);
  const userTranscriptBuffer = useRef<string>('');
  const pendingMicRestart = useRef<boolean>(false);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { agentStateRef.current = agentState; }, [agentState]);

  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  /**
   * Reliably start the microphone with retry.
   * SpeechRecognition.stop() is async — calling start() too soon
   * throws InvalidStateError. This retries with backoff.
   */
  const startMicReliably = useCallback(() => {
    if (!recognitionRef.current) return;

    const tryStart = (attempts: number) => {
      try {
        recognitionRef.current.start();
        pendingMicRestart.current = false;
      } catch (e: any) {
        if (e.name === 'InvalidStateError' && attempts > 0) {
          setTimeout(() => tryStart(attempts - 1), 150);
        } else {
          pendingMicRestart.current = false;
        }
      }
    };

    pendingMicRestart.current = true;
    tryStart(5);
  }, []);

  const speakText = useCallback((text: string, langOverride?: 'en' | 'hi', onEndCallback?: () => void) => {
    if (!voiceModeRef.current || !synthRef.current) {
      if (onEndCallback) {
        setAgentState('idle');
        onEndCallback();
      } else {
        setAgentState('listening');
        startMicReliably();
      }
      return;
    }

    try { synthRef.current.cancel(); } catch (e) {} setAgentState('speaking');
    try { recognitionRef.current?.stop(); } catch (e) {}

    const activeLang = langOverride || language;
    const bcp47 = activeLang === 'hi' ? 'hi-IN' : 'en-US';
    const spokenText = prepareForSpeech(text);

    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = bcp47;
    utterance.rate = 1.1;

    const voices = synthRef.current.getVoices();
    const targetVoice = voices.find(v =>
      activeLang === 'hi'
        ? (v.lang === 'hi-IN' || v.lang === 'hi_IN' || v.lang.startsWith('hi'))
        : (v.lang === 'en-US' || v.lang === 'en_US' || v.lang.startsWith('en'))
    );
    if (targetVoice) utterance.voice = targetVoice;

    utterance.onend = () => {
      if (onEndCallback) {
        setAgentState('idle');
        onEndCallback();
      } else {
        setAgentState('listening');
        startMicReliably();
      }
    };

    utterance.onerror = (e: any) => {
      const errString = e.error || e;
      if (errString !== 'interrupted' && errString !== 'canceled') {
        console.error('TTS Error:', errString);
      }
      if (onEndCallback) {
        setAgentState('idle');
        onEndCallback();
      } else {
        setAgentState('listening');
        startMicReliably();
      }
    };

    (window as any)._utterance = utterance;
    setTimeout(() => { synthRef.current?.speak(utterance); }, 50);
  }, [language, startMicReliably]);

  const startConversation = useCallback(async (selectedLang: 'en' | 'hi') => {
    setAgentState('processing');
    userTranscriptBuffer.current = '';
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [], language: selectedLang, sessionId: Date.now().toString() }),
      });
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      let sentenceBuffer = '';

      if (!reader) throw new Error('No stream available');
      
      setMessages([{ role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (sentenceBuffer.trim()) {
            speakText(sentenceBuffer.trim(), selectedLang);
          }
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        assistantMessage += chunk;
        sentenceBuffer += chunk;
        
        setMessages([{ role: 'assistant', content: assistantMessage }]);

        if (/[.?!]\s/.test(sentenceBuffer)) {
          const split = sentenceBuffer.match(/(.*?[.?!])\s(.*)/);
          if (split) {
            speakText(split[1].trim(), selectedLang);
            sentenceBuffer = split[2] || '';
          }
        }
      }

      setAgentState('listening');
      startMicReliably();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to start conversation');
      setAgentState('idle');
    }
  }, [speakText, startMicReliably]);

  const handleUserSpeech = useCallback(async (text: string) => {
    if (agentStateRef.current === 'processing') return;
    try { synthRef.current?.cancel(); } catch (e) {}
    agentStateRef.current = 'processing';
    setAgentState('processing');
    userTranscriptBuffer.current = '';
    try { recognitionRef.current?.stop(); } catch (e) {}

    const newMessages = [...messagesRef.current, { role: 'user', content: text } as Message];
    setMessages(newMessages);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, language, sessionId }),
      });
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      let sentenceBuffer = '';

      if (!reader) throw new Error('No stream available');
      
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (sentenceBuffer.trim()) {
            speakText(sentenceBuffer.trim());
          }
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        assistantMessage += chunk;
        sentenceBuffer += chunk;
        
        setMessages((prev) => {
          const newMsgs = [...prev];
          newMsgs[newMsgs.length - 1] = { role: 'assistant', content: assistantMessage };
          return newMsgs;
        });

        if (/[.?!]\s/.test(sentenceBuffer)) {
          const split = sentenceBuffer.match(/(.*?[.?!])\s(.*)/);
          if (split) {
            speakText(split[1].trim());
            sentenceBuffer = split[2] || '';
          }
        }
      }

      const jsonMatch = assistantMessage.match(/\{[\s\S]*"session_complete"[\s\S]*\}/);
      if (jsonMatch) {
         try {
           const parsed = JSON.parse(jsonMatch[0]);
           if (parsed.session_complete) {
              setSessionComplete(true);
              setAgentState('idle');
              try { recognitionRef.current?.stop(); } catch (e) {}
              
              fetch('/api/save-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [...messagesRef.current, { role: 'assistant', content: parsed.message }], sessionId })
              }).then(res => res.json()).then(data => {
                if (data.summary) setSummary(data.summary);
              });
              
              speakText(parsed.message || "Session complete.");
              return;
           }
         } catch(e) {}
      }

      setAgentState('listening');
      startMicReliably();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to process speech');
      setAgentState('idle');
    }
  }, [speakText, language, startMicReliably, sessionId]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.maxAlternatives = 1;
      recognitionRef.current.lang = language === 'hi' ? 'hi-IN' : 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript.trim()) {
          userTranscriptBuffer.current += ' ' + finalTranscript.trim();
        }

        if (interimTranscript.trim() || finalTranscript.trim()) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

          const currentBuffer = userTranscriptBuffer.current.trim();
          const latestText = finalTranscript.trim() || interimTranscript.trim();
          const threshold = calculateSilenceThreshold(currentBuffer || latestText);

          silenceTimerRef.current = setTimeout(() => {
            const fullSpeech = userTranscriptBuffer.current.trim();
            if (fullSpeech) {
              userTranscriptBuffer.current = '';
              handleUserSpeech(fullSpeech);
            }
          }, threshold);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        if (event.error !== 'aborted' && event.error !== 'no-speech') {
          console.error('Speech recognition error:', event.error);
          setError(event.error);
        }
      };

      // When recognition stops, restart it if we're supposed to be listening
      // or if a pending restart was requested (after TTS ended)
      recognitionRef.current.onend = () => {
        if (agentStateRef.current === 'listening' || pendingMicRestart.current) {
          pendingMicRestart.current = false;
          setTimeout(() => {
            try { recognitionRef.current?.start(); } catch (e) {}
          }, 100);
        }
      };
    } else {
      setError('Web Speech API is not supported in this browser.');
    }

    if (window.speechSynthesis) {
      synthRef.current = window.speechSynthesis;
    }
  }, [handleUserSpeech, language]);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;

    if (agentState === 'listening') {
      recognitionRef.current.stop();
      pendingMicRestart.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setAgentState('idle');
    } else if (agentState === 'speaking') {
      if (synthRef.current) synthRef.current.cancel();
      setError(null);
      setAgentState('listening');
      startMicReliably();
    } else {
      setError(null);
      setAgentState('listening');
      startMicReliably();
    }
  }, [agentState, startMicReliably]);

  const resetAgent = useCallback(() => {
    if (synthRef.current) synthRef.current.cancel();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    pendingMicRestart.current = false;
    try { recognitionRef.current?.stop(); } catch (e) {}
    setAgentState('idle');
    setMessages([]);
    setSessionComplete(false);
    setSummary(null);
    setError(null);
    setSessionId(Date.now().toString());
    userTranscriptBuffer.current = '';
  }, []);

  const restoreSession = useCallback((session: any) => {
    if (synthRef.current) synthRef.current.cancel();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    pendingMicRestart.current = false;
    try { recognitionRef.current?.stop(); } catch (e) {}
    
    setMessages(session.transcript || []);
    setAgentState('idle');
    setSessionComplete(false);
    setSummary(null);
    setError(null);
    setSessionId(session.id || session.timestamp || Date.now().toString());
    userTranscriptBuffer.current = '';
  }, []);

  return {
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
    sendMessage: handleUserSpeech,
  };
}
