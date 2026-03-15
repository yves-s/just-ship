import type { Metadata } from "next";
import { Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://just-ship.io"),
  title: "Just Ship — From ticket to ship. Autonomously.",
  description:
    "A portable multi-agent framework for autonomous software development. Ship complex projects from ticket to ship — fully autonomous.",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/logos/png/favicons/mark-dark-favicon-32.png",
  },
  openGraph: {
    title: "Just Ship — From ticket to ship. Autonomously.",
    description:
      "A portable multi-agent framework for autonomous software development.",
    url: "https://just-ship.io",
    siteName: "Just Ship",
    type: "website",
    images: [
      {
        url: "/og-dark.png",
        width: 1200,
        height: 630,
        alt: "Just Ship — From ticket to ship. Autonomously.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Just Ship — From ticket to ship. Autonomously.",
    description:
      "A portable multi-agent framework for autonomous software development.",
    images: ["/og-dark.png"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://just-ship.io/#website",
      name: "Just Ship",
      url: "https://just-ship.io",
      description:
        "A portable multi-agent framework for autonomous software development. Ship complex projects from ticket to ship — fully autonomous.",
      inLanguage: "en",
      publisher: { "@id": "https://just-ship.io/#organization" },
    },
    {
      "@type": "Organization",
      "@id": "https://just-ship.io/#organization",
      name: "Just Ship",
      url: "https://just-ship.io",
      logo: {
        "@type": "ImageObject",
        url: "https://just-ship.io/logos/svg/mark-outline-white.svg",
        caption: "Just Ship logo",
      },
      sameAs: ["https://github.com/yves-s/just-ship"],
      description:
        "Portable multi-agent framework for autonomous software development with Claude Code",
    },
    {
      "@type": "WebPage",
      "@id": "https://just-ship.io/#webpage",
      name: "Just Ship — From ticket to ship. Autonomously.",
      description:
        "A portable multi-agent framework for autonomous software development. Ship complex projects from ticket to ship — fully autonomous.",
      url: "https://just-ship.io",
      isPartOf: { "@id": "https://just-ship.io/#website" },
      about: { "@id": "https://just-ship.io/#software" },
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://just-ship.io/#software",
      name: "Just Ship",
      description:
        "A portable multi-agent framework for autonomous software development. Ship complex projects from ticket to ship — fully autonomous.",
      url: "https://just-ship.io",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Linux, macOS",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      programmingLanguage: ["TypeScript", "Bash"],
      downloadUrl: "https://github.com/yves-s/just-ship",
      author: { "@id": "https://just-ship.io/#organization" },
      keywords: [
        "multi-agent framework",
        "autonomous development",
        "Claude Code",
        "AI agents",
        "developer tools",
        "software automation",
      ],
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": "https://just-ship.io/#sourcecode",
      name: "just-ship",
      description:
        "Portable multi-agent framework for autonomous software development with Claude Code",
      codeRepository: "https://github.com/yves-s/just-ship",
      programmingLanguage: ["TypeScript", "Bash", "Markdown"],
      runtimePlatform: "Node.js",
      author: { "@id": "https://just-ship.io/#organization" },
      targetProduct: { "@id": "https://just-ship.io/#software" },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${sora.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
