/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Menu, Sparkles, CircleUser, RefreshCw, Plus, Mic, AudioLines, 
  Image as ImageIcon, PenLine, Globe, ArrowUp, MoreVertical, X, Clock, Trash2, MessageSquare,
  Copy, Volume2, RefreshCcw, Edit2, Check, Command, Search, Square, Pin, FileText, Brain, Download, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GoogleGenAI } from '@google/genai';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('json', json);

const CodeBlock = ({ inline, className, children, ...props }: any) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [copied, setCopied] = useState(false);
    
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    
    if (inline) {
        return <code className="bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>{children}</code>;
    }

    const codeContent = String(children).replace(/\n$/, '');

    const handleCopy = () => {
        navigator.clipboard.writeText(codeContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="my-4 border border-theme-border rounded-lg overflow-hidden bg-[#0d0d0d]">
            <div className="flex justify-between items-center bg-theme-input px-4 py-2 border-b border-theme-border text-xs text-theme-text-s">
                <span>{language || 'code'}</span>
                <div className="flex gap-2">
                    <button onClick={() => setIsExpanded(!isExpanded)} className="hover:text-theme-text-p">{isExpanded ? 'Collapse' : 'Expand'}</button>
                    <button onClick={handleCopy} className="hover:text-theme-text-p">{copied ? 'Copied!' : 'Copy'}</button>
                </div>
            </div>
            {isExpanded && (
                <SyntaxHighlighter
                    language={language || 'text'}
                    style={vscDarkPlus}
                    customStyle={{ margin: 0, padding: '1rem', background: 'transparent' }}
                >
                    {codeContent}
                </SyntaxHighlighter>
            )}
        </div>
    );
};

const exportChat = (format: 'text' | 'json', messages: any[]) => {
  let content = "";
  if (format === 'json') {
    content = JSON.stringify(messages, null, 2);
  } else {
    content = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  }
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-export.${format === 'json' ? 'json' : 'txt'}`;
  a.click();
  URL.revokeObjectURL(url);
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const aiCallWithRetry = async <T,>(apiCall: () => Promise<T>, retries = 3, initialDelay = 1000): Promise<T> => {
  try {
    return await apiCall();
  } catch (error: any) {
    const is429 = error?.message?.includes('429') || 
                  error?.status === 429 || 
                  JSON.stringify(error).includes('status":"RESOURCE_EXHAUSTED"');
    
    if (retries > 0 && is429) {
      await delay(initialDelay);
      return aiCallWithRetry(apiCall, retries - 1, initialDelay * 2);
    }
    
    if (is429) {
      throw new Error('QUOTA_EXCEEDED');
    }
    throw error;
  }
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type ChatMessage = {
  id: string;
  role: 'user' | 'model';
  content: string;
  thought?: string;
  image?: { mimeType: string; data: string };
  isPinned?: boolean;
  rating?: 'up' | 'down';
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
};

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('chatSessions');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return [];
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('activeSessionId') || null;
    } catch(e) {}
    return null;
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const savedId = localStorage.getItem('activeSessionId');
      const savedSessions = localStorage.getItem('chatSessions');
      if (savedId && savedSessions) {
        const parsedSessions = JSON.parse(savedSessions);
        const active = parsedSessions.find((s: ChatSession) => s.id === savedId);
        if (active) return active.messages;
      }
      const old = localStorage.getItem('chatHistory');
      if (old && !savedSessions) {
        const parsed = JSON.parse(old);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch(e) {}
    return [];
  });

  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [input, setInput] = useState("");
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [isImageAnalyzed, setIsImageAnalyzed] = useState(false);
  const [isAnalysisError, setIsAnalysisError] = useState(false);
  const [autoPlayTTS, setAutoPlayTTS] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ mimeType: string; data: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchDateFilter, setSearchDateFilter] = useState<'all' | 'today' | 'last7days' | 'last30days'>('all');
  const [searchSessionFilter, setSearchSessionFilter] = useState<'all' | 'current'>('all');
  const searchRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [ttsVolume, setTtsVolume] = useState<number>(1);
  const [ttsVoiceURI, setTtsVoiceURI] = useState<string>('');
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editInputContent, setEditInputContent] = useState("");

  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [chatSummary, setChatSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const summarizeChat = async () => {
    if (messages.length === 0 || isSummarizing) return;
    setIsSummarizing(true);
    setSummaryModalOpen(true);
    setChatSummary(null);
    
    try {
      const chatText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
      const response = await aiCallWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: {
          parts: [{ text: `Summarize the following chat conversation into a brief, easy-to-read overview:\n\n${chatText}` }]
        }
      }));
      setChatSummary(response.text || "Could not generate summary.");
    } catch (err: any) {
      console.error(err);
      setChatSummary(err.message === 'QUOTA_EXCEEDED' ? "Quota exceeded. Please try again later." : "Error generating summary.");
    } finally {
      setIsSummarizing(false);
    }
  };

  const [isLiveVoiceMode, setIsLiveVoiceMode] = useState(false);
  const [isListeningCommand, setIsListeningCommand] = useState(false);
  const [liveVoiceStatus, setLiveVoiceStatus] = useState<'listening' | 'processing' | 'speaking'>('listening');
  const [spokenLanguage, setSpokenLanguage] = useState<string>(() => {
    try { return localStorage.getItem('spokenLanguage') || ''; } catch(e) { return ''; }
  });

  const isLiveModeRef = useRef(false);
  const liveRecognitionRef = useRef<any>(null);

  useEffect(() => {
     isLiveModeRef.current = isLiveVoiceMode;
  }, [isLiveVoiceMode]);

  useEffect(() => {
     localStorage.setItem('spokenLanguage', spokenLanguage);
  }, [spokenLanguage]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      setProgress(0);
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 98) return prev;
          const delta = Math.max(0.2, (100 - prev) * 0.05);
          return prev + delta;
        });
      }, 50);
    } else {
      setProgress(100);
      const timeout = setTimeout(() => setProgress(0), 400);
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const copyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const listenMessage = (id: string, text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      if (playingMessageId === id) {
        setPlayingMessageId(null);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = ttsVolume;
      const selectedVoice = availableVoices.find(v => v.voiceURI === ttsVoiceURI);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
      utterance.onend = () => setPlayingMessageId(null);
      utterance.onerror = () => setPlayingMessageId(null);
      setPlayingMessageId(id);
      window.speechSynthesis.speak(utterance);
    }
  };

  // Handle input change to stop auto-play if typing
  useEffect(() => {
    if (input && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setPlayingMessageId(null);
    }
  }, [input]);

  // Handle auto-play TTS for new model messages
  useEffect(() => {
    if (isLoading || !autoPlayTTS) return;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'model' && lastMessage.id !== playingMessageId) {
       listenMessage(lastMessage.id, lastMessage.content);
    }
  }, [isLoading, messages, autoPlayTTS]);

  const startEditMessage = (id: string, text: string) => {
    setEditingMessageId(id);
    setEditInputContent(text);
    setTimeout(() => {
      document.getElementById('edit-message-input')?.focus();
    }, 0);
  };

  const deleteMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const togglePinMessage = (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, isPinned: !m.isPinned } : m));
  };

  const rateMessage = (id: string, rating: 'up' | 'down') => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, rating: m.rating === rating ? undefined : rating } : m));
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditInputContent("");
  };

  const saveEdit = (id: string) => {
    const editIndex = messages.findIndex(m => m.id === id);
    if (editIndex === -1) return;

    if (messages[editIndex].role === 'model') {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, content: editInputContent } : m));
      setEditingMessageId(null);
    } else {
      const slicedMessages = messages.slice(0, editIndex);
      const newMessage = { ...messages[editIndex], content: editInputContent };
      const newMessages = [...slicedMessages, newMessage];
      setMessages(newMessages);
      setEditingMessageId(null);
      triggerGeneration(newMessages);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    localStorage.setItem('chatSessions', JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    const loadVoices = () => {
      if (!('speechSynthesis' in window)) return;
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (voices.length > 0 && !ttsVoiceURI) {
        const defaultVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
        setTtsVoiceURI(defaultVoice.voiceURI);
      }
    };

    loadVoices();
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [ttsVoiceURI]);

  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem('activeSessionId', activeSessionId);
    } else {
      localStorage.removeItem('activeSessionId');
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (messages.length > 0) {
      setSessions(prev => {
        let activeId = activeSessionId;
        const exists = prev.find(s => s.id === activeId);
        let title = messages[0].content.trim().slice(0, 30);
        if (messages[0].content.length > 30) title += '...';

        if (exists) {
          return prev.map(s => s.id === activeId ? { ...s, messages, title, updatedAt: Date.now() } : s);
        } else {
          activeId = Date.now().toString();
          setTimeout(() => setActiveSessionId(activeId), 0);
          return [{
            id: activeId,
            title,
            messages,
            updatedAt: Date.now()
          }, ...prev];
        }
      });
    } else if (messages.length === 0 && activeSessionId) {
      setSessions(prev => prev.filter(s => s.id !== activeSessionId));
      setTimeout(() => setActiveSessionId(null), 0);
    }
    
    // Kept for backward compatibility
    localStorage.setItem('chatHistory', JSON.stringify(messages));
    scrollToBottom();
  }, [messages, activeSessionId]);

  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setTimeout(() => {
      document.getElementById('chat-input')?.focus();
    }, 0);
  };

  const clearChat = () => {
    if (activeSessionId) {
      setSessions(prev => prev.filter(s => s.id !== activeSessionId));
      setActiveSessionId(null);
    }
    setMessages([]);
  };

  const loadSession = (id: string) => {
    const s = sessions.find(ses => ses.id === id);
    if (s) {
      setActiveSessionId(id);
      setMessages(s.messages);
    }
  };

  useEffect(() => {
    if (!settingsOpen && !isSidebarOpen && !summaryModalOpen && !audioSettingsOpen && !isLiveVoiceMode) {
       document.getElementById('chat-input')?.focus();
    }
  }, [settingsOpen, isSidebarOpen, summaryModalOpen, audioSettingsOpen, isLiveVoiceMode]);

  const analyzeSelectedImage = async () => {
    setIsAnalyzingImage(true);
    setIsAnalysisError(false);
    setInput("Describe this image, identify objects, and suggest potential uses or questions about it.");
    try {
      const success = await sendMessage();
      if (success) {
        setIsImageAnalyzed(true);
      } else {
        setIsAnalysisError(true);
      }
    } catch (e) {
      setIsAnalysisError(true);
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleImageSelection = (file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({ mimeType: file.type, data: (reader.result as string).split(',')[1] });
        setIsImageAnalyzed(false);
        setIsAnalysisError(false);
      };
      reader.readAsDataURL(file);
  };

  const toggleLiveVoiceMode = () => {
     if (isLiveVoiceMode) {
         stopLiveVoice();
     } else {
         setIsLiveVoiceMode(true);
         isLiveModeRef.current = true;
         startLiveVoiceListening();
     }
  };

  const startLiveVoiceListening = () => {
    if (!isLiveModeRef.current) return;
    setLiveVoiceStatus('listening');
    
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
       alert("Speech Recognition API is not supported in this browser.");
       setIsLiveVoiceMode(false);
       isLiveModeRef.current = false;
       return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    if (spokenLanguage) {
       recognition.lang = spokenLanguage;
    }
    
    recognition.onresult = async (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (transcript.trim()) {
         await handleLiveVoiceTranscript(transcript);
      } else {
         if (isLiveModeRef.current) startLiveVoiceListening();
      }
    };
    
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        alert("Microphone access was denied. Please allow microphone permissions to use voice features.");
        setIsLiveVoiceMode(false);
        isLiveModeRef.current = false;
        return;
      }
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error("Live Voice Error:", event.error);
      }
      if (isLiveModeRef.current) {
         setTimeout(() => {
           if (isLiveModeRef.current && liveVoiceStatus === 'listening') startLiveVoiceListening();
         }, 500);
      }
    };
    
    recognition.onend = () => {
        if (isLiveModeRef.current && liveVoiceStatus === 'listening') {
             startLiveVoiceListening();
        }
    };
    
    liveRecognitionRef.current = recognition;
    try {
        recognition.start();
    } catch(e) {}
  };

  const handleLiveVoiceTranscript = async (transcript: string) => {
      if (!isLiveModeRef.current) return;
      setLiveVoiceStatus('processing');
      
      const newMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: transcript };
      const currentMessages = [...messagesRef.current, newMessage];
      setMessages(currentMessages);

      try {
        const contents = currentMessages.map(m => ({
          role: m.role,
          parts: [{ text: m.content }]
        }));
        
        const modelMessageId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: '' }]);

        const response = await ai.models.generateContentStream({
           model: 'gemini-2.0-flash',
           contents: contents,
           config: {
             systemInstruction: "You are a friendly voice assistant in a live spoken conversation. Keep your answers concise, natural, and conversational. Do not use markdown (like bolding or bullet points), just plain text.",
             tools: [{ googleSearch: {} }]
           }
        });
        
        let aiText = "";
        for await (const chunk of response) {
          if (chunk.text && isLiveModeRef.current) {
            aiText += chunk.text;
            setMessages(prev => 
              prev.map(msg => msg.id === modelMessageId ? { ...msg, content: aiText } : msg)
            );
          }
        }
        
        if (!isLiveModeRef.current) return;
        
        speakLiveVoice(aiText || "I didn't catch that.");
      } catch (err) {
         console.error(err);
         if (!isLiveModeRef.current) return;
         speakLiveVoice("Sorry, I encountered an error.");
      }
  };

  const speakLiveVoice = (text: string) => {
      if (!isLiveModeRef.current) return;
      setLiveVoiceStatus('speaking');
      
      if ('speechSynthesis' in window) {
         window.speechSynthesis.cancel();
         const utterance = new SpeechSynthesisUtterance(text);
         utterance.volume = ttsVolume;
         const selectedVoice = availableVoices.find(v => v.voiceURI === ttsVoiceURI);
         if (selectedVoice) {
           utterance.voice = selectedVoice;
         }
         utterance.onend = () => {
            if (isLiveModeRef.current) {
               startLiveVoiceListening();
            }
         };
         utterance.onerror = () => {
            if (isLiveModeRef.current) {
               startLiveVoiceListening();
            }
         };
         window.speechSynthesis.speak(utterance);
      } else {
         setTimeout(() => {
            if (isLiveModeRef.current) startLiveVoiceListening();
         }, 2000);
      }
  };

  const stopLiveVoice = () => {
     setIsLiveVoiceMode(false);
     isLiveModeRef.current = false;
     if (liveRecognitionRef.current) {
        liveRecognitionRef.current.abort();
     }
     if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
     }
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      startNewChat();
    }
  };

  const renameSession = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTitle = window.prompt("Rename chat", currentTitle);
    if (newTitle && newTitle.trim()) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle.trim() } : s));
    }
  };

  const startVoiceCommand = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
       alert("Speech Recognition API is not supported in this browser.");
       return;
    }
    
    setIsListeningCommand(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    if (spokenLanguage) {
       recognition.lang = spokenLanguage;
    }

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      handleVoiceCommand(transcript);
    };

    recognition.onend = () => {
      setIsListeningCommand(false);
    };

    recognition.onerror = (event: any) => {
      setIsListeningCommand(false);
      if (event.error === 'not-allowed') {
        alert("Microphone access was denied. Please allow microphone permissions to use voice features.");
      }
    };

    recognition.start();
  };

  const handleVoiceCommand = (command: string) => {
   if (command.includes('new chat')) {
       startNewChat();
   } else if (command.includes('clear chat')) {
       clearChat();
   } else if (command.includes('toggle sidebar') || command.includes('open sidebar') || command.includes('close sidebar')) {
       setIsSidebarOpen(prev => !prev);
   } else if (command.includes('send message') || command.includes('send the message')) {
       // Only send if there is text in the input
       const currentInput = document.getElementById('chat-input') as HTMLTextAreaElement;
       if (currentInput && currentInput.value.trim()) {
           sendMessage(currentInput.value);
       }
   } else if (command.includes('copy message')) {
       const msgs = messagesRef.current;
       const lastModelMsg = [...msgs].reverse().find(m => m.role === 'model');
       if (lastModelMsg) copyMessage(lastModelMsg.id, lastModelMsg.content);
   } else if (command.includes('listen to message') || command.includes('read message') || command.includes('stop listening')) {
       const msgs = messagesRef.current;
       const lastModelMsg = [...msgs].reverse().find(m => m.role === 'model');
       if (lastModelMsg) listenMessage(lastModelMsg.id, lastModelMsg.content);
   } else if (command.includes('edit message')) {
       const msgs = messagesRef.current;
       const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user');
       if (lastUserMsg) startEditMessage(lastUserMsg.id, lastUserMsg.content);
   } else if (command.includes('delete message')) {
       const msgs = messagesRef.current;
       if (msgs.length > 0) {
           deleteMessage(msgs[msgs.length - 1].id);
       }
   } else if (command.includes('summarize chat') || command.includes('summarize conversation')) {
       summarizeChat();
       setSettingsOpen(false);
   } else {
       console.log("Unrecognized command:", command);
       // Optional: Add a toast notification or alert for unrecognized command
   }
  };

  const generateImage = async () => {
    const textToSend = input.trim();
    if (!textToSend || isLoading) return;
    
    setInput("");
    const textarea = document.getElementById('chat-input') as HTMLTextAreaElement;
    if (textarea) textarea.style.height = 'auto';
    
    const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: `Generate image: ${textToSend}` };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    
    setIsLoading(true);

    try {
      const response = await aiCallWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: textToSend }]
        }
      }));
      
      let base64Image = "";
      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          base64Image = part.inlineData.data;
          break;
        }
      }
      
      const modelMessageId = (Date.now() + 1).toString();
      if (base64Image) {
        // use image/png per the docs
        const imageUrl = `data:image/png;base64,${base64Image}`;
        const markdownImage = `![Generated Image](${imageUrl})`;
        setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: markdownImage }]);
      } else {
        setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: "Failed to generate image. No image data returned." }]);
      }
    } catch (error: any) {
      console.error(error);
      const message = error.message === 'QUOTA_EXCEEDED' ? "Quota exceeded. Please try again later." : "Sorry, I encountered an error while generating the image.";
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'model', content: message }]);
    } finally {
      setIsLoading(false);
    }
  };

  const startRecording = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech Recognition API is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => {
        const text = prev ? prev + " " + transcript : transcript;
        return text;
      });
      // Try to focus and adjust height
      setTimeout(() => {
        const textarea = document.getElementById('chat-input') as HTMLTextAreaElement;
        if (textarea) {
          textarea.focus();
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
        }
      }, 0);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsRecording(false);
      if (event.error === 'not-allowed') {
        alert("Microphone access was denied. Please allow microphone permissions to use voice features.");
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
  };

  const triggerGeneration = async (currentMessages: ChatMessage[]): Promise<boolean> => {
    setIsLoading(true);

    try {
      const contents = currentMessages.map(m => {
        const parts: any[] = [{ text: m.content }];
        if (m.image) {
          parts.push({ inlineData: { mimeType: m.image.mimeType, data: m.image.data } });
        }
        return { role: m.role, parts };
      });
      
      const modelMessageId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: '', thought: '' }]);

      const response = await aiCallWithRetry(() => ai.models.generateContentStream({
        model: 'gemini-2.0-flash',
        contents: contents,
        config: {
          tools: [{ googleSearch: {} }],
          // Fixed instructions to be more general
          systemInstruction: "You are a helpful AI assistant. You can format responses using markdown tables for tabular options, code blocks, or lists depending on the prompt. If the user asks for news, recent search results, or web data, use your search tool. Provide clear formatting." 
        }
      }));

      let fullText = "";
      let fullThought = "";
      
      for await (const chunk of response) {
        if (chunk.candidates?.[0]?.content?.parts) {
          for (const part of chunk.candidates[0].content.parts) {
            if (part.text) {
              fullText += part.text;
            }
            // Handling 'thought' part which some exp models provide
            if ((part as any).thought) {
              fullThought += (part as any).thought;
            }
          }
          
          setMessages(prev => 
            prev.map(msg => msg.id === modelMessageId ? { ...msg, content: fullText, thought: fullThought } : msg)
          );
        }
      }
      return true;
    } catch (error) {
      console.error("Gemini Error:", error);
      let errorMessage = "Sorry, I encountered an error connecting to the AI. Please try again.";
      if (error instanceof Error && error.message === 'QUOTA_EXCEEDED') {
        errorMessage = "Quota exceeded. Please try again later.";
      } else if (error instanceof Error && error.message.includes('429')) {
        errorMessage = "I am receiving too many requests. Please wait a moment and try again.";
      }
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: errorMessage }]);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (overrideText?: string): Promise<boolean> => {
    const textToSend = overrideText || input.trim();
    if (!textToSend || isLoading) return false;
    
    if (!overrideText) {
      setInput("");
      // Reset textarea height
      const textarea = document.getElementById('chat-input') as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.focus();
      }
    }
    
    let newMessages = messages;
    if (!overrideText) {
      const newMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: textToSend };
      if (selectedImage) {
        newMessage.image = selectedImage;
        setSelectedImage(null);
      }
      newMessages = [...messages, newMessage];
      setMessages(newMessages);
    } else {
      // Regenerate: Remove the last model message if we are regenerating
      if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'model') {
        newMessages = newMessages.slice(0, -1);
      }
      setMessages(newMessages);
    }

    return await triggerGeneration(newMessages);
  };

  const handleSuggestion = (prompt: string, immediate = false) => {
    if (immediate) {
      sendMessage(prompt);
    } else {
      setInput(prompt);
      const textarea = document.getElementById('chat-input') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        setTimeout(() => {
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
        }, 0);
      }
    }
  };

  const [expandedThoughtId, setExpandedThoughtId] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    
    let filteredSessions = sessions;
    
    if (searchSessionFilter === 'current' && activeSessionId) {
      filteredSessions = filteredSessions.filter(s => s.id === activeSessionId);
    }
    
    if (searchDateFilter !== 'all') {
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      let threshold = 0;
      if (searchDateFilter === 'today') threshold = now - day;
      else if (searchDateFilter === 'last7days') threshold = now - 7 * day;
      else if (searchDateFilter === 'last30days') threshold = now - 30 * day;
      
      filteredSessions = filteredSessions.filter(s => s.updatedAt >= threshold);
    }
    
    return filteredSessions.map(s => {
      const msgs = s.messages.filter(m => m.content.toLowerCase().includes(query));
      return msgs.length > 0 ? { session: s, textMatches: msgs } : null;
    }).filter(Boolean) as { session: ChatSession, textMatches: ChatMessage[] }[];
  }, [searchQuery, sessions, searchDateFilter, searchSessionFilter, activeSessionId]);

  const totalSearchResults = useMemo(() => {
    return searchResults.reduce((acc, curr) => acc + curr.textMatches.length, 0);
  }, [searchResults]);

  return (
    <div className="flex flex-col h-[100dvh] bg-theme-bg text-theme-text-p font-inter selection:bg-theme-msg">
      {/* Header */}
      <header className="flex justify-between items-center px-4 py-3 shrink-0 border-b border-theme-border gap-2 sm:gap-4">
        <button onClick={() => setIsSidebarOpen(true)} className="flex justify-center items-center w-10 h-10 hover:bg-theme-input rounded-[6px] transition-colors text-theme-text-s hover:text-theme-text-p shrink-0" aria-label="Open sidebar" aria-expanded={isSidebarOpen}>
          <Menu className="w-5 h-5" />
        </button>
        
        <div className="flex-1 flex justify-center max-w-xl relative">
          <div ref={searchRef} className="relative w-full max-w-[400px]">
            <div className={`flex items-center bg-theme-input border border-theme-border rounded-[8px] px-3 py-1.5 transition-all ${isSearchOpen ? 'ring-1 ring-theme-text-s' : ''}`}>
              <Search className="w-4 h-4 text-theme-text-s mr-2 shrink-0" />
              <input
                type="text"
                aria-label="Search history"
                placeholder="Search history..."
                className="bg-transparent border-none outline-none w-full text-[14px] text-theme-text-p placeholder:text-theme-text-s"
                value={searchQuery}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!isSearchOpen) setIsSearchOpen(true);
                }}
              />
              {searchQuery && (
                 <button onClick={() => setSearchQuery("")} className="ml-2 text-theme-text-s hover:text-theme-text-p shrink-0" aria-label="Clear search"><X className="w-4 h-4" /></button>
              )}
            </div>
            {isSearchOpen && searchQuery.trim() && (
               <div className="absolute top-full mt-2 w-full left-1/2 -translate-x-1/2 bg-[rgba(25,25,25,0.95)] border border-theme-border rounded-[12px] shadow-2xl z-50 overflow-hidden flex flex-col max-h-[60vh] backdrop-blur-md">
                 <div className="p-3 text-[12px] font-semibold text-theme-text-s uppercase tracking-wider border-b border-[rgba(255,255,255,0.05)] flex items-center justify-between">
                   <span>Search Results {totalSearchResults > 0 && <span className="ml-1.5 bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full text-[10px]">{totalSearchResults}</span>}</span>
                 </div>
                 
                 <div className="flex gap-2 p-2 border-b border-[rgba(255,255,255,0.05)] text-[12px] shrink-0">
                   <select aria-label="Filter by details"
                     className="bg-theme-bg border border-theme-border rounded px-2 py-1.5 text-theme-text-p outline-none hover:border-theme-text-s transition-colors cursor-pointer w-full"
                     value={searchDateFilter}
                     onChange={e => setSearchDateFilter(e.target.value as any)}
                   >
                     <option value="all">All time</option>
                     <option value="today">Today</option>
                     <option value="last7days">Last 7 days</option>
                     <option value="last30days">Last 30 days</option>
                   </select>
                   <select aria-label="Filter by details"
                     className="bg-theme-bg border border-theme-border rounded px-2 py-1.5 text-theme-text-p outline-none hover:border-theme-text-s transition-colors cursor-pointer w-full disabled:opacity-50"
                     value={searchSessionFilter}
                     onChange={e => setSearchSessionFilter(e.target.value as any)}
                     disabled={!activeSessionId}
                   >
                     <option value="all">All sessions</option>
                     <option value="current">Current session</option>
                   </select>
                 </div>
                 
                 <div className="overflow-y-auto w-full">
                   {searchResults.length > 0 ? (
                     searchResults.map(({ session, textMatches }) => (
                       <div key={session.id} className="p-3 border-b border-[rgba(255,255,255,0.05)] last:border-none">
                         <div
                           className="font-medium text-[14px] mb-2 cursor-pointer hover:underline text-theme-text-p hover:text-white"
                           onClick={() => {
                             loadSession(session.id);
                             setIsSearchOpen(false);
                           }}
                         >
                           {session.title || "New Chat"}
                         </div>
                         <div className="flex flex-col gap-2">
                           {textMatches.map(m => (
                              <div key={m.id} className="text-[13px] text-theme-text-s bg-[rgba(255,255,255,0.03)] p-2 rounded-[6px]">
                                <span className="font-semibold text-theme-text-p mr-1">{m.role === 'user' ? 'You:' : 'AI:'}</span>
                                <span dangerouslySetInnerHTML={{ __html: m.content.replace(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark class="bg-blue-500/40 text-blue-100 rounded px-1">$1</mark>') }} />
                              </div>
                           ))}
                         </div>
                       </div>
                     ))
                   ) : (
                     <div className="p-4 text-[13px] text-theme-text-s text-center">No results found for "{searchQuery}"</div>
                   )}
                 </div>
               </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-3 text-theme-text-s shrink-0">
          <button 
             onClick={() => setShowPinnedOnly(!showPinnedOnly)}
             className={`hover:bg-[rgba(255,255,255,0.1)] hover:text-theme-text-p rounded-[6px] transition-colors flex items-center justify-center p-1.5 ${showPinnedOnly ? 'text-blue-400 bg-[rgba(255,255,255,0.05)] shadow-inner' : ''}`}
             title="Toggle Pinned Messages" aria-label="Toggle Pinned Messages"
          >
             <Pin className={`w-5 h-5 ${showPinnedOnly ? 'fill-current' : ''}`} />
          </button>
          
          <button 
             onClick={startVoiceCommand}
             className={`hover:bg-[rgba(255,255,255,0.1)] hover:text-theme-text-p rounded-[6px] transition-colors flex items-center justify-center p-1.5 ${isListeningCommand ? 'text-blue-400 bg-[rgba(255,255,255,0.05)] shadow-inner' : ''}`}
             title="Voice Commands (Say 'New chat', 'Clear chat', 'Toggle sidebar', 'Send message', 'Copy message', 'Listen to message', 'Edit message', 'Delete message', 'Summarize chat')" aria-label="Voice Commands (Say 'New chat', 'Clear chat', 'Toggle sidebar', 'Send message', 'Copy message', 'Listen to message', 'Edit message', 'Delete message', 'Summarize chat')"
          >
             <Command className={`w-5 h-5 ${isListeningCommand ? 'animate-pulse' : ''}`} />
          </button>
          
          <button className="hover:bg-theme-input hover:text-theme-text-p rounded-[6px] transition-colors flex items-center justify-center p-1.5" title="Profile" aria-label="Profile">
            <CircleUser className="w-5 h-5" />
          </button>
          
          <div className="relative">
            <button 
              onClick={() => setSettingsOpen(!settingsOpen)} aria-label="Toggle settings menu" aria-expanded={settingsOpen}
              className="hover:bg-theme-input hover:text-theme-text-p rounded-[6px] transition-colors flex items-center justify-center p-1.5"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
                <div className="absolute right-0 top-11 mt-1 w-52 bg-theme-msg border border-theme-border rounded-[12px] shadow-2xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  <button 
                    onClick={() => { startNewChat(); setSettingsOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] text-theme-text-p text-[14px] font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4" /> New chat
                  </button>
                  <button 
                    onClick={() => { setIsSidebarOpen(true); setSettingsOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] text-theme-text-p text-[14px] font-medium transition-colors"
                  >
                    <Clock className="w-4 h-4" /> Chat history
                  </button>
                  <div className="h-px bg-theme-border my-1.5 mx-2" />
                  <button 
                    onClick={() => { clearChat(); setSettingsOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] text-red-500 text-[14px] font-medium transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Clear chat
                  </button>
                  <div className="h-px bg-theme-border my-1.5 mx-2" />
                  <button 
                    onClick={() => { summarizeChat(); setSettingsOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] text-theme-text-p text-[14px] font-medium transition-colors"
                  >
                    <FileText className="w-4 h-4" /> Summarize chat
                  </button>
                  <button 
                    onClick={() => { setAudioSettingsOpen(true); setSettingsOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] text-theme-text-p text-[14px] font-medium transition-colors"
                  >
                    <Volume2 className="w-4 h-4" /> Audio Settings
                  </button>
                  <div className="h-px bg-theme-border my-1.5 mx-2" />
                  <div className="px-4 py-1.5 text-[12px] text-theme-text-s font-semibold uppercase tracking-wider">Export Chat</div>
                  <button 
                    onClick={() => { exportChat('text', messages); setSettingsOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] text-theme-text-p text-[14px] font-medium transition-colors"
                  >
                    <Download className="w-4 h-4" /> As Plain Text
                  </button>
                  <button 
                    onClick={() => { exportChat('json', messages); setSettingsOpen(false); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-[rgba(255,255,255,0.05)] text-theme-text-p text-[14px] font-medium transition-colors"
                  >
                    <Download className="w-4 h-4" /> As JSON
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Summary Modal */}
      {summaryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-theme-msg border border-theme-border rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-5 flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-lg font-semibold text-theme-text-p flex items-center gap-2">
                <FileText className="w-5 h-5" /> Chat Summary
              </h2>
              <button autoFocus onClick={() => setSummaryModalOpen(false)} className="p-1 hover:bg-theme-input rounded text-theme-text-s hover:text-theme-text-p transition-colors" aria-label="Close summary">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-grow text-[14px] text-theme-text-s leading-relaxed pr-2">
              {isSummarizing && !chatSummary ? (
                <div className="flex flex-col items-center justify-center py-10 opacity-70">
                   <div className="flex space-x-2 mb-4">
                     <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                     <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                     <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-bounce"></div>
                   </div>
                   <p>Generating summary...</p>
                </div>
              ) : (
                <div className="markdown-body [&>p]:mb-3 last:[&>p]:mb-0">
                   {chatSummary ? (
                     <ReactMarkdown remarkPlugins={[remarkGfm]}>{chatSummary}</ReactMarkdown>
                   ) : "No summary available."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Audio Settings Modal */}
      {audioSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-theme-msg border border-theme-border rounded-xl shadow-[0_0_40px_rgba(0,0,0,0.5)] p-5">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-lg font-semibold text-theme-text-p">Audio Settings</h2>
              <button autoFocus onClick={() => setAudioSettingsOpen(false)} className="p-1 hover:bg-theme-input rounded text-theme-text-s hover:text-theme-text-p" aria-label="Close audio settings">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-left">
              <div>
                <label className="block text-sm font-medium text-theme-text-p mb-2">Voice</label>
                <select 
                  value={ttsVoiceURI}
                  onChange={e => setTtsVoiceURI(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border text-theme-text-p text-sm rounded-lg px-3 py-2.5 outline-none focus:border-theme-text-s"
                >
                  {availableVoices.map((voice, index) => (
                    <option key={`${voice.voiceURI}-${index}`} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                  {availableVoices.length === 0 && <option value="">Loading voices...</option>}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-theme-text-p">Auto-play TTS</label>
                <input
                  type="checkbox"
                  checked={autoPlayTTS}
                  onChange={e => setAutoPlayTTS(e.target.checked)}
                  className="w-4 h-4 accent-theme-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-p mb-2">Volume: {Math.round(ttsVolume * 100)}%</label>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.1" 
                  value={ttsVolume}
                  onChange={e => setTtsVolume(parseFloat(e.target.value))}
                  className="w-full h-2 bg-theme-bg rounded-lg appearance-none cursor-pointer accent-theme-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-p mb-2">Speech Recognition Language</label>
                <select 
                  value={spokenLanguage}
                  onChange={e => setSpokenLanguage(e.target.value)}
                  className="w-full bg-theme-bg border border-theme-border text-theme-text-p text-sm rounded-lg px-3 py-2.5 outline-none focus:border-theme-text-s"
                >
                  <option value="">Auto-detect / Browser Default</option>
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="es-ES">Spanish</option>
                  <option value="fr-FR">French</option>
                  <option value="de-DE">German</option>
                  <option value="zh-CN">Chinese (Mandarin)</option>
                  <option value="ja-JP">Japanese</option>
                  <option value="ko-KR">Korean</option>
                  <option value="ar-SA">Arabic</option>
                  <option value="hi-IN">Hindi</option>
                  <option value="bn-BD">Bengali</option>
                  <option value="ru-RU">Russian</option>
                  <option value="pt-BR">Portuguese</option>
                  <option value="it-IT">Italian</option>
                </select>
              </div>
            </div>
            
            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => setAudioSettingsOpen(false)}
                className="px-4 py-2 bg-theme-input hover:bg-[rgba(255,255,255,0.1)] text-theme-text-p rounded-lg font-medium transition-colors text-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Voice Mode Overlay */}
      {isLiveVoiceMode && (
        <div className="fixed inset-0 bg-[rgba(15,15,15,0.95)] z-[100] flex flex-col items-center justify-center animate-in fade-in duration-300">
           <button autoFocus
             className="absolute top-6 right-6 p-3 text-theme-text-s hover:text-white hover:bg-[rgba(255,255,255,0.1)] rounded-full transition-colors" 
             onClick={stopLiveVoice}
             title="Close Live Voice" aria-label="Close Live Voice"
           >
              <X className="w-6 h-6" />
           </button>
           
           <div className={`w-40 h-40 rounded-full transition-all duration-500 flex items-center justify-center 
              ${liveVoiceStatus === 'listening' ? 'bg-[rgba(255,255,255,0.1)] animate-pulse' : 
                liveVoiceStatus === 'processing' ? 'bg-blue-500/20 animate-bounce' : 
                'bg-[rgba(255,255,255,0.2)] animate-pulse'}`}>
             <div className={`w-20 h-20 rounded-full shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-colors duration-500
                ${liveVoiceStatus === 'listening' ? 'bg-white' : 
                  liveVoiceStatus === 'processing' ? 'bg-blue-400' : 
                  'bg-white'}`} />
           </div>
           
           <div className="mt-16 text-white text-2xl font-light tracking-wide">
              {liveVoiceStatus === 'listening' ? "Listening..." : 
               liveVoiceStatus === 'processing' ? "Thinking..." : 
               "Speaking..."}
           </div>
           
           <div className="absolute bottom-12 text-theme-text-s text-sm">
             Tap the X to end conversation
           </div>
        </div>
      )}

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex animate-in fade-in duration-200">
          <div className="w-[280px] h-full bg-theme-sidebar border-r border-theme-border flex flex-col pt-4 px-3 pb-3 animate-in slide-in-from-left duration-300 shadow-2xl">
            <div className="flex justify-between items-center mb-6 px-1">
              <h2 className="text-theme-text-p font-semibold">Chats</h2>
              <button autoFocus onClick={() => setIsSidebarOpen(false)} className="p-1.5 hover:bg-theme-input rounded-md text-theme-text-s hover:text-theme-text-p transition-colors" aria-label="Close sidebar">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <button 
              onClick={() => { startNewChat(); setIsSidebarOpen(false); }}
              className="flex w-full items-center justify-center gap-2 py-2.5 mb-4 border border-theme-border rounded-lg text-theme-text-p hover:bg-theme-input transition-colors font-medium text-sm"
            >
              <Plus className="w-4 h-4" /> New chat
            </button>
            
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {sessions.length === 0 ? (
                <div className="text-theme-text-s text-sm px-2 text-center mt-10">No chat history</div>
              ) : (
                sessions.map(session => (
                  <button 
                    key={session.id}
                    onClick={() => { loadSession(session.id); setIsSidebarOpen(false); }}
                    className={`flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-left transition-colors group ${activeSessionId === session.id ? 'bg-[rgba(255,255,255,0.1)] text-theme-text-p font-medium' : 'text-theme-text-s hover:bg-[rgba(255,255,255,0.05)] hover:text-theme-text-p'}`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <span className="truncate">{session.title}</span>
                    </div>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2 bg-theme-sidebar sm:bg-transparent">
                      <div onClick={(e) => renameSession(session.id, session.title, e)} className="p-1.5 hover:bg-[rgba(255,255,255,0.1)] rounded text-theme-text-s hover:text-theme-text-p" title="Rename" aria-label="Rename">
                        <Edit2 className="w-3.5 h-3.5" />
                      </div>
                      <div onClick={(e) => deleteSession(session.id, e)} className="p-1.5 hover:bg-[rgba(255,255,255,0.1)] rounded text-theme-text-s hover:text-red-400" title="Delete" aria-label="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="flex-1" onClick={() => setIsSidebarOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto min-h-0 px-4 flex flex-col pt-4">
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col justify-end w-full max-w-3xl mx-auto pb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col gap-6 mb-8">
               <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-white to-[#9b9b9b] bg-clip-text text-transparent px-2">
                 How can I help you today?
               </h1>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-2">
                 {[
                   { icon: Sparkles, text: "What are some creative ways to use AI in my daily life?", color: "text-blue-400" },
                   { icon: Brain, text: "Explain quantum physics in simple terms.", color: "text-purple-400" },
                   { icon: Globe, text: "5-day travel itinerary for Tokyo.", color: "text-green-400" },
                   { icon: PenLine, text: "Write a short story about a time-traveling historian.", color: "text-orange-400" },
                   { icon: MessageSquare, text: "How do I start learning a new language effectively?", color: "text-cyan-400" }
                 ].map((item, idx) => (
                   <button 
                     key={idx}
                     onClick={() => handleSuggestion(item.text, true)}
                     className="flex flex-col items-start p-4 bg-theme-input border border-theme-border rounded-xl text-left hover:bg-[rgba(255,255,255,0.08)] hover:border-theme-text-s/30 transition-all group"
                   >
                     <item.icon className={`w-5 h-5 mb-3 ${item.color} group-hover:scale-110 transition-transform`} />
                     <span className="text-sm font-medium text-theme-text-p line-clamp-2">{item.text}</span>
                   </button>
                 ))}
               </div>
            </div>

            <div className="flex flex-col space-y-4 text-[14px] font-medium text-theme-text-s mb-2 pl-4 border-l border-theme-border/50">
              <button onClick={() => handleSuggestion("Create a beautiful image of...")} className="flex items-center gap-4 text-theme-text-s hover:text-theme-text-p transition-colors text-left outline-none">
                <ImageIcon className="w-6 h-6" />
                Create an image
              </button>
              <button onClick={() => handleSuggestion("Help me write or edit...")} className="flex items-center gap-4 text-theme-text-s hover:text-theme-text-p transition-colors text-left outline-none">
                <PenLine className="w-6 h-6" />
                Write or edit
              </button>
              <button onClick={() => handleSuggestion("Look up information about...")} className="flex items-center gap-4 text-theme-text-s hover:text-theme-text-p transition-colors text-left outline-none">
                <Globe className="w-6 h-6" />
                Look something up
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-3xl mx-auto flex flex-col space-y-6 pb-4">
            {showPinnedOnly && messages.filter(m => m.isPinned).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-theme-text-s">
                <Pin className="w-12 h-12 mb-4 opacity-20" />
                <p>No pinned messages in this session.</p>
              </div>
            ) : (showPinnedOnly ? messages.filter(m => m.isPinned) : messages).map(msg => {
              const isUser = msg.role === 'user';
              return (
                <div key={msg.id} className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {isUser ? (
                    <div className="flex flex-col items-end w-full group">
                      {editingMessageId === msg.id ? (
                        <div className="w-full max-w-[85%] sm:max-w-[75%] bg-theme-input p-3 rounded-2xl border border-theme-border flex flex-col gap-2">
                           <textarea id="edit-message-input" aria-label="Edit message" 
                             className="w-full bg-transparent text-theme-text-p outline-none resize-none min-h-[80px]"
                             value={editInputContent}
                             onChange={e => setEditInputContent(e.target.value)}
                           />
                           <div className="flex justify-end gap-2">
                             <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg bg-theme-bg text-theme-text-s hover:text-theme-text-p text-sm transition-colors border border-theme-border">Cancel</button>
                             <button onClick={() => saveEdit(msg.id)} disabled={isLoading} className="px-3 py-1.5 rounded-lg bg-white text-black text-sm hover:opacity-90 transition-opacity font-medium disabled:opacity-50">Save & Submit</button>
                           </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end">
                          {msg.isPinned && (
                            <div className="flex items-center gap-1 text-theme-text-s opacity-80 text-[11px] font-semibold uppercase tracking-wide mb-1.5 mr-2">
                              <Pin className="w-3 h-3 fill-current text-blue-400" /> Pinned
                            </div>
                          )}
                          <div className={`max-w-[85%] sm:max-w-[75%] px-5 py-3.5 bg-theme-msg text-[15px] leading-[1.6] text-theme-text-p rounded-3xl rounded-tr-lg ${msg.isPinned ? 'ring-1 ring-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.05)]' : ''}`}>
                            {msg.image && (
                              <img src={`data:${msg.image.mimeType};base64,${msg.image.data}`} className="max-h-64 rounded-xl mb-2" alt="Uploaded"/>
                            )}
                            <div className="whitespace-pre-wrap word-break break-words">{msg.content}</div>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 mr-2">
                            <span className="text-[11px] text-theme-text-s opacity-60 font-medium tracking-wide">
                              {new Date(parseInt(msg.id)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <div className="flex transition-opacity opacity-100">
                              <button onClick={() => startEditMessage(msg.id, msg.content)} className="p-1 hover:bg-theme-input text-theme-text-s hover:text-theme-text-p rounded-full" title="Edit" aria-label="Edit">
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => copyMessage(msg.id, msg.content)} className="p-1 hover:bg-theme-input text-theme-text-s hover:text-theme-text-p rounded-full" title="Copy" aria-label="Copy">
                                {copiedId === msg.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              <button onClick={() => listenMessage(msg.id, msg.content)} className={`p-1 hover:bg-theme-input rounded-full ${playingMessageId === msg.id ? 'text-theme-text-p' : 'text-theme-text-s hover:text-theme-text-p'}`} title={playingMessageId === msg.id ? "Stop listening" : "Listen"} aria-label={playingMessageId === msg.id ? "Stop listening" : "Listen"}>
                                {playingMessageId === msg.id ? <Square fill="currentColor" className="w-3.5 h-3.5 text-blue-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                              </button>
                              <button onClick={() => togglePinMessage(msg.id)} className="p-1 hover:bg-theme-input text-theme-text-s hover:text-theme-text-p rounded-full" title={msg.isPinned ? "Unpin" : "Pin"} aria-label={msg.isPinned ? "Unpin" : "Pin"}>
                                <Pin className={`w-3.5 h-3.5 ${msg.isPinned ? 'fill-current text-blue-400' : ''}`} />
                              </button>
                              <button onClick={() => deleteMessage(msg.id)} className="p-1 hover:bg-theme-input text-theme-text-s hover:text-red-400 rounded-full" title="Delete" aria-label="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full max-w-full text-theme-text-p text-[15px] leading-[1.6] pr-4 flex flex-col group">
                      {editingMessageId === msg.id ? (
                        <div className="w-full mb-4 bg-theme-msg p-3 rounded-2xl border border-theme-border flex flex-col gap-2">
                           <textarea id="edit-message-input" aria-label="Edit message"
                             className="w-full bg-transparent text-theme-text-p outline-none resize-y min-h-[120px] font-mono text-sm leading-relaxed"
                             value={editInputContent}
                             onChange={e => setEditInputContent(e.target.value)}
                           />
                           <div className="flex justify-end gap-2 text-sm mt-1">
                             <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg bg-theme-bg text-theme-text-s hover:text-theme-text-p transition-colors border border-theme-border">Cancel</button>
                             <button onClick={() => saveEdit(msg.id)} className="px-3 py-1.5 rounded-lg bg-white text-black font-medium hover:opacity-90 transition-opacity">Save</button>
                           </div>
                        </div>
                      ) : (
                        <div className={`flex flex-col items-start px-2 sm:px-4 py-2 sm:py-3 rounded-2xl ${msg.isPinned ? 'bg-[rgba(59,130,246,0.02)] ring-1 ring-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.03)]' : ''}`}>
                          {msg.isPinned && (
                            <div className="flex items-center gap-1 text-theme-text-s opacity-80 text-[11px] font-semibold uppercase tracking-wide mb-3">
                              <Pin className="w-3 h-3 fill-current text-blue-400" /> Pinned
                            </div>
                          )}

                          {/* Enhanced Loading Indicator integrated into message area */}
                          {isLoading && msg.id === messages[messages.length - 1]?.id && (
                            <motion.div 
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="w-full max-w-[240px] mb-4 space-y-2 pointer-events-none"
                            >
                              <div className="flex justify-between items-center text-[10px] text-theme-text-s font-bold uppercase tracking-widest opacity-80">
                                <span className="flex items-center gap-2">
                                  <Sparkles className="w-3 h-3 animate-pulse text-blue-400" />
                                  AI Thinking
                                </span>
                                <span className="font-mono text-theme-accent">{Math.round(progress)}%</span>
                              </div>
                              <div className="h-1 w-full bg-[rgba(255,255,255,0.05)] rounded-full overflow-hidden relative">
                                <motion.div 
                                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full shadow-[0_0_10px_rgba(96,165,250,0.5)]"
                                  initial={{ width: "0%" }}
                                  animate={{ width: `${progress}%` }}
                                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                                />
                                <motion.div 
                                  className="absolute top-0 left-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                                  animate={{ x: ["-100%", "100%"] }}
                                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                                />
                              </div>
                            </motion.div>
                          )}

                          {/* Thinking Process (Thought Part) */}
                          {msg.thought && (
                            <div className="mb-4 w-full">
                              <button 
                                onClick={() => setExpandedThoughtId(expandedThoughtId === msg.id ? null : msg.id)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.03)] border border-theme-border/50 text-[12px] font-semibold text-theme-text-s hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                              >
                                <Brain className="w-3.5 h-3.5" />
                                {expandedThoughtId === msg.id ? "Hide Thinking Process" : "Show Thinking Process"}
                                <motion.span
                                  animate={{ rotate: expandedThoughtId === msg.id ? 180 : 0 }}
                                  className="ml-1"
                                >
                                  ▼
                                </motion.span>
                              </button>
                              <AnimatePresence>
                                {expandedThoughtId === msg.id && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-2 p-4 rounded-xl bg-[rgba(255,255,255,0.02)] border-l-2 border-theme-text-s/20 italic text-[13px] text-theme-text-s/80 whitespace-pre-wrap leading-relaxed shadow-inner">
                                      {msg.thought}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}

                          {msg.content ? (
                            <div className="markdown-body [&>p]:mb-4 last:[&>p]:mb-0 [&>ul]:list-disc [&>ul]:ml-5 [&>ul]:mb-4 [&>ol]:list-decimal [&>ol]:ml-5 [&>ol]:mb-4 [&>li]:mb-1.5 [&>li::marker]:text-theme-text-s [&>pre]:bg-[#0d0d0d] [&>pre]:p-4 [&>pre]:rounded-[6px] [&>pre]:overflow-x-auto [&>pre]:mb-4 [&>pre]:border [&>pre]:border-theme-border [&>a]:text-blue-400 [&>a]:underline [&>h1]:text-2xl [&>h1]:font-bold [&>h1]:mb-4 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:mb-3 [&>h3]:text-lg [&>h3]:font-bold [&>h3]:mb-2">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  code: CodeBlock,
                                  blockquote({ node, children, ...props }: any) {
                                    return (
                                      <blockquote className="border-l-4 border-theme-border pl-4 italic text-theme-text-s my-4" {...props}>
                                        {children}
                                      </blockquote>
                                    )
                                  },
                                  table({ node, children, ...props }: any) {
                                    return (
                                      <div className="overflow-x-auto my-4">
                                        <table className="min-w-full border-collapse border border-theme-border" {...props}>
                                          {children}
                                        </table>
                                      </div>
                                    )
                                  },
                                  th({ node, children, ...props }: any) {
                                    return <th className="border border-theme-border px-4 py-2 bg-theme-input text-left text-theme-text-p font-semibold" {...props}>{children}</th>
                                  },
                                  td({ node, children, ...props }: any) {
                                    return <td className="border border-theme-border px-4 py-2" {...props}>{children}</td>
                                  }
                                }}
                              >
                                {msg.content + (isLoading && msg.id === messages[messages.length - 1]?.id ? ' ▍' : '')}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <div className="flex space-x-1.5 items-center h-6 px-1">
                              <motion.div 
                                animate={{ scale: [1, 1.2, 1] }} 
                                transition={{ repeat: Infinity, duration: 1, delay: 0 }}
                                className="w-1.5 h-1.5 bg-blue-400 rounded-full" 
                              />
                              <motion.div 
                                animate={{ scale: [1, 1.2, 1] }} 
                                transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                                className="w-1.5 h-1.5 bg-blue-400 rounded-full opacity-60" 
                              />
                              <motion.div 
                                animate={{ scale: [1, 1.2, 1] }} 
                                transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                                className="w-1.5 h-1.5 bg-blue-400 rounded-full opacity-30" 
                              />
                            </div>
                          )}
                          
                          <div className="flex items-center gap-3 mt-2 text-theme-text-s">
                            <span className="text-[11px] opacity-60 font-medium tracking-wide">
                              {new Date(parseInt(msg.id)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <div className="flex items-center gap-1 transition-opacity opacity-100">
                               <button onClick={() => rateMessage(msg.id, 'up')} className={`p-1.5 hover:bg-theme-input hover:text-theme-text-p rounded-md transition-colors ${msg.rating === 'up' ? 'text-green-500' : ''}`} title="Thumbs up" aria-label="Thumbs up">
                                 <ThumbsUp className="w-4 h-4" />
                               </button>
                               <button onClick={() => rateMessage(msg.id, 'down')} className={`p-1.5 hover:bg-theme-input hover:text-theme-text-p rounded-md transition-colors ${msg.rating === 'down' ? 'text-red-500' : ''}`} title="Thumbs down" aria-label="Thumbs down">
                                 <ThumbsDown className="w-4 h-4" />
                               </button>
                              <button onClick={() => startEditMessage(msg.id, msg.content)} className="p-1.5 hover:bg-theme-input hover:text-theme-text-p rounded-md transition-colors" title="Edit" aria-label="Edit">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => listenMessage(msg.id, msg.content)} className={`p-1.5 hover:bg-theme-input transition-colors rounded-md ${playingMessageId === msg.id ? 'text-theme-text-p bg-theme-input shadow-inner' : 'hover:text-theme-text-p'}`} title={playingMessageId === msg.id ? "Stop listening" : "Listen"} aria-label={playingMessageId === msg.id ? "Stop listening" : "Listen"}>
                                {playingMessageId === msg.id ? <Square fill="currentColor" className="w-4 h-4 text-blue-400" /> : <Volume2 className="w-4 h-4" />}
                              </button>
                              <button onClick={() => copyMessage(msg.id, msg.content)} className="p-1.5 hover:bg-theme-input hover:text-theme-text-p rounded-md transition-colors" title="Copy" aria-label="Copy">
                                {copiedId === msg.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                              </button>
                              <button onClick={() => togglePinMessage(msg.id)} className="p-1.5 hover:bg-theme-input hover:text-theme-text-p rounded-md transition-colors" title={msg.isPinned ? "Unpin" : "Pin"} aria-label={msg.isPinned ? "Unpin" : "Pin"}>
                                <Pin className={`w-4 h-4 ${msg.isPinned ? 'fill-current text-blue-400' : ''}`} />
                              </button>
                              <button onClick={() => deleteMessage(msg.id)} className="p-1.5 hover:bg-theme-input hover:text-red-400 rounded-md transition-colors" title="Delete" aria-label="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                              {/* Regenerate visible on last message */}
                              {msg.id === messages[messages.length - 1]?.id && !isLoading && (
                                <button onClick={() => sendMessage(messages[messages.length - 2]?.content)} className="p-1.5 hover:bg-theme-input hover:text-theme-text-p rounded-md transition-colors" title="Regenerate" aria-label="Regenerate">
                                  <RefreshCcw className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="sticky bottom-0 z-50 bg-theme-bg px-4 pb-4 w-full flex flex-col items-center shrink-0">
        <div className="w-full max-w-3xl flex flex-col">
          <div className={`w-full mb-2 transition-opacity duration-300 ${progress > 0 ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden mb-0'}`}>
            <div className="flex justify-between items-center mb-1 text-[11px] text-theme-text-s">
              <span>{progress === 100 ? 'Completed' : 'Generating response...'}</span>
              <span className="font-mono">{Math.round(progress)}%</span>
            </div>
            <div className="h-1 w-full bg-[rgba(255,255,255,0.05)] rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-400 transition-all duration-75 ease-out rounded-full shadow-[0_0_8px_rgba(96,165,250,0.6)]" 
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
        <div className="w-full max-w-3xl relative flex items-end bg-theme-input border border-theme-border rounded-[12px] px-3 py-2 shadow-[0_0_20px_rgba(0,0,0,0.2)] transition-colors focus-within:ring-1 focus-within:ring-theme-border focus-within:ring-offset-0">
          
          <button onClick={() => fileInputRef.current?.click()} className="p-2.5 mb-[2px] bg-[rgba(255,255,255,0.1)] text-theme-text-p hover:opacity-80 rounded-[6px] transition-opacity shrink-0" aria-label="Add attachment">
            <Plus className="w-5 h-5" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={(e) => {
               const file = e.target.files?.[0];
               if (file) {
                 handleImageSelection(file);
               }
            }}
          />
          
          {selectedImage && (
             <div className="absolute bottom-[calc(100%+8px)] left-0 bg-theme-msg border border-theme-border rounded-lg p-2 flex items-center gap-2 z-10">
                <img src={`data:${selectedImage.mimeType};base64,${selectedImage.data}`} className="w-16 h-16 rounded object-cover" alt="Preview"/>
                <div className="flex flex-col gap-1">
                  <button onClick={() => setSelectedImage(null)} className="p-1 hover:bg-theme-input rounded">
                      <X className="w-4 h-4"/>
                  </button>
                  <button onClick={analyzeSelectedImage} disabled={isAnalyzingImage || isImageAnalyzed} className={`p-1 hover:bg-theme-input rounded flex items-center gap-1 text-xs ${isAnalysisError ? 'text-red-400' : ''}`} title="Analyze Image">
                      {isAnalyzingImage ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Brain className="w-4 h-4"/>}
                      {isAnalyzingImage ? "Analyzing..." : isAnalysisError ? "Error" : isImageAnalyzed ? "Analyzed" : "Analyze Image"}
                  </button>
                </div>
             </div>
          )}
          
          {/* Dynamic Textarea */}
          <textarea 
            id="chat-input" aria-label="Chat message input"
            autoFocus
            value={input}
            maxLength={500}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Message ChatGPT..."
            className="flex-1 max-h-[150px] min-h-[44px] bg-transparent text-theme-text-p placeholder-theme-text-s outline-none px-3 py-3 resize-none w-full text-[15px] leading-[1.4]"
            disabled={isLoading}
            rows={1}
          />
          
          {/* Actions */}
          <div className="flex items-center gap-1.5 mb-[2px] shrink-0 ml-1">
            <button 
              onClick={startRecording}
              className={`p-2 transition-colors flex items-center justify-center rounded-[6px] ${isRecording ? 'text-red-500 animate-pulse bg-[rgba(255,0,0,0.1)]' : 'text-theme-text-s hover:bg-[rgba(255,255,255,0.1)] hover:text-theme-text-p'}`}
              title={isRecording ? "Recording..." : "Start voice input"} aria-label={isRecording ? "Recording..." : "Start voice input"}
            >
              <Mic className="w-5 h-5" />
            </button>
            {input.trim() ? (
              <>
                <button 
                  onClick={generateImage}
                  disabled={isLoading}
                  className="w-8 h-8 flex justify-center items-center bg-[rgba(255,255,255,0.1)] text-theme-text-p hover:bg-[rgba(255,255,255,0.2)] rounded-[6px] transition-colors disabled:opacity-50"
                  title="Generate Image" aria-label="Generate Image"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => sendMessage()} 
                  disabled={isLoading || (selectedImage !== null && !isImageAnalyzed)} 
                  className="w-8 h-8 flex justify-center items-center bg-[rgba(255,255,255,0.1)] text-theme-text-p hover:bg-[rgba(255,255,255,0.2)] rounded-[6px] transition-colors disabled:opacity-50"
                  aria-label="Send message"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button onClick={toggleLiveVoiceMode} className="p-2 text-theme-text-s hover:bg-[rgba(255,255,255,0.1)] hover:text-theme-text-p rounded-[6px] transition-colors flex items-center justify-center" title="Live Voice Mode" aria-label="Live Voice Mode">
                <AudioLines className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        <div className="w-full max-w-3xl flex justify-between items-center px-1 mt-2">
          <div className="flex-1" />
          <div className="text-[11px] text-theme-text-s text-center shrink-0 ml-auto mr-auto absolute left-1/2 -translate-x-1/2">
            ChatGPT can make mistakes. Check important info.
          </div>
          <div className="text-[11px] text-theme-text-s shrink-0 font-mono">
            {input.length} / 500
          </div>
        </div>
      </footer>
    </div>
  );
}

