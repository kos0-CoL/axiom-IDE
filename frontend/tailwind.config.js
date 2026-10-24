/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primitive tokens
        substrate: {
          DEFAULT: '#0A0A0A',
          elevated: '#101010',
          border: '#1A1A1A',
        },
        phosphor: {
          DEFAULT: '#EAEAEA',
          muted: '#A0A0A0',
          dim: '#666666',
        },
        aviation: {
          red: '#FF2A2A',
          redDim: '#4A0D0D',
        },
        verified: {
          green: '#4AF626',
          greenDim: '#0D4A0D',
        },
        // Semantic tokens
        bg: {
          primary: 'var(--color-bg-primary)',
          secondary: 'var(--color-bg-secondary)',
          tertiary: 'var(--color-bg-tertiary)',
        },
        fg: {
          primary: 'var(--color-fg-primary)',
          secondary: 'var(--color-fg-secondary)',
          muted: 'var(--color-fg-muted)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          focus: 'var(--color-border-focus)',
        },
        accent: {
          red: 'var(--color-accent-red)',
          green: 'var(--color-accent-green)',
        },
        // Component tokens
        card: {
          bg: 'var(--color-card-bg)',
          border: 'var(--color-card-border)',
        },
        button: {
          primary: 'var(--color-button-primary)',
          primaryHover: 'var(--color-button-primary-hover)',
          secondary: 'var(--color-button-secondary)',
          secondaryHover: 'var(--color-button-secondary-hover)',
          danger: 'var(--color-button-danger)',
          dangerHover: 'var(--color-button-danger-hover)',
        },
        input: {
          bg: 'var(--color-input-bg)',
          border: 'var(--color-input-border)',
          focus: 'var(--color-input-focus)',
        },
        status: {
          verified: 'var(--color-status-verified)',
          pending: 'var(--color-status-pending)',
          blocked: 'var(--color-status-blocked)',
          running: 'var(--color-status-running)',
        },
      },
      fontFamily: {
        macro: ['Inter', 'system-ui', 'sans-serif'],
        micro: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'macro-title': ['clamp(3rem, 8vw, 10rem)', { lineHeight: '0.9', letterSpacing: '-0.04em', fontWeight: '900', textTransform: 'uppercase' }],
        'macro-sub': ['clamp(1.5rem, 3vw, 2.5rem)', { lineHeight: '0.9', letterSpacing: '-0.04em', fontWeight: '700', textTransform: 'uppercase' }],
        'micro-base': ['11px', { lineHeight: '1.5', letterSpacing: '0.08em', fontWeight: '400', textTransform: 'uppercase' }],
        'micro-sm': ['10px', { lineHeight: '1.5', letterSpacing: '0.08em', fontWeight: '400', textTransform: 'uppercase' }],
        'micro-lg': ['13px', { lineHeight: '1.5', letterSpacing: '0.08em', fontWeight: '500', textTransform: 'uppercase' }],
      },
      spacing: {
        'grid-gap': '1px',
      },
      borderRadius: {
        'none': '0',
      },
      boxShadow: {
        'card': '0 0 0 1px var(--color-card-border)',
        'focus': '0 0 0 2px var(--color-border-focus)',
      },
      backgroundImage: {
        'scanlines': "url(\"data:image/svg+xml,%3Csvg width='2' height='4' viewBox='0 0 2 4' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23ffffff' fill-opacity='0.02' d='M0 0h2v2H0V0zm0 2h2v2H0v-2z'/%3E%3C/svg%3E\")",
        'grain': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
}