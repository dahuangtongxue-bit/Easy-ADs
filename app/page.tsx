import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import Marquee from "@/components/Marquee";
import Gallery from "@/components/Gallery";
import Templates from "@/components/Templates";
import Flow from "@/components/Flow";
import Stats from "@/components/Stats";
import Compliance from "@/components/Compliance";
import LeadForm from "@/components/LeadForm";
import Footer from "@/components/Footer";
import { loadShowcase } from "@/lib/showcase-server";

export default function Page() {
  const { items } = loadShowcase();
  const hero = items.find((i) => i.hero) || items[0];
  const gallery = items.filter((i) => !i.hero || items.length <= 3);
  const hasShowcase = items.length > 0;

  return (
    <>
      <Nav hasShowcase={hasShowcase} />
      <main>
        <Hero hero={hero} hasShowcase={hasShowcase} />
        <Marquee />
        {hasShowcase && (
          <section id="showcase" className="border-b hairline">
            <div className="mx-auto max-w-site px-5 py-20 md:px-8 md:py-28">
              <div className="eyebrow">Showcase · Seedance 2.5</div>
              <h2 className="display mt-4 text-[32px] md:text-[52px]">Seedance 2.5 出的片</h2>
              <p className="mt-5 max-w-[40em] text-[16px] leading-relaxed text-ink-2">
                每一场都是模型单次连续生成，场与场之间无损拼接，没有模板套壳。悬停预览，点开有声。
              </p>
              <div className="mt-10">
                <Gallery items={gallery} />
              </div>
            </div>
          </section>
        )}
        <Stats />
        <Templates items={items} />
        <Flow />
        <Compliance />
        <LeadForm />
      </main>
      <Footer />
    </>
  );
}
