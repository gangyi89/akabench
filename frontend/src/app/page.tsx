'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import LoginModal from '@/components/shared/LoginModal'
import './landing.css'

function LandingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [modalOpen, setModalOpen] = useState(false)
  // Initial state derives from the URL: when the proxy redirects with
  // ?login=1, the modal opens on first render. Subsequent state changes are
  // user-driven (Open Portal click, close, etc.).
  const [loginOpen, setLoginOpen] = useState(() => searchParams.get('login') === '1')
  const openModal = () => setModalOpen(true)
  const closeModal = () => setModalOpen(false)

  const fromParam = searchParams.get('from')
  const destination = fromParam && fromParam.startsWith('/') ? fromParam : '/configure'

  function handleLoginSuccess() {
    setLoginOpen(false)
    router.replace(destination)
    router.refresh()
  }

  function handleOpenPortal(e: React.MouseEvent) {
    e.preventDefault()
    setLoginOpen(true)
  }

  return (
    <div className="landing">
      {/* NAV */}
      <nav className="landing-nav">
        <div className="nav-inner">
          <Link className="nav-logo" href="/">
            <div className="nav-wordmark">AKA<span>bench</span></div>
          </Link>
          <div className="nav-actions">
            <a className="btn-nav-cta" href="/configure" onClick={handleOpenPortal}>Sign In →</a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-eyebrow">Akamai Internal Tool</div>
          <h1>Your internal<br /><span>LLM Benchmark</span> portal</h1>
          <p className="hero-sub">
            Generate reproducible LLM inference benchmark reports on Akamai cloud GPUs.
            Purpose-built for Akamai field teams.
          </p>
          <div className="hero-cta-group">
            <a className="hero-cta" href="/configure" onClick={handleOpenPortal}>Sign In →</a>
            <p className="hero-cta-note">
              Don&apos;t have an account?{' '}
              <button type="button" className="hero-cta-link" onClick={openModal}>Request access</button>
            </p>
          </div>
          <img
            className="hero-screenshot"
            src="/screenshots/hero.jpg"
            alt="AKAbench benchmark configuration wizard — model selection, engine & quantisation, hardware, and test parameters"
          />
        </div>
      </section>

      {/* WHY SECTION */}
      <section className="why">
        <div className="container">
          <div className="why-header">
            <img src="/screenshots/masot.png" className="why-mascot" alt="AKAbench mascot" />
            <div>
              <div className="section-label">Why AKAbench</div>
              <h2 className="section-title">Built to win the early GPU conversation</h2>
              <p className="why-quote">
                Customer: &quot;Have you benchmarked model X on your GPUs?&quot;<br />
                You: &quot;Yes.&quot;
              </p>
            </div>
          </div>
          <div className="why-grid">
            <div className="why-card">
              <div className="why-card-header">
                <div className="why-icon">
                  <svg viewBox="0 0 24 24">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 .49-4" />
                  </svg>
                </div>
                <h3>Reproducible benchmarks, on demand</h3>
              </div>
              <p>Same methodology, same tooling, every time — for any model.</p>
            </div>
            <div className="why-card">
              <div className="why-card-header">
                <div className="why-icon">
                  <svg viewBox="0 0 24 24">
                    <line x1="12" y1="20" x2="12" y2="10" />
                    <line x1="18" y1="20" x2="18" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="16" />
                  </svg>
                </div>
                <h3>Confirm value early in the sales cycle</h3>
              </div>
              <p>Real performance numbers on Akamai hardware before a prospect commits.</p>
            </div>
            <div className="why-card">
              <div className="why-card-header">
                <div className="why-icon">
                  <svg viewBox="0 0 24 24">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h3>One place for all benchmark reports</h3>
              </div>
              <p>A shared repository that teams can access, reuse, and build on.</p>
            </div>
            <div className="why-card">
              <div className="why-card-header">
                <div className="why-icon">
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <h3>Access to limited GPU resources</h3>
              </div>
              <p>Purpose-built tooling ensures GPU benchmark capacity is used efficiently and accessibly.</p>
            </div>
          </div>
        </div>
      </section>

      {/* VALUE PROPS */}
      <section className="values">
        <div className="container">
          <div className="value-list">

            <div className="value-row">
              <img className="value-row-screenshot" src="/screenshots/model.jpg" alt="Model selection panel" />
              <div className="value-row-text">
                <h3>45+ Models, Ready to Bench 🏋️</h3>
                <p>
                  Search and benchmark popular open-source models — LLaMA, Qwen, Mistral, Gemma, and more.
                  New models are added continuously as they gain adoption.
                </p>
              </div>
            </div>

            <div className="value-row reverse">
              <img className="value-row-screenshot" src="/screenshots/engine.jpg" alt="Engine and quantisation configuration" />
              <div className="value-row-text">
                <h3>2 Popular Open Source Engines 🚀</h3>
                <p>
                  Choose between <strong>vLLM</strong> for throughput-optimised workloads and{' '}
                  <strong>SGLang</strong> for shared-prefix and RAG scenarios. Tune engine parameters
                  to match your customer&apos;s exact use case.
                </p>
              </div>
            </div>

            <div className="value-row">
              <img className="value-row-screenshot" src="/screenshots/benchmark.jpg" alt="Benchmark report with TTFT, latency and throughput charts" />
              <div className="value-row-text">
                <h3>
                  Benchmark with NVIDIA AIPerf 🎯{' '}
                  <a
                    href="https://docs.nvidia.com/nim/benchmarking/llm/latest/step-by-step.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="NVIDIA AIPerf documentation"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </h3>
                <p>
                  Every run is driven by NVIDIA&apos;s AIPerf benchmarking tool. Get TTFT, inter-token latency,
                  end-to-end latency, and throughput — the same numbers your customers use to evaluate
                  production readiness.
                </p>
              </div>
            </div>

            <div className="value-row reverse">
              <img className="value-row-screenshot" src="/screenshots/reports.jpg" alt="Benchmark jobs dashboard with shared report repository" />
              <div className="value-row-text">
                <h3>Shared Report Repository 🗂️</h3>
                <p>
                  All completed benchmarks land in a shared library. Browse, compare, and export PDF reports —
                  no need to re-run jobs others already ran.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how">
        <div className="container">
          <div className="section-label">How it works</div>
          <h2 className="section-title">Three steps to a benchmark report</h2>
          <div className="steps">
            <div className="step">
              <div className="step-icon">1</div>
              <h3>Configure</h3>
              <p>Select your model, inference engine, quantisation format, GPU tier, and load profile in a guided 4-step wizard.</p>
            </div>
            <div className="step">
              <div className="step-icon">2</div>
              <h3>Run</h3>
              <p>Submit the job. AKAbench deploys it on a GPU node, starts the inference server, and runs AIPerf automatically.</p>
            </div>
            <div className="step">
              <div className="step-icon">3</div>
              <h3>Report</h3>
              <p>View throughput and latency charts. Export a polished PDF to share directly with your customer.</p>
            </div>
          </div>
        </div>
      </section>

      {/* HARDWARE */}
      <section className="hardware">
        <div className="container">
          <div className="section-label">Infrastructure</div>
          <h2 className="section-title">Real GPUs.&nbsp;Real numbers.</h2>
          <p className="section-sub">Benchmarks run on Akamai cloud GPUs.</p>

          <div className="hw-grid">
            <div className="hw-card">
              <div className="hw-badge">Cost-efficient</div>
              <h3>RTX 4000 Ada</h3>
              <div className="hw-stat"><span className="hw-stat-label">VRAM</span><span className="hw-stat-value">20 GB</span></div>
              <div className="hw-stat"><span className="hw-stat-label">BF16 performance</span><span className="hw-stat-value">48.7 TFLOPS</span></div>
              <div className="hw-stat"><span className="hw-stat-label">Max model size</span><span className="hw-stat-value">≤ 13B FP16</span></div>
              <p className="hw-note">Ideal for smaller models and cost-sensitive customer conversations.</p>
            </div>

            <div className="hw-card featured">
              <div className="hw-badge">Max performance · NVFP4</div>
              <h3>RTX Pro 6000 Server Edition</h3>
              <div className="hw-stat"><span className="hw-stat-label">VRAM</span><span className="hw-stat-value">96 GB</span></div>
              <div className="hw-stat"><span className="hw-stat-label">BF16 performance</span><span className="hw-stat-value">314.6 TFLOPS</span></div>
              <div className="hw-stat"><span className="hw-stat-label">Max model size</span><span className="hw-stat-value">Large models</span></div>
              <p className="hw-note">Supports NVFP4 quantisation. Recommended for flagship model benchmarks and large-context workloads.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq-section">
        <div className="container" style={{ textAlign: 'center' }}>
          <div className="section-label">FAQ</div>
          <h2 className="section-title">Common questions</h2>
        </div>
        <div className="faq-list">
          <div className="faq-item">
            <div className="faq-question">What are the current limitations of this portal?</div>
            <div className="faq-answer">
              AKAbench currently supports LLM inference benchmarks on a single GPU card.
              Multi-GPU configurations are not yet supported.
            </div>
          </div>
          <div className="faq-item">
            <div className="faq-question">Why the focus on early conversation of the sales cycle?</div>
            <div className="faq-answer">
              Deep performance validation is highly customer-specific — every engagement has its own model,
              engine, load profile, and acceptance criteria. Trying to accommodate every permutation in a
              single portal would make it too complex to use quickly.<br /><br />
              AKAbench is designed for the first answer, not the final one. When a customer needs deeper
              fine-tuning, you can export the benchmark parameters and continue the analysis on your own
              workstation — picking up exactly where the portal left off.
            </div>
          </div>
          <div className="faq-item">
            <div className="faq-question">What&apos;s on the roadmap?</div>
            <div className="faq-answer">
              The roadmap is driven by user feedback. A few ideas we can explore:
              <ol>
                <li>Benchmark support for other model types — vision, ASR, and image generation.</li>
                <li>Multi-GPU inference — Data Parallel and Tensor Parallel configurations.</li>
                <li>Bring-Your-Own-GPU — Run the same benchmark quality on any GPU.</li>
              </ol>
            </div>
          </div>
          <div className="faq-item">
            <div className="faq-question">How long does a benchmark run take?</div>
            <div className="faq-answer">Usually over 5 minutes — it&apos;s the nature of this type of workload. Go grab a coffee.</div>
          </div>
          <div className="faq-item">
            <div className="faq-question">Can I share benchmark results with my customer?</div>
            <div className="faq-answer">Absolutely. Reports are designed to be shared — export as PDF and hand it directly to your customer.</div>
          </div>
          <div className="faq-item">
            <div className="faq-question">Can I request a new model to be added?</div>
            <div className="faq-answer">Yes. If the model has broad popularity, I&apos;ll get it added. Reach out via Webex.</div>
          </div>
          <div className="faq-item">
            <div className="faq-question">What else is pending on your MVP?</div>
            <div className="faq-answer">I need an RTX Pro 6000 Server Edition please 🥹.</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2>Want access?</h2>
        <p>AKAbench is available to internal Akamai teams only. Reach out to get started.</p>
        <button type="button" className="btn-primary" onClick={openModal}>Request Access</button>
      </section>

      {/* FOOTER */}
      <footer className="landing-footer">
        AKAbench · Internal use only
      </footer>

      {/* REQUEST ACCESS MODAL */}
      {modalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-modal-title"
        >
          <div className="modal-box">
            <div className="modal-mascot">😄</div>
            <h3 id="access-modal-title">Thank you for the support!</h3>
            <p>Please reach out to me via <strong>Webex</strong> and I&apos;ll get you set up.</p>
            <button type="button" className="modal-close" onClick={closeModal}>Close</button>
          </div>
        </div>
      )}

      {/* LOGIN MODAL */}
      {loginOpen && (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onSuccess={handleLoginSuccess}
          onRequestAccess={() => { setLoginOpen(false); openModal() }}
        />
      )}
    </div>
  )
}

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingPageInner />
    </Suspense>
  )
}
