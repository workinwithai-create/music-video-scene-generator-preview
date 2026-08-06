import React, { useState } from 'react';
import { 
  Play, Copy, RefreshCw, Download, Music, Video, Palette, 
  Clock, Sparkles, ChevronDown, ChevronUp, Settings, Film 
} from 'lucide-react';

// ==================== TYPES ====================
interface Scene {
  id: string;
  section: string;
  startTime: string;
  endTime: string;
  prompt: string;
  visualElements: string[];
  cameraMovement: string;
  lighting: string;
  colorGrade: string;
  mood: string;
}

interface StylePreset {
  id: string;
  label: string;
  description: string;
  accentColor: string;
  keywords: string[];
}

interface RunwayGeneration {
  sceneId: string;
  status: 'idle' | 'generating' | 'completed' | 'failed';
  videoUrl?: string;
  taskId?: string;
  error?: string;
  model: string;
  duration: number;
}

// ==================== STYLE PRESETS ====================
const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'cyber-western',
    label: 'Cyber-Western',
    description: 'Neon desert, holographic cacti, chrome horses, dust + digital rain',
    accentColor: '#f97316',
    keywords: ['neon', 'desert', 'holographic', 'chrome', 'dusty', 'cyberpunk western']
  },
  {
    id: 'neon-pulse',
    label: 'Neon Pulse (Smule)',
    description: 'Vibrant nightclub, pulsing lights, reflections on wet streets, electric atmosphere',
    accentColor: '#a855f7',
    keywords: ['neon', 'club', 'pulse', 'wet reflections', 'electric', 'nightlife']
  },
  {
    id: 'sultry-erotic',
    label: 'Sultry Erotic',
    description: 'Dim red lighting, silk sheets, candlelight, intimate close-ups, warm shadows',
    accentColor: '#ef4444',
    keywords: ['red light', 'silk', 'intimate', 'warm shadows', 'candlelight', 'sensual']
  },
  {
    id: 'raw-country-ballad',
    label: 'Raw Country Ballad',
    description: 'Golden hour fields, worn leather, truck beds, honest faces, dust in sunlight',
    accentColor: '#eab308',
    keywords: ['golden hour', 'leather', 'fields', 'truck', 'honest', 'americana']
  },
  {
    id: 'spiritual-redemption',
    label: 'Spiritual / Redemption',
    description: 'Cathedral light through stained glass, rain on windows, solitary figure praying, hopeful dawn',
    accentColor: '#3b82f6',
    keywords: ['stained glass', 'light rays', 'rain', 'prayer', 'dawn', 'redemption']
  },
  {
    id: 'pre-dawn-monterey',
    label: 'Pre-Dawn Monterey',
    description: 'Salt air kitchen, foggy windows, coffee steam, early light over Pacific, quiet intensity',
    accentColor: '#64748b',
    keywords: ['fog', 'kitchen', 'coffee', 'pacific', 'early light', 'salt air', 'cinematic']
  },
  {
    id: 'hick-hop',
    label: 'Hick-Hop / Country-Rap',
    description: 'Dirt roads at night, lifted trucks, bonfire parties, gold chains + cowboy hats',
    accentColor: '#22c55e',
    keywords: ['dirt road', 'truck', 'bonfire', 'night', 'country rap', 'southern']
  }
];

// ==================== RUNWAY MODELS (2026) ====================
const RUNWAY_MODELS = [
  { id: 'gen3_turbo', label: 'Gen-3 Turbo (Legacy)', creditsPerSec: 5, note: 'Being deprecated July 2026' },
  { id: 'gen4_turbo', label: 'Gen-4 Turbo', creditsPerSec: 5, note: 'Fast & high quality' },
  { id: 'gen4.5', label: 'Gen-4.5 (Recommended)', creditsPerSec: 8, note: 'Best quality' },
];

const MusicVideoSceneGeneratorWithRunway: React.FC = () => {
  // ==================== STATE ====================
  const [songTitle, setSongTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [styleDescription, setStyleDescription] = useState('');
  const [selectedPresets, setSelectedPresets] = useState<string[]>(['cyber-western']);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [sceneCount, setSceneCount] = useState(6);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sunoStylePrompt, setSunoStylePrompt] = useState('');
  const [showSunoSection, setShowSunoSection] = useState(true);
  const [activeTab, setActiveTab] = useState<'scenes' | 'suno' | 'runway'>('scenes');

  // Runway Integration State
  const [runwayApiKey, setRunwayApiKey] = useState('');
  const [selectedRunwayModel, setSelectedRunwayModel] = useState('gen4.5');
  const [defaultDuration, setDefaultDuration] = useState(5);
  const [runwayGenerations, setRunwayGenerations] = useState<Record<string, RunwayGeneration>>({});
  const [showRunwaySettings, setShowRunwaySettings] = useState(false);

  // ==================== HELPERS ====================
  const togglePreset = (presetId: string) => {
    setSelectedPresets(prev =>
      prev.includes(presetId)
        ? prev.filter(id => id !== presetId)
        : [...prev, presetId]
    );
  };

  const parseLyricsIntoSections = (rawLyrics: string): { section: string; text: string }[] => {
    const lines = rawLyrics.trim().split('\n').filter(Boolean);
    const sections: { section: string; text: string }[] = [];
    let currentSection = 'Verse 1';
    let currentText: string[] = [];

    const sectionRegex = /^\[(Verse|Chorus|Bridge|Intro|Outro|Pre-Chorus|Hook)\s*\d*\]/i;

    lines.forEach(line => {
      const match = line.match(sectionRegex);
      if (match) {
        if (currentText.length > 0) {
          sections.push({ section: currentSection, text: currentText.join(' ') });
        }
        currentSection = match[0].replace(/[\[\]]/g, '');
        currentText = [];
      } else {
        currentText.push(line.trim());
      }
    });

    if (currentText.length > 0) {
      sections.push({ section: currentSection, text: currentText.join(' ') });
    }

    if (sections.length === 0 && rawLyrics.trim()) {
      const chunks = rawLyrics.trim().split(/\n\s*\n/).filter(Boolean);
      chunks.forEach((chunk, i) => {
        sections.push({ 
          section: i === 0 ? 'Verse 1' : i === 1 ? 'Chorus' : `Section ${i + 1}`, 
          text: chunk.replace(/\n/g, ' ') 
        });
      });
    }

    return sections.slice(0, sceneCount);
  };

  const generateScenePrompt = (
    section: string, 
    lyricText: string, 
    presets: string[], 
    customStyle: string,
    songTitle: string
  ) => {
    const activePresets = STYLE_PRESETS.filter(p => presets.includes(p.id));
    const presetKeywords = activePresets.flatMap(p => p.keywords).join(', ');
    const presetLabels = activePresets.map(p => p.label).join(' + ');

    const moodFromLyrics = lyricText.length > 40 
      ? lyricText.slice(0, 120) + (lyricText.length > 120 ? '...' : '')
      : 'emotional performance moment';

    const baseVisual = `${presetLabels} aesthetic, ${presetKeywords}`;

    const prompt = `Cinematic music video scene for "${songTitle}" — ${section}. ${baseVisual}. ${customStyle}. ${moodFromLyrics}. Highly detailed, filmic lighting, emotional atmosphere, professional music video cinematography, smooth camera motion, 8k.`;

    let camera = 'Slow cinematic push-in with subtle handheld feel';
    let lighting = 'Dramatic cinematic lighting with practical sources';
    let colorGrade = 'Film emulation grade with rich contrast';
    let visualElements = ['performer', 'atmospheric environment'];

    if (presets.includes('cyber-western')) {
      camera = 'Wide establishing shot → slow push to hero';
      lighting = 'Neon rim lights + warm practicals, volumetric dust';
      colorGrade = 'Cyan-orange split tone, high contrast, film grain';
      visualElements = ['holographic elements', 'neon signs', 'desert landscape'];
    } else if (presets.includes('pre-dawn-monterey')) {
      camera = 'Static wide with very slow subtle drift';
      lighting = 'Soft pre-dawn window light + warm lamp glow';
      colorGrade = 'Cool blue-gray morning with warm interior accents';
      visualElements = ['fogged windows', 'coffee steam', 'ocean horizon'];
    }

    return {
      section,
      prompt,
      visualElements,
      cameraMovement: camera,
      lighting,
      colorGrade,
      mood: moodFromLyrics
    };
  };

  // ==================== MAIN GENERATE ====================
  const handleGenerate = async () => {
    if (!songTitle.trim() || (!lyrics.trim() && !styleDescription.trim())) {
      alert('Please provide a song title and lyrics or style description.');
      return;
    }

    setIsGenerating(true);
    await new Promise(resolve => setTimeout(resolve, 750));

    const sections = parseLyricsIntoSections(lyrics);
    const effectiveSections = sections.length > 0 ? sections : [
      { section: 'Intro', text: styleDescription || 'opening moment' },
      { section: 'Verse 1', text: lyrics || styleDescription },
      { section: 'Chorus', text: 'emotional peak' },
      { section: 'Verse 2', text: lyrics || styleDescription },
      { section: 'Bridge', text: 'reflective moment' },
      { section: 'Final Chorus', text: 'powerful resolution' }
    ].slice(0, sceneCount);

    const generatedScenes: Scene[] = effectiveSections.map((sec, index) => {
      const sceneData = generateScenePrompt(sec.section, sec.text, selectedPresets, styleDescription, songTitle);
      const duration = Math.floor(180 / effectiveSections.length);
      const start = index * duration;
      const end = start + duration;

      return {
        id: `scene-${Date.now()}-${index}`,
        ...sceneData,
        startTime: `${Math.floor(start / 60)}:${(start % 60).toString().padStart(2, '0')}`,
        endTime: `${Math.floor(end / 60)}:${(end % 60).toString().padStart(2, '0')}`
      };
    });

    const presetStyles = STYLE_PRESETS
      .filter(p => selectedPresets.includes(p.id))
      .map(p => p.description)
      .join('. ');

    const fullStyle = [presetStyles, styleDescription, `Cinematic ${aspectRatio} music video, smooth motion`]
      .filter(Boolean).join('. ');

    setSunoStylePrompt(fullStyle);
    setScenes(generatedScenes);
    setActiveTab('scenes');
    setIsGenerating(false);
  };

  // ==================== RUNWAY INTEGRATION ====================
  const getRunwayModelInfo = (modelId: string) => {
    return RUNWAY_MODELS.find(m => m.id === modelId) || RUNWAY_MODELS[2];
  };

  const estimateRunwayCost = (duration: number) => {
    const model = getRunwayModelInfo(selectedRunwayModel);
    const credits = duration * model.creditsPerSec;
    return (credits * 0.01).toFixed(2); // $0.01 per credit
  };

  // This is the key function you will replace with real backend call
  const generateRunwayVideo = async (scene: Scene) => {
    if (!runwayApiKey) {
      alert('Please enter your Runway API key in the settings panel first.\n\nFor production, store this securely in environment variables or Supabase secrets.');
      setShowRunwaySettings(true);
      return;
    }

    const modelInfo = getRunwayModelInfo(selectedRunwayModel);
    const duration = defaultDuration;

    // Set generating state
    setRunwayGenerations(prev => ({
      ...prev,
      [scene.id]: {
        sceneId: scene.id,
        status: 'generating',
        model: selectedRunwayModel,
        duration,
      }
    }));

    // =============================================
    // TODO: REPLACE THIS SIMULATION WITH REAL CALL
    // Recommended production pattern:
    // 1. Call your own backend (Supabase Edge Function / Vercel API route)
    // 2. Backend uses official @runwayml/sdk with secret key
    // 3. Return taskId or video URL
    // =============================================

    try {
      // Simulate API call (2.5 - 8 seconds depending on model)
      const simTime = selectedRunwayModel === 'gen4.5' ? 6500 : 3200;
      await new Promise(resolve => setTimeout(resolve, simTime));

      // Mock successful result
      const mockVideoUrl = `https://mock-runway-video.example.com/${scene.id}.mp4`;

      setRunwayGenerations(prev => ({
        ...prev,
        [scene.id]: {
          sceneId: scene.id,
          status: 'completed',
          videoUrl: mockVideoUrl,
          taskId: `task_${Date.now()}`,
          model: selectedRunwayModel,
          duration,
        }
      }));

    } catch (error) {
      setRunwayGenerations(prev => ({
        ...prev,
        [scene.id]: {
          ...prev[scene.id],
          status: 'failed',
          error: error instanceof Error ? error.message : 'Generation failed',
        }
      }));
    }
  };

  const regenerateRunwayVideo = (sceneId: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (scene) {
      generateRunwayVideo(scene);
    }
  };

  // ==================== COPY & EXPORT ====================
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    const originalTitle = document.title;
    document.title = `✓ Copied ${label}`;
    setTimeout(() => { document.title = originalTitle; }, 1100);
  };

  const copySunoPrompt = () => {
    const fullPrompt = `**Style:** ${sunoStylePrompt}\n\n**Lyrics:**\n${lyrics || '[Your lyrics here]'}`;
    copyToClipboard(fullPrompt, 'Suno Prompt');
  };

  const copyAllScenePrompts = () => {
    const text = scenes.map((s, i) => 
      `## ${s.section} (${s.startTime}–${s.endTime})\n\n${s.prompt}\n\nCamera: ${s.cameraMovement}\nLighting: ${s.lighting}\n`
    ).join('\n---\n\n');
    copyToClipboard(text, 'All Prompts');
  };

  const exportJSON = () => {
    const data = {
      songTitle,
      stylePresets: selectedPresets,
      sunoStylePrompt,
      aspectRatio,
      scenes,
      runwayGenerations,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${songTitle || 'music-video'}-full-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadDemo = () => {
    setSongTitle('Ghost in the Neon Rain');
    setLyrics(`[Verse 1]\nI see your shadow in the static glow\nChrome reflections where the streetlights go\n\n[Chorus]\nGhost in the neon rain\nCalling me back again\n\n[Verse 2]\nThe city hums a low electric prayer\nYour voice is static in the midnight air\n\n[Bridge]\nIf I could reach through the screen tonight\nWould you still be waiting in the light?`);
    setStyleDescription('Dark cyberpunk western atmosphere, lonely protagonist, holographic memories flickering, rain-soaked neon streets, emotional and cinematic');
    setSelectedPresets(['cyber-western', 'neon-pulse']);
    setAspectRatio('16:9');
  };

  // ==================== RENDER ====================
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-500 via-orange-500 to-blue-500 flex items-center justify-center">
                <Film className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Music Video Scene Generator</h1>
                <p className="text-xs text-slate-500 -mt-1">Suno + Runway Gen-3/Gen-4 Integration</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={loadDemo} className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-700 hover:bg-slate-900 transition-colors">
              <Sparkles className="w-4 h-4" /> Load Demo
            </button>
            <button onClick={handleGenerate} disabled={isGenerating || !songTitle.trim()} 
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white text-slate-950 font-medium hover:bg-slate-200 disabled:opacity-50 transition-all active:scale-[0.985]">
              {isGenerating ? <>Generating <RefreshCw className="w-4 h-4 animate-spin" /></> : <>Generate Scenes <Sparkles className="w-4 h-4" /></>}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Song + Style Inputs */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          <div className="lg:col-span-7 space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Song Title</label>
              <input type="text" value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="Ghost in the Neon Rain"
                     className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-5 py-3.5 text-xl placeholder:text-slate-600 focus:outline-none focus:border-slate-700" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Lyrics</label>
              <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={7}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-5 py-4 font-mono text-sm placeholder:text-slate-600 focus:outline-none focus:border-slate-700 resize-y" 
                        placeholder="Paste lyrics with [Verse 1], [Chorus] tags..." />
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-3">Visual Style Presets</label>
              <div className="flex flex-wrap gap-2">
                {STYLE_PRESETS.map(preset => {
                  const isSelected = selectedPresets.includes(preset.id);
                  return (
                    <button key={preset.id} onClick={() => togglePreset(preset.id)}
                            className={`px-4 py-2 rounded-full text-sm border transition-all ${isSelected ? 'bg-white text-slate-950 border-white' : 'border-slate-700 hover:border-slate-500 hover:bg-slate-900'}`}
                            style={isSelected ? { backgroundColor: preset.accentColor, color: '#0f172a', borderColor: preset.accentColor } : {}}>
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Additional Style Direction</label>
              <textarea value={styleDescription} onChange={(e) => setStyleDescription(e.target.value)} rows={3}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-5 py-3.5 text-sm placeholder:text-slate-600 focus:outline-none focus:border-slate-700" 
                        placeholder="Add specific cinematic details..." />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-400 mb-2">Aspect Ratio</label>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm">
                  <option value="16:9">16:9 — YouTube / Standard</option>
                  <option value="9:16">9:16 — Reels / TikTok</option>
                  <option value="1:1">1:1 — Square</option>
                </select>
              </div>
              <div className="w-28">
                <label className="block text-sm font-medium text-slate-400 mb-2">Scenes</label>
                <input type="number" min={3} max={12} value={sceneCount} onChange={(e) => setSceneCount(Math.max(3, Math.min(12, parseInt(e.target.value) || 6)))}
                       className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm" />
              </div>
            </div>
          </div>
        </div>

        {/* Suno Section */}
        <div className="mb-8 border border-slate-800 rounded-3xl overflow-hidden">
          <button onClick={() => setShowSunoSection(!showSunoSection)} className="w-full flex items-center justify-between px-6 py-4 bg-slate-900 hover:bg-slate-950">
            <div className="flex items-center gap-3">
              <Music className="w-5 h-5 text-orange-400" />
              <span className="font-semibold">Suno Custom Mode</span>
            </div>
            {showSunoSection ? <ChevronUp /> : <ChevronDown />}
          </button>
          {showSunoSection && (
            <div className="p-6 bg-slate-950 border-t border-slate-800">
              <div className="flex justify-between mb-3">
                <p className="text-sm text-slate-400">Optimized Style prompt for Suno Custom Mode</p>
                <button onClick={copySunoPrompt} disabled={!sunoStylePrompt} className="flex items-center gap-2 px-4 py-1.5 text-sm rounded-lg border border-slate-700 hover:bg-slate-900 disabled:opacity-40">
                  <Copy className="w-4 h-4" /> Copy
                </button>
              </div>
              <div className="bg-slate-900 rounded-2xl p-5 font-mono text-sm border border-slate-800 min-h-[80px] whitespace-pre-wrap">
                {sunoStylePrompt || 'Generate scenes to create Suno prompt...'}
              </div>
            </div>
          )}
        </div>

        {/* RUNWAY SECTION */}
        {scenes.length > 0 && (
          <div className="mb-8 border border-slate-800 rounded-3xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 bg-slate-900">
              <div className="flex items-center gap-3">
                <Video className="w-5 h-5 text-blue-400" />
                <span className="font-semibold">Runway Video Generation (Gen-3 / Gen-4)</span>
              </div>
              <button onClick={() => setShowRunwaySettings(!showRunwaySettings)} className="flex items-center gap-2 text-sm px-4 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800">
                <Settings className="w-4 h-4" /> Settings
              </button>
            </div>

            {showRunwaySettings && (
              <div className="p-6 bg-slate-950 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Runway API Key</label>
                  <input type="password" value={runwayApiKey} onChange={(e) => setRunwayApiKey(e.target.value)} 
                         placeholder="rw_••••••••••••••••" className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm font-mono" />
                  <p className="text-[10px] text-amber-400 mt-1.5">Store securely in env vars or Supabase secrets in production.</p>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Model</label>
                  <select value={selectedRunwayModel} onChange={(e) => setSelectedRunwayModel(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm">
                    {RUNWAY_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Default Clip Duration (seconds)</label>
                  <input type="number" min={3} max={10} value={defaultDuration} onChange={(e) => setDefaultDuration(parseInt(e.target.value) || 5)} 
                         className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm" />
                  <p className="text-[10px] text-slate-500 mt-1.5">Est. cost per clip: ~${estimateRunwayCost(defaultDuration)}</p>
                </div>
              </div>
            )}

            <div className="p-6 bg-slate-950 border-t border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-slate-400">Generate actual video clips from your scene prompts using Runway.</p>
                  <p className="text-xs text-slate-500 mt-0.5">Currently simulated — replace the mock function with your backend call.</p>
                </div>
                <div className="text-xs px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  {getRunwayModelInfo(selectedRunwayModel).label}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {scenes.map(scene => {
                  const gen = runwayGenerations[scene.id];
                  const isGeneratingThis = gen?.status === 'generating';

                  return (
                    <div key={scene.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="text-xs text-slate-500">{scene.section}</div>
                          <div className="font-mono text-sm text-orange-400">{scene.startTime}–{scene.endTime}</div>
                        </div>
                        {gen?.status === 'completed' && gen.videoUrl && (
                          <a href={gen.videoUrl} target="_blank" rel="noopener noreferrer" 
                             className="text-xs px-3 py-1 bg-emerald-500 text-black rounded-full flex items-center gap-1 font-medium">
                            <Play className="w-3 h-3" /> Watch
                          </a>
                        )}
                      </div>

                      <div className="flex-1 text-xs text-slate-400 line-clamp-3 mb-4">
                        {scene.prompt.substring(0, 160)}...
                      </div>

                      {!gen || gen.status === 'idle' || gen.status === 'failed' ? (
                        <button 
                          onClick={() => generateRunwayVideo(scene)}
                          disabled={!runwayApiKey}
                          className="mt-auto w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 text-sm font-medium flex items-center justify-center gap-2 transition-colors">
                          <Video className="w-4 h-4" /> Generate Video Clip
                        </button>
                      ) : isGeneratingThis ? (
                        <div className="mt-auto flex items-center justify-center gap-2 py-2.5 text-sm text-blue-400">
                          <RefreshCw className="w-4 h-4 animate-spin" /> Generating with Runway...
                        </div>
                      ) : gen.status === 'completed' ? (
                        <div className="mt-auto flex gap-2">
                          <button onClick={() => regenerateRunwayVideo(scene.id)} className="flex-1 py-2 rounded-xl border border-slate-700 text-sm hover:bg-slate-800 flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4" /> Regenerate
                          </button>
                          {gen.videoUrl && (
                            <a href={gen.videoUrl} target="_blank" className="flex-1 py-2 rounded-xl bg-emerald-600 text-sm font-medium flex items-center justify-center gap-2">
                              <Play className="w-4 h-4" /> Play Video
                            </a>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Scenes Grid */}
        {scenes.length > 0 && activeTab !== 'runway' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Generated Scenes</h2>
              <div className="flex gap-2">
                <button onClick={copyAllScenePrompts} className="px-4 py-2 text-sm rounded-lg border border-slate-700 hover:bg-slate-900 flex items-center gap-2">
                  <Copy className="w-4 h-4" /> Copy All
                </button>
                <button onClick={exportJSON} className="px-4 py-2 text-sm rounded-lg border border-slate-700 hover:bg-slate-900 flex items-center gap-2">
                  <Download className="w-4 h-4" /> Export
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {scenes.map((scene, index) => (
                <div key={scene.id} className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden flex flex-col">
                  <div className="px-5 pt-5 pb-4 border-b border-slate-800">
                    <div className="text-xs uppercase tracking-widest text-slate-500">SCENE {index + 1} • {scene.section}</div>
                    <div className="font-mono text-sm text-orange-400 flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3.5 h-3.5" /> {scene.startTime} – {scene.endTime}
                    </div>
                  </div>
                  <div className="p-5 flex-1">
                    <textarea value={scene.prompt} onChange={(e) => setScenes(prev => prev.map(s => s.id === scene.id ? {...s, prompt: e.target.value} : s))}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm min-h-[110px] resize-y" />
                  </div>
                  <div className="p-4 border-t border-slate-800 flex gap-2">
                    <button onClick={() => copyToClipboard(scene.prompt, 'Prompt')} className="flex-1 py-2.5 text-sm rounded-xl border border-slate-700 hover:bg-slate-800 flex items-center justify-center gap-2">
                      <Copy className="w-4 h-4" /> Copy
                    </button>
                    <button onClick={() => { /* regenerate logic */ }} className="flex-1 py-2.5 text-sm rounded-xl border border-slate-700 hover:bg-slate-800 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4" /> Regenerate Prompt
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-6 pb-12 text-center text-[10px] text-slate-600">
        Built for ReleaseForge • Suno + Runway ready • Replace mock generation with real backend call using @runwayml/sdk
      </div>
    </div>
  );
};

export default MusicVideoSceneGeneratorWithRunway;
