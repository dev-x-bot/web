"use client";

import { useEffect, useRef, useState } from "react";

const TARGET = new Date("2026-09-01T00:00:00");

type Role = "candidate" | "skills" | "match" | "job";

interface NetNode {
  x: number;
  y: number;
  layer: number;
  role: Role;
  label: string;
  r: number;
  phase: number;
  speed: number;
  layerCount: number;
}

interface Packet {
  src: NetNode;
  dst: NetNode;
  t: number;
  speed: number;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cd, setCd] = useState({ d: "--", h: "--", m: "--", s: "--" });
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  // ── COUNTDOWN ──
  useEffect(() => {
    const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
    const tick = () => {
      const d = TARGET.getTime() - Date.now();
      if (d <= 0) return;
      setCd({
        d: pad(d / 86400000),
        h: pad((d % 86400000) / 3600000),
        m: pad((d % 3600000) / 60000),
        s: pad((d % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── NEURAL NET CANVAS ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let nodes: NetNode[] = [];
    let packets: Packet[] = [];
    let frame = 0;
    let raf = 0;

    const isMobile = () => window.innerWidth < 500;

    const LAYERS_DESKTOP = [
      { count: 5, role: "candidate" as Role, labels: ["Engineer", "Designer", "Product", "Data", "Sales"] },
      { count: 6, role: "skills" as Role, labels: ["React", "Python", "Strategy", "SQL", "Leadership", "UX"] },
      { count: 6, role: "match" as Role, labels: ["Screened", "Verified", "Fit Score", "Shortlisted", "Assessed", "Ranked"] },
      { count: 4, role: "job" as Role, labels: ["Startup", "Fintech", "E-commerce", "SaaS"] },
    ];
    const LAYERS_MOBILE = [
      { count: 3, role: "candidate" as Role, labels: ["Engineer", "Designer", "Product"] },
      { count: 4, role: "skills" as Role, labels: ["React", "Python", "SQL", "UX"] },
      { count: 4, role: "match" as Role, labels: ["Screened", "Fit Score", "Shortlisted", "Ranked"] },
      { count: 3, role: "job" as Role, labels: ["Startup", "Fintech", "SaaS"] },
    ];

    const COLORS: Record<Role, { base: string; bright: string }> = {
      candidate: { base: "rgba(56,189,248,", bright: "#38BDF8" },
      skills: { base: "rgba(129,140,248,", bright: "#818CF8" },
      match: { base: "rgba(192,132,252,", bright: "#C084FC" },
      job: { base: "rgba(34,211,144,", bright: "#22D390" },
    };

    function buildNodes() {
      nodes = [];
      const LAYERS = isMobile() ? LAYERS_MOBILE : LAYERS_DESKTOP;
      const mX = W * (isMobile() ? 0.08 : 0.1);
      const mY = H * (isMobile() ? 0.08 : 0.1);
      const uW = W - mX * 2;
      const uH = H - mY * 2;

      LAYERS.forEach((layer, li) => {
        const x = mX + (uW / (LAYERS.length - 1)) * li;
        for (let i = 0; i < layer.count; i++) {
          const yFrac = layer.count === 1 ? 0.5 : i / (layer.count - 1);
          nodes.push({
            x,
            y: mY + uH * yFrac,
            layer: li,
            role: layer.role,
            label: layer.labels[i],
            r: layer.role === "candidate" || layer.role === "job" ? (isMobile() ? 3.5 : 4.5) : isMobile() ? 2.5 : 3,
            phase: Math.random() * Math.PI * 2,
            speed: 0.011 + Math.random() * 0.009,
            layerCount: LAYERS.length,
          });
        }
      });
    }

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
      buildNodes();
    }

    const spawn = setInterval(
      () => {
        const LAYERS = isMobile() ? LAYERS_MOBILE : LAYERS_DESKTOP;
        const fromLayer = Math.floor(Math.random() * (LAYERS.length - 1));
        const from = nodes.filter((n) => n.layer === fromLayer);
        const to = nodes.filter((n) => n.layer === fromLayer + 1);
        if (!from.length || !to.length) return;
        packets.push({
          src: from[Math.floor(Math.random() * from.length)],
          dst: to[Math.floor(Math.random() * to.length)],
          t: 0,
          speed: 0.01 + Math.random() * 0.012,
        });
      },
      isMobile() ? 220 : 160
    );

    function draw() {
      frame++;
      ctx!.clearRect(0, 0, W, H);
      const mobile = isMobile();
      const LAYERS = mobile ? LAYERS_MOBILE : LAYERS_DESKTOP;

      // edges
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const na = nodes[a];
          const nb = nodes[b];
          if (Math.abs(na.layer - nb.layer) !== 1) continue;
          ctx!.beginPath();
          ctx!.moveTo(na.x, na.y);
          ctx!.lineTo(nb.x, nb.y);
          ctx!.strokeStyle = COLORS[na.role].base + "0.055)";
          ctx!.lineWidth = 0.5;
          ctx!.stroke();
        }
      }

      // packets
      packets = packets.filter((p) => p.t <= 1);
      packets.forEach((p) => {
        p.t += p.speed;
        const x = p.src.x + (p.dst.x - p.src.x) * p.t;
        const y = p.src.y + (p.dst.y - p.src.y) * p.t;
        const col = COLORS[p.src.role];
        const t0 = Math.max(0, p.t - 0.2);
        ctx!.beginPath();
        ctx!.moveTo(p.src.x + (p.dst.x - p.src.x) * t0, p.src.y + (p.dst.y - p.src.y) * t0);
        ctx!.lineTo(x, y);
        ctx!.strokeStyle = col.base + "0.5)";
        ctx!.lineWidth = 1;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(x, y, mobile ? 1.5 : 2, 0, Math.PI * 2);
        ctx!.fillStyle = col.bright;
        ctx!.fill();
      });

      // nodes
      nodes.forEach((n) => {
        const pulse = 0.5 + 0.5 * Math.sin(frame * n.speed + n.phase);
        const col = COLORS[n.role];
        const r = n.r + pulse * 0.9;

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
        ctx!.fillStyle = col.base + (0.03 + pulse * 0.035) + ")";
        ctx!.fill();

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = col.base + (0.4 + pulse * 0.45) + ")";
        ctx!.fill();

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, r * 0.4, 0, Math.PI * 2);
        ctx!.fillStyle = col.bright;
        ctx!.globalAlpha = 0.55 + pulse * 0.45;
        ctx!.fill();
        ctx!.globalAlpha = 1;

        // labels
        if (n.label) {
          const isLeft = n.layer === 0;
          const isRight = n.layer === LAYERS.length - 1;
          const isInner = !isLeft && !isRight;

          if (isInner && !mobile) {
            ctx!.font = "400 7.5px JetBrains Mono, monospace";
            ctx!.fillStyle = col.base + "0.45)";
            ctx!.textAlign = "center";
            ctx!.fillText(n.label, n.x, n.y - r - 5);
          } else if (!isInner) {
            ctx!.font = `500 ${mobile ? "8px" : "9.5px"} JetBrains Mono, monospace`;
            ctx!.fillStyle = col.base + "0.72)";
            ctx!.textAlign = isLeft ? "right" : "left";
            const dx = isLeft ? -(r + 6) : r + 6;
            ctx!.fillText(n.label, n.x + dx, n.y + 3.5);
          }
        }
      });

      // scanline
      const scanY = ((frame * 1.1) % (H + 60)) - 30;
      const sg = ctx!.createLinearGradient(0, scanY - 18, 0, scanY + 18);
      sg.addColorStop(0, "rgba(56,189,248,0)");
      sg.addColorStop(0.5, "rgba(56,189,248,0.022)");
      sg.addColorStop(1, "rgba(56,189,248,0)");
      ctx!.fillStyle = sg;
      ctx!.fillRect(0, scanY - 18, W, 36);

      raf = requestAnimationFrame(draw);
    }

    resize();
    const onResize = () => {
      resize();
      packets = [];
    };
    window.addEventListener("resize", onResize);
    draw();

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(spawn);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const notify = () => {
    if (!email || !email.includes("@")) return;
    setDone(true);
  };

  return (
    <div className="wrap">
      <canvas id="net" ref={canvasRef}></canvas>
      <div className="vignette"></div>

      <div className="content">
        <div className="badge">
          <span className="badge-dot"></span>Currently in stealth · India 🇮🇳
        </div>

        <h1 className="headline">
          <span className="xbot">x-bot</span>
          <span className="tagline">Where great hires happen.</span>
        </h1>

        <p className="sub">
          A <strong>full-stack hiring platform</strong> for employers and job
          seekers — AI-powered matching, verified listings, live application
          tracking, and zero fake jobs.
        </p>

        <div className="timer">
          <div className="unit">
            <span className="num">{cd.d}</span>
            <span className="lbl">Days</span>
          </div>
          <span className="sep">:</span>
          <div className="unit">
            <span className="num">{cd.h}</span>
            <span className="lbl">Hrs</span>
          </div>
          <span className="sep">:</span>
          <div className="unit">
            <span className="num">{cd.m}</span>
            <span className="lbl">Min</span>
          </div>
          <span className="sep">:</span>
          <div className="unit">
            <span className="num">{cd.s}</span>
            <span className="lbl">Sec</span>
          </div>
        </div>

        {!done ? (
          <div className="form-row">
            <input
              className="email-in"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") notify();
              }}
              placeholder="get early access · your@email.com"
            />
            <button className="notify-btn" onClick={notify}>
              Notify me →
            </button>
          </div>
        ) : (
          <div className="success-msg" style={{ display: "block" }}>
            ✓ you&apos;re on the list — we&apos;ll reach out soon
          </div>
        )}

        <div className="tags">
          <span className="tag">For Employers</span>
          <span className="tag">For Job Seekers</span>
          <span className="tag">AI-Powered Matching</span>
          <span className="tag">Zero Fake Listings</span>
          <span className="tag">Live Application Status</span>
        </div>
      </div>

      <footer className="foot">
        <a href="mailto:info@x-bot.co">info@x-bot.co</a>
        <a href="#">Privacy</a>
      </footer>
    </div>
  );
}
