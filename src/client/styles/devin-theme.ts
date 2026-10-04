export function injectDevinStyles(): void {
  if (typeof document === 'undefined') return
  const ID = 'dsh-devin-search-theme-styles'
  const prev = document.getElementById(ID)
  if (prev) prev.remove()

  const style = document.createElement('style')
  style.id = ID
  style.textContent = `
    /* ==========================================================================
       Piwin Inkstone (砚) Authentic Design System & Token Architecture
       ========================================================================== */

    :root,
    .devin-card {
      /* Typography */
      --ink-serif: 'Noto Serif SC', 'Songti SC', 'STSong', 'Source Han Serif SC', 'Source Serif 4', Georgia, serif;
      --ink-sans: Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif;
      --ink-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

      /* Motion */
      --ink-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
      --ink-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
      --ink-breath: 2.4s;

      /* Geometry */
      --r-card: 10px;
      --r-control: 7px;
      --r-chip: 4px;
      --r-pill: 999px;

      /* 墨面 (Ink Face - Dark Stone Default) */
      --ink-void: #0b0a09;
      --ink-s1: #141210;
      --ink-s2: #191714;
      --ink-s3: #201d19;
      --ink-s4: #2a2621;

      --ink-t1: #ebe5da;
      --ink-t2: #a59d92;
      --ink-t3: #8b8378;
      --ink-t4: #6a6259;

      --ink-l1: rgba(235, 229, 218, 0.07);
      --ink-l2: rgba(235, 229, 218, 0.12);
      --ink-l3: rgba(235, 229, 218, 0.2);

      /* 朱红 (Cinnabar / Vermillion) — Signature action & seal mark */
      --ink-zhu: #e25a3d;
      --ink-zhu-lift: #f07054;
      --ink-zhu-press: #c6412a;
      --ink-on-zhu: #ffffff;
      --ink-zhu-wash: rgba(226, 90, 61, 0.14);

      /* 燃灯暖金 (Lamp / Warm Amber) — Pending, waiting & running glow */
      --ink-lamp: #e7b352;
      --ink-lamp-glow: rgba(231, 179, 82, 0.4);
      --ink-lamp-wash: rgba(231, 179, 82, 0.14);

      /* 松绿 (Pine Green) — Active, completed, valid & verified */
      --ink-pine: #5fad85;
      --ink-pine-lift: #73c49a;
      --ink-pine-wash: rgba(95, 173, 133, 0.14);

      /* 茜红 (Crimson) — Error & failure alert */
      --ink-crimson: #d95f6e;
      --ink-crimson-wash: rgba(217, 95, 110, 0.14);

      /* 霁蓝 (Azure) — Auxiliary highlights & code refs */
      --ink-azure: #6ba4c3;
      --ink-azure-wash: rgba(107, 164, 195, 0.14);

      /* 砚石 (Slab) — Deep dark stone for troughs & code blocks */
      --ink-slab: #0e0d0b;
      --ink-slab-t: #ebe5da;
      --ink-slab-ph: #6f685f;
      --ink-slab-chip: rgba(235, 229, 218, 0.08);
      --ink-slab-line: rgba(235, 229, 218, 0.1);

      /* Shadows with razor-thin top highlight (浮雕石阶光影) */
      --ink-sh1: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.5), 0 2px 8px -1px rgba(0, 0, 0, 0.45);
      --ink-sh2: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.6), 0 6px 18px -3px rgba(0, 0, 0, 0.6);
      --ink-sh-trough: inset 0 2px 4px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(0, 0, 0, 0.4);
    }

    /* 纸面 (Paper Face - Light Parchment Adaptation) */
    @media (prefers-color-scheme: light) {
      html:not([data-theme='dark']):not([data-theme-id*='dark']):not([data-theme-id*='ink']) {
        --ink-void: #e6e1d7;
        --ink-s1: #f0ece4;
        --ink-s2: #f8f6f0;
        --ink-s3: #fffdf8;
        --ink-s4: #ffffff;
        --ink-t1: #1d1b17;
        --ink-t2: #5a554d;
        --ink-t3: #726b61;
        --ink-t4: #8f887d;
        --ink-l1: rgba(29, 27, 23, 0.06);
        --ink-l2: rgba(29, 27, 23, 0.12);
        --ink-l3: rgba(29, 27, 23, 0.2);
        --ink-zhu: #b03a24;
        --ink-zhu-lift: #d4553d;
        --ink-zhu-press: #9c2e1a;
        --ink-on-zhu: #fff7f0;
        --ink-zhu-wash: rgba(198, 65, 42, 0.1);
        --ink-lamp: #b8801f;
        --ink-lamp-glow: rgba(184, 128, 31, 0.35);
        --ink-lamp-wash: rgba(184, 128, 31, 0.12);
        --ink-pine: #3d7c5e;
        --ink-pine-lift: #4d9370;
        --ink-pine-wash: rgba(61, 124, 94, 0.12);
        --ink-crimson: #9c2e3d;
        --ink-crimson-wash: rgba(156, 46, 61, 0.1);
        --ink-azure: #3a7797;
        --ink-azure-wash: rgba(58, 119, 151, 0.12);
        --ink-slab: #1f1c18;
        --ink-slab-t: #efe9df;
        --ink-slab-ph: #8d857a;
        --ink-slab-chip: rgba(255, 255, 255, 0.08);
        --ink-slab-line: rgba(255, 255, 255, 0.12);
        --ink-sh1: 0 1px 2px rgba(60, 45, 20, 0.06), 0 0 0 1px var(--ink-l2);
        --ink-sh2: 0 4px 12px -2px rgba(60, 45, 20, 0.12), 0 0 0 1px var(--ink-l2);
        --ink-sh-trough: inset 0 1px 3px rgba(30, 20, 10, 0.15), inset 0 0 0 1px var(--ink-l2);
      }
    }

    html[data-theme='light'],
    html[data-theme-id*='paper'],
    html[data-theme-id*='light'] {
      --ink-void: #e6e1d7;
      --ink-s1: #f0ece4;
      --ink-s2: #f8f6f0;
      --ink-s3: #fffdf8;
      --ink-s4: #ffffff;
      --ink-t1: #1d1b17;
      --ink-t2: #5a554d;
      --ink-t3: #726b61;
      --ink-t4: #8f887d;
      --ink-l1: rgba(29, 27, 23, 0.06);
      --ink-l2: rgba(29, 27, 23, 0.12);
      --ink-l3: rgba(29, 27, 23, 0.2);
      --ink-zhu: #b03a24;
      --ink-zhu-lift: #d4553d;
      --ink-zhu-press: #9c2e1a;
      --ink-on-zhu: #fff7f0;
      --ink-zhu-wash: rgba(198, 65, 42, 0.1);
      --ink-lamp: #b8801f;
      --ink-lamp-glow: rgba(184, 128, 31, 0.35);
      --ink-lamp-wash: rgba(184, 128, 31, 0.12);
      --ink-pine: #3d7c5e;
      --ink-pine-lift: #4d9370;
      --ink-pine-wash: rgba(61, 124, 94, 0.12);
      --ink-crimson: #9c2e3d;
      --ink-crimson-wash: rgba(156, 46, 61, 0.1);
      --ink-azure: #3a7797;
      --ink-slab: #1f1c18;
      --ink-slab-t: #efe9df;
      --ink-slab-ph: #8d857a;
      --ink-slab-chip: rgba(255, 255, 255, 0.08);
      --ink-slab-line: rgba(255, 255, 255, 0.12);
      --ink-sh1: 0 1px 2px rgba(60, 45, 20, 0.06), 0 0 0 1px var(--ink-l2);
      --ink-sh2: 0 4px 12px -2px rgba(60, 45, 20, 0.12), 0 0 0 1px var(--ink-l2);
      --ink-sh-trough: inset 0 1px 3px rgba(30, 20, 10, 0.15), inset 0 0 0 1px var(--ink-l2);
    }

    /* ─── Keyframe Animations (砚池研磨与燃灯呼吸) ─────────────────── */
    @keyframes ink-grind-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes ink-breath-pulse {
      0%, 100% {
        opacity: 0.85;
        box-shadow: 0 0 0 0 var(--ink-lamp-glow);
      }
      50% {
        opacity: 1;
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink-lamp-glow) 35%, transparent);
      }
    }

    /* ─── 砚石台面容器 (Inkstone Card Slab) ────────────────────────── */
    .devin-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px 16px 24px;
      margin: 8px 0;
      border: 1px solid var(--ink-l2);
      border-radius: var(--r-card, 10px);
      background: linear-gradient(180deg, var(--ink-s2) 0%, color-mix(in srgb, var(--ink-s2) 90%, black) 100%);
      box-shadow: var(--ink-sh1);
      font-family: var(--ink-sans);
      box-sizing: border-box;
      width: 100%;
      overflow: hidden;
      transition: border-color 0.2s var(--ink-ease-out), box-shadow 0.2s var(--ink-ease-out);
    }

    .devin-card:hover {
      border-color: var(--ink-l3);
      box-shadow: var(--ink-sh2);
    }

    /* ─── Inkstone 标志性左侧色脊线 (Signature Left Accent Spine) ── */
    .devin-card::before {
      content: '';
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 3.5px;
      border-radius: 0 2px 2px 0;
      background: var(--ink-l3);
      transition: background-color 0.2s ease, width 0.2s ease;
    }

    /* 状态脊线色彩绑定 */
    .devin-card[data-ink-spine='pine']::before,
    .devin-card.spine-pine::before {
      background: var(--ink-pine);
      box-shadow: 0 0 8px color-mix(in srgb, var(--ink-pine) 40%, transparent);
    }

    .devin-card[data-ink-spine='lamp']::before,
    .devin-card.spine-lamp::before {
      background: var(--ink-lamp);
      box-shadow: 0 0 8px color-mix(in srgb, var(--ink-lamp) 50%, transparent);
    }

    .devin-card[data-ink-spine='zhu']::before,
    .devin-card.spine-zhu::before {
      background: var(--ink-zhu);
      box-shadow: 0 0 8px color-mix(in srgb, var(--ink-zhu) 40%, transparent);
    }

    .devin-card[data-ink-spine='crimson']::before,
    .devin-card.spine-crimson::before {
      background: var(--ink-crimson);
      box-shadow: 0 0 8px color-mix(in srgb, var(--ink-crimson) 40%, transparent);
    }

    /* ─── 砚石题头与眉标 (Eyebrow & Headings) ──────────────────────── */
    .devin-card-eyebrow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: -4px;
      font-family: var(--ink-mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink-t3);
      user-select: none;
    }

    .devin-card-eyebrow .eyebrow-scope {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .devin-card-eyebrow .eyebrow-id {
      color: var(--ink-t4);
      font-variant-numeric: tabular-nums;
    }

    .devin-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .devin-title {
      display: flex;
      align-items: center;
      gap: 9px;
      font-family: var(--ink-serif);
      font-size: 15px;
      font-weight: 600;
      color: var(--ink-t1);
      letter-spacing: 0.02em;
      line-height: 1.3;
    }

    /* ─── 砚印标志 (Inkstone Brand Seal · 红色背景的“砚”) ───────── */
    .brand-seal,
    .devin-title-icon {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      min-width: 22px;
      min-height: 22px;
      border-radius: 3.5px;
      background: var(--ink-zhu, #b03a24) !important;
      color: var(--ink-on-zhu, #ffffff) !important;
      font-family: var(--ink-serif, 'Noto Serif SC', 'Songti SC', 'STSong', serif);
      font-size: 13.5px;
      font-weight: 600;
      line-height: 1;
      outline: 1px solid rgba(255, 255, 255, 0.45);
      outline-offset: -3px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      transform: rotate(-1.5deg);
      flex: none;
      user-select: none;
      box-sizing: border-box;
      border: 0 !important;
    }

    /* ─── Inkstone 印章徽标 (Seal Badges) ─────────────────────────── */
    /* 采用正统 Piwin .seal 篆刻双线矩形印符 */
    .ink-seal {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 22px;
      padding: 0 8px;
      border-radius: 3px;
      font-family: var(--ink-sans);
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0.02em;
      white-space: nowrap;
      user-select: none;
      transform: rotate(-0.8deg);
      border: 1px solid transparent;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    /* 印面内部细微压印边框 */
    .ink-seal::after {
      content: '';
      position: absolute;
      inset: 2px;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 1.5px;
      pointer-events: none;
    }

    /* 松绿篆印 (Pine Seal · Active / Done) */
    .ink-seal.seal-pine {
      background: var(--ink-pine);
      color: #ffffff;
      border-color: color-mix(in srgb, var(--ink-pine) 80%, black);
    }
    .ink-seal.seal-pine::after {
      border-color: rgba(255, 255, 255, 0.4);
    }

    /* 燃灯暖金印 (Lamp Seal · Pending / In Flight) */
    .ink-seal.seal-lamp {
      background: var(--ink-lamp);
      color: #1e1505;
      border-color: color-mix(in srgb, var(--ink-lamp) 80%, black);
      animation: ink-breath-pulse 2.4s ease-in-out infinite;
    }
    .ink-seal.seal-lamp::after {
      border-color: rgba(30, 21, 5, 0.25);
    }

    /* 朱砂红印 (Zhu Seal · Auth / Prompt) */
    .ink-seal.seal-zhu {
      background: var(--ink-zhu);
      color: var(--ink-on-zhu);
      border-color: color-mix(in srgb, var(--ink-zhu) 75%, black);
    }
    .ink-seal.seal-zhu::after {
      border-color: rgba(255, 255, 255, 0.4);
    }

    /* 茜红印 (Crimson Seal · Error) */
    .ink-seal.seal-crimson {
      background: var(--ink-crimson);
      color: #ffffff;
      border-color: color-mix(in srgb, var(--ink-crimson) 80%, black);
    }

    /* 墨石幽灵印 (Ghost Seal · Settled / Muted) */
    .ink-seal.seal-ghost {
      background: var(--ink-s3);
      color: var(--ink-t3);
      border-color: var(--ink-l2);
      transform: none;
      box-shadow: none;
    }
    .ink-seal.seal-ghost::after {
      display: none;
    }

    /* 研磨转子 (Ink Grinding Spinner) */
    .ink-grind {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      border: 1.5px solid rgba(255, 255, 255, 0.3);
      border-top-color: currentColor;
      animation: ink-grind-spin 1.2s linear infinite;
      display: inline-block;
      flex-shrink: 0;
    }

    /* 兼容老代码的 badge 类名 */
    .devin-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2.5px 9px;
      border-radius: var(--r-pill, 999px);
      font-size: 11px;
      font-weight: 500;
      font-family: var(--ink-sans);
      border: 1px solid var(--ink-l2);
      color: var(--ink-t3);
      background: var(--ink-s3);
    }
    .devin-badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    /* ─── 砚台账册台面 (Inkstone Ledger Grid) ─────────────────────── */
    .ink-ledger {
      display: flex;
      flex-direction: column;
      gap: 1px;
      border-radius: var(--r-control, 7px);
      background: var(--ink-l2);
      border: 1px solid var(--ink-l2);
      overflow: hidden;
      margin: 2px 0;
    }

    .ink-ledger-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 14px;
      background: var(--ink-s3);
      font-size: 12.5px;
      transition: background-color 0.15s ease;
    }

    .ink-ledger-row:hover {
      background: var(--ink-s4);
    }

    .ink-ledger-key {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--ink-t3);
      font-size: 12px;
      font-weight: 500;
      flex-shrink: 0;
    }

    .ink-ledger-val {
      font-family: var(--ink-mono);
      font-size: 12px;
      color: var(--ink-t1);
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
      text-align: right;
    }

    /* ─── 工具标签与药丸 (Inkstone Tool Chips) ────────────────────── */
    .ink-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: var(--r-chip, 4px);
      background: var(--ink-slab);
      border: 1px solid var(--ink-l2);
      font-family: var(--ink-mono);
      font-size: 11px;
      color: var(--ink-t1);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    .ink-chip .chip-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--ink-pine);
    }

    /* ─── 砚石深槽 (Stone Trough for URL & Code) ──────────────────── */
    .ink-trough {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 14px;
      border-radius: var(--r-control, 7px);
      background: var(--ink-slab);
      border: 1px solid var(--ink-slab-line);
      box-shadow: var(--ink-sh-trough);
    }

    .ink-trough-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: var(--ink-mono);
      font-size: 10.5px;
      color: var(--ink-t3);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .devin-url-box {
      font-family: var(--ink-mono);
      font-size: 11.5px;
      line-height: 1.55;
      word-break: break-all;
      user-select: all;
      color: var(--ink-slab-t);
      background: transparent;
      padding: 0;
      border: 0;
    }

    /* ─── 钤印按键系统 (Inkstone Seal Buttons) ────────────────────── */
    .devin-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-top: 4px;
    }

    .devin-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 32px;
      padding: 0 14px;
      border-radius: var(--r-control, 7px);
      font-family: var(--ink-sans);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      box-sizing: border-box;
      text-decoration: none;
      transition: all 0.18s var(--ink-ease-out);
    }

    .devin-btn:focus-visible {
      outline: 2px solid var(--ink-zhu);
      outline-offset: 2px;
    }

    /* 朱红钤印主按键 (Vermillion Seal Button) */
    .devin-btn-primary,
    .devin-btn-zhu {
      background: var(--ink-zhu);
      color: var(--ink-on-zhu);
      border: 1px solid color-mix(in srgb, var(--ink-zhu) 75%, black);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .devin-btn-primary:hover,
    .devin-btn-zhu:hover {
      background: var(--ink-zhu-lift);
      transform: translateY(-0.5px);
      box-shadow: 0 4px 10px -1px color-mix(in srgb, var(--ink-zhu) 45%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    }

    .devin-btn-primary:active,
    .devin-btn-zhu:active {
      background: var(--ink-zhu-press);
      transform: translateY(0.5px);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    }

    /* 砚石副按键 (Stone Outline Button) */
    .devin-btn-outline {
      background: var(--ink-s3);
      border: 1px solid var(--ink-l2);
      color: var(--ink-t1);
      box-shadow: var(--ink-sh1);
    }

    .devin-btn-outline:hover {
      background: var(--ink-s4);
      border-color: var(--ink-l3);
      color: var(--ink-t1);
      transform: translateY(-0.5px);
    }

    .devin-btn-outline:active {
      transform: translateY(0.5px);
    }

    /* ─── 案头底注与提示 (Footnotes & Breadcrumbs) ────────────────── */
    .devin-tip {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: var(--ink-t3);
      line-height: 1.5;
      font-family: var(--ink-sans);
      margin-top: 2px;
    }

    .devin-tip code {
      font-family: var(--ink-mono);
      font-size: 11px;
      padding: 1.5px 6px;
      border-radius: var(--r-chip, 4px);
      background: var(--ink-s3);
      border: 1px solid var(--ink-l2);
      color: var(--ink-t2);
    }

    /* ─── 代码搜索卡片文件卷册 (Code Search Dossier) ──────────────── */
    .devin-code-file {
      border: 1px solid var(--ink-l2);
      border-radius: var(--r-control, 7px);
      overflow: hidden;
      margin-top: 6px;
      background: var(--ink-slab);
      box-shadow: var(--ink-sh-trough);
    }

    .devin-file-header {
      padding: 8px 14px;
      background: var(--ink-s3);
      border-bottom: 1px solid var(--ink-l2);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s ease;
    }

    .devin-file-header:hover {
      background: var(--ink-s4);
    }

    .devin-file-path {
      font-family: var(--ink-mono);
      font-size: 12px;
      font-weight: 500;
      color: var(--ink-t1);
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .devin-file-action {
      font-size: 11px;
      color: var(--ink-t3);
      display: flex;
      align-items: center;
      gap: 5px;
      font-family: var(--ink-sans);
    }

    .devin-code-pre {
      margin: 0;
      padding: 12px 14px;
      font-size: 12px;
      font-family: var(--ink-mono);
      line-height: 1.55;
      overflow-x: auto;
      white-space: pre;
      color: var(--ink-t1);
      background: transparent;
      cursor: pointer;
    }

    .devin-code-line-badge {
      display: inline-block;
      font-size: 11px;
      color: var(--ink-lamp);
      margin-bottom: 4px;
      font-family: var(--ink-mono);
      letter-spacing: 0.04em;
    }

    /* ─── Native command-input echo (blank-session activation only) ─── */
    /* Matches dsh-client-ui-goal GoalCommandInputView tokens. */
    .devin-command-input-row {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }

    .devin-command-input-stack {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      min-width: 0;
      max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);
    }

    .devin-command-input-bubble {
      max-width: 100%;
      padding: 10px 16px;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      border-radius: var(--dsw-radius-xl, 16px);
      background: var(--dsw-specific-bubble, var(--ink-s3));
      color: var(--dsw-alias-label-primary, var(--ink-t1));
      font-size: var(--dsh-content-font-size, 14px);
      line-height: calc(22px + var(--dsh-content-font-delta, 0px));
      font-family: var(--dsw-font-sans, var(--ink-sans));
      border: 0;
      box-shadow: none;
    }
  `
  document.head.appendChild(style)
}
