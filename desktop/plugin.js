// desktop/plugin.js - Native Hermes Desktop plugin (Phase 1 & 2A In-Chat Deck)
import { host, useValue } from '@hermes/plugin-sdk'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

function AetherInChatUxDeck() {
  const activeSessionId = useValue(host.state.activeSessionId);
  const [sessionSnapshot, setSessionSnapshot] = useState({
    sessionId: null,
    uxGenerations: [],
    selectedUx: null,
    uiGenerations: [],
    selectedUi: null,
    stage: 'IDLE',
  });
  const [activeTab, setActiveTab] = useState('ux'); // 'ux' | 'ui'
  const [refineInput, setRefineInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollContainerRef = useRef(null);
  const prevGensCountRef = useRef(0);
  const prevUiCountRef = useRef(0);

  // Notify backend of current focused session (null on New Session)
  useEffect(() => {
    fetch('http://127.0.0.1:4173/api/session/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: activeSessionId || null }),
    }).catch(() => {});
  }, [activeSessionId]);

  // Fetch & poll with AbortController and strict session matching
  useEffect(() => {
    if (!activeSessionId) {
      setSessionSnapshot({
        sessionId: null,
        uxGenerations: [],
        selectedUx: null,
        uiGenerations: [],
        selectedUi: null,
        stage: 'IDLE',
      });
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;

    async function fetchState() {
      try {
        const res = await fetch(`http://127.0.0.1:4173/api/state?sessionId=${encodeURIComponent(activeSessionId)}`, {
          signal: controller.signal,
        });
        if (res.ok && !isCancelled) {
          const data = await res.json();
          if (data && data.sessionId === activeSessionId) {
            setSessionSnapshot({
              sessionId: activeSessionId,
              uxGenerations: data.uxGenerations || [],
              selectedUx: data.selectedUx || null,
              uiGenerations: data.uiGenerations || [],
              selectedUi: data.selectedUi || null,
              stage: data.stage || 'IDLE',
            });
          }
        }
      } catch (e) {
        // Never clear sessionSnapshot on transient fetch error if session already matches!
      }
    }

    fetchState();
    const timer = setInterval(fetchState, 1500);

    return () => {
      isCancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [activeSessionId]);

  const uxGenerations = sessionSnapshot.uxGenerations || [];
  const selectedUx = sessionSnapshot.selectedUx;
  const uiGenerations = sessionSnapshot.uiGenerations || [];
  const selectedUi = sessionSnapshot.selectedUi;

  // Auto-switch to UI tab when new UI generations arrive
  useEffect(() => {
    const uiLen = uiGenerations.length;
    if (uiLen > prevUiCountRef.current && uiLen > 0) {
      setActiveTab('ui');
    }
    prevUiCountRef.current = uiLen;
  }, [uiGenerations.length]);

  // Determine current active view deck
  const isShowingUi = activeTab === 'ui' && uiGenerations.length > 0;
  const currentDeckList = isShowingUi ? uiGenerations : uxGenerations;

  // Auto-scroll when new generation is appended
  useEffect(() => {
    if (currentDeckList.length > prevGensCountRef.current && scrollContainerRef.current) {
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            left: scrollContainerRef.current.scrollWidth,
            behavior: 'smooth',
          });
        }
      }, 100);
    }
    prevGensCountRef.current = currentDeckList.length;
  }, [currentDeckList.length]);

  // Select a UX direction directly from card UI
  const handleSelectDirection = async (directionId, generationId) => {
    if (!activeSessionId) return;
    try {
      const res = await fetch('http://127.0.0.1:4173/api/ux/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          generationId,
          directionId,
          userInitiated: true,
          source: 'desktop_ui',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.selectedUx && data.sessionId === activeSessionId) {
          setSessionSnapshot((prev) => ({
            ...prev,
            selectedUx: data.selectedUx,
          }));
        }
      }
    } catch (err) {
      console.error('Failed to select UX direction', err);
    }
  };

  // Select a UI concept directly from card UI
  const handleSelectConcept = async (conceptId, generationId) => {
    if (!activeSessionId) return;
    try {
      const res = await fetch('http://127.0.0.1:4173/api/ui/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          generationId,
          conceptId,
          userInitiated: true,
          source: 'desktop_ui',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.selectedUi && data.sessionId === activeSessionId) {
          setSessionSnapshot((prev) => ({
            ...prev,
            selectedUi: data.selectedUi,
            stage: data.stage || 'PREVIEW_READY',
          }));
        }
      }
    } catch (err) {
      console.error('Failed to select UI concept', err);
    }
  };

  // Submit inline refinement
  const handleRefineSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const text = refineInput.trim();
    if (!text || isSubmitting || !activeSessionId) return;

    setIsSubmitting(true);
    try {
      const endpoint = isShowingUi
        ? 'http://127.0.0.1:4173/api/ui/generate'
        : 'http://127.0.0.1:4173/api/ux/generate';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          refinement: text,
        }),
      });
      if (res.ok) {
        setRefineInput('');
        const data = await res.json();
        if (data && data.sessionId === activeSessionId) {
          if (isShowingUi && data.uiGenerations) {
            setSessionSnapshot((prev) => ({
              ...prev,
              uiGenerations: data.uiGenerations,
            }));
          } else if (data.uxGenerations) {
            setSessionSnapshot((prev) => ({
              ...prev,
              uxGenerations: data.uxGenerations,
            }));
          }
        }
      }
    } catch (err) {
      console.error('Failed to submit refinement', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // RULE 1: Synchronous hide when activeSessionId is null or sessionSnapshot doesn't match activeSessionId
  if (!activeSessionId || sessionSnapshot.sessionId !== activeSessionId) {
    return null;
  }

  // Reactive Visibility: Completely hidden when no generations exist for this conversation
  if (uxGenerations.length === 0 && uiGenerations.length === 0) {
    return null;
  }

  // Find selected UX title for stage switcher pill
  const allUxCards = uxGenerations.flatMap((g) => g.directions || []);
  const activeUxCard = allUxCards.find((c) => c.id === selectedUx?.directionId);
  const selectedUxTitle = activeUxCard?.title || 'Selected UX';

  return jsx('div', {
    style: {
      marginBottom: '8px',
      backgroundColor: '#0a0f1d',
      border: '1px solid #1e293b',
      borderRadius: '10px',
      padding: '12px 14px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#f8fafc',
    },
    children: jsxs('div', {
      children: [
        // Deck Header Bar
        jsxs('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '10px',
            gap: '12px',
            flexWrap: 'wrap',
          },
          children: [
            // Left: Icon + Title + Count + Stage Switcher
            jsxs('div', {
              style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
              children: [
                jsx('span', { style: { fontSize: '16px' }, children: isShowingUi ? '🎨' : '📐' }),
                jsx('span', {
                  style: { fontWeight: 700, fontSize: '13px', color: '#ffffff', letterSpacing: '-0.2px' },
                  children: isShowingUi ? 'Aether UI Concepts' : 'Aether UX Directions',
                }),
                jsx('span', {
                  style: {
                    background: '#1e293b',
                    color: '#94a3b8',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    fontSize: '11px',
                    fontWeight: 600,
                  },
                  children: `${currentDeckList.length} ${currentDeckList.length === 1 ? 'Generation' : 'Generations'}`,
                }),

                // Stage Switcher Context Pills
                isShowingUi &&
                  jsxs('button', {
                    onClick: () => setActiveTab('ux'),
                    title: 'Switch view back to UX directions',
                    style: {
                      background: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    },
                    children: [
                      jsx('span', { style: { color: '#10b981', fontWeight: 700 }, children: 'UX: ✓' }),
                      jsx('span', {
                        style: { color: '#ffffff', fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                        children: selectedUxTitle,
                      }),
                      jsx('span', { style: { color: '#60a5fa', fontSize: '10px' }, children: '(View UX)' }),
                    ],
                  }),

                !isShowingUi && uiGenerations.length > 0 &&
                  jsx('button', {
                    onClick: () => setActiveTab('ui'),
                    title: 'Switch view to UI concepts',
                    style: {
                      background: '#1e3a8a',
                      border: '1px solid #3b82f6',
                      borderRadius: '6px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      color: '#93c5fd',
                      cursor: 'pointer',
                      fontWeight: 600,
                    },
                    children: '→ View UI Concepts',
                  }),
              ],
            }),

            // Inline Refinement Input Bar
            jsxs('form', {
              onSubmit: handleRefineSubmit,
              style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '1', maxWidth: '420px' },
              children: [
                jsx('input', {
                  type: 'text',
                  value: refineInput,
                  onChange: (e) => setRefineInput(e.target.value),
                  placeholder: isShowingUi
                    ? 'Refine UI (e.g. Darker neon tones, high contrast)...'
                    : 'Refine UX (e.g. Focus on 1-tap logging)...',
                  style: {
                    flex: '1',
                    background: '#131d31',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    color: '#f8fafc',
                    outline: 'none',
                  },
                }),
                jsx('button', {
                  type: 'submit',
                  disabled: isSubmitting || !refineInput.trim(),
                  style: {
                    background: refineInput.trim() ? '#3b82f6' : '#1e293b',
                    color: refineInput.trim() ? '#ffffff' : '#64748b',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: refineInput.trim() ? 'pointer' : 'default',
                    transition: 'all 0.15s ease',
                  },
                  children: isSubmitting ? 'Generating...' : 'Refine',
                }),
              ],
            }),
          ],
        }),

        // Horizontal Card Deck Track
        jsx('div', {
          ref: scrollContainerRef,
          style: {
            display: 'flex',
            gap: '12px',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            paddingBottom: '4px',
            scrollbarWidth: 'thin',
          },
          children: isShowingUi
            ? // ==================== UI CONCEPT DECK ====================
              uiGenerations.map((gen, gIdx) =>
                jsxs('div', {
                  key: gen.generationId,
                  style: { display: 'flex', gap: '12px', alignItems: 'stretch' },
                  children: [
                    // Divider between generations
                    gIdx > 0 &&
                      jsx('div', {
                        style: {
                          width: '2px',
                          background: '#334155',
                          alignSelf: 'stretch',
                          margin: '4px 2px',
                          borderRadius: '1px',
                        },
                      }),

                    // Cards in this generation
                    ...(gen.concepts || []).map((concept) => {
                      const isConceptSelected =
                        selectedUi?.conceptId === concept.conceptId || concept.isSelected;
                      return jsxs('div', {
                        key: concept.conceptId,
                        style: {
                          flex: '0 0 300px',
                          width: '300px',
                          scrollSnapAlign: 'start',
                          background: isConceptSelected ? '#0b241b' : '#131d31',
                          border: isConceptSelected ? '2px solid #10b981' : '1px solid #1e293b',
                          borderRadius: '8px',
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          boxShadow: isConceptSelected ? '0 0 14px rgba(16, 185, 129, 0.25)' : 'none',
                          transition: 'border-color 0.2s, box-shadow 0.2s',
                          boxSizing: 'border-box',
                        },
                        children: [
                          // Header Row: Gen Badge + Archetype
                          jsxs('div', {
                            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
                            children: [
                              jsx('span', {
                                style: {
                                  background: '#1e3a8a',
                                  color: '#60a5fa',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                },
                                children: `Gen ${concept.generationNumber}`,
                              }),
                              jsx('span', {
                                style: {
                                  background: '#2e1065',
                                  color: '#c084fc',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  maxWidth: '180px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                                children: concept.styleArchetype,
                              }),
                            ],
                          }),

                          // Title
                          jsx('h4', {
                            style: {
                              fontSize: '13px',
                              fontWeight: 700,
                              color: '#ffffff',
                              margin: 0,
                              lineHeight: '1.3',
                            },
                            children: concept.title,
                          }),

                          // Styled Mini-Screen Mockup (Responsive miniature layout)
                          jsxs('div', {
                            style: {
                              borderRadius: '6px',
                              background: concept.palette?.surface || '#1e293b',
                              border: `1px solid ${concept.palette?.primary || '#3b82f6'}40`,
                              padding: '8px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                              height: '135px',
                              boxSizing: 'border-box',
                              overflow: 'hidden',
                            },
                            children: [
                              // Top Bar
                              jsxs('div', {
                                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
                                children: [
                                  jsxs('div', {
                                    style: { display: 'flex', alignItems: 'center', gap: '4px' },
                                    children: [
                                      jsx('div', {
                                        style: {
                                          width: '6px',
                                          height: '6px',
                                          borderRadius: '50%',
                                          background: concept.palette?.primary || '#3b82f6',
                                        },
                                      }),
                                      jsx('span', {
                                        style: {
                                          fontSize: '10px',
                                          fontWeight: 700,
                                          color: concept.palette?.text || '#f8fafc',
                                          fontFamily: concept.typography?.headingFont || 'inherit',
                                          maxWidth: '150px',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        },
                                        children: concept.miniPreviewSpec?.previewTitle || concept.title,
                                      }),
                                    ],
                                  }),
                                  jsx('span', {
                                    style: {
                                      fontSize: '9px',
                                      fontWeight: 700,
                                      padding: '1px 5px',
                                      borderRadius: '3px',
                                      background: concept.palette?.primary || '#3b82f6',
                                      color: concept.palette?.background || '#0f172a',
                                      textTransform: 'uppercase',
                                    },
                                    children: concept.miniPreviewSpec?.badgeText || 'PRO',
                                  }),
                                ],
                              }),
                              // Accent Line
                              jsx('div', {
                                style: {
                                  height: '2px',
                                  width: '100%',
                                  background: concept.palette?.accent || concept.palette?.primary || '#38bdf8',
                                  borderRadius: '1px',
                                },
                              }),
                              // Mini Stats Cards
                              jsxs('div', {
                                style: { display: 'flex', gap: '4px', flex: '1' },
                                children: [
                                  jsxs('div', {
                                    style: {
                                      flex: '1',
                                      background: concept.palette?.background || '#0f172a',
                                      border: `1px solid ${concept.palette?.secondary || '#64748b'}30`,
                                      borderRadius: '4px',
                                      padding: '4px 6px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      justifyContent: 'center',
                                    },
                                    children: [
                                      jsx('span', {
                                        style: { fontSize: '8px', color: concept.palette?.secondary || '#94a3b8' },
                                        children: 'ACTIVE SET',
                                      }),
                                      jsx('span', {
                                        style: {
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          color: concept.palette?.text || '#ffffff',
                                          fontFamily: concept.typography?.headingFont || 'monospace',
                                        },
                                        children: '185 lbs × 8',
                                      }),
                                    ],
                                  }),
                                  jsxs('div', {
                                    style: {
                                      flex: '1',
                                      background: concept.palette?.background || '#0f172a',
                                      border: `1px solid ${concept.palette?.secondary || '#64748b'}30`,
                                      borderRadius: '4px',
                                      padding: '4px 6px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      justifyContent: 'center',
                                    },
                                    children: [
                                      jsx('span', {
                                        style: { fontSize: '8px', color: concept.palette?.secondary || '#94a3b8' },
                                        children: 'REST TIMER',
                                      }),
                                      jsx('span', {
                                        style: {
                                          fontSize: '11px',
                                          fontWeight: 700,
                                          color: concept.palette?.accent || concept.palette?.primary || '#38bdf8',
                                          fontFamily: concept.typography?.headingFont || 'monospace',
                                        },
                                        children: '01:15',
                                      }),
                                    ],
                                  }),
                                ],
                              }),
                              // Mini CTA Button
                              jsx('div', {
                                style: {
                                  background: concept.palette?.primary || '#3b82f6',
                                  color: concept.palette?.background || '#0f172a',
                                  fontSize: '9px',
                                  fontWeight: 700,
                                  padding: '3px 8px',
                                  borderRadius: '3px',
                                  alignSelf: 'flex-start',
                                },
                                children: concept.miniPreviewSpec?.primaryButtonText || '+ Log Set',
                              }),
                            ],
                          }),

                          // Palette Swatches Row
                          jsxs('div', {
                            style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' },
                            children: [
                              jsx('span', {
                                style: { fontSize: '10px', color: '#94a3b8', fontWeight: 600 },
                                children: 'Colors:',
                              }),
                              jsxs('div', {
                                style: { display: 'flex', gap: '4px' },
                                children: [
                                  { key: 'BG', color: concept.palette?.background },
                                  { key: 'SURF', color: concept.palette?.surface },
                                  { key: 'PRI', color: concept.palette?.primary },
                                  { key: 'SEC', color: concept.palette?.secondary },
                                  { key: 'ACC', color: concept.palette?.accent },
                                  { key: 'TXT', color: concept.palette?.text },
                                ].map((swatch) =>
                                  jsx('div', {
                                    key: swatch.key,
                                    title: `${swatch.key}: ${swatch.color}`,
                                    style: {
                                      width: '14px',
                                      height: '14px',
                                      borderRadius: '50%',
                                      background: swatch.color || '#333',
                                      border: '1px solid rgba(255, 255, 255, 0.25)',
                                      boxSizing: 'border-box',
                                    },
                                  })
                                ),
                              }),
                            ],
                          }),

                          // Typography & Density Pills Row
                          jsxs('div', {
                            style: { display: 'flex', gap: '4px', flexWrap: 'wrap', fontSize: '10px' },
                            children: [
                              jsx('span', {
                                style: {
                                  background: '#090d16',
                                  color: '#94a3b8',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #1e293b',
                                },
                                children: `🔤 ${(concept.typography?.headingFont || '').split(',')[0]} / ${(concept.typography?.bodyFont || '').split(',')[0]}`,
                              }),
                              jsx('span', {
                                style: {
                                  background: '#090d16',
                                  color: '#38bdf8',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #1e293b',
                                  fontWeight: 600,
                                },
                                children: `Density: ${concept.typography?.density || 'Compact'}`,
                              }),
                            ],
                          }),

                          // Component Traits
                          concept.componentTraits && concept.componentTraits.length > 0 &&
                            jsx('div', {
                              style: { display: 'flex', gap: '3px', flexWrap: 'wrap' },
                              children: concept.componentTraits.map((trait, tIdx) =>
                                jsx('span', {
                                  key: tIdx,
                                  style: {
                                    fontSize: '9px',
                                    color: '#cbd5e1',
                                    background: '#1e293b',
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                  },
                                  children: trait,
                                })
                              ),
                            }),

                          // Trade-off Alert
                          concept.tradeOff &&
                            jsx('div', {
                              style: {
                                color: '#fbbf24',
                                fontSize: '10px',
                                lineHeight: '1.3',
                                background: 'rgba(245, 158, 11, 0.1)',
                                padding: '2px 6px',
                                borderRadius: '3px',
                              },
                              children: concept.tradeOff,
                            }),

                          // Direct Selection Button
                          jsx('button', {
                            onClick: () => handleSelectConcept(concept.conceptId, concept.generationId),
                            style: {
                              marginTop: 'auto',
                              padding: '7px 12px',
                              borderRadius: '6px',
                              border: 'none',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              backgroundColor: isConceptSelected ? '#10b981' : '#2563eb',
                              color: '#ffffff',
                              transition: 'background-color 0.15s ease',
                            },
                            children: isConceptSelected ? '✓ Selected' : 'Select UI Concept',
                          }),
                        ],
                      });
                    }),
                  ],
                })
              )
            : // ==================== UX DIRECTION DECK ====================
              uxGenerations.map((gen, gIdx) =>
                jsxs('div', {
                  key: gen.generationId,
                  style: { display: 'flex', gap: '12px', alignItems: 'stretch' },
                  children: [
                    // Divider between generations
                    gIdx > 0 &&
                      jsx('div', {
                        style: {
                          width: '2px',
                          background: '#334155',
                          alignSelf: 'stretch',
                          margin: '4px 2px',
                          borderRadius: '1px',
                        },
                      }),

                    // Cards in this generation
                    ...(gen.directions || []).map((card) => {
                      const isCardSelected = selectedUx?.directionId === card.id || card.isSelected;
                      return jsxs('div', {
                        key: card.id,
                        style: {
                          flex: '0 0 295px',
                          width: '295px',
                          scrollSnapAlign: 'start',
                          background: isCardSelected ? '#0b241b' : '#131d31',
                          border: isCardSelected ? '2px solid #10b981' : '1px solid #1e293b',
                          borderRadius: '8px',
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          boxShadow: isCardSelected ? '0 0 12px rgba(16, 185, 129, 0.25)' : 'none',
                          transition: 'border-color 0.2s, box-shadow 0.2s',
                          boxSizing: 'border-box',
                        },
                        children: [
                          // Header Row: Badge + Archetype
                          jsxs('div', {
                            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
                            children: [
                              jsx('span', {
                                style: {
                                  background: '#1e3a8a',
                                  color: '#60a5fa',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  textTransform: 'uppercase',
                                },
                                children: `Gen ${card.generationNumber}`,
                              }),
                              jsx('span', {
                                style: {
                                  background: '#2e1065',
                                  color: '#c084fc',
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  maxWidth: '180px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                                children: card.archetype,
                              }),
                            ],
                          }),

                          // Title
                          jsx('h4', {
                            style: {
                              fontSize: '13px',
                              fontWeight: 700,
                              color: '#ffffff',
                              margin: 0,
                              lineHeight: '1.3',
                            },
                            children: card.title,
                          }),

                          // Miniature Layout Illustration SVG
                          card.illustrationSvg &&
                            jsx('div', {
                              style: { borderRadius: '6px', overflow: 'hidden' },
                              dangerouslySetInnerHTML: { __html: card.illustrationSvg },
                            }),

                          // Key User Flow step pills
                          card.keyFlow && card.keyFlow.length > 0 &&
                            jsx('div', {
                              style: {
                                display: 'flex',
                                gap: '4px',
                                flexWrap: 'wrap',
                                background: '#090d16',
                                padding: '6px',
                                borderRadius: '5px',
                              },
                              children: card.keyFlow.map((step, sIdx) =>
                                jsxs('span', {
                                  key: sIdx,
                                  style: {
                                    fontSize: '10px',
                                    color: '#94a3b8',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  },
                                  children: [
                                    jsx('span', { style: { color: '#cbd5e1' }, children: step }),
                                    sIdx < card.keyFlow.length - 1 &&
                                      jsx('span', { style: { color: '#475569' }, children: '→' }),
                                  ],
                                })
                              ),
                            }),

                          // Strengths & Trade-offs
                          jsxs('div', {
                            style: { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', marginTop: '2px' },
                            children: [
                              ...(card.strengths || []).map((str, strIdx) =>
                                jsx('div', {
                                  key: strIdx,
                                  style: { color: '#34d399', lineHeight: '1.3' },
                                  children: str,
                                })
                              ),
                              card.tradeOff &&
                                jsx('div', {
                                  style: {
                                    color: '#fbbf24',
                                    lineHeight: '1.3',
                                    background: 'rgba(245, 158, 11, 0.1)',
                                    padding: '2px 5px',
                                    borderRadius: '3px',
                                    marginTop: '2px',
                                  },
                                  children: card.tradeOff,
                                }),
                            ],
                          }),

                          // Direct Selection Button
                          jsx('button', {
                            onClick: () => handleSelectDirection(card.id, card.generationId),
                            style: {
                              marginTop: 'auto',
                              padding: '7px 12px',
                              borderRadius: '6px',
                              border: 'none',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              backgroundColor: isCardSelected ? '#10b981' : '#2563eb',
                              color: '#ffffff',
                              transition: 'background-color 0.15s ease',
                            },
                            children: isCardSelected ? '✓ Selected' : 'Select Direction',
                          }),
                        ],
                      });
                    }),
                  ],
                })
              ),
        }),
      ],
    }),
  });
}

// Phase 2 Standby helper (only rendered when studio pane is re-enabled in Phase 2)
function AetherStudioPane() {
  const [status, setStatus] = useState('offline');

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:4173/api/health', {
        headers: { Origin: 'http://127.0.0.1:4173' },
        signal: AbortSignal.timeout(1200),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          setStatus('ready');
          return;
        }
      }
      setStatus('offline');
    } catch (e) {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  return jsx('div', {
    style: { backgroundColor: '#0f172a', width: '100%', height: '100%' },
  });
}

export default {
  id: 'aether-ui',
  name: 'Aether UI Studio',
  description: 'Visual pair-programming engine, AST surgery, and in-chat UX/UI card deck',
  register(ctx) {
    // 1. In-Chat Horizontal UX & UI Card Deck (mounted above composer input in the active conversation)
    ctx.register({
      id: 'ux-deck',
      area: 'composer.top',
      order: 10,
      render: () => jsx(AetherInChatUxDeck, {}),
    });

    // 2. Right-Hand Studio Pane: Disabled for Phase 1 & 2A
    ctx.register({
      id: 'studio',
      area: 'panes',
      title: 'Aether Studio',
      when: () => false,
      data: {
        placement: 'main',
        dock: {
          pane: 'workspace',
          pos: 'right',
          enforce: true,
        },
        defaultCollapsed: true,
      },
      render: () => jsx(AetherStudioPane, {}),
    });

    // 3. Palette command (Ctrl+K)
    ctx.register({
      id: 'open-studio',
      area: 'palette',
      title: 'Aether: Open Studio Workspace',
      data: {
        id: 'aether-ui.open-studio',
        label: 'Aether: Open Studio Workspace',
        run: () => {
          if (typeof host.revealPane === 'function') {
            host.revealPane('aether-ui:studio');
          }
        },
      },
    });

    // 4. Programmatic reveal trigger
    const revealAetherStudio = () => {
      try {
        if (typeof host.revealPane === 'function') {
          host.revealPane('aether-ui:studio');
        }
      } catch (e) {}
    };

    if (typeof ctx.onEvent === 'function') {
      ctx.onEvent('*', (event) => {
        try {
          if (!event) return;
          const payload = event.payload || {};
          const toolName = (payload.tool_id || payload.tool_name || payload.name || '').toLowerCase();
          if (toolName.startsWith('aether_')) {
            revealAetherStudio();
          }
        } catch (e) {}
      });
    }
  },
};
