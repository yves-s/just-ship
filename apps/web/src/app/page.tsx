import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Differentiation } from "@/components/differentiation";
import { Agents } from "@/components/agents";
import { Commands } from "@/components/commands";
import { Features } from "@/components/features";
import { Skills } from "@/components/skills";
import { Showcase } from "@/components/showcase";
import { QuickStart } from "@/components/quick-start";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <Differentiation />
      <Agents />
      <Commands />
      <Features />
      <Skills />
      <Showcase />
      <QuickStart />
      <Footer />
    </main>
  );
}
