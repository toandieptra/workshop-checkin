export interface LandingImage {
  url: string;
  alt?: string;
}

export interface LandingHero {
  displayTitle: string;
  tagline: string;
  description: string;
  image: LandingImage;
  ctaLabel: string;
  ctaHref?: string;
}

export interface LandingMarquee {
  images: LandingImage[];
}

export interface LandingAbout {
  heading: string;
  description: string;
  promise: string;
  decorImages: LandingImage[];
}

export interface LandingProgramItem {
  title: string;
  description: string;
  meta?: string;
}

export interface LandingProgram {
  heading: string;
  items: LandingProgramItem[];
}

export interface LandingHighlightCard {
  category: string;
  title: string;
  description: string;
  images: LandingImage[];
  ctaLabel: string;
  ctaHref?: string;
}

export interface LandingHighlights {
  heading: string;
  cards: LandingHighlightCard[];
  outcomes: string[];
  ctaLabel: string;
  ctaHref?: string;
  contact: {
    organizer: string;
    email: string;
    phone: string;
  };
}

export interface LandingSeo {
  title: string;
  description: string;
}

export interface LandingContent {
  hero: LandingHero;
  marquee: LandingMarquee;
  about: LandingAbout;
  program: LandingProgram;
  highlights: LandingHighlights;
  seo: LandingSeo;
}

/**
 * Local product imagery used by the default landing page. Keeping these under
 * /public makes the landing page work without third-party image hosts and
 * keeps the builder preview deterministic.
 */
const LOCAL_ASSET_BASE = "/landing-assets/workshop/";

export const DEFAULT_MARQUEE_FILES = [
  "marquee-products/01-nho-xanh.webp",
  "marquee-products/02-siro-luu.webp",
  "marquee-products/03-mut-xoai-xanh.webp",
  "marquee-products/04-mut-kiwi-tao-xanh.webp",
  "marquee-products/05-mut-oi-hoa-anh-dao.webp",
  "marquee-products/06-nho-xanh.webp",
  "marquee-products/07-black-sugar-pearl.webp",
  "marquee-products/08-peach-cheese-pearls.webp",
  "marquee-products/09-bot-thach-rau-cau.webp",
  "marquee-products/10-qua-hong-bi.webp",
];

export const DEFAULT_CARD_FILES = [
  "highlight-01-experience-cup.webp",
  "highlight-02-experience-table.webp",
  "highlight-03-experience-space.webp",
  "highlight-04-hands-on-pour.webp",
  "highlight-05-hands-on-ingredients.webp",
  "highlight-06-hands-on-counter.webp",
  "highlight-07-result-tray.webp",
  "highlight-08-result-guest.webp",
  "highlight-09-result-hero.webp",
];

const DEFAULT_CARD_ALTS = [
  "Cận cảnh ly trà trong trải nghiệm workshop",
  "Bàn workshop với nguyên liệu và ly trà",
  "Không gian workshop với quầy thực hành",
  "Người hướng dẫn rót trà vào ly",
  "Nguyên liệu và topping được chuẩn bị cho phần thực hành",
  "Học viên thực hành tại quầy pha chế",
  "Khay trà trái cây thành phẩm",
  "Học viên nâng ly trà vừa hoàn thiện",
  "Ly trà trái cây nhiều lớp với đá và trái cây tươi",
];

const DEFAULT_MARQUEE_ALTS = [
  "Nho xanh LerMao cùng ly trà nho kem",
  "Siro lựu LerMao cùng ly nước lựu đá",
  "Mứt xoài xanh LerMao cùng trà xoài bạc hà",
  "Mứt kiwi táo xanh LerMao cùng ly trái cây tươi",
  "Mứt ổi hoa anh đào LerMao cùng ly nước ổi hồng",
  "Nho xanh LerMao cùng ly nước nho vàng",
  "Trân châu đường đen LerMao cùng trà sữa",
  "Trân châu đào nhân phomai LerMao cùng trà sữa đào",
  "Bột thạch rau câu LerMao cùng các loại thạch trái cây",
  "Quả hồng bì đông lạnh LerMao cùng ly nước hồng bì",
];

const FIGMA_BASE =
  "https://shrug-person-78902957.figma.site/_components/v2/ebb2b8f25d8e24d5f0a5ca8af4c950de81aa2fd7/";

export const DEFAULT_HERO_IMAGE =
  "https://shrug-person-78902957.figma.site/_components/v2/d24c01ad3a56fc65e942a1f501eb73db42d7cf9a/Rectangle_40443.81459862.png";

export const DEFAULT_DECOR_IMAGES: LandingImage[] = [
  { url: `${FIGMA_BASE}moon_icon.11395d36.png`, alt: "" },
  { url: `${FIGMA_BASE}p59_1.4659672e.png`, alt: "" },
  { url: `${FIGMA_BASE}lego_icon-1.703bb594.png`, alt: "" },
  { url: `${FIGMA_BASE}Group_134-1.2e04f3ce.png`, alt: "" },
];

export function marqueeImageUrl(file: string): string {
  return file.startsWith("http") || file.startsWith("/")
    ? file
    : `${LOCAL_ASSET_BASE}${file}`;
}

export function cardImageUrl(file: string): string {
  return file.startsWith("http") || file.startsWith("/")
    ? file
    : `${LOCAL_ASSET_BASE}${file}`;
}

export function defaultMarqueeImages(): LandingImage[] {
  return DEFAULT_MARQUEE_FILES.map((file, index) => ({
    url: marqueeImageUrl(file),
    alt: DEFAULT_MARQUEE_ALTS[index] || "Hình ảnh minh họa workshop",
  }));
}

export interface LandingWorkshopSeed {
  name: string;
  eventDate?: string | null;
  eventTime?: string | null;
  location?: string | null;
  registerUrl?: string;
}

function seedDate(seed: LandingWorkshopSeed): string {
  if (!seed.eventDate) return "[DD/MM/YYYY]";
  const [y, m, d] = seed.eventDate.split("-");
  if (!y || !m || !d) return "[DD/MM/YYYY]";
  return `${d}/${m}/${y}`;
}

function seedTime(seed: LandingWorkshopSeed): string {
  if (!seed.eventTime) return "[HH:MM]";
  return seed.eventTime.slice(0, 5);
}

export function buildDefaultContent(seed: LandingWorkshopSeed): LandingContent {
  const ctaHref = seed.registerUrl || "";
  return {
    hero: {
      displayTitle: seed.name.toUpperCase(),
      tagline: "[TAGLINE NGẮN VỀ WORKSHOP]",
      description: "[MÔ TẢ WORKSHOP — dành cho ai, học được gì]",
      image: { url: DEFAULT_HERO_IMAGE, alt: "" },
      ctaLabel: "Đăng ký tham gia",
      ctaHref,
    },
    marquee: { images: defaultMarqueeImages() },
    about: {
      heading: "Về workshop",
      description: "[MÔ TẢ WORKSHOP — dành cho ai, học được gì]",
      promise: "[LỜI HỨA WORKSHOP]",
      decorImages: DEFAULT_DECOR_IMAGES,
    },
    program: {
      heading: "Timeline Workshop",
      items: [
        { title: "Nền tảng", description: "[MÔ TẢ MODULE 01]" },
        { title: "Phương pháp", description: "[MÔ TẢ MODULE 02]" },
        { title: "Thực hành", description: "[MÔ TẢ MODULE 03]" },
        { title: "Phản hồi và hoàn thiện", description: "[MÔ TẢ MODULE 04]" },
        { title: "Kế hoạch ứng dụng", description: "[MÔ TẢ MODULE 05]" },
      ],
    },
    highlights: {
      heading: "Điểm nổi bật",
      cards: [
        {
          category: "Trải nghiệm",
          title: "Trải nghiệm workshop",
          description: "[MÔ TẢ ĐIỂM NỔI BẬT 01]",
          images: DEFAULT_CARD_FILES.slice(0, 3).map((f, imageIndex) => ({
            url: cardImageUrl(f),
            alt: DEFAULT_CARD_ALTS[imageIndex],
          })),
          ctaLabel: "Xem chi tiết",
          ctaHref: "",
        },
        {
          category: "Thực hành",
          title: "Thực hành trực tiếp",
          description: "[MÔ TẢ ĐIỂM NỔI BẬT 02]",
          images: DEFAULT_CARD_FILES.slice(3, 6).map((f, imageIndex) => ({
            url: cardImageUrl(f),
            alt: DEFAULT_CARD_ALTS[imageIndex + 3],
          })),
          ctaLabel: "Xem chi tiết",
          ctaHref: "",
        },
        {
          category: "Kết quả",
          title: "Kết quả mang về",
          description: "[MÔ TẢ ĐIỂM NỔI BẬT 03]",
          images: DEFAULT_CARD_FILES.slice(6, 9).map((f, imageIndex) => ({
            url: cardImageUrl(f),
            alt: DEFAULT_CARD_ALTS[imageIndex + 6],
          })),
          ctaLabel: "Xem chi tiết",
          ctaHref: "",
        },
      ],
      outcomes: [
        "Chọn nhóm vị phù hợp với menu trà, café hoặc trà trái cây của quán.",
        "Phác thảo biến thể từ nguyên liệu đang có để thử tại quầy.",
        "Ưu tiên quy trình pha chế dễ lặp lại theo nhịp vận hành.",
        "Cân nhắc giá vốn và khả năng bán thử trước khi chốt món.",
      ],
      ctaLabel: "Đăng ký tham gia",
      ctaHref,
      contact: { organizer: "[ĐƠN VỊ TỔ CHỨC]", email: "[EMAIL]", phone: "[SỐ ĐIỆN THOẠI]" },
    },
    seo: {
      title: `${seed.name} — Workshop`,
      description: "",
    },
  };
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function pickOptionalString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickImages(value: unknown, fallback: LandingImage[]): LandingImage[] {
  if (!Array.isArray(value)) return fallback;
  const images = value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      url: typeof item.url === "string" ? item.url : "",
      alt: typeof item.alt === "string" ? item.alt : "",
    }))
    .filter((item) => item.url);
  return images.length ? images : fallback;
}

function isLegacyMarqueeAsset(url: string): boolean {
  return (
    url.includes("motionsites.ai") ||
    /(^|\/)hero-[^/]+\.gif(?:$|\?)/i.test(url) ||
    /(^|\/)v2-\d+-marquee-[^/]+\.webp(?:$|\?)/i.test(url) ||
    /(^|\/)marquee-ai\/\d+-[^/]+\.webp(?:$|\?)/i.test(url) ||
    /(^|\/)lermao-(?:movang|mutyuzu|nhan|quathongbi|ximuoi)\.webp(?:$|\?)/i.test(url)
  );
}

function isLegacyCardAsset(url: string): boolean {
  return (
    url.includes("images.higgs.ai") ||
    url.includes("cloudfront.net") ||
    /(^|\/)(?:hf_[^/]+|highlight-(?:dark-)?\d+[^/]*)\.(?:png|jpe?g|webp)(?:$|\?)/i.test(url) ||
    /(^|\/)v2-0[1-9]-[^/]+\.webp(?:$|\?)/i.test(url)
  );
}

function replaceLegacyImages(
  images: LandingImage[],
  fallback: LandingImage[],
  isLegacy: (url: string) => boolean,
  replaceLocalLegacy = false,
): LandingImage[] {
  return images.map((image, index) =>
    (replaceLocalLegacy || !image.url.startsWith(LOCAL_ASSET_BASE)) &&
    isLegacy(image.url) &&
    fallback.length
      ? fallback[index % fallback.length]
      : image,
  );
}

/**
 * Gộp nội dung đã lưu với defaults để renderer luôn có đủ dữ liệu.
 * Trường thiếu sẽ dùng giá trị mặc định (placeholder rõ ràng).
 */
export function normalizeLandingContent(
  raw: Record<string, unknown> | null | undefined,
  defaults: LandingContent,
): LandingContent {
  if (!raw || typeof raw !== "object") return defaults;
  const hero = (raw.hero ?? {}) as Record<string, unknown>;
  const marquee = (raw.marquee ?? {}) as Record<string, unknown>;
  const about = (raw.about ?? {}) as Record<string, unknown>;
  const program = (raw.program ?? {}) as Record<string, unknown>;
  const highlights = (raw.highlights ?? {}) as Record<string, unknown>;
  const seo = (raw.seo ?? {}) as Record<string, unknown>;
  const contact = (highlights.contact ?? {}) as Record<string, unknown>;

  const programItems = Array.isArray(program.items)
    ? program.items
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          title: typeof item.title === "string" ? item.title : "",
          description: typeof item.description === "string" ? item.description : "",
          meta: typeof item.meta === "string" ? item.meta : "",
        }))
    : defaults.program.items;

  const highlightCards = Array.isArray(highlights.cards)
    ? highlights.cards
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item, index) => {
          const fallback = defaults.highlights.cards[index] ?? defaults.highlights.cards[0];
          const images = replaceLegacyImages(
            pickImages(item.images, fallback.images),
            fallback.images,
            isLegacyCardAsset,
          );
          return {
            category: pickString(item.category, fallback.category),
            title: pickString(item.title, fallback.title),
            description: typeof item.description === "string" ? item.description : "",
            images,
            ctaLabel: pickString(item.ctaLabel, "Xem chi tiết"),
            ctaHref: typeof item.ctaHref === "string" ? item.ctaHref : "",
          };
        })
    : defaults.highlights.cards;

  const highlightOutcomes = Array.isArray(highlights.outcomes)
    ? highlights.outcomes
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 4)
    : defaults.highlights.outcomes;

  const rawMarqueeImages = pickImages(marquee.images, defaults.marquee.images);
  // A saved draft can still contain the previous built-in marquee set. Treat
  // an all-legacy set as the default so it receives the complete replacement
  // set, including the new image count, instead of only being mapped by index.
  const hasOnlyLegacyMarqueeImages =
    rawMarqueeImages.length > 0 &&
    rawMarqueeImages.every((image) => isLegacyMarqueeAsset(image.url));
  const marqueeImages = hasOnlyLegacyMarqueeImages
    ? defaults.marquee.images
    : replaceLegacyImages(rawMarqueeImages, defaults.marquee.images, isLegacyMarqueeAsset, true);

  return {
    hero: {
      displayTitle: pickString(hero.displayTitle, defaults.hero.displayTitle),
      tagline: pickString(hero.tagline, defaults.hero.tagline),
      description: pickString(hero.description, defaults.hero.description),
      image: pickImages(hero.image ? [hero.image] : [], [defaults.hero.image])[0],
      ctaLabel: pickString(hero.ctaLabel, defaults.hero.ctaLabel),
      ctaHref: typeof hero.ctaHref === "string" ? hero.ctaHref : defaults.hero.ctaHref,
    },
    marquee: { images: marqueeImages },
    about: {
      heading: pickString(about.heading, defaults.about.heading),
      description: pickString(about.description, defaults.about.description),
      promise: pickString(about.promise, defaults.about.promise),
      decorImages: pickImages(about.decorImages, defaults.about.decorImages),
    },
    program: {
      heading: pickString(program.heading, defaults.program.heading),
      items: programItems.length ? programItems : defaults.program.items,
    },
    highlights: {
      heading: pickString(highlights.heading, defaults.highlights.heading),
      cards: highlightCards.length ? highlightCards : defaults.highlights.cards,
      outcomes: highlightOutcomes.length ? highlightOutcomes : defaults.highlights.outcomes,
      ctaLabel: pickString(highlights.ctaLabel, defaults.highlights.ctaLabel),
      ctaHref: typeof highlights.ctaHref === "string" ? highlights.ctaHref : defaults.highlights.ctaHref,
      contact: {
        organizer: pickOptionalString(contact.organizer, defaults.highlights.contact.organizer),
        email: pickOptionalString(contact.email, defaults.highlights.contact.email),
        phone: pickOptionalString(contact.phone, defaults.highlights.contact.phone),
      },
    },
    seo: {
      title: pickString(seo.title, defaults.seo.title),
      description: typeof seo.description === "string" ? seo.description : defaults.seo.description,
    },
  };
}
