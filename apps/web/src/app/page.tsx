import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Agents } from "@/components/agents";
import { Commands } from "@/components/commands";
import { Features } from "@/components/features";
import { QuickStart } from "@/components/quick-start";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <Agents />
      <Commands />
      <Features />
      <QuickStart />
      <Footer />
    </main>
  );
}
