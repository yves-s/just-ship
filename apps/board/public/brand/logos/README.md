# Just Ship — Logo Assets

Alle Orbit-Logo-Varianten in SVG und PNG.

## Struktur

```
logos/
├── mark/                        # Logo Mark (nur Orbit)
│   ├── mark-{32..512}.svg       # Transparenter Hintergrund, verschiedene Grössen
│   ├── mark-{32..512}.png       # PNG-Versionen
│   ├── mark-light-bg.svg/png    # Auf warmem Hintergrund (#FAF9F7)
│   ├── mark-dark-bg.svg/png     # Auf dunklem Hintergrund (#111113)
│   ├── mark-mono-dark.svg/png   # Einfarbig schwarz
│   └── mark-mono-white.svg/png  # Einfarbig weiss
│
├── horizontal/                  # Mark + Wortmarke nebeneinander
│   ├── horizontal-{32..64}.svg  # Verschiedene Mark-Grössen
│   ├── horizontal-light-bg.*    # Auf hellem Hintergrund
│   └── horizontal-dark-bg.*     # Auf dunklem Hintergrund
│
├── stacked/                     # Mark oben, Wortmarke unten
│   ├── stacked-light.*          # Transparenter Hintergrund
│   ├── stacked-dark.*           # Dunkler Hintergrund
│   └── stacked-light-bg.*       # Warmer Hintergrund
│
├── app-icon/                    # App-Icons (Orbit auf Indigo-Hintergrund)
│   ├── app-icon-{16..1024}.*    # iOS, Android, Web (22% corner radius)
│   └── app-icon-android-512.*   # Android Adaptive (kein Radius, System-Maske)
│
├── favicon/                     # Favicons
│   ├── favicon.ico              # Multi-Size ICO (16+32+48)
│   ├── favicon-{16,32,48}.svg   # SVG-Quellen
│   └── favicon-{16,32,48}.png   # PNG-Versionen + @2x Retina
│
└── social/                      # Social Media / Open Graph
    ├── og-image.*               # 1200×630 (Twitter, LinkedIn, etc.)
    └── github-social.*          # 1280×640 (GitHub Repository)
```

## Verwendung

| Kontext              | Datei                              |
|----------------------|------------------------------------|
| Website Favicon      | `favicon/favicon.ico`              |
| Next.js `favicon`    | `favicon/favicon-32.svg`           |
| Apple Touch Icon     | `app-icon/app-icon-180.png`        |
| Android PWA          | `app-icon/app-icon-192.png`        |
| Board Sidebar        | `app-icon/app-icon-32.png`         |
| Navbar               | `horizontal/horizontal-32.svg`     |
| README / Docs        | `horizontal/horizontal-light-bg.svg` |
| OG Image             | `social/og-image.png`              |
| GitHub Social        | `social/github-social.png`         |
| Print / Merchandise  | `mark/mark-512.svg`                |

## Farben

- **Ring & Agent Dot:** Indigo `#6366F1`
- **Task Dot:** Orange `#F97316`
- **Dark Variant:** Ring & Agent in Weiss `#FFFFFF`
- **Wortmarke:** "just" in Textfarbe, "ship" in Indigo
