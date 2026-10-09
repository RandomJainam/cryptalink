import React, { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(MotionPathPlugin, useGSAP);

export const PIPELINE_NODES = [
  { id: 'encrypt', zone: 'sender', label: 'Encrypt', algo: 'AES-256-GCM', x: 80, y: 125 },
  { id: 'wrap_key', zone: 'sender', label: 'Wrap Key', algo: 'RSA-OAEP', x: 195, y: 125 },
  { id: 'integrity_tag', zone: 'sender', label: 'Integrity', algo: 'HMAC-SHA256', x: 310, y: 125 },
  { id: 'transmit', zone: 'sender', label: 'Transmit', algo: 'TCP Sockets', x: 425, y: 125 },
  { id: 'verify_hmac', zone: 'receiver', label: 'Verify HMAC', algo: 'HMAC Tag', x: 675, y: 125 },
  { id: 'freshness', zone: 'receiver', label: 'Freshness', algo: '+/-60s Window', x: 790, y: 125 },
  { id: 'replay_check', zone: 'receiver', label: 'Replay Check', algo: 'Nonce / ID Cache', x: 905, y: 125 },
  { id: 'decrypt', zone: 'receiver', label: 'Decrypt', algo: 'AES-GCM', x: 1020, y: 125 },
  { id: 'store', zone: 'receiver', label: 'Store', algo: 'Vault', x: 1130, y: 125 }
];

const SCRAMBLED_CHARS = '01#%&*+<>[]abcdef0123456789';

export function Pipeline({
  phase,
  actionType,
  result,
  error,
  file,
  onSkip,
  onReplay,
  onFinishReveal,
  timelineControllerRef
}) {
  const containerRef = useRef(null);
  const activeTimelineRef = useRef(null);
  const idleTimelineRef = useRef(null);

  const filename = file ? file.name : (result?.filename || 'payload.bin');
  const shortFilename = filename.length > 9 ? filename.slice(0, 8) + '…' : filename;

  // Visibility handling to pause/resume ambient idle animations
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        idleTimelineRef.current?.pause();
      } else {
        idleTimelineRef.current?.play();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // GSAP animation engine
  useGSAP(
    () => {
      // Clean up previous active timelines
      if (activeTimelineRef.current) {
        activeTimelineRef.current.kill();
        activeTimelineRef.current = null;
      }
      if (idleTimelineRef.current) {
        idleTimelineRef.current.kill();
        idleTimelineRef.current = null;
      }

      const packetToken = containerRef.current.querySelector('#packet-token');
      const packetCard = containerRef.current.querySelector('#packet-card');
      const packetLabel = containerRef.current.querySelector('#packet-label');
      const packetLock = containerRef.current.querySelector('#packet-lock');
      const ghostPacket = containerRef.current.querySelector('#ghost-packet');
      const tamperTag = containerRef.current.querySelector('#tamper-tag');
      const storeConfirmation = containerRef.current.querySelector('#store-confirmation');
      const failureBanner = containerRef.current.querySelector('#failure-banner');
      const failureBannerText = containerRef.current.querySelector('#failure-banner-text');

      // Helper to reset SVG visuals
      const resetVisuals = () => {
        gsap.set(packetToken, { x: 80, y: 125, scale: 1, opacity: 1 });
        gsap.set(packetCard, { stroke: '#00f2fe', fill: '#1e293b' });
        gsap.set(packetLock, { opacity: 0 });
        gsap.set(ghostPacket, { opacity: 0, x: 80, y: 95 });
        gsap.set(tamperTag, { opacity: 0, scale: 0.8 });
        gsap.set(storeConfirmation, { opacity: 0, scale: 0.8 });
        gsap.set(failureBanner, { opacity: 0, y: 15 });
        if (packetLabel) packetLabel.textContent = shortFilename;

        PIPELINE_NODES.forEach((n) => {
          const circle = containerRef.current.querySelector(`#circle-${n.id}`);
          const label = containerRef.current.querySelector(`#label-${n.id}`);
          const caption = containerRef.current.querySelector(`#caption-${n.id}`);
          const checkIcon = containerRef.current.querySelector(`#check-${n.id}`);
          const crossIcon = containerRef.current.querySelector(`#cross-${n.id}`);
          const numText = containerRef.current.querySelector(`#num-${n.id}`);

          if (circle) {
            gsap.set(circle, { stroke: '#334155', fill: '#101520', strokeDasharray: 'none', x: 0, scale: 1 });
          }
          if (label) gsap.set(label, { fill: '#94a3b8' });
          if (caption) {
            gsap.set(caption, { fill: '#64748b' });
            caption.textContent = n.algo;
          }
          if (checkIcon) gsap.set(checkIcon, { opacity: 0, scale: 0.5 });
          if (crossIcon) gsap.set(crossIcon, { opacity: 0, scale: 0.5 });
          if (numText) gsap.set(numText, { opacity: 1 });
        });
      };

      // 1. IDLE / SENDING STATE
      if (phase === 'idle' || phase === 'sending') {
        resetVisuals();
        const pulse = gsap.timeline({ repeat: -1, yoyo: true });
        pulse.to(packetToken, {
          scale: 1.05,
          opacity: 0.85,
          duration: 0.8,
          ease: 'sine.inOut'
        });
        idleTimelineRef.current = pulse;
        return;
      }

      // 2. ERROR STATE (No reveal timeline per honesty rule)
      if (phase === 'error') {
        resetVisuals();
        gsap.set(packetCard, { stroke: '#ef4444' });
        return;
      }

      // 3. REVEAL / DONE STATE
      if ((phase === 'revealing' || phase === 'done') && result?.steps) {
        resetVisuals();

        const mm = gsap.matchMedia();

        mm.add('(prefers-reduced-motion: reduce)', () => {
          // Reduced motion: immediate final state without moving packet or shakes
          result.steps.forEach((step) => {
            const node = PIPELINE_NODES.find((n) => n.id === step.name);
            if (!node) return;
            const circle = containerRef.current.querySelector(`#circle-${node.id}`);
            const label = containerRef.current.querySelector(`#label-${node.id}`);
            const caption = containerRef.current.querySelector(`#caption-${node.id}`);
            const checkIcon = containerRef.current.querySelector(`#check-${node.id}`);
            const crossIcon = containerRef.current.querySelector(`#cross-${node.id}`);
            const numText = containerRef.current.querySelector(`#num-${node.id}`);

            if (step.ok) {
              if (circle) gsap.set(circle, { stroke: '#10b981', fill: '#06281e' });
              if (label) gsap.set(label, { fill: '#f1f5f9' });
              if (checkIcon) gsap.set(checkIcon, { opacity: 1, scale: 1 });
              if (numText) gsap.set(numText, { opacity: 0 });
            } else if (step.detail === 'skipped') {
              if (circle) gsap.set(circle, { stroke: '#475569', fill: '#090d14', strokeDasharray: '3,3' });
              if (caption) {
                gsap.set(caption, { fill: '#475569' });
                caption.textContent = 'SKIPPED';
              }
            } else {
              // Failed
              if (circle) gsap.set(circle, { stroke: '#ef4444', fill: '#2b1014' });
              if (label) gsap.set(label, { fill: '#ef4444' });
              if (crossIcon) gsap.set(crossIcon, { opacity: 1, scale: 1 });
              if (numText) gsap.set(numText, { opacity: 0 });
            }
          });

          // Position token at last evaluated node
          const failStepIndex = result.steps.findIndex((s) => !s.ok && s.detail !== 'skipped');
          const stopIndex = failStepIndex !== -1 ? failStepIndex : result.steps.length - 1;
          const stopNode = PIPELINE_NODES[stopIndex];
          if (stopNode) {
            gsap.set(packetToken, { x: stopNode.x, y: stopNode.y });
          }

          if (result.status === 'accepted') {
            gsap.set(storeConfirmation, { opacity: 1, scale: 1 });
          } else if (failStepIndex !== -1 && stopNode) {
            if (failureBannerText) failureBannerText.textContent = result.reason || 'Verification failed';
            gsap.set(failureBanner, { opacity: 1, y: 0, x: stopNode.x });
          }

          if (phase === 'revealing' && onFinishReveal) {
            onFinishReveal();
          }
        });

        mm.add('(prefers-reduced-motion: no-preference)', () => {
          const tl = gsap.timeline({
            onComplete: () => {
              if (phase === 'revealing' && onFinishReveal) {
                onFinishReveal();
              }
            }
          });
          activeTimelineRef.current = tl;

          if (timelineControllerRef) {
            timelineControllerRef.current = {
              kill: () => tl.kill(),
              skip: () => tl.progress(1)
            };
          }

          // Total duration budget is ~2.2 - 2.5 seconds total
          const stepMoveDuration = 0.16;
          const nodePulseDuration = 0.10;

          // Reveal steps sequentially based on real result
          let failedOccurred = false;

          result.steps.forEach((step, idx) => {
            if (failedOccurred) return; // Never advance packet past a failed node

            const node = PIPELINE_NODES.find((n) => n.id === step.name);
            if (!node) return;

            const circle = containerRef.current.querySelector(`#circle-${node.id}`);
            const label = containerRef.current.querySelector(`#label-${node.id}`);
            const caption = containerRef.current.querySelector(`#caption-${node.id}`);
            const checkIcon = containerRef.current.querySelector(`#check-${node.id}`);
            const crossIcon = containerRef.current.querySelector(`#cross-${node.id}`);
            const numText = containerRef.current.querySelector(`#num-${node.id}`);

            // Move packet token to current node
            tl.to(packetToken, {
              x: node.x,
              y: node.y,
              duration: stepMoveDuration,
              ease: 'power2.inOut'
            });

            // Special scene: Replay ghost packet
            if (actionType === 'replay' && idx === 0) {
              tl.to(ghostPacket, { opacity: 0.8, duration: 0.1 }, '<');
              tl.to(ghostPacket, { x: node.x, y: node.y - 30, duration: stepMoveDuration }, '<');
            } else if (actionType === 'replay') {
              tl.to(ghostPacket, { x: node.x, y: node.y - 30, duration: stepMoveDuration }, '<');
            }

            // Special scene: Tamper simulation during transit across TCP link
            if (actionType === 'tamper' && step.name === 'transmit') {
              tl.to(tamperTag, { opacity: 1, scale: 1, duration: 0.15, ease: 'back.out(2)' });
              tl.to(tamperTag, { opacity: 0, scale: 0.8, duration: 0.15, delay: 0.2 });
            }

            // Token transformation: Encrypt scrambles token label into cipher block
            if (step.name === 'encrypt' && step.ok) {
              tl.to(packetCard, { stroke: '#38bdf8', fill: '#0f172a', duration: 0.1 });
              tl.call(() => {
                if (packetLabel) {
                  let chars = '';
                  for (let i = 0; i < 7; i++) {
                    chars += SCRAMBLED_CHARS[Math.floor(Math.random() * SCRAMBLED_CHARS.length)];
                  }
                  packetLabel.textContent = chars;
                }
              });
            }

            // Transmit overlay lock
            if (step.name === 'transmit') {
              tl.to(packetLock, { opacity: 1, duration: 0.1 }, '<');
            }

            // Decrypt restores original filename
            if (step.name === 'decrypt' && step.ok) {
              tl.to(packetLock, { opacity: 0, duration: 0.1 }, '<');
              tl.to(packetCard, { stroke: '#10b981', fill: '#1e293b', duration: 0.1 });
              tl.call(() => {
                if (packetLabel) packetLabel.textContent = shortFilename;
              });
            }

            // Check if this step passed or failed
            if (step.ok) {
              // PASSED NODE ANIMATION
              tl.to(circle, {
                stroke: '#10b981',
                fill: '#06281e',
                scale: 1.12,
                duration: nodePulseDuration,
                yoyo: true,
                repeat: 1,
                transformOrigin: 'center center'
              });
              tl.to(numText, { opacity: 0, duration: 0.05 }, '<');
              tl.to(checkIcon, { opacity: 1, scale: 1, duration: 0.1, ease: 'back.out(2)' }, '<0.05');
              tl.to(label, { fill: '#f1f5f9', duration: 0.05 }, '<');
            } else if (step.detail !== 'skipped') {
              // FAILED NODE ANIMATION (First failed step)
              failedOccurred = true;

              // Token stops here and pulses red
              tl.to(packetCard, { stroke: '#ef4444', fill: '#2b1014', duration: 0.1 });

              // Shake node circle
              tl.to(circle, {
                stroke: '#ef4444',
                fill: '#2b1014',
                duration: 0.05
              });
              tl.to(circle, {
                x: -5,
                duration: 0.04,
                repeat: 5,
                yoyo: true,
                ease: 'power1.inOut'
              });
              tl.to(numText, { opacity: 0, duration: 0.05 }, '<');
              tl.to(crossIcon, { opacity: 1, scale: 1, duration: 0.1, ease: 'back.out(2)' }, '<0.05');
              tl.to(label, { fill: '#ef4444', duration: 0.05 }, '<');

              // Display failure banner positioned at failed node
              tl.call(() => {
                if (failureBannerText) {
                  failureBannerText.textContent = result.reason || 'Verification Failed';
                }
              });
              tl.set(failureBanner, { x: node.x });
              tl.to(failureBanner, { opacity: 1, y: 0, duration: 0.2, ease: 'back.out(1.5)' });

              // Transition all subsequent nodes to SKIPPED state
              result.steps.slice(idx + 1).forEach((skippedStep) => {
                const sNode = PIPELINE_NODES.find((n) => n.id === skippedStep.name);
                if (!sNode) return;
                const sCircle = containerRef.current.querySelector(`#circle-${sNode.id}`);
                const sCaption = containerRef.current.querySelector(`#caption-${sNode.id}`);
                if (sCircle) {
                  tl.to(sCircle, {
                    stroke: '#475569',
                    fill: '#090d14',
                    strokeDasharray: '3,3',
                    opacity: 0.6,
                    duration: 0.1
                  }, '<');
                }
                if (sCaption) {
                  tl.call(() => {
                    sCaption.textContent = 'SKIPPED';
                  });
                }
              });
            }
          });

          // All passed: final store confirmation
          if (result.status === 'accepted' && !failedOccurred) {
            tl.to(storeConfirmation, {
              opacity: 1,
              scale: 1,
              duration: 0.2,
              ease: 'back.out(2)'
            });
          }
        });
      }
    },
    { scope: containerRef, dependencies: [phase, actionType, result] }
  );

  return (
    <section className="pipeline-card" aria-label="Cryptographic transfer pipeline" ref={containerRef}>
      <div className="pipeline-header">
        <h2 className="pipeline-title">Secure Transfer Pipeline</h2>
        <div className="pipeline-actions">
          {phase === 'revealing' && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              onClick={onSkip}
              title="Skip animation (or press Esc)"
            >
              Skip (Esc)
            </button>
          )}
          {phase === 'done' && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              onClick={onReplay}
              title="Replay animation without sending a new request"
            >
              Replay Animation
            </button>
          )}
        </div>
      </div>

      <div className="pipeline-svg-container">
        <svg
          viewBox="0 0 1210 260"
          className="pipeline-svg"
          role="img"
          aria-label="Interactive pipeline showing Sender nodes, TCP link, and Receiver nodes"
        >
          <defs>
            <linearGradient id="link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.4" />
              <stop offset="50%" stopColor="#00f2fe" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          {/* SENDER ZONE */}
          <rect
            x="20"
            y="25"
            width="465"
            height="210"
            rx="8"
            fill="#0b0f17"
            stroke="#1e293b"
            strokeWidth="1.5"
          />
          <text x="35" y="48" fill="#64748b" fontSize="11" fontWeight="700" letterSpacing="0.08em">
            ZONE A: SENDER (CLIENT)
          </text>

          {/* TCP LINK ZONE */}
          <rect
            id="tcp-zone"
            x="485"
            y="55"
            width="145"
            height="150"
            rx="6"
            fill="#090d14"
            stroke="#1e293b"
            strokeDasharray="4,4"
            strokeWidth="1"
          />
          <text x="557" y="78" fill="#38bdf8" fontSize="10" textAnchor="middle" fontWeight="600">
            TCP LINK
          </text>

          {/* RECEIVER ZONE */}
          <rect
            x="630"
            y="25"
            width="560"
            height="210"
            rx="8"
            fill="#0b0f17"
            stroke="#1e293b"
            strokeWidth="1.5"
          />
          <text x="645" y="48" fill="#64748b" fontSize="11" fontWeight="700" letterSpacing="0.08em">
            ZONE B: RECEIVER (SERVER)
          </text>

          {/* MAIN TRANSFER PATH */}
          <path
            id="transfer-path"
            d="M 80 125 L 1130 125"
            fill="none"
            stroke="#1e293b"
            strokeWidth="3"
          />

          {/* ACTIVE TCP TRANSIT LINE */}
          <line
            id="tcp-transit-line"
            x1="435"
            y1="125"
            x2="675"
            y2="125"
            stroke="url(#link-grad)"
            strokeWidth="2.5"
            strokeDasharray="6,4"
          />

          {/* TAMPER ALERT BADGE (Hidden unless tamper triggered) */}
          <g id="tamper-tag" opacity="0" transform="translate(557, 105)">
            <rect x="-80" y="-12" width="160" height="24" rx="4" fill="#7f1d1d" stroke="#ef4444" strokeWidth="1" />
            <text x="0" y="4" fill="#fee2e2" fontSize="8.5" fontWeight="700" textAnchor="middle">
              1 BYTE MODIFIED IN TRANSIT
            </text>
          </g>

          {/* 9 NODES */}
          {PIPELINE_NODES.map((node, idx) => (
            <g key={node.id} id={`node-${node.id}`} className="pipeline-node">
              {/* Node circle */}
              <circle
                id={`circle-${node.id}`}
                cx={node.x}
                cy={node.y}
                r="24"
                fill="#101520"
                stroke="#334155"
                strokeWidth="2"
              />

              {/* Status indicators inside circle */}
              <path
                id={`check-${node.id}`}
                d={`M ${node.x - 6} ${node.y} l 4 4 l 8 -8`}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity="0"
                transformOrigin={`${node.x}px ${node.y}px`}
              />
              <path
                id={`cross-${node.id}`}
                d={`M ${node.x - 6} ${node.y - 6} l 12 12 M ${node.x + 6} ${node.y - 6} l -12 12`}
                fill="none"
                stroke="#ef4444"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity="0"
                transformOrigin={`${node.x}px ${node.y}px`}
              />
              <text
                id={`num-${node.id}`}
                x={node.x}
                y={node.y + 4}
                fill="#94a3b8"
                fontSize="11"
                fontWeight="700"
                textAnchor="middle"
              >
                {idx + 1}
              </text>

              {/* Label */}
              <text
                id={`label-${node.id}`}
                x={node.x}
                y={node.y + 40}
                fill="#94a3b8"
                fontSize="10"
                fontWeight="600"
                textAnchor="middle"
              >
                {node.label}
              </text>

              {/* Algo caption */}
              <text
                id={`caption-${node.id}`}
                x={node.x}
                y={node.y + 54}
                fill="#64748b"
                fontSize="9"
                textAnchor="middle"
                className="mono"
              >
                {node.algo}
              </text>
            </g>
          ))}

          {/* GHOST PACKET (used for replay simulation scene) */}
          <g id="ghost-packet" opacity="0" transform="translate(80, 95)">
            <rect
              x="-36"
              y="-14"
              width="72"
              height="28"
              rx="4"
              fill="#1e1e2e"
              stroke="#a855f7"
              strokeDasharray="3,3"
              strokeWidth="1.5"
            />
            <text x="0" y="4" fill="#c084fc" fontSize="8" fontWeight="700" textAnchor="middle" className="mono">
              {result?.message_id ? result.message_id.slice(0, 7) + '…' : 'REPLAY'}
            </text>
          </g>

          {/* PACKET TOKEN (SVG element controlled by GSAP) */}
          <g id="packet-token" transform="translate(80, 125)">
            <rect
              id="packet-card"
              x="-36"
              y="-16"
              width="72"
              height="32"
              rx="4"
              fill="#1e293b"
              stroke="#00f2fe"
              strokeWidth="1.5"
            />
            <text
              id="packet-label"
              x="0"
              y="4"
              fill="#00f2fe"
              fontSize="9"
              fontWeight="600"
              textAnchor="middle"
              className="mono"
            >
              {shortFilename}
            </text>
            {/* Small lock icon indicator */}
            <g id="packet-lock" opacity="0" transform="translate(24, -8) scale(0.7)">
              <rect x="-4" y="-2" width="8" height="6" rx="1" fill="#00f2fe" />
              <path d="M -2 -2 A 2 2 0 0 1 2 -2" fill="none" stroke="#00f2fe" strokeWidth="1" />
            </g>
          </g>

          {/* STORE CONFIRMATION BADGE */}
          <g id="store-confirmation" opacity="0" transform="translate(1130, 70)">
            <rect x="-65" y="-18" width="130" height="36" rx="5" fill="#064e3b" stroke="#10b981" strokeWidth="1.5" />
            <text x="0" y="-3" fill="#a7f3d0" fontSize="8.5" fontWeight="700" textAnchor="middle" className="mono">
              SAVED: {shortFilename}
            </text>
            <text x="0" y="10" fill="#6ee7b7" fontSize="8" textAnchor="middle" className="mono">
              {result?.size_bytes ? `${Math.round(result.size_bytes / 1024)} KiB in vault ✓` : 'Stored in vault ✓'}
            </text>
          </g>

          {/* FAILURE REASON POPUP BANNER */}
          <g id="failure-banner" opacity="0" transform="translate(675, 185)">
            <rect id="failure-banner-rect" x="-140" y="-12" width="280" height="24" rx="4" fill="#450a0a" stroke="#ef4444" strokeWidth="1" />
            <text id="failure-banner-text" x="0" y="4" fill="#fca5a5" fontSize="9" fontWeight="700" textAnchor="middle">
              Verification Failed
            </text>
          </g>
        </svg>
      </div>

      <div className="pipeline-caption-bar">
        <div id="pipeline-status-text" aria-live="polite">
          {error
            ? `Error: ${error.message}`
            : phase === 'sending'
            ? 'Transmitting: Waiting for server response (neutral state)...'
            : phase === 'revealing'
            ? 'Evaluating pipeline: Verifying cryptographic steps...'
            : phase === 'done' && result?.status === 'accepted'
            ? 'Transfer Accepted: Secure handshake, HMAC and Replay verified. File stored in vault.'
            : phase === 'done' && result?.status === 'rejected'
            ? actionType === 'replay' && result.steps.find((s) => s.name === 'verify_hmac')?.ok
              ? 'Transfer Rejected: HMAC was authentic, but packet was blocked by replay cache window.'
              : `Transfer Rejected at step: ${result.reason || 'Cryptographic verification failure'}`
            : 'Pipeline ready: Select a payload or choose an attack simulation.'}
        </div>

        <div className="pipeline-legend">
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#334155' }} />
            <span>Idle</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#00f2fe' }} />
            <span>Active</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#10b981' }} />
            <span>Passed</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#ef4444' }} />
            <span>Failed</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ border: '1px dashed #64748b' }} />
            <span>Skipped</span>
          </div>
        </div>
      </div>
    </section>
  );
}
